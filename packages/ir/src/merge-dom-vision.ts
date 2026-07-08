/**
 * Layout Merger (ARCHITECTURE §10) — merges VisionAnalysis (screenshot-level
 * section bands) with DOM nodes, computed CSS and bounding boxes into SectionIR[].
 *
 * Source priority (ARCHITECTURE §22):
 *   - text / links / image src  -> DOM
 *   - section layout            -> vision section boxes
 *   - style values              -> computed CSS
 *
 * This module also owns the per-node component classification rules
 * (ARCHITECTURE §21). The analyzer package re-exports them from here so the
 * rules live in exactly one place (ir is the dependency root — it cannot
 * import from the analyzer).
 */

import type {
  Box,
  ComponentIR,
  CssSnapshot,
  DomNode,
  DomSnapshot,
  LayoutSnapshot,
  SectionIR,
  VisionAnalysis,
  VisionSection,
} from "./types";

export const MAX_SECTIONS = 12;
export const MAX_COMPONENTS_PER_SECTION = 60;

// ---------------------------------------------------------------------------
// Small shared parsing helpers
// ---------------------------------------------------------------------------

/** Parse "63.734px" | "64" -> number, else undefined. */
export function parsePx(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const m = /^(-?\d*\.?\d+)(px)?$/.exec(value.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse the first length of a multi-value CSS shorthand ("16px 16px 0px 0px"). */
export function parseFirstPx(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const first = value.trim().split(/\s+/)[0];
  return parsePx(first);
}

/** True when a CSS color value paints nothing. */
export function isTransparentColor(value: string | undefined | null): boolean {
  if (!value) return true;
  const v = value.trim().toLowerCase();
  if (v === "" || v === "none" || v === "transparent" || v === "initial" || v === "inherit") return true;
  const rgba = /^rgba?\(\s*[\d.]+\s*[,\s]\s*[\d.]+\s*[,\s]\s*[\d.]+\s*[,/\s]\s*([\d.]+%?)\s*\)$/.exec(v);
  if (rgba) {
    const a = parseFloat(rgba[1]);
    return Number.isFinite(a) ? a === 0 : false;
  }
  return false;
}

/** Extract the url from a CSS background-image value. */
export function extractCssUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const m = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(value);
  return m ? m[2] : undefined;
}

function hasVisibleBorder(style: Record<string, string>): boolean {
  const bw = parseFirstPx(style.borderWidth);
  if (bw !== undefined && bw > 0 && !/^\s*none/i.test(style.borderStyle || "")) return true;
  const border = style.border || "";
  return /(?:[1-9]\d*(?:\.\d+)?|0\.0*[1-9]\d*)px\s+(solid|dashed|dotted|double)/i.test(border);
}

/** §21: a/button with padding, background or border -> button. */
export function hasButtonStyling(style: Record<string, string>): boolean {
  const padX = (parsePx(style.paddingLeft) || 0) + (parsePx(style.paddingRight) || 0);
  const padY = (parsePx(style.paddingTop) || 0) + (parsePx(style.paddingBottom) || 0);
  if (padX >= 12 || padY >= 8) return true;
  if (!isTransparentColor(style.backgroundColor)) return true;
  if (hasVisibleBorder(style)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Component style whitelist (kept small on purpose — Style Mapper §15)
// ---------------------------------------------------------------------------

const COMPONENT_STYLE_KEYS = [
  "fontSize",
  "fontWeight",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "color",
  "backgroundColor",
  "borderRadius",
  "textAlign",
  "boxShadow",
  "marginTop",
  "marginBottom",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "maxWidth",
] as const;

/** Pick only meaningful whitelisted style values for a component. */
export function pickComponentStyle(
  style: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!style) return undefined;
  const out: Record<string, string> = {};
  for (const key of COMPONENT_STYLE_KEYS) {
    const v = style[key];
    if (!v) continue;
    const trimmed = v.trim();
    if (trimmed === "" || trimmed === "none" || trimmed === "normal" || trimmed === "auto") continue;
    if (key === "backgroundColor" && isTransparentColor(trimmed)) continue;
    if ((/^(margin|padding)/.test(key) || key === "borderRadius") && (parseFirstPx(trimmed) || 0) === 0) {
      continue;
    }
    out[key] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// Per-node classification (ARCHITECTURE §21)
// ---------------------------------------------------------------------------

const TEXT_TAGS = new Set([
  "p",
  "li",
  "blockquote",
  "span",
  "div",
  "figcaption",
  "small",
  "strong",
  "em",
  "b",
  "i",
  "td",
  "th",
  "dt",
  "dd",
  "label",
  "legend",
  "cite",
  "time",
  "address",
  "summary",
]);

const MIN_IMAGE_AREA = 10000;
const ICON_MAX_SIZE = 48;

export type ClassifyOptions = {
  /** Page width — used to skip full-width background images (section backgrounds). */
  pageWidth?: number;
};

function clampHeadingLevel(raw: number): NonNullable<ComponentIR["level"]> {
  const n = Math.min(Math.max(raw, 1), 4);
  return ("h" + String(n)) as NonNullable<ComponentIR["level"]>;
}

/**
 * Classify a single DOM node into a primitive ComponentIR (or null).
 *
 * The "text node must have no classified descendant" rule and the suppression
 * of nodes nested inside headings/buttons is enforced by classifyNodes(),
 * which sees the whole tree.
 */
export function classifyDomNode(
  node: DomNode,
  style: Record<string, string>,
  fullText?: string,
  opts?: ClassifyOptions
): ComponentIR | null {
  if (!node.visible) return null;
  const tag = node.tag.toLowerCase();
  const role = (node.role || "").toLowerCase();
  const box = node.box;
  const area = Math.max(0, box.width) * Math.max(0, box.height);
  const text = (fullText !== undefined ? fullText : node.text || "").trim();

  // heading -----------------------------------------------------------------
  const h = /^h([1-6])$/.exec(tag);
  if (h) {
    if (!text) return null;
    return {
      id: node.id,
      type: "heading",
      text,
      level: clampHeadingLevel(parseInt(h[1], 10)),
      box,
      style: pickComponentStyle(style),
    };
  }

  // button / link -----------------------------------------------------------
  if (tag === "button" || role === "button" || tag === "a") {
    const label = text || (node.ariaLabel || "").trim();
    const buttonish = tag === "button" || role === "button" || hasButtonStyling(style);
    if (buttonish) {
      if (!label) return null;
      return {
        id: node.id,
        type: "button",
        text: label,
        href: node.href,
        box,
        style: pickComponentStyle(style),
      };
    }
    // plain link -> text with href (text/links come from DOM per §22)
    if (text.length > 0) {
      return { id: node.id, type: "text", text, href: node.href, box, style: pickComponentStyle(style) };
    }
    return null;
  }

  // image / icon ------------------------------------------------------------
  if (tag === "svg") {
    if (box.width <= ICON_MAX_SIZE && box.height <= ICON_MAX_SIZE) {
      return { id: node.id, type: "icon", box, style: pickComponentStyle(style) };
    }
    return { id: node.id, type: "image", src: node.src, alt: node.alt, box, style: pickComponentStyle(style) };
  }
  if (tag === "img") {
    if (box.width <= ICON_MAX_SIZE && box.height <= ICON_MAX_SIZE) {
      return { id: node.id, type: "icon", src: node.src, alt: node.alt, box, style: pickComponentStyle(style) };
    }
    return { id: node.id, type: "image", src: node.src, alt: node.alt, box, style: pickComponentStyle(style) };
  }
  const bgUrl = extractCssUrl(style.backgroundImage);
  if (bgUrl && area > MIN_IMAGE_AREA) {
    const pageWidth = opts?.pageWidth || 0;
    const fullWidthBackground = pageWidth > 0 && box.width >= 0.9 * pageWidth;
    if (!fullWidthBackground) {
      return { id: node.id, type: "image", src: bgUrl, box, style: pickComponentStyle(style) };
    }
  }

  // divider -----------------------------------------------------------------
  if (tag === "hr") {
    return { id: node.id, type: "divider", box, style: pickComponentStyle(style) };
  }
  if (
    (tag === "div" || tag === "span") &&
    box.height > 0 &&
    box.height <= 4 &&
    box.width >= 96 &&
    (!isTransparentColor(style.backgroundColor) || hasVisibleBorder(style))
  ) {
    return { id: node.id, type: "divider", box, style: pickComponentStyle(style) };
  }

  // text ---------------------------------------------------------------------
  const ownText = (node.text || "").trim();
  if (TEXT_TAGS.has(tag) && ownText.length >= 3) {
    return { id: node.id, type: "text", text: ownText, box, style: pickComponentStyle(style) };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

export type NodeIndex = {
  byId: Map<string, DomNode>;
  childrenOf: Map<string, DomNode[]>;
};

function indexNodes(dom: DomSnapshot): NodeIndex {
  const byId = new Map<string, DomNode>();
  const childrenOf = new Map<string, DomNode[]>();
  for (const n of dom.nodes) byId.set(n.id, n);
  for (const n of dom.nodes) {
    if (n.parentId === null) continue;
    const list = childrenOf.get(n.parentId);
    if (list) list.push(n);
    else childrenOf.set(n.parentId, [n]);
  }
  return { byId, childrenOf };
}

function descendantIds(nodeId: string, index: NodeIndex, out: string[] = []): string[] {
  const kids = index.childrenOf.get(nodeId);
  if (!kids) return out;
  for (const k of kids) {
    out.push(k.id);
    descendantIds(k.id, index, out);
  }
  return out;
}

/** Own text + descendant own texts, in document order, capped. */
export function collectNodeText(node: DomNode, index: NodeIndex, maxLength = 400): string {
  const parts: string[] = [];
  const stack: DomNode[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop() as DomNode;
    const t = (cur.text || "").trim();
    if (t) parts.push(t);
    const kids = index.childrenOf.get(cur.id) || [];
    // push in reverse so document order is preserved on pop
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    if (parts.join(" ").length > maxLength) break;
  }
  return parts.join(" ").slice(0, maxLength).trim();
}

function readingOrderKey(box: Box | undefined): [number, number] {
  if (!box) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  return [Math.round(box.y / 24), box.x];
}

function sortReadingOrder<T extends { box?: Box }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ka = readingOrderKey(a.box);
    const kb = readingOrderKey(b.box);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return (a.box ? a.box.y : 0) - (b.box ? b.box.y : 0);
  });
}

// ---------------------------------------------------------------------------
// Whole-set classification driver (used per section and by the analyzer)
// ---------------------------------------------------------------------------

export type ClassifyNodesOptions = {
  /** "header" | "footer" enables nav-link-list collapsing (MVP scope). */
  sectionType?: string;
  pageWidth?: number;
};

/**
 * Classify a set of DOM nodes into flat ComponentIR list in reading order.
 * Applies:
 *  - full-text collection for headings/buttons/links,
 *  - suppression of nodes nested inside classified headings/buttons,
 *  - the "text node must have no classified descendant" rule,
 *  - nav-menu link handling inside header/footer sections (one text
 *    component per link, href preserved, styleRole "nav-link"/"footer-text").
 */
export function classifyNodes(
  candidates: DomNode[],
  dom: DomSnapshot,
  css: CssSnapshot,
  layout: LayoutSnapshot,
  opts?: ClassifyNodesOptions
): ComponentIR[] {
  const index = indexNodes(dom);
  const styleOf = (id: string): Record<string, string> => css.styles[id] || {};
  const boxOf = (n: DomNode): Box => layout.boxes[n.id] || n.box;
  const classifyOpts: ClassifyOptions = { pageWidth: opts?.pageWidth ?? layout.pageWidth };

  const RICH_TEXT_TAGS = new Set(["a", "button"]);
  const primitive = new Map<string, ComponentIR>();
  const nodeOfComp = new Map<string, DomNode>();

  for (const node of candidates) {
    if (!node.visible) continue;
    const tag = node.tag.toLowerCase();
    const needsFullText =
      /^h[1-6]$/.test(tag) || RICH_TEXT_TAGS.has(tag) || (node.role || "").toLowerCase() === "button";
    const fullText = needsFullText ? collectNodeText(node, index) : undefined;
    const comp = classifyDomNode(node, styleOf(node.id), fullText, classifyOpts);
    if (!comp) continue;
    comp.box = boxOf(node);
    primitive.set(node.id, comp);
    nodeOfComp.set(node.id, node);
  }

  // 1. suppress anything nested inside a classified heading/button
  const containers = [...primitive.values()]
    .filter((c) => c.type === "heading" || c.type === "button")
    .map((c) => nodeOfComp.get(c.id) as DomNode)
    .sort((a, b) => a.depth - b.depth);
  for (const container of containers) {
    if (!primitive.has(container.id)) continue; // already suppressed by an outer one
    for (const id of descendantIds(container.id, index)) primitive.delete(id);
  }

  // 2. text nodes must have no classified descendant
  for (const [id, comp] of [...primitive.entries()]) {
    if (comp.type !== "text") continue;
    const hasClassifiedDescendant = descendantIds(id, index).some((d) => primitive.has(d));
    if (hasClassifiedDescendant) primitive.delete(id);
  }

  let comps = [...primitive.values()];

  // 3. nav-menu link lists in header/footer -> one text component per link
  if (opts?.sectionType === "header" || opts?.sectionType === "footer") {
    comps = collapseNavLinkLists(comps, nodeOfComp, index, opts.sectionType);
  }

  return sortReadingOrder(comps);
}

function navGroupKey(node: DomNode, index: NodeIndex): string {
  let cur: DomNode | undefined = node;
  for (let i = 0; i < 4 && cur && cur.parentId !== null; i++) {
    const parent = index.byId.get(cur.parentId);
    if (!parent) break;
    const tag = parent.tag.toLowerCase();
    if (tag === "nav" || tag === "ul" || tag === "ol") return parent.id;
    cur = parent;
  }
  return node.parentId || "root";
}

const MAX_NAV_LINKS = 6;

/**
 * Nav-menu link lists in header/footer: keep one component PER link
 * (type "text", href preserved — link URLs come from the DOM per §9/§22),
 * tagged with a shared styleRole so the planner can group them into a nav
 * row. Groups are capped at MAX_NAV_LINKS links; extras are dropped.
 */
function collapseNavLinkLists(
  comps: ComponentIR[],
  nodeOfComp: Map<string, DomNode>,
  index: NodeIndex,
  sectionType: "header" | "footer"
): ComponentIR[] {
  const groups = new Map<string, ComponentIR[]>();
  for (const comp of comps) {
    const node = nodeOfComp.get(comp.id);
    if (!node || node.tag.toLowerCase() !== "a") continue;
    if (comp.type !== "text" || !comp.text) continue; // keep styled CTA buttons individual
    const key = navGroupKey(node, index);
    const list = groups.get(key);
    if (list) list.push(comp);
    else groups.set(key, [comp]);
  }

  const dropped = new Set<string>();
  const role = sectionType === "footer" ? "footer-text" : "nav-link";
  let changed = false;
  for (const links of groups.values()) {
    if (links.length < 3) continue;
    changed = true;
    const ordered = sortReadingOrder(links);
    ordered.forEach((link, i) => {
      if (i < MAX_NAV_LINKS) link.styleRole = role;
      else dropped.add(link.id);
    });
  }
  if (!changed) return comps;
  return comps.filter((c) => !dropped.has(c.id));
}

// ---------------------------------------------------------------------------
// Card grid nesting
// ---------------------------------------------------------------------------

function centerInside(inner: Box, outer: Box): boolean {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
}

/** Find groups of >= 3 similar-size sibling nodes (the cards of a card grid). */
function findCardNodes(
  sectionNodes: DomNode[],
  boxOf: (n: DomNode) => Box
): DomNode[] | null {
  const byParent = new Map<string, DomNode[]>();
  for (const n of sectionNodes) {
    if (!n.visible || n.parentId === null) continue;
    const b = boxOf(n);
    if (b.width * b.height < 8000 || b.width < 100 || b.height < 60) continue;
    const list = byParent.get(n.parentId);
    if (list) list.push(n);
    else byParent.set(n.parentId, [n]);
  }

  let best: DomNode[] | null = null;
  for (const group of byParent.values()) {
    if (group.length < 3) continue;
    // bucket by width so a heading sibling does not break the group
    const buckets = new Map<number, DomNode[]>();
    for (const n of group) {
      const key = Math.round(boxOf(n).width / 60);
      const list = buckets.get(key);
      if (list) list.push(n);
      else buckets.set(key, [n]);
    }
    for (const bucket of buckets.values()) {
      if (bucket.length < 3) continue;
      const hs = bucket.map((n) => boxOf(n).height);
      if (Math.min(...hs) <= 0 || Math.max(...hs) / Math.min(...hs) > 2.2) continue;
      if (!best || bucket.length > best.length) best = bucket;
    }
  }
  return best;
}

function nestCardChildren(
  comps: ComponentIR[],
  sectionNodes: DomNode[],
  boxOf: (n: DomNode) => Box,
  styleOf: (id: string) => Record<string, string>
): ComponentIR[] {
  const cardNodes = findCardNodes(sectionNodes, boxOf);
  if (!cardNodes) return comps;

  const compIds = new Set(comps.map((c) => c.id));
  const cards = sortReadingOrder(
    cardNodes.filter((n) => !compIds.has(n.id)).map((n) => ({ node: n, box: boxOf(n) }))
  );
  if (cards.length < 3) return comps;

  const used = new Set<string>();
  const blocks: ComponentIR[] = [];
  for (const card of cards) {
    const children = comps.filter((c) => c.box && !used.has(c.id) && centerInside(c.box, card.box));
    if (children.length === 0) continue;
    for (const c of children) used.add(c.id);
    blocks.push({
      id: card.node.id,
      type: "block",
      styleRole: "card",
      box: card.box,
      style: pickComponentStyle(styleOf(card.node.id)),
      children: sortReadingOrder(children),
    });
  }
  if (blocks.length < 2) return comps;

  const rest = comps.filter((c) => !used.has(c.id));
  return sortReadingOrder([...rest, ...blocks]);
}

// ---------------------------------------------------------------------------
// Hero title rule
// ---------------------------------------------------------------------------

function markHeroTitle(comps: ComponentIR[]): void {
  let bestScore = -1;
  let best: ComponentIR | null = null;
  for (const c of comps) {
    if (c.type !== "heading") continue;
    const fontSize = parsePx(c.style ? c.style.fontSize : undefined) || 0;
    const area = c.box ? c.box.width * c.box.height : 0;
    const score = fontSize * 10000 + area;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best) {
    best.level = "h1";
    best.styleRole = "hero-title";
  }
}

// ---------------------------------------------------------------------------
// Section-level style extraction
// ---------------------------------------------------------------------------

function extractSectionStyle(
  sec: VisionSection,
  nodes: DomNode[],
  boxOf: (n: DomNode) => Box,
  styleOf: (id: string) => Record<string, string>,
  pageWidth: number
): Record<string, string> | undefined {
  if (!sec.box) return undefined;
  const minWidth = 0.9 * Math.min(pageWidth || sec.box.width, sec.box.width);
  const bandNodes = nodes
    .filter((n) => {
      const b = boxOf(n);
      return (
        b.width >= minWidth &&
        b.height >= 0.7 * (sec.box as Box).height &&
        Math.abs(b.y - (sec.box as Box).y) <= 48
      );
    })
    .sort((a, b) => a.depth - b.depth);

  for (const n of bandNodes) {
    const s = styleOf(n.id);
    const out: Record<string, string> = {};
    if (!isTransparentColor(s.backgroundColor)) out.backgroundColor = s.backgroundColor;
    const bgUrl = extractCssUrl(s.backgroundImage);
    if (bgUrl) out.backgroundImage = s.backgroundImage;
    const pt = parsePx(s.paddingTop);
    const pb = parsePx(s.paddingBottom);
    if (pt !== undefined && pt > 0) out.paddingTop = s.paddingTop;
    if (pb !== undefined && pb > 0) out.paddingBottom = s.paddingBottom;
    if (Object.keys(out).length > 0) return out;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// mergeDomVision — main entry
// ---------------------------------------------------------------------------

/**
 * Assign DOM nodes to vision sections by vertical box containment
 * (node center-y inside the section band), classify them into ComponentIR
 * children in reading order (y then x), and nest card children under "block"
 * components when the section layout is a card grid.
 */
export function mergeDomVision(
  vision: VisionAnalysis,
  dom: DomSnapshot,
  css: CssSnapshot,
  layout: LayoutSnapshot
): SectionIR[] {
  const styleOf = (id: string): Record<string, string> => css.styles[id] || {};
  const boxOf = (n: DomNode): Box => layout.boxes[n.id] || n.box;

  const sections = [...(vision.sections || [])]
    .filter((s): s is VisionSection => Boolean(s))
    .sort((a, b) => (a.box ? a.box.y : 0) - (b.box ? b.box.y : 0))
    .slice(0, MAX_SECTIONS);

  if (sections.length === 0) return [];

  const boxedSections = sections.filter((s) => s.box);
  const assigned = new Map<string, DomNode[]>();
  for (const s of sections) assigned.set(s.id, []);

  for (const node of dom.nodes) {
    if (!node.visible) continue;
    const b = boxOf(node);
    const cy = b.y + b.height / 2;
    let target: VisionSection | undefined;
    if (boxedSections.length > 0) {
      target = boxedSections.find(
        (s) => cy >= (s.box as Box).y && cy < (s.box as Box).y + (s.box as Box).height
      );
    } else {
      target = sections[0];
    }
    if (target) (assigned.get(target.id) as DomNode[]).push(node);
  }

  return sections.map((sec) => {
    const nodes = assigned.get(sec.id) || [];
    let comps = classifyNodes(nodes, dom, css, layout, {
      sectionType: sec.type,
      pageWidth: layout.pageWidth,
    });

    if (sec.type === "hero") markHeroTitle(comps);
    if (/grid/.test(sec.layout || "")) {
      comps = nestCardChildren(comps, nodes, boxOf, styleOf);
    }

    const section: SectionIR = {
      id: sec.id,
      type: sec.type,
      layout: sec.layout || "one-column",
      children: comps.slice(0, MAX_COMPONENTS_PER_SECTION),
    };
    if (sec.box) section.box = sec.box;
    if (typeof sec.confidence === "number") section.confidence = sec.confidence;
    const style = extractSectionStyle(sec, nodes, boxOf, styleOf, layout.pageWidth);
    if (style) section.style = style;
    return section;
  });
}
