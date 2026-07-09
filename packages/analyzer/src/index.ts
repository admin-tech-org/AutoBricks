/**
 * @bricks-cdp/analyzer — Analyze Worker stage (ARCHITECTURE §20).
 *
 * analyzeCapture(capture, ctx):
 *   screenshot pixels -> screenshot stats
 *   -> detect sections -> detect layout per section -> detect theme
 *   -> VisionAnalysis -> mergeDomVision + createPageIR + normalizeIR
 *   -> AnalysisReport
 *   -> writes <storageRoot>/ir/<jobId>/page-ir.json
 *      and <storageRoot>/reports/<jobId>/analysis-report.json
 *
 * Heuristic only — no network, no AI calls.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  AnalysisReport,
  AnalysisResult,
  CaptureResult,
  ComponentIR,
  PageIR,
  StageContext,
  VisionAnalysis,
  VisionSection,
} from "@bricks-cdp/ir";
import { MAX_COMPONENTS_PER_SECTION, createPageIR, normalizeIR } from "@bricks-cdp/ir";
import {
  ScreenshotStats,
  analyzeScreenshot,
  dominantColorInRect,
  dominantPaletteInRect,
  hexToRgb,
  luminance,
  parseCssColor,
  readPng,
} from "./analyze-screenshot";
import { classifyComponents, countComponents } from "./classify-components";
import { detectLayouts } from "./detect-layout";
import { detectPageType, detectSections } from "./detect-sections";
import { DetectedTheme, detectTheme } from "./detect-theme";
import { reconstructSectionChildren } from "./reconstruct-layout";
import { runVisionAI } from "./vision-ai";

export * from "./analyze-screenshot";
export * from "./detect-theme";
export * from "./detect-sections";
export * from "./detect-layout";
export * from "./classify-components";
export * from "./reconstruct-layout";

/**
 * Flip text colours that are illegible against their effective background.
 * Effective background = the element's own backgroundColor, else the nearest
 * ancestor that paints one, else the section's, else the page theme background
 * (defaulting to white). Contrast below 3:1 (WCAG's large-text minimum) is
 * treated as objectively unreadable and replaced with white or near-black —
 * whichever the background contrasts with. Text that already passes is untouched.
 */
export function fixUnreadableText(pageIR: PageIR): void {
  const MIN_CONTRAST = 3;
  const lumOf = (css: string | undefined): number | undefined => {
    const rgb = css ? parseCssColor(css) : null;
    return rgb ? luminance(rgb) : undefined;
  };
  const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const pageBgLum = lumOf(pageIR.theme?.backgroundColor) ?? 1;
  const walk = (comps: ComponentIR[] | undefined, parentBgLum: number): void => {
    if (!comps) return;
    for (const c of comps) {
      const ownBgLum = lumOf(c.style?.["backgroundColor"] ?? c.style?.["background-color"]);
      const bgLum = ownBgLum ?? parentBgLum;
      const textCss = c.style?.["color"];
      if (c.text && c.text.trim() && textCss) {
        const tLum = lumOf(textCss);
        if (tLum !== undefined && contrast(tLum, bgLum) < MIN_CONTRAST) {
          c.style = { ...(c.style ?? {}), color: bgLum < 0.5 ? "#ffffff" : "#1a1a1a" };
        }
      }
      walk(c.children, bgLum);
    }
  };
  for (const section of pageIR.sections) {
    const secBgLum = lumOf(section.style?.["backgroundColor"] ?? section.style?.["background-color"]) ?? pageBgLum;
    walk(section.children, secBgLum);
  }
}

export async function analyzeCapture(capture: CaptureResult, ctx: StageContext): Promise<AnalysisResult> {
  const jobId = ctx.jobId || capture.jobId;
  const url = capture.url || ctx.url;
  const { dom, css, layout } = capture;

  // 1. screenshot pixel statistics (optional — screenshot may be missing).
  // The decoded PNG is kept for per-section background sampling further down.
  let stats: ScreenshotStats | undefined;
  let fullPagePng: import("pngjs").PNG | undefined;
  const shots = capture.savedPaths ? capture.savedPaths.screenshots : undefined;
  const screenshotPath =
    (shots && (shots.fullPage || shots.desktop)) ||
    (capture.screenshots && (capture.screenshots.fullPage || capture.screenshots.desktop));
  if (screenshotPath) {
    try {
      fullPagePng = readPng(screenshotPath);
      stats = analyzeScreenshot(fullPagePng);
    } catch {
      stats = undefined;
      fullPagePng = undefined;
    }
  }

  // 2. sections
  let sections: VisionSection[];
  try {
    sections = detectSections(dom, layout, css);
  } catch {
    sections = [];
  }
  if (sections.length === 0) {
    sections = [
      {
        id: "visual_sec_content",
        type: "content",
        layout: "one-column",
        box: { x: 0, y: 0, width: layout.pageWidth || 1440, height: layout.pageHeight || 900 },
        confidence: 0.3,
      },
    ];
  }

  // 3. layout per section (mobile layout confirms column stacking when present)
  sections = detectLayouts(sections, dom, layout, capture.mobileLayout);

  // 4. theme (CSS + screenshot; falls back to CSS-only when pixels missing)
  let theme: DetectedTheme = {};
  try {
    theme = detectTheme({ dom, css, layout, screenshot: stats, sections }).theme;
  } catch {
    theme = stats ? { mode: stats.mode, backgroundColor: stats.backgroundColor } : {};
  }

  // 5. page type
  const pageType = detectPageType(sections);

  const vision: VisionAnalysis = { pageType, theme, sections };

  // 6. Page IR (merge + normalize) — never throw on weird pages.
  //    In "structural" layout mode, rebuild each section's children as the real
  //    nested container tree (row/column/grid) reconstructed from box geometry +
  //    computed flex CSS, instead of the flat, label-guessed heuristic children
  //    (SPEC §5.1). Reconstruction runs BEFORE normalizeIR so the rebuilt tree
  //    is normalized like any other. The heuristic path is untouched by default.
  let pageIR: PageIR;
  try {
    const base = createPageIR({ url, vision, dom, css, layout });
    if (ctx.layoutMode === "structural") {
      for (const section of base.sections) {
        try {
          const rebuilt = reconstructSectionChildren(section, dom, css, layout);
          if (rebuilt.length > 0) {
            section.children = rebuilt;
            section.layout = "structural";
          }
        } catch {
          // Fall back to the heuristic children for this section on any failure.
        }
      }
    }
    pageIR = normalizeIR(base);
  } catch {
    pageIR = { url, pageType, theme: { ...theme }, sections: [] };
  }

  // 6b. Backgrounds from screenshot pixels (§22: Color = Computed CSS +
  // screenshot). Gradients/background-images can't be mapped from computed
  // CSS, leaving light text on a missing (white) background. For sections —
  // and nested blocks (cards) — without an explicit background, sample the
  // screenshot region and pick a color that CONTRASTS with the text inside:
  // light text demands a dark sampled candidate and vice versa.
  if (fullPagePng && layout.pageHeight > 0 && layout.pageWidth > 0) {
    const png = fullPagePng;
    const scaleX = png.width / layout.pageWidth;
    const scaleY = png.height / layout.pageHeight;
    const toRect = (box: { x: number; y: number; width: number; height: number }) => ({
      x: box.x * scaleX,
      y: box.y * scaleY,
      width: box.width * scaleX,
      height: box.height * scaleY,
    });
    const lum = (hex: string | undefined): number | undefined => {
      const rgb = hex ? hexToRgb(hex) : null;
      return rgb ? luminance(rgb) : undefined;
    };
    const lightTextRatio = (comps: ComponentIR[]): number => {
      let light = 0;
      let total = 0;
      const walk = (list: ComponentIR[]) => {
        for (const c of list) {
          const color = c.style ? parseCssColor(c.style["color"]) : null;
          if (color && c.text) {
            total++;
            if (luminance(color) > 0.8) light++;
          }
          if (c.children) walk(c.children);
        }
      };
      walk(comps);
      return total === 0 ? 0 : light / total;
    };
    const collectForegroundRects = (comps: ComponentIR[]): Array<{ x: number; y: number; width: number; height: number }> => {
      const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
      const walk = (list: ComponentIR[]) => {
        for (const c of list) {
          // big images / cards are foreground, not background
          if ((c.type === "image" || c.type === "block") && c.box && c.box.width * c.box.height > 40000) {
            rects.push(toRect(c.box));
          }
          if (c.children) walk(c.children);
        }
      };
      walk(comps);
      return rects.slice(0, 24);
    };
    const pickBackground = (
      box: { x: number; y: number; width: number; height: number },
      wantDark: boolean,
      excludeComps?: ComponentIR[]
    ): string | undefined => {
      try {
        const rect = toRect(box);
        const exclude = excludeComps ? collectForegroundRects(excludeComps) : undefined;
        const edges = dominantColorInRect(png, rect, "edges", exclude);
        if (!wantDark) return edges ?? dominantColorInRect(png, rect, "interior", exclude);
        // Light text needs a dark background: try edge dominant, then walk the
        // interior palette for the highest-share dark bucket.
        const edgeLum = lum(edges);
        if (edges && edgeLum !== undefined && edgeLum < 0.55) return edges;
        const palette = dominantPaletteInRect(png, rect, "interior", exclude);
        for (const cand of palette) {
          const l = lum(cand.hex);
          if (l !== undefined && l < 0.55 && cand.ratio >= 0.08) return cand.hex;
        }
        return palette.length > 0 ? palette[0].hex : edges;
      } catch {
        return undefined;
      }
    };
    const hasBg = (style?: Record<string, string>) =>
      !!(style && (style["backgroundColor"] || style["background-color"]));
    const fillBlockBackgrounds = (comps: ComponentIR[]) => {
      for (const c of comps) {
        if (c.type === "block" && c.box && c.box.height >= 60 && !hasBg(c.style) && c.children && lightTextRatio(c.children) > 0.5) {
          const hex = pickBackground(c.box, true, c.children);
          if (hex !== undefined && (lum(hex) ?? 1) < 0.55) c.style = { ...(c.style || {}), backgroundColor: hex };
        }
        if (c.children) fillBlockBackgrounds(c.children);
      }
    };
    for (const section of pageIR.sections) {
      if (section.box && section.box.height >= 40 && !hasBg(section.style)) {
        const wantDark = lightTextRatio(section.children) > 0.5;
        const hex = pickBackground(section.box, wantDark, section.children);
        // Never write a background that would hide the section's text.
        const l = lum(hex);
        if (hex !== undefined && !(wantDark && l !== undefined && l > 0.8)) {
          section.style = { ...(section.style || {}), backgroundColor: hex };
        }
      }
      fillBlockBackgrounds(section.children);
    }
  }
  if (pageIR.sections.length === 0) {
    let comps: ComponentIR[];
    try {
      comps = classifyComponents(dom, css, layout);
    } catch {
      comps = [];
    }
    pageIR.sections = [
      {
        id: "sec_content",
        type: "content",
        layout: "one-column",
        box: { x: 0, y: 0, width: layout.pageWidth || 1440, height: layout.pageHeight || 900 },
        children: comps.slice(0, MAX_COMPONENTS_PER_SECTION),
        confidence: 0.3,
      },
    ];
    pageIR = normalizeIR(pageIR);
  }

  // 6c. AI vision refinement (§8 upgrade): fan out parallel claude-cli vision
  // subagents — one per section plus one global — that read the rendered
  // pixels and correct backgrounds/gradients/typography/layout per §22
  // (Color/Theme style come from the screenshot). The heuristic result above
  // is the baseline and the fallback for every task that fails.
  let visionMode: "heuristic" | "ai" = "heuristic";
  let visionAIReportPath: string | undefined;
  if (ctx.vision && ctx.vision.mode === "ai" && screenshotPath && layout.pageWidth > 0 && layout.pageHeight > 0) {
    // Vision may correct colours/typography per section, but it returns a
    // heuristic layout label ("one-column", …). Remember which sections were
    // reconstructed structurally so we can re-assert that marker afterwards —
    // otherwise the structural planner is bypassed and the nested tree gets
    // re-planned (and bloated) by the heuristic path.
    const structuralIds = new Set(
      pageIR.sections.filter((s) => s.layout === "structural").map((s) => s.id)
    );
    const out = await runVisionAI(
      {
        pageIR,
        screenshotPath,
        pageWidth: layout.pageWidth,
        pageHeight: layout.pageHeight,
        jobId,
        storageRoot: path.resolve(ctx.storageRoot),
        url,
      },
      ctx.vision
    );
    visionAIReportPath = out.savedPaths.visionAIReport;
    if (out.report.tasks.some((t) => t.status === "ok")) {
      visionMode = "ai";
      try {
        pageIR = normalizeIR(out.pageIR);
      } catch {
        pageIR = out.pageIR;
      }
      if (structuralIds.size > 0) {
        for (const s of pageIR.sections) if (structuralIds.has(s.id)) s.layout = "structural";
      }
    }
  }

  // 6d. Legibility guard (deterministic, always on). Some captured text colours
  // are unreadable against their effective background — dark text on a dark
  // banner, a link whose real (white) colour wasn't the computed one at capture,
  // etc. Any text failing even the loosest contrast bar (< 3:1, below WCAG's
  // large-text minimum → objectively illegible) is flipped to a readable colour.
  // It never touches text that already passes, so well-designed pages are inert.
  try {
    fixUnreadableText(pageIR);
  } catch {
    // legibility is best-effort — never fail analysis over it
  }

  // 7. report
  const report: AnalysisReport = {
    jobId,
    url,
    pageType: pageIR.pageType,
    visionMode,
    theme: pageIR.theme,
    sections: pageIR.sections.map((s) => ({
      id: s.id,
      type: s.type,
      layout: s.layout,
      box: s.box,
      confidence: s.confidence,
      componentCount: countComponents(s.children),
    })),
    createdAt: new Date().toISOString(),
  };

  // 8. persist
  const storageRoot = path.resolve(ctx.storageRoot);
  const irDir = path.join(storageRoot, "ir", jobId);
  const reportsDir = path.join(storageRoot, "reports", jobId);
  await fs.promises.mkdir(irDir, { recursive: true });
  await fs.promises.mkdir(reportsDir, { recursive: true });

  const pageIRPath = path.join(irDir, "page-ir.json");
  const analysisReportPath = path.join(reportsDir, "analysis-report.json");
  await fs.promises.writeFile(pageIRPath, JSON.stringify(pageIR, null, 2), "utf8");
  await fs.promises.writeFile(analysisReportPath, JSON.stringify(report, null, 2), "utf8");

  const savedPaths: AnalysisResult["savedPaths"] = { pageIR: pageIRPath, analysisReport: analysisReportPath };
  if (visionAIReportPath) savedPaths.visionAIReport = visionAIReportPath;
  return { vision, pageIR, report, savedPaths };
}
