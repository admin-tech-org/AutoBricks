/**
 * Section detection (ARCHITECTURE §21 rules) on the desktop
 * LayoutSnapshot + DomSnapshot.
 *
 * Candidate: visible block whose width >= 92% of pageWidth and height > 250
 * (semantic tags section/header/footer/main/nav accepted with height > 60).
 * Candidates are merged into non-overlapping top-level bands covering the
 * page top-to-bottom; large gaps become generic bands. Each band is then
 * classified (header/hero/features/cta/footer/testimonial/pricing/content)
 * with a rule-hit-ratio confidence.
 */

import type { Box, CssSnapshot, DomNode, DomSnapshot, LayoutSnapshot, VisionSection } from "@bricks-cdp/ir";
import { MAX_SECTIONS, hasButtonStyling, isTransparentColor, parsePx } from "@bricks-cdp/ir";

const SEMANTIC_TAGS = new Set(["section", "header", "footer", "main", "nav"]);

type Band = {
  y0: number;
  y1: number;
  tags: Set<string>;
  synthetic: boolean;
};

type BandInfo = {
  height: number;
  headings: DomNode[];
  headingText: string;
  linkCount: number;
  buttonCount: number;
  hasNavTag: boolean;
  containsLargestHeading: boolean;
  cardCount: number;
  hasColoredBackground: boolean;
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function detectSections(dom: DomSnapshot, layout: LayoutSnapshot, css?: CssSnapshot): VisionSection[] {
  const boxOf = (n: DomNode): Box => layout.boxes[n.id] || n.box;
  const visible = dom.nodes.filter((n) => {
    const b = boxOf(n);
    return n.visible && b.width > 0 && b.height > 0;
  });

  const pageWidth = layout.pageWidth > 0 ? layout.pageWidth : maxRight(visible, boxOf) || 1440;
  const pageHeight = layout.pageHeight > 0 ? layout.pageHeight : maxBottom(visible, boxOf) || 900;

  const candidates = pickCandidates(visible, boxOf, pageWidth, pageHeight);
  let bands = buildBands(candidates, boxOf);
  bands = fillGaps(bands, pageHeight);
  bands = capBands(bands, MAX_SECTIONS);

  if (bands.length === 0) {
    bands = [{ y0: 0, y1: pageHeight, tags: new Set<string>(), synthetic: true }];
  }

  return classifyBands(bands, visible, boxOf, pageWidth, css);
}

/** pageType per the analyzer flow rules. */
export function detectPageType(sections: VisionSection[]): string {
  const types = new Set(sections.map((s) => s.type));
  const hasHero = types.has("hero");
  const hasFeaturesOrCta = types.has("features") || types.has("cta");
  if (hasHero && hasFeaturesOrCta) {
    return types.has("pricing") ? "saas-landing-page" : "landing-page";
  }
  return "content-page";
}

// ---------------------------------------------------------------------------
// Candidates + bands
// ---------------------------------------------------------------------------

function maxRight(nodes: DomNode[], boxOf: (n: DomNode) => Box): number {
  return nodes.reduce((acc, n) => Math.max(acc, boxOf(n).x + boxOf(n).width), 0);
}

function maxBottom(nodes: DomNode[], boxOf: (n: DomNode) => Box): number {
  return nodes.reduce((acc, n) => Math.max(acc, boxOf(n).y + boxOf(n).height), 0);
}

function pickCandidates(
  visible: DomNode[],
  boxOf: (n: DomNode) => Box,
  pageWidth: number,
  pageHeight: number
): DomNode[] {
  let candidates = visible.filter((n) => {
    const b = boxOf(n);
    const tag = n.tag.toLowerCase();
    const fullWidthBlock = b.width >= 0.92 * pageWidth && b.height > 250;
    const semantic = SEMANTIC_TAGS.has(tag) && b.height > 60 && b.width >= 0.5 * pageWidth;
    return fullWidthBlock || semantic;
  });

  // Drop giant wrappers (body/main-like) that vertically contain >= 2 other candidates.
  candidates = candidates.filter((c) => {
    const cb = boxOf(c);
    if (cb.height <= 0.7 * pageHeight) return true;
    let contained = 0;
    for (const o of candidates) {
      if (o === c) continue;
      const ob = boxOf(o);
      if (ob.height >= cb.height) continue;
      if (ob.y >= cb.y - 2 && ob.y + ob.height <= cb.y + cb.height + 2) contained += 1;
      if (contained >= 2) return false;
    }
    return true;
  });

  return candidates;
}

function buildBands(candidates: DomNode[], boxOf: (n: DomNode) => Box): Band[] {
  const sorted = [...candidates].sort((a, b) => boxOf(a).y - boxOf(b).y || boxOf(b).height - boxOf(a).height);
  let bands: Band[] = [];

  for (const c of sorted) {
    const b = boxOf(c);
    const y0 = b.y;
    const y1 = b.y + b.height;
    const hit = bands.find((band) => verticalOverlapRatio(band.y0, band.y1, y0, y1) > 0.6);
    if (hit) {
      hit.y0 = Math.min(hit.y0, y0);
      hit.y1 = Math.max(hit.y1, y1);
      hit.tags.add(c.tag.toLowerCase());
    } else {
      bands.push({ y0, y1, tags: new Set([c.tag.toLowerCase()]), synthetic: false });
    }
  }

  // repeat merging until stable (unions can create new overlaps)
  for (let pass = 0; pass < 5; pass++) {
    const merged = mergeOverlappingBands(bands);
    if (merged.length === bands.length) {
      bands = merged;
      break;
    }
    bands = merged;
  }

  // clip small residual overlaps, drop slivers
  bands.sort((a, b) => a.y0 - b.y0);
  const out: Band[] = [];
  for (const band of bands) {
    const prev = out[out.length - 1];
    if (prev && band.y0 < prev.y1) band.y0 = prev.y1;
    if (band.y1 - band.y0 >= 50) out.push(band);
  }
  return out;
}

export function verticalOverlapRatio(a0: number, a1: number, b0: number, b1: number): number {
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  const minH = Math.min(a1 - a0, b1 - b0);
  return minH > 0 ? overlap / minH : 0;
}

function mergeOverlappingBands(bands: Band[]): Band[] {
  const sorted = [...bands].sort((a, b) => a.y0 - b.y0);
  const out: Band[] = [];
  for (const band of sorted) {
    const prev = out[out.length - 1];
    if (prev && verticalOverlapRatio(prev.y0, prev.y1, band.y0, band.y1) > 0.6) {
      prev.y0 = Math.min(prev.y0, band.y0);
      prev.y1 = Math.max(prev.y1, band.y1);
      for (const t of band.tags) prev.tags.add(t);
    } else {
      out.push(band);
    }
  }
  return out;
}

const MIN_GAP = 250;

function fillGaps(bands: Band[], pageHeight: number): Band[] {
  const out: Band[] = [];
  let cursor = 0;
  for (const band of bands) {
    if (band.y0 - cursor > MIN_GAP) {
      out.push({ y0: cursor, y1: band.y0, tags: new Set<string>(), synthetic: true });
    }
    out.push(band);
    cursor = Math.max(cursor, band.y1);
  }
  if (pageHeight - cursor > MIN_GAP) {
    out.push({ y0: cursor, y1: pageHeight, tags: new Set<string>(), synthetic: true });
  }
  return out;
}

function capBands(bands: Band[], max: number): Band[] {
  const out = [...bands];
  while (out.length > max) {
    // merge the adjacent pair with the smallest combined height
    let bestIdx = 0;
    let bestH = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 1 < out.length; i++) {
      const h = out[i + 1].y1 - out[i].y0;
      if (h < bestH) {
        bestH = h;
        bestIdx = i;
      }
    }
    const a = out[bestIdx];
    const b = out[bestIdx + 1];
    for (const t of b.tags) a.tags.add(t);
    a.y1 = b.y1;
    a.synthetic = a.synthetic && b.synthetic;
    out.splice(bestIdx + 1, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Band classification
// ---------------------------------------------------------------------------

function classifyBands(
  bands: Band[],
  visible: DomNode[],
  boxOf: (n: DomNode) => Box,
  pageWidth: number,
  css?: CssSnapshot
): VisionSection[] {
  const largestHeadingId = findLargestHeadingId(visible, boxOf, css);

  const infos = bands.map((band) => collectBandInfo(band, visible, boxOf, pageWidth, largestHeadingId, css));

  const typeCounts = new Map<string, number>();
  let heroFound = false;

  return bands.map((band, i) => {
    const info = infos[i];
    const { type, confidence } = classifyBand(band, info, i, bands.length, heroFound);
    if (type === "hero") heroFound = true;

    const n = (typeCounts.get(type) || 0) + 1;
    typeCounts.set(type, n);
    const id = n === 1 ? `visual_sec_${type}` : `visual_sec_${type}_${n}`;

    return {
      id,
      type,
      layout: "one-column", // refined by detect-layout
      box: { x: 0, y: band.y0, width: pageWidth, height: band.y1 - band.y0 },
      confidence,
    };
  });
}

function findLargestHeadingId(
  visible: DomNode[],
  boxOf: (n: DomNode) => Box,
  css?: CssSnapshot
): string | undefined {
  let best: string | undefined;
  let bestScore = 0;
  for (const n of visible) {
    if (!/^h[1-6]$/.test(n.tag.toLowerCase())) continue;
    const style = css ? css.styles[n.id] || {} : {};
    const fontSize = parsePx(style.fontSize);
    const score = fontSize !== undefined ? fontSize : boxOf(n).height;
    if (score > bestScore) {
      bestScore = score;
      best = n.id;
    }
  }
  return best;
}

function collectBandInfo(
  band: Band,
  visible: DomNode[],
  boxOf: (n: DomNode) => Box,
  pageWidth: number,
  largestHeadingId: string | undefined,
  css?: CssSnapshot
): BandInfo {
  const inBand = visible.filter((n) => {
    const b = boxOf(n);
    const cy = b.y + b.height / 2;
    return cy >= band.y0 && cy < band.y1;
  });

  const headings = inBand.filter((n) => /^h[1-6]$/.test(n.tag.toLowerCase()));
  const headingText = headings.map((n) => (n.text || "").toLowerCase()).join(" ");
  const linkCount = inBand.filter((n) => n.tag.toLowerCase() === "a").length;
  const hasNavTag = band.tags.has("nav") || inBand.some((n) => n.tag.toLowerCase() === "nav");
  const buttonCount = inBand.filter((n) => {
    const tag = n.tag.toLowerCase();
    const role = (n.role || "").toLowerCase();
    if (tag === "button" || role === "button") return true;
    if (tag !== "a") return false;
    return css ? hasButtonStyling(css.styles[n.id] || {}) : false;
  }).length;
  const containsLargestHeading =
    largestHeadingId !== undefined && inBand.some((n) => n.id === largestHeadingId);
  const cardCount = largestSimilarSiblingGroup(inBand, boxOf);

  let hasColoredBackground = false;
  if (css) {
    const height = band.y1 - band.y0;
    const bandNode = inBand.find((n) => {
      const b = boxOf(n);
      return b.width >= 0.9 * pageWidth && b.height >= 0.8 * height && Math.abs(b.y - band.y0) <= 48;
    });
    if (bandNode) {
      const bg = (css.styles[bandNode.id] || {}).backgroundColor;
      hasColoredBackground = !isTransparentColor(bg) && !/rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/i.test(bg || "");
    }
  }

  return {
    height: band.y1 - band.y0,
    headings,
    headingText,
    linkCount,
    buttonCount,
    hasNavTag,
    containsLargestHeading,
    cardCount,
    hasColoredBackground,
  };
}

/**
 * Largest group of similar-size sibling blocks (the cards of a card grid):
 * same parent, comparable area, widths in the same 60px bucket.
 * Also used by detect-layout as the grid-layout fallback signal.
 */
export function largestSimilarSiblingGroupNodes(
  nodes: DomNode[],
  boxOf: (n: DomNode) => Box
): DomNode[] {
  const byParent = new Map<string, DomNode[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const b = boxOf(n);
    if (b.width * b.height < 8000 || b.width < 100 || b.height < 60) continue;
    const list = byParent.get(n.parentId);
    if (list) list.push(n);
    else byParent.set(n.parentId, [n]);
  }
  let best: DomNode[] = [];
  for (const group of byParent.values()) {
    if (group.length < 2) continue;
    const buckets = new Map<number, DomNode[]>();
    for (const n of group) {
      const key = Math.round(boxOf(n).width / 60);
      const list = buckets.get(key);
      if (list) list.push(n);
      else buckets.set(key, [n]);
    }
    for (const bucket of buckets.values()) {
      if (bucket.length > best.length) best = bucket;
    }
  }
  return best;
}

/** Size of the largest group of similar-size sibling blocks in the band. */
export function largestSimilarSiblingGroup(nodes: DomNode[], boxOf: (n: DomNode) => Box): number {
  return largestSimilarSiblingGroupNodes(nodes, boxOf).length;
}

function hitRatio(checks: boolean[]): number {
  const hits = checks.filter(Boolean).length;
  return Math.round((hits / checks.length) * 100) / 100;
}

function classifyBand(
  band: Band,
  info: BandInfo,
  index: number,
  total: number,
  heroFound: boolean
): { type: string; confidence: number } {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const h = info.height;

  // header — first short band with nav/logo links
  if (isFirst) {
    const checks = [h < 200, info.hasNavTag || band.tags.has("header"), info.linkCount >= 3];
    if ((h < 200 && (checks[1] || checks[2])) || (band.tags.has("header") && h < 300)) {
      return { type: "header", confidence: hitRatio(checks) };
    }
  }

  // footer — last band or an explicit footer tag
  if (band.tags.has("footer") || (isLast && total > 1 && heroFound)) {
    const checks = [band.tags.has("footer"), isLast, info.linkCount >= 2];
    if (band.tags.has("footer") || info.linkCount >= 2 || h < 600) {
      return { type: "footer", confidence: hitRatio(checks) };
    }
  }

  // hero — first tall band after the header containing the page's largest heading
  if (!heroFound && index <= 2 && h >= 300 && info.containsLargestHeading) {
    const checks = [h >= 300, index <= 1, info.containsLargestHeading, info.buttonCount >= 1];
    return { type: "hero", confidence: hitRatio(checks) };
  }

  // keyword hints
  if (/pric|plan\b|plans\b|tier/.test(info.headingText)) {
    const checks = [true, info.cardCount >= 2, info.buttonCount >= 1];
    return { type: "pricing", confidence: hitRatio(checks) };
  }
  if (/testimonial|review|customers?\s|clients?\s|loved by|trusted by|what .* say/.test(info.headingText)) {
    const checks = [true, info.cardCount >= 2];
    return { type: "testimonial", confidence: hitRatio(checks) };
  }

  // features — >= 3 similar-size card children
  if (info.cardCount >= 3) {
    const checks = [info.cardCount >= 3, info.headings.length >= 1, h >= 250];
    return { type: "features", confidence: hitRatio(checks) };
  }

  // cta — short colored band with heading + button
  if (h < 400 && info.headings.length >= 1 && info.buttonCount >= 1) {
    const checks = [h < 400, info.headings.length >= 1, info.buttonCount >= 1, info.hasColoredBackground];
    return { type: "cta", confidence: hitRatio(checks) };
  }

  return { type: "content", confidence: 0.5 };
}
