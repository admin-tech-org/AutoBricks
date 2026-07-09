/**
 * Bricks Planner (ARCHITECTURE §13).
 *
 * Turns one SectionIR into a clean, editable Bricks plan tree:
 *
 *   Section
 *   └── Container
 *       └── (layout-specific structure)
 *
 * The planner NORMALIZES — it never mirrors DOM garbage ("Planner không được
 * copy DOM rác"): components without meaningful content are skipped, layouts
 * are rebuilt the way a Bricks user would build them, and degenerate layouts
 * (e.g. a "two-column" section with only one column of content) gracefully
 * fall back to simpler structures.
 */

import type { ComponentIR, LayoutBox, SectionIR, ThemeIR } from "@bricks-cdp/ir";
import type { BricksPlanNode } from "./types";
import type { IdFactory } from "./create-element";
import { slugify } from "./create-element";
import { getStyleValue, mapComponentStyle, mapSectionStyle, pxToGridString, splitFontFamily } from "./map-style";

const DEFAULT_COLUMN_GAP = "48";
const DEFAULT_GRID_GAP = "24";
const DEFAULT_NAV_GAP = "24";

type Settings = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Component -> plan node mapping
// ---------------------------------------------------------------------------

function hasText(c: ComponentIR): boolean {
  return typeof c.text === "string" && c.text.trim().length > 0;
}

function hasSrc(c: ComponentIR): boolean {
  return typeof c.src === "string" && c.src.trim().length > 0;
}

/** Last path segment of a URL, for settings.image.filename. */
function urlBasename(src: string): string {
  // data: URIs have no path segments — splitting on "/" yields garbage
  // like "svg%3E", so use a stable extension-less placeholder instead.
  if (src.startsWith("data:")) return "embedded-image";
  const withoutQuery = src.split(/[?#]/)[0];
  const segments = withoutQuery.split("/").filter((s) => s.length > 0);
  const last = segments.length > 0 ? segments[segments.length - 1] : "";
  return last || "image";
}

/**
 * Component style for non-text elements (image/icon/divider): a `_typography`
 * block inherited from the DOM node is meaningless noise there — drop it.
 */
function nonTextStyle(c: ComponentIR, theme: ThemeIR): Settings {
  const style = mapComponentStyle(c, theme);
  delete style._typography;
  return style;
}

/** Merge extra class tokens into an existing _cssClasses string (deduped). */
function addClasses(settings: Settings, ...classes: string[]): void {
  const existing = typeof settings._cssClasses === "string" ? settings._cssClasses.split(/\s+/) : [];
  const set = new Set([...existing, ...classes].filter((c) => c.length > 0));
  if (set.size > 0) settings._cssClasses = [...set].join(" ");
}

/** Semantic design-system classes for a component (consumed by the design CSS). */
function componentClasses(c: ComponentIR): string[] {
  const parts: string[] = [];
  switch (c.type) {
    case "heading":
      parts.push("cdp-heading");
      break;
    case "text":
      parts.push("cdp-text");
      break;
    case "button":
      parts.push("cdp-btn");
      break;
    case "image":
      parts.push("cdp-media");
      break;
    case "block":
      parts.push("cdp-card");
      break;
  }
  // styleRole -> cdp-<role> (hero-title, hero-subtitle, primary-cta,
  // section-title, card-title, card-text, card-image, nav-link, footer-text...)
  if (c.styleRole) parts.push(`cdp-${c.styleRole}`);
  return parts;
}

/**
 * Map a single ComponentIR to a plan node, or null when the component carries
 * no meaningful content (DOM garbage — skipped by design, §13).
 */
export function componentToNode(c: ComponentIR, theme: ThemeIR): BricksPlanNode | null {
  const node = buildComponentNode(c, theme);
  if (node) {
    const cls = componentClasses(c);
    if (cls.length > 0) addClasses(node.settings, ...cls);
    // Provenance: remember which source ComponentIR this node came from.
    if (c.id) node.irId = c.id;
  }
  return node;
}

function buildComponentNode(c: ComponentIR, theme: ThemeIR): BricksPlanNode | null {
  const style = mapComponentStyle(c, theme);

  switch (c.type) {
    case "heading": {
      if (!hasText(c)) return null;
      const settings: Settings = { ...style, text: c.text!.trim(), tag: c.level ?? "h2" };
      return { name: "heading", settings, children: [], idHint: "hdg" };
    }
    case "text": {
      if (!hasText(c)) return null;
      return { name: "text-basic", settings: { ...style, text: c.text!.trim() }, children: [], idHint: "txt" };
    }
    case "button": {
      if (!hasText(c)) return null;
      const settings: Settings = {
        ...style,
        text: c.text!.trim(),
        link: { type: "external", url: c.href && c.href.trim().length > 0 ? c.href.trim() : "#" },
      };
      return { name: "button", settings, children: [], idHint: "btn" };
    }
    case "image": {
      if (!hasSrc(c)) return null;
      const src = c.src!.trim();
      const settings: Settings = {
        ...nonTextStyle(c, theme),
        image: { url: src, external: true, filename: urlBasename(src) },
      };
      if (typeof c.alt === "string" && c.alt.trim().length > 0) settings.altText = c.alt.trim();
      // Exact object size: pin the real measured render box from the source
      // (e.g. a 140x63 logo, a 696x548 screenshot). We drive size from the width
      // and lock the source's aspect ratio (not the image's intrinsic ratio), so
      // the object is its exact source size on desktop AND — because Bricks keeps
      // `max-width:100%` — shrinks proportionally without distortion in a narrow
      // container (the responsive behaviour requested). The aspect ratio is
      // stashed here and turned into id-scoped CSS in a post-flatten pass
      // (generate-json) — Bricks emits `_cssCustom` verbatim (no `%root%`
      // substitution), so the real `#brxe-<id>` selector is only known then.
      if (c.box && c.box.width > 0 && settings._width === undefined) {
        settings._width = `${Math.round(c.box.width)}px`;
        if (c.box.height > 0) settings.__cdpAspect = `${Math.round(c.box.width)}/${Math.round(c.box.height)}`;
      }
      return { name: "image", settings, children: [], idHint: "img" };
    }
    case "icon": {
      // MVP cannot map arbitrary inline SVGs to a Bricks icon-library setting;
      // an icon element without settings.icon renders nothing and is dead
      // weight after import — skip it (the source SVG stays in assets.json).
      return null;
    }
    case "divider":
      return { name: "divider", settings: nonTextStyle(c, theme), children: [], idHint: "dvd" };
    case "block": {
      const children = mapComponents(c.children ?? [], theme);
      if (children.length === 0) return null;
      const settings: Settings = { _direction: "column", ...style };
      return { name: "block", settings, children, idHint: "blk" };
    }
    default: {
      // Unknown IR type — salvage real content, drop the rest.
      if (hasText(c)) {
        return { name: "text-basic", settings: { ...style, text: c.text!.trim() }, children: [], idHint: "txt" };
      }
      if (hasSrc(c)) {
        return componentToNode({ ...c, type: "image" }, theme);
      }
      return null;
    }
  }
}

/** Map a component list, dropping garbage. */
export function mapComponents(components: ComponentIR[], theme: ThemeIR): BricksPlanNode[] {
  const nodes: BricksPlanNode[] = [];
  let logoRun: BricksPlanNode[] = [];
  let logoRunSize = 0;

  const flushLogoRun = () => {
    if (logoRunSize >= 4) {
      // A run of ≥4 small images is a logo strip — lay it out as a wrapping
      // row instead of stacking each logo on its own line.
      const logoRowNode = container(
        {
          _direction: "row",
          direction: "row",
          _flexWrap: "wrap",
          _alignItems: "center",
          _justifyContent: "center",
          _columnGap: "48",
          _rowGap: "24",
          _width: "100%",
        },
        logoRun,
        "row_logos"
      );
      addClasses(logoRowNode.settings, "cdp-logo-row");
      nodes.push(logoRowNode);
    } else {
      nodes.push(...logoRun);
    }
    logoRun = [];
    logoRunSize = 0;
  };

  for (const c of components) {
    const node = componentToNode(c, theme);
    if (!node) continue;
    const isSmallImage = node.name === "image" && !!c.box && c.box.height > 0 && c.box.height <= 140;
    if (isSmallImage) {
      logoRun.push(node);
      logoRunSize++;
      continue;
    }
    if (logoRun.length > 0) flushLogoRun();
    nodes.push(node);
  }
  if (logoRun.length > 0) flushLogoRun();
  return nodes;
}

// ---------------------------------------------------------------------------
// Layout builders
// ---------------------------------------------------------------------------

function container(settings: Settings, children: BricksPlanNode[], idHint: string): BricksPlanNode {
  return { name: "container", settings, children, idHint };
}

/**
 * Row container settings. Emits Bricks-native `_direction` AND mirrors the
 * plain `direction` key for ARCHITECTURE §14 spec parity (see map-style.ts
 * header comment for the rationale).
 */
function rowSettings(extra: Settings = {}): Settings {
  return { _direction: "row", direction: "row", ...extra };
}

function sectionGap(section: SectionIR, fallback: string): string {
  return (
    pxToGridString(
      getStyleValue(section.style, "gap") ??
        getStyleValue(section.style, "column-gap")
    ) ?? fallback
  );
}

/** Column gap: vision layout hint wins over captured CSS, then the fallback. */
function columnGap(section: SectionIR, fallback: string): string {
  const hint = section.layoutHints?.columnGapPx;
  return hint !== undefined ? String(hint) : sectionGap(section, fallback);
}

/** Row gap: vision layout hint wins over captured CSS, then the fallback. */
function rowGap(section: SectionIR, fallback: string): string {
  const hint = section.layoutHints?.rowGapPx;
  return hint !== undefined ? String(hint) : sectionGap(section, fallback);
}

/** Mean horizontal box center of the components that carry a box. */
function meanCenterX(components: ComponentIR[]): number | undefined {
  const centers = components
    .filter((c) => c.box && c.box.width > 0)
    .map((c) => c.box!.x + c.box!.width / 2);
  if (centers.length === 0) return undefined;
  return centers.reduce((sum, x) => sum + x, 0) / centers.length;
}

/** two-column: row > [content column, image column], sides follow page geometry. */
function planTwoColumn(section: SectionIR, theme: ThemeIR, slug: string): BricksPlanNode[] {
  const imageComponents: ComponentIR[] = [];
  const contentComponents: ComponentIR[] = [];
  let firstImageIndex = -1;
  let firstContentIndex = -1;

  section.children.forEach((c, i) => {
    if (c.type === "image") {
      if (firstImageIndex === -1) firstImageIndex = i;
      imageComponents.push(c);
    } else {
      if (firstContentIndex === -1) firstContentIndex = i;
      contentComponents.push(c);
    }
  });

  const contentNodes = mapComponents(contentComponents, theme);
  const imageNodes = mapComponents(imageComponents, theme);

  // Degenerate two-column -> one column of whatever content exists.
  if (contentNodes.length === 0 || imageNodes.length === 0) {
    return mapComponents(section.children, theme);
  }

  const gap = columnGap(section, DEFAULT_COLUMN_GAP);
  const alignItems = section.layoutHints?.alignItems ?? "center";
  const contentCol = container(
    { _direction: "column", _width: "50%", _justifyContent: "center" },
    contentNodes,
    "col_left"
  );
  const imageCol = container(
    { _direction: "column", _width: "50%", _justifyContent: "center" },
    imageNodes,
    "col_right"
  );

  // Sides come from real page geometry: compare the mean box center-x of the
  // image group vs the content group. IR array order is only a fallback when
  // boxes are missing — DOM/reading order can put a tall right-hand image
  // before the left-hand text and would swap the columns.
  const imageCenterX = meanCenterX(imageComponents);
  const contentCenterX = meanCenterX(contentComponents);
  const imagesFirst =
    imageCenterX !== undefined && contentCenterX !== undefined
      ? imageCenterX < contentCenterX
      : firstImageIndex !== -1 && (firstContentIndex === -1 || firstImageIndex < firstContentIndex);
  const columns = imagesFirst ? [imageCol, contentCol] : [contentCol, imageCol];
  if (imagesFirst) {
    columns[0].idHint = "col_left";
    columns[1].idHint = "col_right";
  }

  addClasses(contentCol.settings, "cdp-col", "cdp-col-content");
  addClasses(imageCol.settings, "cdp-col", "cdp-col-media");
  const splitRow = container(
    rowSettings({ _columnGap: gap, _alignItems: alignItems, _width: "100%" }),
    columns,
    `row_${slug}`
  );
  addClasses(splitRow.settings, "cdp-split");
  return [splitRow];
}

/**
 * Group flat components into card runs of (image?, heading, text+...):
 * an image opens a new card, a heading joins an image-only card or opens its
 * own, and everything else attaches to the current card.
 */
export function groupIntoCards(components: ComponentIR[]): ComponentIR[][] {
  const cards: ComponentIR[][] = [];
  let current: ComponentIR[] | null = null;

  for (const c of components) {
    if (c.type === "image") {
      current = [c];
      cards.push(current);
    } else if (c.type === "heading") {
      if (current && current.length > 0 && current.every((x) => x.type === "image")) {
        current.push(c); // the "image?" slot of this card
      } else {
        current = [c];
        cards.push(current);
      }
    } else if (current) {
      current.push(c);
    } else {
      current = [c];
      cards.push(current);
    }
  }
  return cards;
}

/** grid / three-card-grid: row(wrap) > one block per card. */
function planGrid(section: SectionIR, theme: ThemeIR, slug: string): BricksPlanNode[] {
  const colGap = columnGap(section, DEFAULT_GRID_GAP);
  const rGap = rowGap(section, DEFAULT_GRID_GAP);
  const blockChildren = section.children.filter((c) => c.type === "block");
  // Non-card components (section title, intro text...) must survive the grid:
  // they render above the card row, in reading order.
  const leadComponents = blockChildren.length > 0 ? mapComponents(section.children.filter((c) => c.type !== "block"), theme) : [];

  // Bricks blocks default to width:100%, which makes each card take the whole
  // row (one card per line). Compute cards-per-row from the real captured card
  // geometry and give every card an explicit flex width.
  const cardWidth = (() => {
    const widths = blockChildren.map((b) => b.box?.width ?? 0).filter((w) => w > 0).sort((a, b) => a - b);
    return widths.length > 0 ? widths[Math.floor(widths.length / 2)] : 0;
  })();
  const sectionWidth = section.box?.width ?? 1200;
  const gapPx = Number(colGap) || 24;
  // Vision hint (the actual visible column count) wins over the geometry guess.
  let perRow: number;
  if (section.layoutHints?.columns !== undefined) {
    perRow = section.layoutHints.columns;
  } else if (cardWidth > 0) {
    perRow = Math.round(sectionWidth / (cardWidth + gapPx));
  } else {
    perRow = Math.min(3, Math.max(2, blockChildren.length));
  }
  perRow = Math.min(8, Math.max(1, perRow));
  const cardWidthSetting =
    perRow <= 1 ? "100%" : `calc((100% - ${(perRow - 1) * gapPx}px) / ${perRow})`;

  let cardNodes: BricksPlanNode[];
  if (blockChildren.length > 0) {
    // IR already carved out cards: one block per card, its style (background,
    // border-radius, padding...) comes from the block itself.
    cardNodes = [];
    for (const blockIR of blockChildren) {
      const inner = mapComponents(blockIR.children ?? [], theme);
      if (inner.length === 0) continue;
      const settings: Settings = {
        _direction: "column",
        _flexGrow: "0",
        ...mapComponentStyle(blockIR, theme),
        // AFTER the spread: the calc width must win over any captured px width.
        _width: cardWidthSetting,
      };
      addClasses(settings, "cdp-card");
      cardNodes.push({ name: "block", settings, children: inner, idHint: "blk_card" });
    }
  } else {
    cardNodes = [];
    for (const run of groupIntoCards(section.children)) {
      const inner = mapComponents(run, theme);
      if (inner.length === 0) continue;
      const cardSettings: Settings = { _direction: "column", _flexGrow: "0", _width: cardWidthSetting };
      addClasses(cardSettings, "cdp-card");
      cardNodes.push({ name: "block", settings: cardSettings, children: inner, idHint: "blk_card" });
    }
  }

  // A "grid" with fewer than two real cards is not a grid — flatten it.
  if (cardNodes.length <= 1) {
    const flat = mapComponents(section.children, theme);
    return flat.length > 0 ? flat : [];
  }

  const rowExtra: Settings = {
    _flexWrap: "wrap",
    _columnGap: colGap,
    _rowGap: rGap,
    _alignItems: section.layoutHints?.alignItems ?? "stretch",
    _width: "100%",
  };
  if (section.layoutHints?.justifyContent) rowExtra._justifyContent = section.layoutHints.justifyContent;
  const rowNode = container(rowSettings(rowExtra), cardNodes, `row_${slug}`);
  addClasses(rowNode.settings, "cdp-card-row");
  return [...leadComponents, rowNode];
}

/** header: row(space-between) > [logo, nav links as text-basic]. MVP. */
function planHeader(section: SectionIR, theme: ThemeIR, slug: string): BricksPlanNode[] {
  const flatten = (cs: ComponentIR[]): ComponentIR[] =>
    cs.flatMap((c) => (c.type === "block" && c.children ? flatten(c.children) : [c]));
  const components = flatten(section.children);

  // Logo: first image, else first heading, else first short text.
  let logoIR =
    components.find((c) => c.type === "image" && hasSrc(c)) ??
    components.find((c) => c.type === "heading" && hasText(c)) ??
    components.find((c) => c.type === "text" && hasText(c) && c.text!.trim().length <= 40);

  const logoNode = logoIR ? componentToNode(logoIR, theme) : null;

  const navNodes: BricksPlanNode[] = [];
  for (const c of components) {
    if (c === logoIR) continue;
    if (c.type === "button") {
      const node = componentToNode(c, theme);
      if (node) navNodes.push(node);
    } else if (hasText(c) && c.type !== "image") {
      // Nav links become text-basic elements (MVP); when the IR carries an
      // href (type "text", styleRole "nav-link") the element gets a Bricks
      // link setting so the nav stays clickable after import.
      const settings: Settings = { ...mapComponentStyle(c, theme), text: c.text!.trim() };
      if (typeof c.href === "string" && c.href.trim().length > 0) {
        settings.link = { type: "external", url: c.href.trim() };
      }
      navNodes.push({
        name: "text-basic",
        settings,
        children: [],
        idHint: "nav_link",
      });
    }
  }

  const rowChildren: BricksPlanNode[] = [];
  if (logoNode) {
    logoNode.idHint = "logo";
    rowChildren.push(logoNode);
  }
  if (navNodes.length > 0) {
    const navNode = container(
      rowSettings({ _columnGap: DEFAULT_NAV_GAP, _alignItems: "center" }),
      navNodes,
      `nav_${slug}`
    );
    addClasses(navNode.settings, "cdp-nav");
    rowChildren.push(navNode);
  }
  if (rowChildren.length === 0) return [];

  const headerRow = container(
    rowSettings({ _justifyContent: "space-between", _alignItems: "center", _width: "100%" }),
    rowChildren,
    `row_${slug}`
  );
  addClasses(headerRow.settings, "cdp-header-row");
  return [headerRow];
}

// ---------------------------------------------------------------------------
// Structural layout (SPEC §5.1) — emit the reconstructed nested container tree
// verbatim (analyzer/reconstruct-layout.ts produced "block" ComponentIRs each
// carrying a LayoutBox). No label-guessing: direction/gaps/wrap/align and per-
// child flex widths come straight from the source geometry.
// ---------------------------------------------------------------------------

/** LayoutBox -> Bricks flex container settings. */
function layoutToSettings(layout: LayoutBox): Settings {
  const s: Settings = layout.direction === "row" ? rowSettings() : { _direction: "column" };
  if (layout.wrap) s._flexWrap = "wrap";
  if (layout.columnGap !== undefined) s._columnGap = String(layout.columnGap);
  if (layout.rowGap !== undefined) s._rowGap = String(layout.rowGap);
  if (layout.alignItems) s._alignItems = layout.alignItems;
  if (layout.justifyContent) s._justifyContent = layout.justifyContent;
  return s;
}

/**
 * widthPct (0..1) -> Bricks _width percentage, for SUBSTANTIAL columns only.
 * Narrow items (< 12%) are left auto: pinning a tiny width makes CJK text wrap
 * one glyph per line (最→最/物/車) and balloons the container height. ~full
 * width also fills naturally.
 */
function widthFromPct(pct: number | undefined): string | undefined {
  if (pct === undefined || pct < 0.12 || pct >= 0.98) return undefined;
  return `${Math.round(pct * 1000) / 10}%`;
}

function structuralNode(c: ComponentIR, theme: ThemeIR): BricksPlanNode | null {
  if (c.type === "block") {
    const children = structuralNodes(c.children ?? [], theme);
    if (children.length === 0) return null;
    const layout: LayoutBox = c.layout ?? { direction: "column" };
    const surface = mapComponentStyle(c, theme);
    delete surface._typography; // containers don't carry inherited text style
    const settings: Settings = { ...layoutToSettings(layout), ...surface };
    // Pin the flex width only for real columns/cards; a block wider than a
    // sibling row needs it or Bricks' default block width:100% stacks them.
    const w = widthFromPct(c.widthPct);
    if (w) settings._width = w;
    addClasses(settings, "cdp-block");
    // A block with a real surface reads as a card (design pass dims/hovers it).
    if (c.style && (c.style.backgroundColor || c.style.border || c.style.boxShadow || c.style.borderRadius)) {
      addClasses(settings, "cdp-card");
    }
    return { name: "block", settings, children, idHint: "blk", irId: c.id };
  }

  // Leaves (text/heading/button) size to their content — never pin a width, or
  // narrow flex items wrap CJK text vertically. Images keep their measured px
  // _width (set in buildComponentNode).
  return componentToNode(c, theme);
}

function structuralNodes(components: ComponentIR[], theme: ThemeIR): BricksPlanNode[] {
  const out: BricksPlanNode[] = [];
  for (const c of components) {
    const node = structuralNode(c, theme);
    if (node) out.push(node);
  }
  return out;
}

function planStructuralSection(section: SectionIR, theme: ThemeIR): BricksPlanNode[] {
  return structuralNodes(section.children, theme);
}

// ---------------------------------------------------------------------------
// planSection — the planner entry point
// ---------------------------------------------------------------------------

/**
 * Plan a section: Section > Container > layout-specific structure.
 *
 * `ids` is accepted for API symmetry with the generation run; real ids are
 * assigned when the plan is flattened (generate-json.ts) via `idHint`s, so
 * the planner itself stays a pure IR -> plan transform.
 */
export function planSection(section: SectionIR, theme: ThemeIR, ids?: IdFactory): BricksPlanNode {
  void ids; // ids are consumed at flatten time (see generate-json.ts)

  const slug = slugify(section.type || section.id || "section");
  const layout = (section.layout || "").toLowerCase();
  const isHeader = section.type === "header";
  const isCentered = layout.includes("center");

  let innerNodes: BricksPlanNode[];
  if (layout === "structural") {
    // Reconstructed nested container tree — emit it verbatim (all section types).
    innerNodes = planStructuralSection(section, theme);
  } else if (isHeader) {
    innerNodes = planHeader(section, theme, slug);
  } else if (layout === "two-column" || layout === "two-columns") {
    innerNodes = planTwoColumn(section, theme, slug);
  } else if (layout === "three-card-grid" || layout === "grid" || layout.includes("card-grid")) {
    innerNodes = planGrid(section, theme, slug);
  } else {
    // "one-column", "centered", and anything unknown -> clean single column.
    innerNodes = mapComponents(section.children, theme);
  }

  const containerSettings: Settings = { _direction: "column" };
  addClasses(containerSettings, "cdp-container");
  const hints = section.layoutHints;
  const centered = isCentered || hints?.textAlign === "center" || hints?.alignItems === "center";
  if (centered) {
    containerSettings._alignItems = "center";
    containerSettings._typography = { "text-align": "center" };
    addClasses(containerSettings, "cdp-centered");
  }
  // Vision-reported content width constrains the inner container (Bricks
  // containers are centered by default, so this reproduces the real max-width).
  if (hints?.contentMaxWidthPx !== undefined) {
    containerSettings._widthMax = String(hints.contentMaxWidthPx);
  }
  // Structural mode: pin the container to the source's content width so the
  // reconstructed percentage widths map to the right canvas (SPEC §5.2) and
  // Bricks' ~1100px default container doesn't squish a full-width page.
  if (layout === "structural" && containerSettings._widthMax === undefined) {
    const structuralMax = theme.containerMaxWidth
      ? pxToGridString(theme.containerMaxWidth)
      : section.box && section.box.width > 0
        ? String(Math.round(section.box.width))
        : undefined;
    if (structuralMax) containerSettings._widthMax = structuralMax;
  }

  // Theme font cascades from the section element to every child via CSS
  // inheritance — set font-family once here without clobbering other keys.
  // Split into Bricks' family + fallback keys (see splitFontFamily).
  const sectionSettings = mapSectionStyle(section, theme);
  const themeFont = theme.fontFamily ? splitFontFamily(theme.fontFamily) : undefined;
  if (themeFont) {
    const typo = (sectionSettings._typography as Settings) || {};
    if (!typo["font-family"]) {
      typo["font-family"] = themeFont.family;
      if (themeFont.fallback && !typo.fallback) typo.fallback = themeFont.fallback;
    }
    sectionSettings._typography = typo;
  }

  addClasses(sectionSettings, "cdp-section", `cdp-${slug}`);

  const sectionNode: BricksPlanNode = {
    name: "section",
    settings: sectionSettings,
    children: [container(containerSettings, innerNodes, `con_${slug}`)],
    idHint: `sec_${slug}`,
  };
  return sectionNode;
}
