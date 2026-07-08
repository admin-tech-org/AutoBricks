/**
 * Theme detection — combines computed CSS with screenshot statistics per the
 * source priority matrix (ARCHITECTURE §22):
 *
 *  - backgroundColor: body computed CSS cross-checked against screenshot
 *    border pixels (prefer CSS, adjust + warn when they disagree strongly)
 *  - textColor: most common text color weighted by text length (CSS)
 *  - primaryColor: most common background among button-like nodes, else the
 *    most saturated dominant screenshot color
 *  - borderRadius: median of button/card radii (CSS)
 *  - fontFamily / fontStyle: body / first heading computed CSS
 *  - style: simple heuristic from radius + mode
 *  - sectionPaddingY: median vertical padding of detected sections (8px grid)
 *  - containerMaxWidth: most common width of centered 1000–1400px blocks (§21)
 */

import type {
  Box,
  CssSnapshot,
  DomNode,
  DomSnapshot,
  LayoutSnapshot,
  VisionSection,
  VisionTheme,
} from "@bricks-cdp/ir";
import { hasButtonStyling, isTransparentColor, parseFirstPx, parsePx } from "@bricks-cdp/ir";
import {
  Rgb,
  ScreenshotStats,
  colorDistance,
  hexToRgb,
  luminance,
  parseCssColor,
  rgbToHex,
  saturation,
} from "./analyze-screenshot";

export type DetectedTheme = VisionTheme & {
  fontFamily?: string;
  sectionPaddingY?: string;
  containerMaxWidth?: string;
  mutedTextColor?: string;
};

export type ThemeDetectionInput = {
  dom: DomSnapshot;
  css: CssSnapshot;
  layout: LayoutSnapshot;
  screenshot?: ScreenshotStats;
  sections?: VisionSection[];
};

export type ThemeDetectionResult = {
  theme: DetectedTheme;
  warnings: string[];
};

export function detectTheme(input: ThemeDetectionInput): ThemeDetectionResult {
  const { dom, css, layout, screenshot, sections } = input;
  const warnings: string[] = [];
  const styleOf = (id: string): Record<string, string> => css.styles[id] || {};
  const boxOf = (n: DomNode): Box => layout.boxes[n.id] || n.box;
  const theme: DetectedTheme = {};

  // background color -------------------------------------------------------
  const cssBg = detectCssBackground(dom, styleOf, boxOf, layout.pageWidth);
  const shotBg = screenshot ? hexToRgb(screenshot.backgroundColor) : null;
  let bg: Rgb | null = cssBg;
  if (cssBg && shotBg && colorDistance(cssBg, shotBg) > 120) {
    warnings.push(
      `Computed body background ${rgbToHex(cssBg)} disagrees strongly with screenshot border ` +
        `pixels ${rgbToHex(shotBg)}; using the screenshot value.`
    );
    bg = shotBg;
  } else if (!cssBg && shotBg) {
    bg = shotBg;
  }
  if (bg) theme.backgroundColor = rgbToHex(bg);

  // mode --------------------------------------------------------------------
  if (screenshot) theme.mode = screenshot.mode;
  else if (bg) theme.mode = luminance(bg) >= 0.5 ? "light" : "dark";

  // text color -----------------------------------------------------------
  // §22 (Color -> Computed CSS): the body/root computed color is the page
  // text color when available; the weighted vote (fontSize x text length)
  // only decides mutedTextColor (and textColor as a fallback).
  const bodyColor = detectBodyTextColor(dom, styleOf);
  const textVotes = weightedTextColors(dom, styleOf);
  const textHex = bodyColor ? rgbToHex(bodyColor) : textVotes.length > 0 ? textVotes[0].hex : undefined;
  if (textHex) {
    theme.textColor = textHex;
    const muted = textVotes.find((c) => c.hex !== textHex);
    if (muted) theme.mutedTextColor = muted.hex;
  }

  // primary color ------------------------------------------------------------
  const primary = detectPrimaryColor(dom, styleOf, screenshot, bg);
  if (primary) theme.primaryColor = primary;

  // border radius --------------------------------------------------------------
  const radius = detectBorderRadius(dom, styleOf, boxOf, layout.pageWidth);
  if (radius !== undefined) theme.borderRadius = `${radius}px`;

  // typography -----------------------------------------------------------------
  const fontFamily = detectFontFamily(dom, styleOf);
  if (fontFamily) theme.fontFamily = fontFamily;
  theme.fontStyle = describeFontStyle(fontFamily);

  // style description ------------------------------------------------------------
  theme.style = describeStyle(radius, theme.mode);

  // section vertical rhythm --------------------------------------------------
  if (sections && sections.length > 0) {
    const spy = detectSectionPaddingY(sections, dom, styleOf, boxOf, layout.pageWidth);
    if (spy) theme.sectionPaddingY = spy;
  }

  // container width ------------------------------------------------------------
  const cmw = detectContainerMaxWidth(dom, boxOf, layout.pageWidth);
  if (cmw) theme.containerMaxWidth = cmw;

  return { theme, warnings };
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

function detectCssBackground(
  dom: DomSnapshot,
  styleOf: (id: string) => Record<string, string>,
  boxOf: (n: DomNode) => Box,
  pageWidth: number
): Rgb | null {
  const body =
    dom.nodes.find((n) => n.tag.toLowerCase() === "body") || dom.nodes.find((n) => n.parentId === null);
  if (body) {
    const c = parseCssColor(styleOf(body.id).backgroundColor);
    if (c) return c;
  }
  // fall back to the first full-width opaque block near the top
  for (const n of dom.nodes) {
    if (!n.visible) continue;
    const b = boxOf(n);
    if (pageWidth > 0 && b.width < 0.95 * pageWidth) continue;
    if (b.y > 100) continue;
    const value = styleOf(n.id).backgroundColor;
    if (isTransparentColor(value)) continue;
    const c = parseCssColor(value);
    if (c) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text color
// ---------------------------------------------------------------------------

type WeightedColor = { hex: string; weight: number };

/** Computed text color of the body (or root) node, when the CSS snapshot has it. */
function detectBodyTextColor(
  dom: DomSnapshot,
  styleOf: (id: string) => Record<string, string>
): Rgb | null {
  const body =
    dom.nodes.find((n) => n.tag.toLowerCase() === "body") || dom.nodes.find((n) => n.parentId === null);
  if (!body) return null;
  return parseCssColor(styleOf(body.id).color);
}

/** Vote per color, weighted by text length x font size (headings count more). */
function weightedTextColors(
  dom: DomSnapshot,
  styleOf: (id: string) => Record<string, string>
): WeightedColor[] {
  const weights = new Map<string, number>();
  for (const n of dom.nodes) {
    if (!n.visible) continue;
    const text = (n.text || "").trim();
    if (text.length < 3) continue;
    const style = styleOf(n.id);
    const c = parseCssColor(style.color);
    if (!c) continue;
    const fontSize = Math.max(8, parsePx(style.fontSize) || 16);
    const hex = rgbToHex(c);
    weights.set(hex, (weights.get(hex) || 0) + text.length * fontSize);
  }
  return [...weights.entries()]
    .map(([hex, weight]) => ({ hex, weight }))
    .sort((a, b) => b.weight - a.weight);
}

// ---------------------------------------------------------------------------
// Primary color
// ---------------------------------------------------------------------------

function isButtonLike(n: DomNode, style: Record<string, string>): boolean {
  const tag = n.tag.toLowerCase();
  const role = (n.role || "").toLowerCase();
  if (!(tag === "a" || tag === "button" || role === "button")) return false;
  return hasButtonStyling(style);
}

function detectPrimaryColor(
  dom: DomSnapshot,
  styleOf: (id: string) => Record<string, string>,
  screenshot: ScreenshotStats | undefined,
  bg: Rgb | null
): string | undefined {
  // most common background-color among button-like nodes
  type Candidate = { hex: string; rgb: Rgb; count: number; sat: number };
  const counts = new Map<string, Candidate>();
  for (const n of dom.nodes) {
    if (!n.visible) continue;
    const style = styleOf(n.id);
    if (!isButtonLike(n, style)) continue;
    if (isTransparentColor(style.backgroundColor)) continue;
    const c = parseCssColor(style.backgroundColor);
    if (!c) continue;
    const hex = rgbToHex(c);
    const existing = counts.get(hex);
    if (existing) existing.count += 1;
    else counts.set(hex, { hex, rgb: c, count: 1, sat: saturation(c) });
  }
  // exclude inverted buttons (theme background / near-white / near-black);
  // break count ties by saturation so the brand color wins.
  const candidates = [...counts.values()].filter((c) => {
    if (bg && colorDistance(c.rgb, bg) < 40) return false;
    const lum = luminance(c.rgb);
    if (lum > 0.92 || lum < 0.06) return false;
    return true;
  });
  candidates.sort((a, b) => b.count - a.count || b.sat - a.sat);
  if (candidates.length > 0) return candidates[0].hex;

  // fallback: most saturated dominant screenshot color
  if (screenshot) {
    let bestScore = 0;
    let bestHex: string | undefined;
    for (const d of screenshot.dominantColors) {
      if (d.ratio < 0.005 || d.saturation < 0.25) continue;
      if (bg && colorDistance(d.rgb, bg) < 60) continue;
      const score = d.saturation * Math.sqrt(d.ratio);
      if (score > bestScore) {
        bestScore = score;
        bestHex = d.hex;
      }
    }
    return bestHex;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Border radius
// ---------------------------------------------------------------------------

function detectBorderRadius(
  dom: DomSnapshot,
  styleOf: (id: string) => Record<string, string>,
  boxOf: (n: DomNode) => Box,
  pageWidth: number
): number | undefined {
  const values: number[] = [];
  for (const n of dom.nodes) {
    if (!n.visible) continue;
    const style = styleOf(n.id);
    const b = boxOf(n);
    // full-width bands (header/footer/sections) are not buttons/cards and
    // would drag the median towards 0
    if (pageWidth > 0 && b.width > 0.6 * pageWidth) continue;
    const area = b.width * b.height;
    const buttonLike = isButtonLike(n, style);
    const shadow = style.boxShadow || "";
    const cardLike =
      area >= 10000 &&
      area <= 400000 &&
      ((shadow !== "" && shadow !== "none") || !isTransparentColor(style.backgroundColor));
    if (!buttonLike && !cardLike) continue;
    const r = parseFirstPx(style.borderRadius);
    if (r !== undefined && r >= 0 && r <= 200) values.push(r);
  }
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  return Math.round(values[Math.floor(values.length / 2)]);
}

// ---------------------------------------------------------------------------
// Typography + style description
// ---------------------------------------------------------------------------

function detectFontFamily(
  dom: DomSnapshot,
  styleOf: (id: string) => Record<string, string>
): string | undefined {
  const body =
    dom.nodes.find((n) => n.tag.toLowerCase() === "body") || dom.nodes.find((n) => n.parentId === null);
  const heading = dom.nodes.find((n) => /^h[1-2]$/.test(n.tag.toLowerCase()) && n.visible);
  for (const node of [body, heading]) {
    if (!node) continue;
    const value = styleOf(node.id).fontFamily;
    if (!value) continue;
    const first = value.split(",")[0].trim().replace(/^["']|["']$/g, "").trim();
    if (first) return first;
  }
  return undefined;
}

function describeFontStyle(fontFamily: string | undefined): string {
  const f = (fontFamily || "").toLowerCase();
  if (/mono|consolas|courier|code/.test(f)) return "monospace";
  if (/serif/.test(f) && !/sans/.test(f)) return "serif";
  return "modern sans-serif";
}

function describeStyle(radius: number | undefined, mode: "light" | "dark" | undefined): string {
  const r = radius || 0;
  const dark = mode === "dark";
  if (r >= 12) return dark ? "modern dark" : "modern minimal";
  if (r >= 6) return dark ? "clean dark" : "clean modern";
  return dark ? "sharp dark" : "sharp corporate";
}

// ---------------------------------------------------------------------------
// Section padding + container width
// ---------------------------------------------------------------------------

function detectSectionPaddingY(
  sections: VisionSection[],
  dom: DomSnapshot,
  styleOf: (id: string) => Record<string, string>,
  boxOf: (n: DomNode) => Box,
  pageWidth: number
): string | undefined {
  const values: number[] = [];
  for (const sec of sections) {
    if (!sec.box) continue;
    const band = sec.box;
    const bandNode = dom.nodes.find((n) => {
      if (!n.visible) return false;
      const b = boxOf(n);
      return (
        b.width >= 0.9 * (pageWidth || band.width) &&
        b.height >= 0.7 * band.height &&
        Math.abs(b.y - band.y) <= 48
      );
    });
    if (!bandNode) continue;
    const style = styleOf(bandNode.id);
    const pt = parsePx(style.paddingTop);
    const pb = parsePx(style.paddingBottom);
    if (pt !== undefined && pt > 0) values.push(pt);
    if (pb !== undefined && pb > 0) values.push(pb);
  }
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  const snapped = Math.round(median / 8) * 8;
  return snapped >= 8 ? `${snapped}px` : undefined;
}

function detectContainerMaxWidth(
  dom: DomSnapshot,
  boxOf: (n: DomNode) => Box,
  pageWidth: number
): string | undefined {
  if (pageWidth <= 0) return undefined;
  const pageCenter = pageWidth / 2;
  const counts = new Map<number, number>();
  for (const n of dom.nodes) {
    if (!n.visible) continue;
    const b = boxOf(n);
    if (b.width < 1000 || b.width > 1400 || b.height < 100) continue;
    if (Math.abs(b.x + b.width / 2 - pageCenter) > 40) continue;
    const key = Math.round(b.width / 10) * 10;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const [width, count] of counts) {
    if (count > bestCount) {
      best = width;
      bestCount = count;
    }
  }
  return best !== undefined ? `${best}px` : undefined;
}
