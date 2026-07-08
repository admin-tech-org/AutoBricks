/**
 * Per-section layout detection (ARCHITECTURE §21).
 *
 * Clusters a section's direct visible children by x-position:
 *  - 1 cluster  -> "one-column" (or "centered" when content max-width < 800
 *                  and horizontally centered)
 *  - 2 clusters of comparable height -> "two-column"
 *  - >= 3 similar-width siblings in a row -> "three-card-grid" / "grid"
 *
 * When the first sibling level stacks vertically (e.g. [section title,
 * grid wrapper]), heading/media/short-text siblings are excluded and the
 * detection descends into the dominant remaining wrapper to re-test for
 * columns/cards. As a final fallback, a group of >= 3 similar-size sibling
 * blocks anywhere in the section forces a grid layout (§21 similar-size rule).
 *
 * When a mobile LayoutSnapshot is provided, columns are confirmed by mobile
 * stacking; a "two-column" result whose children clearly stay side-by-side
 * on mobile is downgraded to "one-column".
 */

import type { Box, DomNode, DomSnapshot, LayoutSnapshot, VisionSection } from "@bricks-cdp/ir";
import { largestSimilarSiblingGroupNodes } from "./detect-sections";

const MIN_CHILD_AREA = 2000;
const MAX_DESCEND_DEPTH = 5;

export function detectSectionLayout(
  section: VisionSection,
  dom: DomSnapshot,
  layout: LayoutSnapshot,
  mobileLayout?: LayoutSnapshot
): string {
  const band = section.box;
  if (!band) return section.layout || "one-column";

  const boxOf = (n: DomNode): Box => layout.boxes[n.id] || n.box;
  const pageWidth = layout.pageWidth > 0 ? layout.pageWidth : band.width || 1440;

  const inBand = dom.nodes.filter((n) => {
    if (!n.visible) return false;
    const b = boxOf(n);
    if (b.width <= 0 || b.height <= 0) return false;
    const cy = b.y + b.height / 2;
    return cy >= band.y && cy < band.y + band.height;
  });
  if (inBand.length === 0) return "one-column";

  const idsInBand = new Set(inBand.map((n) => n.id));
  const childrenOf = new Map<string, DomNode[]>();
  for (const n of inBand) {
    if (n.parentId === null || !idsInBand.has(n.parentId)) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n);
    else childrenOf.set(n.parentId, [n]);
  }

  let current = findDirectChildren(inBand, childrenOf, idsInBand, boxOf);
  let single: { contentWidth: number; center: number } | null = null;

  for (let depth = 0; depth < MAX_DESCEND_DEPTH && current.length > 0; depth++) {
    const clusters = clusterByX(current.map(boxOf));

    if (clusters.length >= 3) {
      const widths = clusters.map((c) => c.x1 - c.x0);
      const maxW = Math.max(...widths);
      const minW = Math.min(...widths);
      const similar = minW > 0 && maxW / minW <= 1.4;
      const result = similar && clusters.length === 3 ? "three-card-grid" : "grid";
      return confirmWithMobile(result, current, mobileLayout);
    }

    if (clusters.length === 2) {
      const heights = clusters.map((c) => c.maxHeight);
      const minH = Math.min(...heights);
      const maxH = Math.max(...heights);
      if (maxH > 0 && minH / maxH >= 0.45) {
        return confirmWithMobile("two-column", current, mobileLayout);
      }
      // incomparable pair (e.g. small icon next to a big wrapper) — keep descending
    }

    if (!single && clusters.length === 1) {
      const c = clusters[0];
      single = { contentWidth: c.x1 - c.x0, center: (c.x0 + c.x1) / 2 };
    }

    // stacked so far: exclude heading/media/short-text siblings and descend
    // into the dominant remaining wrapper to re-test for columns/cards.
    const dominant = pickDominantWrapper(current, boxOf);
    if (!dominant) break;
    const kids = (childrenOf.get(dominant.id) || []).filter((n) => {
      const b = boxOf(n);
      return b.width * b.height >= MIN_CHILD_AREA;
    });
    if (kids.length === 0) break;
    current = kids;
  }

  // fallback (§21 similar-size rule): >= 3 similar-size sibling blocks
  // anywhere in the section force a grid layout.
  const cardGroup = largestSimilarSiblingGroupNodes(inBand, boxOf);
  if (cardGroup.length >= 3) {
    const result = cardGroup.length === 3 ? "three-card-grid" : "grid";
    return confirmWithMobile(result, cardGroup, mobileLayout);
  }

  const contentWidth = single ? single.contentWidth : band.width;
  const center = single ? single.center : pageWidth / 2;
  const centered = Math.abs(center - pageWidth / 2) < 100;
  if (contentWidth < 800 && centered) return "centered";
  return "one-column";
}

/** Convenience: apply detectSectionLayout across all sections. */
export function detectLayouts(
  sections: VisionSection[],
  dom: DomSnapshot,
  layout: LayoutSnapshot,
  mobileLayout?: LayoutSnapshot
): VisionSection[] {
  return sections.map((s) => {
    try {
      let detected = detectSectionLayout(s, dom, layout, mobileLayout);
      // A hero is a headline area, never a card grid — grid-ish signals there
      // come from decorative strips (logo marquees, floating UI shots). Keep
      // two-column heroes; anything grid-like collapses to centered.
      if (s.type === "hero" && /grid/i.test(detected)) detected = "centered";
      return { ...s, layout: detected };
    } catch {
      return { ...s, layout: s.layout || "one-column" };
    }
  });
}

// ---------------------------------------------------------------------------
// Direct children discovery
// ---------------------------------------------------------------------------

/**
 * Unwrap wrapper divs: start from the band's root nodes and descend through
 * sole-child wrappers until a level with >= 2 meaningful siblings is found.
 */
function findDirectChildren(
  inBand: DomNode[],
  childrenOf: Map<string, DomNode[]>,
  idsInBand: Set<string>,
  boxOf: (n: DomNode) => Box
): DomNode[] {
  // roots: nodes whose parent is outside the band
  let current = inBand.filter((n) => n.parentId === null || !idsInBand.has(n.parentId));

  for (let guard = 0; guard < 12; guard++) {
    const meaningful = current.filter((n) => {
      const b = boxOf(n);
      return b.width * b.height >= MIN_CHILD_AREA;
    });
    if (meaningful.length >= 2) return meaningful;
    const sole = meaningful[0] || current[0];
    if (!sole) return meaningful;
    const kids = childrenOf.get(sole.id) || [];
    if (kids.length === 0) return meaningful;
    current = kids;
  }
  return current;
}

/**
 * Among stacked siblings, pick the wrapper worth descending into:
 * skip headings, media and short text-bearing nodes, take the largest rest.
 */
function pickDominantWrapper(current: DomNode[], boxOf: (n: DomNode) => Box): DomNode | undefined {
  let dominant: DomNode | undefined;
  let bestArea = 0;
  for (const n of current) {
    const tag = n.tag.toLowerCase();
    if (/^h[1-6]$/.test(tag)) continue;
    if (tag === "img" || tag === "svg" || tag === "picture" || tag === "video" || tag === "hr") continue;
    const b = boxOf(n);
    if (b.height < 80 && (n.text || "").trim().length > 0) continue; // short text sibling
    const area = b.width * b.height;
    if (area > bestArea) {
      bestArea = area;
      dominant = n;
    }
  }
  return dominant;
}

// ---------------------------------------------------------------------------
// X clustering
// ---------------------------------------------------------------------------

export type XCluster = { x0: number; x1: number; maxHeight: number; count: number };

/** Merge horizontally overlapping x-intervals into column clusters. */
export function clusterByX(boxes: Box[]): XCluster[] {
  const sorted = [...boxes]
    .filter((b) => b.width > 0 && b.height > 0)
    .sort((a, b) => a.x - b.x);
  const clusters: XCluster[] = [];
  for (const b of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && b.x < last.x1 - 4) {
      last.x1 = Math.max(last.x1, b.x + b.width);
      last.maxHeight = Math.max(last.maxHeight, b.height);
      last.count += 1;
    } else {
      clusters.push({ x0: b.x, x1: b.x + b.width, maxHeight: b.height, count: 1 });
    }
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Mobile confirmation
// ---------------------------------------------------------------------------

function confirmWithMobile(result: string, children: DomNode[], mobileLayout?: LayoutSnapshot): string {
  if (!mobileLayout) return result;
  const boxes = children
    .map((n) => mobileLayout.boxes[n.id])
    .filter((b): b is Box => Boolean(b) && b.width > 0 && b.height > 0);
  if (boxes.length < 2) return result;

  // stacked = adjacent boxes (by y) do not overlap much vertically
  const sorted = [...boxes].sort((a, b) => a.y - b.y);
  let sideBySidePairs = 0;
  let pairs = 0;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    pairs += 1;
    const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    const minH = Math.min(a.height, b.height);
    if (minH > 0 && overlap / minH > 0.5) sideBySidePairs += 1;
  }
  const stacked = pairs > 0 && sideBySidePairs / pairs < 0.5;
  if (stacked) return result; // mobile stacking confirms desktop columns
  // clearly still side-by-side on mobile -> not real columns
  return result === "two-column" ? "one-column" : result;
}
