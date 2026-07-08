/**
 * createPageIR — assembles the full PageIR from the vision analysis and the
 * capture snapshots (ARCHITECTURE §10/§11).
 */

import type {
  Box,
  CssSnapshot,
  DomNode,
  DomSnapshot,
  LayoutSnapshot,
  PageIR,
  SectionIR,
  ThemeIR,
  VisionAnalysis,
  VisionTheme,
} from "./types";
import { mergeDomVision, parsePx } from "./merge-dom-vision";

export type CreatePageIRInput = {
  url: string;
  vision: VisionAnalysis;
  dom: DomSnapshot;
  css: CssSnapshot;
  layout: LayoutSnapshot;
};

/**
 * The analyzer's theme detector may attach extra ThemeIR fields
 * (fontFamily, sectionPaddingY, containerMaxWidth, mutedTextColor)
 * on top of VisionTheme. Read them when present, else derive here.
 */
type ExtendedVisionTheme = VisionTheme &
  Partial<Pick<ThemeIR, "fontFamily" | "sectionPaddingY" | "containerMaxWidth" | "mutedTextColor" | "radius">>;

export function createPageIR(input: CreatePageIRInput): PageIR {
  const { url, vision, dom, css, layout } = input;

  let sections: SectionIR[];
  try {
    sections = mergeDomVision(vision, dom, css, layout);
  } catch {
    sections = [];
  }

  const theme = buildThemeIR(vision, dom, css, layout, sections);

  return {
    url,
    pageType: vision.pageType || "content-page",
    theme,
    sections,
  };
}

// ---------------------------------------------------------------------------
// Theme assembly
// ---------------------------------------------------------------------------

function buildThemeIR(
  vision: VisionAnalysis,
  dom: DomSnapshot,
  css: CssSnapshot,
  layout: LayoutSnapshot,
  sections: SectionIR[]
): ThemeIR {
  const vt = (vision.theme || {}) as ExtendedVisionTheme;
  const theme: ThemeIR = {};

  if (vt.style) theme.style = vt.style;
  if (vt.mode) theme.mode = vt.mode;
  if (vt.primaryColor) theme.primaryColor = vt.primaryColor;
  if (vt.backgroundColor) theme.backgroundColor = vt.backgroundColor;
  if (vt.textColor) theme.textColor = vt.textColor;
  if (vt.mutedTextColor) theme.mutedTextColor = vt.mutedTextColor;

  const radius = vt.radius || vt.borderRadius;
  if (radius) theme.radius = radius;

  const fontFamily = vt.fontFamily || deriveFontFamily(dom, css);
  if (fontFamily) theme.fontFamily = fontFamily;

  const sectionPaddingY = vt.sectionPaddingY || deriveSectionPaddingY(sections);
  if (sectionPaddingY) theme.sectionPaddingY = sectionPaddingY;

  const containerMaxWidth = vt.containerMaxWidth || deriveContainerMaxWidth(dom, layout);
  if (containerMaxWidth) theme.containerMaxWidth = containerMaxWidth;

  return theme;
}

/** First font family of the body (or the first heading), quotes stripped. */
export function deriveFontFamily(dom: DomSnapshot, css: CssSnapshot): string | undefined {
  const candidates: DomNode[] = [];
  const body = dom.nodes.find((n) => n.tag.toLowerCase() === "body") || dom.nodes.find((n) => n.parentId === null);
  if (body) candidates.push(body);
  const heading = dom.nodes.find((n) => /^h[1-2]$/.test(n.tag.toLowerCase()) && n.visible);
  if (heading) candidates.push(heading);

  for (const node of candidates) {
    const family = firstFontFamily((css.styles[node.id] || {}).fontFamily);
    if (family) return family;
  }
  return undefined;
}

function firstFontFamily(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0].trim().replace(/^["']|["']$/g, "").trim();
  return first.length > 0 ? first : undefined;
}

/** Median vertical section padding, snapped to an 8px grid. */
export function deriveSectionPaddingY(sections: SectionIR[]): string | undefined {
  const values: number[] = [];
  for (const s of sections) {
    if (!s.style) continue;
    const pt = parsePx(s.style.paddingTop);
    const pb = parsePx(s.style.paddingBottom);
    if (pt !== undefined && pt > 0) values.push(pt);
    if (pb !== undefined && pb > 0) values.push(pb);
  }
  if (values.length === 0) return undefined;
  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  const snapped = Math.round(median / 8) * 8;
  return snapped >= 8 ? `${snapped}px` : undefined;
}

/** Most common width of centered blocks between 1000 and 1400px (§21). */
export function deriveContainerMaxWidth(dom: DomSnapshot, layout: LayoutSnapshot): string | undefined {
  const pageWidth = layout.pageWidth || 0;
  if (pageWidth <= 0) return undefined;
  const pageCenter = pageWidth / 2;
  const counts = new Map<number, number>();

  for (const node of dom.nodes) {
    if (!node.visible) continue;
    const b: Box = layout.boxes[node.id] || node.box;
    if (b.width < 1000 || b.width > 1400 || b.height < 100) continue;
    const center = b.x + b.width / 2;
    if (Math.abs(center - pageCenter) > 40) continue;
    const key = Math.round(b.width / 10) * 10;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  let bestWidth: number | undefined;
  let bestCount = 0;
  for (const [width, count] of counts) {
    if (count > bestCount || (count === bestCount && bestWidth !== undefined && width > bestWidth)) {
      bestWidth = width;
      bestCount = count;
    }
  }
  return bestWidth !== undefined ? `${bestWidth}px` : undefined;
}
