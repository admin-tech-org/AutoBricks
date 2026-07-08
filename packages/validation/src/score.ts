/**
 * Validation scoring (README "Validation" section).
 *
 * Produces the ValidationReport shape:
 *   { score, layoutScore, colorScore, spacingScore, contentScore, warnings }
 *
 * Structural scores are computed from IR vs generated template; pixel-based
 * scores use the screenshot-diff similarity when available and degrade to
 * documented heuristics otherwise (visual validation must never break the
 * pipeline).
 */

import type {
  BricksElement,
  BricksTemplate,
  ComponentIR,
  PageIR,
  SectionIR,
  ValidationReport,
} from "@bricks-cdp/ir";

const round2 = (n: number): number => Math.round(clamp01(n) * 100) / 100;
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Normalize text for containment matching: lowercase, collapsed whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function walkComponents(components: ComponentIR[], visit: (c: ComponentIR) => void): void {
  for (const c of components) {
    visit(c);
    if (c.children && c.children.length > 0) walkComponents(c.children, visit);
  }
}

/** Collect deep string values from a settings object (text, links, colors...). */
function collectSettingStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (value.trim() !== "") out.push(norm(value));
  } else if (Array.isArray(value)) {
    for (const v of value) collectSettingStrings(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectSettingStrings(v, out);
  }
}

type TemplateIndex = {
  byId: Map<string, BricksElement>;
  rootSections: BricksElement[];
  allStrings: string[];
};

function indexTemplate(template: BricksTemplate): TemplateIndex {
  const content = Array.isArray(template.content) ? template.content : [];
  const byId = new Map<string, BricksElement>();
  const allStrings: string[] = [];
  for (const el of content) {
    byId.set(el.id, el);
    collectSettingStrings(el.settings, allStrings);
  }
  const rootSections = content.filter((el) => el.parent === 0);
  return { byId, rootSections, allStrings };
}

/** All descendant elements (inclusive) of a template element, cycle-safe. */
function descendants(root: BricksElement, byId: Map<string, BricksElement>): BricksElement[] {
  const out: BricksElement[] = [];
  const seen = new Set<string>();
  const stack: BricksElement[] = [root];
  while (stack.length > 0) {
    const el = stack.pop() as BricksElement;
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    out.push(el);
    for (const childId of el.children || []) {
      const child = byId.get(childId);
      if (child) stack.push(child);
    }
  }
  return out;
}

function irTexts(ir: PageIR): string[] {
  const texts: string[] = [];
  for (const section of ir.sections) {
    walkComponents(section.children, (c) => {
      if ((c.type === "heading" || c.type === "text" || c.type === "text-basic" || c.type === "button") && c.text) {
        const n = norm(c.text);
        if (n) texts.push(n);
      }
    });
  }
  return texts;
}

/** IR component type -> expected Bricks element name(s). */
const KIND_TO_NAMES: Record<string, string[]> = {
  heading: ["heading"],
  button: ["button"],
  image: ["image"],
};

function sectionExpectedKinds(section: SectionIR): Set<string> {
  const kinds = new Set<string>();
  walkComponents(section.children, (c) => {
    if (KIND_TO_NAMES[c.type]) kinds.add(c.type);
  });
  return kinds;
}

function firstHeadingText(section: SectionIR): string | undefined {
  let found: string | undefined;
  walkComponents(section.children, (c) => {
    if (!found && c.type === "heading" && c.text && norm(c.text)) found = norm(c.text);
  });
  return found;
}

function layoutScoreOf(ir: PageIR, idx: TemplateIndex): number {
  const irCount = ir.sections.length;
  const tplCount = idx.rootSections.length;

  // 1) Section count: ratio of the smaller to the larger.
  const countScore =
    irCount === 0 && tplCount === 0 ? 1 : Math.min(irCount, tplCount) / Math.max(irCount, tplCount, 1);

  // 2) Per-section presence of expected element kinds (heading/button/image
  //    where the IR has them), matching sections by order.
  let kindsExpected = 0;
  let kindsFound = 0;
  // 3) Section order: matched-by-index sections whose first IR heading text is
  //    present in the corresponding template section.
  let orderChecks = 0;
  let orderHits = 0;

  const pairs = Math.min(irCount, tplCount);
  for (let i = 0; i < pairs; i++) {
    const irSection = ir.sections[i];
    const tplSection = idx.rootSections[i];
    const tplEls = descendants(tplSection, idx.byId);
    const tplNames = new Set(tplEls.map((e) => e.name));
    const tplStrings: string[] = [];
    for (const e of tplEls) collectSettingStrings(e.settings, tplStrings);

    for (const kind of sectionExpectedKinds(irSection)) {
      kindsExpected++;
      const names = KIND_TO_NAMES[kind] || [];
      if (names.some((n) => tplNames.has(n))) kindsFound++;
    }

    const heading = firstHeadingText(irSection);
    orderChecks++;
    if (!heading) {
      orderHits++; // nothing to verify -> treat as preserved
    } else if (tplStrings.some((s) => s.includes(heading))) {
      orderHits++;
    }
  }

  const kindsScore = kindsExpected === 0 ? 1 : kindsFound / kindsExpected;
  const orderScore = orderChecks === 0 ? 1 : orderHits / orderChecks;

  const base = 0.4 * countScore + 0.4 * kindsScore + 0.2 * orderScore;

  // Grid check: an IR section whose layout is a grid (e.g. "three-card-grid")
  // must materialize as a row with >=2 sibling "block" cards in the template.
  // Kind-presence above cannot catch a collapsed card grid (a single heading/
  // image still satisfies it), so missing grids penalize the structural score
  // proportionally (up to 50% — bounded so one bad grid section cannot zero
  // out an otherwise correct page).
  const gridScore = gridScoreOf(ir, idx);
  return base * (0.5 + 0.5 * gridScore);
}

/**
 * Fraction of IR grid sections whose matched template section contains at
 * least 2 sibling "block" elements under some row (the cards). 1 when the IR
 * has no grid sections.
 */
function gridScoreOf(ir: PageIR, idx: TemplateIndex): number {
  let expected = 0;
  let satisfied = 0;
  for (let i = 0; i < ir.sections.length; i++) {
    if (!/grid/i.test(ir.sections[i].layout || "")) continue;
    expected++;
    const tplSection = i < idx.rootSections.length ? idx.rootSections[i] : undefined;
    if (!tplSection) continue;
    const els = descendants(tplSection, idx.byId);
    const hasCardRow = els.some(
      (e) => (e.children || []).filter((cid) => idx.byId.get(cid)?.name === "block").length >= 2
    );
    if (hasCardRow) satisfied++;
  }
  return expected === 0 ? 1 : satisfied / expected;
}

function contentScoreOf(ir: PageIR, idx: TemplateIndex): number {
  const texts = irTexts(ir);
  if (texts.length === 0) return 1;
  let found = 0;
  for (const t of texts) {
    if (idx.allStrings.some((s) => s.includes(t))) found++;
  }
  return found / texts.length;
}

function themeColorsInSettings(ir: PageIR, idx: TemplateIndex): boolean {
  const colors = [ir.theme.primaryColor, ir.theme.backgroundColor, ir.theme.textColor]
    .filter((c): c is string => typeof c === "string" && c.trim() !== "")
    .map((c) => norm(c));
  if (colors.length === 0) return false;
  return colors.some((c) => idx.allStrings.some((s) => s.includes(c)));
}

function hasSpacingSettings(idx: TemplateIndex): boolean {
  for (const el of idx.byId.values()) {
    const s = el.settings as Record<string, unknown> | undefined;
    if (!s) continue;
    if (s["_padding"] || s["_margin"] || s["_columnGap"] || s["_rowGap"]) return true;
  }
  return false;
}

function autoWarnings(ir: PageIR): string[] {
  const warnings: string[] = [];

  // Header navigation is out of MVP scope -> mobile menu will be missing.
  const headerSection = ir.sections.find(
    (s) =>
      s.type.toLowerCase().includes("header") ||
      s.type.toLowerCase().includes("nav") ||
      (s.visualRole || "").toLowerCase().includes("header")
  );
  if (headerSection) warnings.push("Mobile menu not generated");

  // Background images are flattened to solid colors in the MVP mapper.
  let hasBgImage = false;
  const styleHasBgImage = (style?: Record<string, string>): boolean => {
    if (!style) return false;
    const v = style["background-image"] ?? style["backgroundImage"];
    return typeof v === "string" && v.trim() !== "" && v.trim() !== "none";
  };
  for (const section of ir.sections) {
    if (styleHasBgImage(section.style)) hasBgImage = true;
    walkComponents(section.children, (c) => {
      if (styleHasBgImage(c.style)) hasBgImage = true;
    });
  }
  if (hasBgImage) warnings.push("Background image simplified");

  return warnings;
}

export function scoreValidation(input: {
  ir: PageIR;
  template: BricksTemplate;
  pixelSimilarity?: number;
  warnings?: string[];
}): ValidationReport {
  const { ir, template, pixelSimilarity } = input;
  const idx = indexTemplate(template);

  // Structural layout compares template vs IR only, so a template that
  // faithfully reproduces a WRONG IR (swapped columns, collapsed grid the IR
  // never modeled) would score perfect. The screenshot diff is the only
  // evidence against the ORIGINAL page, so when it exists it is blended into
  // layoutScore instead of feeding colorScore alone.
  const structuralLayoutScore = layoutScoreOf(ir, idx);
  const layoutScore =
    pixelSimilarity !== undefined
      ? 0.6 * structuralLayoutScore + 0.4 * clamp01(pixelSimilarity)
      : structuralLayoutScore;

  // contentScore intentionally stays IR -> template text fidelity: it answers
  // "did the generated JSON carry the extracted content", not "was the
  // extraction right" — the pixel evidence above covers the latter.
  const contentScore = contentScoreOf(ir, idx);

  // colorScore: pixel similarity when a diff ran; otherwise 1 if the detected
  // theme colors made it into the generated settings, else a 0.7 fallback.
  const colorScore =
    pixelSimilarity !== undefined ? clamp01(pixelSimilarity) : themeColorsInSettings(ir, idx) ? 1 : 0.7;

  // spacingScore: MVP heuristic — half from pixel similarity (0.7 neutral
  // fallback when no diff was possible), half from whether padding/gap
  // settings were emitted at all. Replace with box-model comparison later.
  const pixelPart = pixelSimilarity !== undefined ? clamp01(pixelSimilarity) : 0.7;
  const spacingScore = 0.5 * pixelPart + 0.5 * (hasSpacingSettings(idx) ? 1 : 0);

  const warnings = [...(input.warnings ?? [])];
  for (const w of autoWarnings(ir)) {
    if (!warnings.includes(w)) warnings.push(w);
  }
  // Surface real visual divergence explicitly — scores alone bury it.
  if (pixelSimilarity !== undefined && pixelSimilarity < 0.85) {
    const w = `Layout differs from original (pixel similarity ${clamp01(pixelSimilarity).toFixed(2)})`;
    if (!warnings.includes(w)) warnings.push(w);
  }

  const layout = round2(layoutScore);
  const content = round2(contentScore);
  const color = round2(colorScore);
  const spacing = round2(spacingScore);

  return {
    score: round2(0.35 * layout + 0.25 * content + 0.2 * color + 0.2 * spacing),
    layoutScore: layout,
    colorScore: color,
    spacingScore: spacing,
    contentScore: content,
    warnings,
  };
}
