/**
 * Structural layout reconstruction (SPEC §5.1) — the fix for復刻 of complex pages.
 *
 * The heuristic path (`mergeDomVision` → `classifyNodes`, packages/ir) flattens a
 * section into a flat list of leaf primitives in reading order, so multi-column /
 * nested layouts collapse into a single vertical stack. This module instead
 * reconstructs the source's REAL nested container tree from the captured DOM tree
 * + bounding boxes + computed flex CSS, producing nested "block" ComponentIRs
 * (each carrying a LayoutBox) that the structural planner (map-section.ts
 * `planStructuralSection`) emits verbatim as nested Bricks flex containers.
 *
 * Signal priority per container:
 *   1. the node's own computed CSS  (display:flex/grid → flexDirection/wrap/gap)
 *   2. child box geometry           (y-banding + x-order) when it isn't a flex parent
 * Gaps are always measured from geometry (sites frequently space with margins, so
 * the computed `gap` is 0) and only overridden by a positive computed gap.
 *
 * `packages/analyzer` (not `ir`) is the right home: it can import the leaf
 * classifiers/geometry from `@bricks-cdp/ir` AND the sibling analyzer helpers
 * (verticalOverlapRatio) — `ir` is the dependency root and cannot import upward.
 */

import type {
  Box,
  ComponentIR,
  CssSnapshot,
  DomNode,
  DomSnapshot,
  LayoutBox,
  LayoutSnapshot,
  NodeIndex,
} from "@bricks-cdp/ir";
import {
  classifyDomNode,
  collectNodeText,
  indexNodes,
  isTransparentColor,
  parseFirstPx,
  parsePx,
  sortReadingOrder,
} from "@bricks-cdp/ir";
import { verticalOverlapRatio } from "./detect-sections";

const MAX_DEPTH = 12;
const DEFAULT_MAX_NODES_PER_SECTION = 300;
/** Drop hairline spacers / tracking pixels but keep small nav links (~40px²+). */
const MIN_KEEP_AREA = 40;
const MIN_SURFACE_RADIUS = 2;
const MAX_GAP = 200;

export type ReconstructOptions = { maxNodesPerSection?: number };

type Ctx = {
  css: CssSnapshot;
  layout: LayoutSnapshot;
  index: NodeIndex;
  pageWidth: number;
  /** Remaining node budget for this section (mutated as nodes are emitted). */
  budget: number;
};

const styleOf = (ctx: Ctx, id: string): Record<string, string> => ctx.css.styles[id] || {};
const boxOf = (ctx: Ctx, n: DomNode): Box => ctx.layout.boxes[n.id] || n.box;

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Reconstruct one section's children as a nested ComponentIR tree. Nodes whose
 * center-y falls in the section band are gathered; the band's top-level DOM
 * nodes (parent outside the band) are each compiled into a layout tree.
 */
export function reconstructSectionChildren(
  sec: { box?: Box },
  dom: DomSnapshot,
  css: CssSnapshot,
  layout: LayoutSnapshot,
  opts?: ReconstructOptions
): ComponentIR[] {
  const band = sec.box;
  const ctx: Ctx = {
    css,
    layout,
    index: indexNodes(dom),
    pageWidth: layout.pageWidth || (band ? band.width : 1440),
    budget: opts?.maxNodesPerSection ?? DEFAULT_MAX_NODES_PER_SECTION,
  };

  // Full-viewport modal backdrops (a promo popup open during capture) and their
  // whole subtree are dropped up front — otherwise the backdrop, or its orphaned
  // close button, becomes a stray section root and corrupts the y-banding.
  const overlayIds = new Set<string>();
  for (const n of dom.nodes) {
    if (n.visible && isDroppableOverlay(ctx, n)) overlayIds.add(n.id);
  }
  const parentOf = new Map<string, string | null>();
  for (const n of dom.nodes) parentOf.set(n.id, n.parentId);
  const underOverlay = (id: string): boolean => {
    let cur: string | null | undefined = id;
    for (let guard = 0; cur != null && guard < 200; guard++) {
      if (overlayIds.has(cur)) return true;
      cur = parentOf.get(cur);
    }
    return false;
  };

  // Nodes assigned to the band (visible, non-degenerate, center-y inside band).
  const assignedSet = new Set<string>();
  for (const n of dom.nodes) {
    if (!n.visible) continue;
    if (underOverlay(n.id)) continue;
    const b = boxOf(ctx, n);
    if (b.width <= 0 || b.height <= 0) continue;
    if (band) {
      const cy = b.y + b.height / 2;
      if (cy < band.y || cy >= band.y + band.height) continue;
    }
    assignedSet.add(n.id);
  }
  if (assignedSet.size === 0) return [];

  // Section roots = assigned nodes whose parent is outside the band.
  const roots = dom.nodes.filter(
    (n) => assignedSet.has(n.id) && (n.parentId === null || !assignedSet.has(n.parentId))
  );
  const orderedRoots = sortReadingOrder(roots.map((n) => ({ node: n, box: boxOf(ctx, n) }))).map(
    (r) => r.node
  );

  let children: ComponentIR[] = [];
  for (const root of orderedRoots) {
    if (ctx.budget <= 0) break;
    const ir = buildLayoutTree(ctx, root, band ? band.width : ctx.pageWidth, 0);
    if (ir) children.push(ir);
  }

  // Unwrap a single surface-less column block: the section's own container is
  // already a centered column, so this avoids a redundant nesting level.
  if (children.length === 1) {
    const only = children[0];
    if (only.type === "block" && only.layout?.direction === "column" && !only.style && only.children) {
      children = only.children;
    }
  }
  return children;
}

// ---------------------------------------------------------------------------
// Recursion
// ---------------------------------------------------------------------------

function buildLayoutTree(
  ctx: Ctx,
  node: DomNode,
  parentWidth: number,
  depth: number
): ComponentIR | null {
  if (ctx.budget <= 0) return null;
  const tag = node.tag.toLowerCase();
  const role = (node.role || "").toLowerCase();
  const style = styleOf(ctx, node.id);
  const box = boxOf(ctx, node);

  // Always-leaf tags: media, headings, dividers, buttons never wrap a layout.
  if (isAlwaysLeaf(tag, role)) return leaf(ctx, node, style);

  const kids = meaningfulChildren(ctx, node);
  if (kids.length === 0 || depth >= MAX_DEPTH) return leaf(ctx, node, style);

  const results: Array<{ ir: ComponentIR; box: Box }> = [];
  for (const kid of kids) {
    if (ctx.budget <= 0) break;
    const ir = buildLayoutTree(ctx, kid, box.width || parentWidth, depth + 1);
    if (ir) results.push({ ir, box: boxOf(ctx, kid) });
  }
  if (results.length === 0) return leaf(ctx, node, style);

  const surface = surfaceStyle(style);

  // Single surviving child: collapse the redundant wrapper unless it is a real
  // surface (card) worth preserving.
  if (results.length === 1) {
    const inner = results[0].ir;
    if (!surface) return inner;
    ctx.budget -= 1;
    return { id: node.id, type: "block", box, layout: { direction: "column" }, style: surface, children: [inner] };
  }

  const layout = detectArrangement(ctx, node, results.map((r) => r.box));

  // Pin per-child flex widths for row/grid children (from measured boxes).
  if (layout.direction === "row") {
    const cw = box.width > 0 ? box.width : parentWidth;
    for (const r of results) {
      if (cw > 0 && r.box.width > 0) {
        const pct = r.box.width / cw;
        if (pct > 0.02 && pct <= 1.05) r.ir.widthPct = Math.min(1, Math.round(pct * 1000) / 1000);
      }
    }
  }

  ctx.budget -= 1;
  const blk: ComponentIR = {
    id: node.id,
    type: "block",
    box,
    layout,
    children: results.map((r) => r.ir),
  };
  if (surface) blk.style = surface;
  return blk;
}

/** Classify a single node as a leaf primitive (heading/text/image/button/...). */
function leaf(ctx: Ctx, node: DomNode, style: Record<string, string>): ComponentIR | null {
  const tag = node.tag.toLowerCase();
  const role = (node.role || "").toLowerCase();
  const needsFullText = /^h[1-6]$/.test(tag) || tag === "a" || tag === "button" || role === "button";
  const fullText = needsFullText ? collectNodeText(node, ctx.index) : undefined;
  const comp = classifyDomNode(node, style, fullText, { pageWidth: ctx.pageWidth });
  if (comp) {
    comp.box = boxOf(ctx, node);
    ctx.budget -= 1;
  }
  return comp;
}

function isAlwaysLeaf(tag: string, role: string): boolean {
  if (tag === "img" || tag === "svg" || tag === "hr") return true;
  if (/^h[1-6]$/.test(tag)) return true;
  if (tag === "button" || role === "button") return true;
  return false; // <a> may wrap a card — handled by recursion
}

/** Visible DOM children with a non-degenerate box, in reading order. */
function meaningfulChildren(ctx: Ctx, node: DomNode): DomNode[] {
  const kids = ctx.index.childrenOf.get(node.id) || [];
  const kept = kids.filter((k) => {
    if (!k.visible) return false;
    if (isDroppableOverlay(ctx, k)) return false;
    const b = boxOf(ctx, k);
    return b.width > 0 && b.height > 0 && b.width * b.height >= MIN_KEEP_AREA;
  });
  return sortReadingOrder(kept.map((n) => ({ node: n, box: boxOf(ctx, n) }))).map((r) => r.node);
}

/**
 * Full-viewport modal backdrops / fixed overlays (a promo popup open during
 * capture) are NOT content: they cover the page with a translucent dark layer,
 * vertically overlap everything, and wreck the y-banding (the header, backdrop
 * and whole page collapse into one "row"). Drop any full-width, tall element
 * with a translucent background or fixed positioning.
 */
function isDroppableOverlay(ctx: Ctx, node: DomNode): boolean {
  const b = boxOf(ctx, node);
  if (b.width < 0.9 * ctx.pageWidth || b.height < 400) return false;
  const s = styleOf(ctx, node.id);
  // translucent background (alpha in (0,1)) covering the viewport = backdrop
  const alpha = /rgba?\([^)]*[,/ ]\s*(0?\.\d+)\s*\)\s*$/.exec((s.backgroundColor || "").trim());
  if (alpha && parseFloat(alpha[1]) > 0 && parseFloat(alpha[1]) < 0.95) return true;
  // a fixed, full-width, tall element is a modal/overlay, not a section
  if ((s.position || "").trim() === "fixed") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Surface (card chrome) extraction — camelCase keys the style mapper reads
// ---------------------------------------------------------------------------

/**
 * Extract card-surface style (background / border / radius / shadow, plus
 * padding when a surface exists) from a container's computed CSS. Returns
 * undefined for pure layout wrappers (no visible surface) so they stay clean.
 * Emits keys `mapComponentStyle` consumes (it tolerates camelCase); a `border`
 * shorthand is synthesized from the top-side longhands (the capture stores
 * per-side widths, which `mapBorder` does not read directly).
 */
function surfaceStyle(style: Record<string, string>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  if (!isTransparentColor(style.backgroundColor)) out.backgroundColor = style.backgroundColor;
  const radius = parseFirstPx(style.borderRadius);
  if (radius !== undefined && radius >= MIN_SURFACE_RADIUS) out.borderRadius = style.borderRadius;
  if (style.boxShadow && style.boxShadow.trim() !== "none" && style.boxShadow.trim() !== "") {
    out.boxShadow = style.boxShadow;
  }
  const bw = parseFirstPx(style.borderTopWidth);
  const bs = (style.borderTopStyle || "").trim();
  if (bw !== undefined && bw > 0 && bs && bs !== "none") {
    const bc = (style.borderTopColor || "").trim();
    out.border = `${Math.round(bw)}px ${bs}${bc ? " " + bc : ""}`;
  }
  if (Object.keys(out).length === 0) return undefined; // no surface → layout-only wrapper

  // Real card → also carry padding so inner content isn't flush to the edge.
  for (const k of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) {
    const p = parsePx(style[k]);
    if (p !== undefined && p > 0) out[k] = style[k];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Arrangement detection (flex CSS first, geometry fallback)
// ---------------------------------------------------------------------------

function detectArrangement(ctx: Ctx, node: DomNode, boxes: Box[]): LayoutBox {
  const style = styleOf(ctx, node.id);
  const disp = (style.display || "").toLowerCase();

  let direction: "row" | "column";
  let wrap = false;

  if (disp.includes("flex")) {
    direction = (style.flexDirection || "row").toLowerCase().startsWith("column") ? "column" : "row";
    wrap = (style.flexWrap || "").toLowerCase().includes("wrap");
  } else if (disp.includes("grid")) {
    direction = "row";
    wrap = true;
  } else {
    const bands = groupByYBand(boxes);
    if (bands.length <= 1) direction = "row";
    else if (bands.every((b) => b.length === 1)) direction = "column";
    else {
      direction = "row";
      wrap = true;
    }
  }

  // Guard: ≥2 near-full-width children cannot sit side-by-side — whatever the CSS
  // or single-band geometry suggested, this is really a vertical stack. Prevents
  // full-width blocks (header / banner / content) collapsing into a wrap-row.
  if (direction === "row") {
    const cw = boxOf(ctx, node).width;
    if (cw > 0 && boxes.filter((b) => b.width >= 0.65 * cw).length >= 2) {
      direction = "column";
      wrap = false;
    }
  }

  // A non-wrapping row far wider than its container is a horizontal carousel
  // captured statically: rendered flat it overflows and spills items off-screen
  // (negative x). Wrap it into a grid so every item stays visible — a faithful
  // STATIC stand-in for the scroll strip.
  if (direction === "row" && !wrap) {
    const cw = boxOf(ctx, node).width;
    const total = boxes.reduce((s, b) => s + b.width, 0);
    if (cw > 0 && total > cw * 1.3) wrap = true;
  }

  const gaps = measureGaps(boxes, direction, wrap);
  const cssCol = parsePx(style.columnGap) ?? parseFirstPx(style.gap);
  const cssRow = parsePx(style.rowGap) ?? parseFirstPx(style.gap);
  const columnGap = cssCol !== undefined && cssCol > 0 ? Math.round(cssCol) : gaps.columnGap;
  const rowGap = cssRow !== undefined && cssRow > 0 ? Math.round(cssRow) : gaps.rowGap;

  const out: LayoutBox = { direction };
  if (wrap) out.wrap = true;
  if (direction === "row" && columnGap !== undefined && columnGap > 0) out.columnGap = clampGap(columnGap);
  if ((direction === "column" || wrap) && rowGap !== undefined && rowGap > 0) out.rowGap = clampGap(rowGap);
  const align = mapFlexAlign(style.alignItems);
  if (align) out.alignItems = align;
  const justify = mapFlexJustify(style.justifyContent);
  if (justify) out.justifyContent = justify;
  return out;
}

/** Group boxes into rows by vertical overlap (> 0.5 of the smaller height). */
function groupByYBand(boxes: Box[]): Box[][] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y);
  const bands: Box[][] = [];
  const ranges: Array<{ y0: number; y1: number }> = [];
  for (const b of sorted) {
    let placed = false;
    for (let i = 0; i < ranges.length; i++) {
      if (verticalOverlapRatio(ranges[i].y0, ranges[i].y1, b.y, b.y + b.height) > 0.5) {
        bands[i].push(b);
        ranges[i].y0 = Math.min(ranges[i].y0, b.y);
        ranges[i].y1 = Math.max(ranges[i].y1, b.y + b.height);
        placed = true;
        break;
      }
    }
    if (!placed) {
      bands.push([b]);
      ranges.push({ y0: b.y, y1: b.y + b.height });
    }
  }
  return bands;
}

function measureGaps(
  boxes: Box[],
  direction: "row" | "column",
  wrap: boolean
): { columnGap?: number; rowGap?: number } {
  if (direction === "column") return { rowGap: medianAdjacentGap(boxes, "y") };
  if (direction === "row" && !wrap) return { columnGap: medianAdjacentGap(boxes, "x") };
  // grid (row + wrap): column gap within bands, row gap between bands.
  const bands = groupByYBand(boxes);
  const colGaps: number[] = [];
  for (const band of bands) {
    const g = medianAdjacentGap(band, "x");
    if (g !== undefined) colGaps.push(g);
  }
  const tops = bands.map((b) => Math.min(...b.map((x) => x.y)));
  const bottoms = bands.map((b) => Math.max(...b.map((x) => x.y + x.height)));
  const order = bands.map((_, i) => i).sort((a, b) => tops[a] - tops[b]);
  const rGaps: number[] = [];
  for (let i = 1; i < order.length; i++) {
    const g = tops[order[i]] - bottoms[order[i - 1]];
    if (g > 0 && g < 400) rGaps.push(g);
  }
  return { columnGap: median(colGaps), rowGap: median(rGaps) };
}

function medianAdjacentGap(boxes: Box[], axis: "x" | "y"): number | undefined {
  const sorted = [...boxes].sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const g = axis === "x" ? cur.x - (prev.x + prev.width) : cur.y - (prev.y + prev.height);
    if (g > 0 && g < 400) gaps.push(g);
  }
  return median(gaps);
}

function median(arr: number[]): number | undefined {
  if (arr.length === 0) return undefined;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function clampGap(n: number): number {
  return Math.max(0, Math.min(MAX_GAP, Math.round(n)));
}

function mapFlexAlign(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const x = v.trim().toLowerCase();
  if (x === "start") return "flex-start";
  if (x === "end") return "flex-end";
  if (["flex-start", "flex-end", "center", "stretch", "baseline"].includes(x)) return x;
  return undefined;
}

function mapFlexJustify(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const x = v.trim().toLowerCase();
  if (x === "start") return "flex-start";
  if (x === "end") return "flex-end";
  if (["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"].includes(x)) return x;
  return undefined;
}
