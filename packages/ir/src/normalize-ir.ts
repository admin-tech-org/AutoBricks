/**
 * normalizeIR — Style Mapper normalization rules (ARCHITECTURE §15):
 *
 *  - round font-size to integer px
 *  - convert line-height to a unitless ratio (2 decimals) when both px known
 *  - snap margins/paddings to a 4px grid
 *  - drop components with empty text and no src
 *  - unique readable ids (sec_hero, sec_features, cmp_1 ...)
 *  - clamp heading level to h1–h4
 *  - fill styleRole (hero-title, hero-subtitle, primary-cta, hero-image,
 *    section-title, card-title, card-text, footer-text ...)
 *  - drop sections with zero children unless type hero/header/footer
 */

import type { ComponentIR, PageIR, SectionIR } from "./types";
import { parseFirstPx, parsePx } from "./merge-dom-vision";

const KEEP_EMPTY_SECTION_TYPES = new Set(["hero", "header", "footer"]);

/**
 * Marquee/carousel patterns duplicate their content (logo strips render the
 * same list twice for seamless looping) — after capture both copies are
 * visible DOM. Within one section an image src should appear once: repeats
 * are dropped, recursively through nested blocks.
 */
/**
 * Decorative full-screen background art (gradient washes, hero glows) is
 * captured as ordinary <img> nodes but must not become content images: at our
 * 1440x900 capture viewport anything bigger than ~1.5M px² is scenery.
 */
const DECORATIVE_IMAGE_AREA = 1_500_000;

function dedupeRepeatedImages(components: ComponentIR[], seen?: Set<string>): void {
  const srcs = seen ?? new Set<string>();
  const drop = new Set<ComponentIR>();
  for (const c of components) {
    if (c.type === "image" && c.box && c.box.width * c.box.height > DECORATIVE_IMAGE_AREA) {
      drop.add(c);
      continue;
    }
    if (c.type === "image" && c.src) {
      if (srcs.has(c.src)) {
        drop.add(c);
        continue;
      }
      srcs.add(c.src);
    }
    if (c.children && c.children.length > 0) dedupeRepeatedImages(c.children, srcs);
  }
  if (drop.size > 0) {
    for (let i = components.length - 1; i >= 0; i--) {
      if (drop.has(components[i])) components.splice(i, 1);
    }
  }
}

export function normalizeIR(ir: PageIR): PageIR {
  const clone: PageIR = JSON.parse(JSON.stringify(ir));

  normalizeThemeValues(clone);

  const sectionTypeCounts = new Map<string, number>();
  const sections: SectionIR[] = [];

  for (const section of clone.sections || []) {
    if (!section) continue;
    section.type = section.type || "content";
    section.layout = section.layout || "one-column";
    normalizeStyleValues(section.style);

    section.children = normalizeComponents(section.children || []);
    dedupeRepeatedImages(section.children);
    if (section.children.length === 0 && !KEEP_EMPTY_SECTION_TYPES.has(section.type)) continue;

    const slugType = slug(section.type);
    const n = (sectionTypeCounts.get(slugType) || 0) + 1;
    sectionTypeCounts.set(slugType, n);
    section.id = n === 1 ? `sec_${slugType}` : `sec_${slugType}_${n}`;

    fillStyleRoles(section);
    sections.push(section);
  }

  clone.sections = sections;

  // unique readable component ids across the whole page
  let counter = 0;
  const assignIds = (comps: ComponentIR[]): void => {
    for (const c of comps) {
      counter += 1;
      c.id = `cmp_${counter}`;
      if (c.children && c.children.length > 0) assignIds(c.children);
    }
  };
  for (const s of sections) assignIds(s.children);

  return clone;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function normalizeComponents(comps: ComponentIR[]): ComponentIR[] {
  const out: ComponentIR[] = [];
  for (const comp of comps) {
    if (!comp) continue;
    normalizeStyleValues(comp.style);
    clampLevel(comp);
    if (typeof comp.text === "string") {
      const trimmed = comp.text.trim();
      if (trimmed.length > 0) comp.text = trimmed;
      else delete comp.text;
    }
    if (comp.children && comp.children.length > 0) {
      comp.children = normalizeComponents(comp.children);
    }
    if (keepComponent(comp)) out.push(comp);
  }
  return out;
}

function keepComponent(comp: ComponentIR): boolean {
  const hasText = typeof comp.text === "string" && comp.text.length > 0;
  const hasSrc = typeof comp.src === "string" && comp.src.length > 0;
  switch (comp.type) {
    case "image":
      return hasSrc;
    case "icon":
    case "divider":
      return true;
    case "block":
      return Boolean(comp.children && comp.children.length > 0);
    default:
      // heading / text / button / anything text-bearing
      return hasText || hasSrc;
  }
}

function clampLevel(comp: ComponentIR): void {
  if (comp.type !== "heading") {
    if (comp.level) delete comp.level;
    return;
  }
  const m = /^h(\d)$/.exec(comp.level || "");
  const n = m ? Math.min(Math.max(parseInt(m[1], 10), 1), 4) : 2;
  comp.level = ("h" + String(n)) as NonNullable<ComponentIR["level"]>;
}

// ---------------------------------------------------------------------------
// Style value normalization (§15)
// ---------------------------------------------------------------------------

function normalizeStyleValues(style: Record<string, string> | undefined): void {
  if (!style) return;

  // font-size -> integer px
  const fontSize = parsePx(style.fontSize);
  if (fontSize !== undefined) style.fontSize = `${Math.round(fontSize)}px`;

  // line-height -> unitless ratio when both px values are known
  if (style.lineHeight && /px\s*$/.test(style.lineHeight) && fontSize !== undefined && fontSize > 0) {
    const lh = parsePx(style.lineHeight);
    if (lh !== undefined && lh > 0) {
      style.lineHeight = String(Math.round((lh / fontSize) * 100) / 100);
    }
  }

  // margins / paddings -> 4px grid
  for (const key of Object.keys(style)) {
    if (!/^(margin|padding)/.test(key)) continue;
    const v = parsePx(style[key]);
    if (v === undefined) continue;
    const snapped = Math.round(v / 4) * 4;
    if (snapped === 0) delete style[key];
    else style[key] = `${snapped}px`;
  }

  // border-radius -> integer px (first value of possible shorthand)
  if (style.borderRadius) {
    const r = parseFirstPx(style.borderRadius);
    if (r !== undefined) {
      if (Math.round(r) === 0) delete style.borderRadius;
      else style.borderRadius = `${Math.round(r)}px`;
    }
  }

  for (const key of Object.keys(style)) {
    const v = style[key];
    if (typeof v !== "string" || v.trim() === "") delete style[key];
  }
}

function normalizeThemeValues(ir: PageIR): void {
  const theme = ir.theme;
  if (!theme) return;
  if (theme.radius) {
    const r = parseFirstPx(theme.radius);
    if (r !== undefined) theme.radius = `${Math.round(r)}px`;
  }
  if (theme.sectionPaddingY) {
    const p = parsePx(theme.sectionPaddingY);
    if (p !== undefined) theme.sectionPaddingY = `${Math.round(p / 8) * 8}px`;
  }
}

// ---------------------------------------------------------------------------
// styleRole filling
// ---------------------------------------------------------------------------

function firstWithoutRole(comps: ComponentIR[], type: string): ComponentIR | undefined {
  return comps.find((c) => c.type === type && !c.styleRole);
}

function fillStyleRoles(section: SectionIR): void {
  const comps = section.children;

  switch (section.type) {
    case "hero": {
      const hasTitle = comps.some((c) => c.type === "heading" && c.styleRole === "hero-title");
      if (!hasTitle) {
        const title = firstWithoutRole(comps, "heading");
        if (title) title.styleRole = "hero-title";
      }
      const subtitle = firstWithoutRole(comps, "text");
      if (subtitle) subtitle.styleRole = "hero-subtitle";
      const cta = firstWithoutRole(comps, "button");
      if (cta) cta.styleRole = "primary-cta";
      const image = firstWithoutRole(comps, "image");
      if (image) image.styleRole = "hero-image";
      break;
    }
    case "header": {
      for (const c of comps) {
        if (c.type === "text" && !c.styleRole) c.styleRole = "nav-text";
      }
      const cta = firstWithoutRole(comps, "button");
      if (cta) cta.styleRole = "primary-cta";
      break;
    }
    case "footer": {
      const title = firstWithoutRole(comps, "heading");
      if (title) title.styleRole = "section-title";
      for (const c of comps) {
        if (c.type === "text" && !c.styleRole) c.styleRole = "footer-text";
      }
      break;
    }
    case "cta": {
      const title = firstWithoutRole(comps, "heading");
      if (title) title.styleRole = "section-title";
      const cta = firstWithoutRole(comps, "button");
      if (cta) cta.styleRole = "primary-cta";
      break;
    }
    default: {
      const title = firstWithoutRole(comps, "heading");
      if (title) title.styleRole = "section-title";
      break;
    }
  }

  // card blocks (any section type)
  for (const c of comps) {
    if (c.type !== "block" || !c.children) continue;
    const title = firstWithoutRole(c.children, "heading");
    if (title) title.styleRole = "card-title";
    for (const child of c.children) {
      if (child.type === "text" && !child.styleRole) child.styleRole = "card-text";
    }
    const image = firstWithoutRole(c.children, "image");
    if (image) image.styleRole = "card-image";
    const btn = firstWithoutRole(c.children, "button");
    if (btn) btn.styleRole = "card-cta";
  }
}

// ---------------------------------------------------------------------------

function slug(value: string): string {
  const s = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s.length > 0 ? s : "content";
}
