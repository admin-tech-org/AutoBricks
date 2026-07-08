/**
 * Bricks JSON Generator (ARCHITECTURE §14).
 *
 * PageIR -> planSection per section -> flatten the plan trees into the flat
 * Bricks content array (parent/children wired by id, document order preserved,
 * root sections parented to 0), attach theme-level defaults, deep-clean
 * settings, and wrap everything in a BricksTemplate envelope.
 *
 * Deterministic: given the same IR and idStyle "readable", the output is
 * byte-for-byte identical. idStyle "bricks" uses random ids by design.
 */

import type { BricksElement, BricksTemplate, PageIR, ThemeIR } from "@bricks-cdp/ir";
import type { BricksPlanNode } from "./types";
import { IdFactory, type IdStyle } from "./create-element";
import { planSection } from "./map-section";
import { cssColorToHex, pxToGridString } from "./map-style";
import {
  buttonHoverSettings,
  cardBaseSettings,
  cardHoverSettings,
  entranceInteraction,
  logoSettings,
  mediaSettings,
} from "./design-native";
import { applyLogoMarquee } from "./logo-marquee";
import { applyFeatureCards } from "./feature-card";

export type GenerateJsonOptions = {
  idStyle?: IdStyle;
  sourceUrl?: string;
};

// ---------------------------------------------------------------------------
// Deep clean — settings must never contain undefined/null/NaN/empty objects
// ---------------------------------------------------------------------------

function cleanValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    const arr = value.map(cleanValue).filter((v) => v !== undefined);
    return arr.length > 0 ? arr : undefined;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = cleanValue(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return value;
}

/**
 * Recursively strip undefined / null / NaN / empty-object values from a
 * settings record. The top-level settings object itself is always kept
 * (Bricks elements always carry a settings key, possibly {}).
 */
export function cleanSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const cleaned = cleanValue(settings);
  return (cleaned as Record<string, unknown> | undefined) ?? {};
}

// ---------------------------------------------------------------------------
// Theme-level defaults (only when explicitly known — never invented)
// ---------------------------------------------------------------------------

function applyThemeDefaults(sectionNode: BricksPlanNode, theme: ThemeIR): void {
  // Section background: from section style (already mapped by the planner) or
  // the theme's detected page background — only when explicitly known.
  if (sectionNode.settings._background === undefined) {
    const themeBg = cssColorToHex(theme.backgroundColor);
    if (themeBg) sectionNode.settings._background = { color: { hex: themeBg } };
  }

  // Main container of every section is width-capped by the theme container.
  const maxWidth = theme.containerMaxWidth ? pxToGridString(theme.containerMaxWidth) : undefined;
  if (maxWidth) {
    for (const child of sectionNode.children) {
      if (child.name === "container" && child.settings._widthMax === undefined) {
        child.settings._widthMax = maxWidth;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Native design pass (hover / transition / surface / entrance animation)
// ---------------------------------------------------------------------------

const NON_MEDIA_NAMES = new Set(["heading", "text-basic", "text", "button"]);

/**
 * Walk the flat content and attach NATIVE Bricks design settings keyed on the
 * planner's `.cdp-*` classes: card surface + hover, button hover, media
 * surface, logo dimming, and scroll-entrance `_interactions`. Existing captured
 * values are respected (surface keys are only filled when absent); hover /
 * transition / interaction keys are additive.
 */
function applyNativeDesign(content: BricksElement[], ids: IdFactory, theme: ThemeIR): void {
  const byId = new Map(content.map((e) => [e.id, e]));
  const parentOf = new Map<string, string | 0>();
  for (const e of content) for (const c of e.children) parentOf.set(c, e.id);

  const classesOf = (e: BricksElement): Set<string> =>
    typeof e.settings._cssClasses === "string" ? new Set((e.settings._cssClasses as string).split(/\s+/)) : new Set();

  const descendants = (e: BricksElement): BricksElement[] => {
    const out: BricksElement[] = [];
    const stack = [...e.children];
    while (stack.length) {
      const el = byId.get(stack.pop() as string);
      if (!el) continue;
      out.push(el);
      stack.push(...el.children);
    }
    return out;
  };

  /** A card whose content is media/decoration only (logo tiles) — no card chrome. */
  const isMediaOnlyCard = (card: BricksElement): boolean => {
    const kids = descendants(card);
    const hasText = kids.some((k) => NON_MEDIA_NAMES.has(k.name));
    const hasImage = kids.some((k) => k.name === "image");
    return hasImage && !hasText;
  };

  const ancestorHasClass = (e: BricksElement, cls: string): boolean => {
    let pid = parentOf.get(e.id);
    while (typeof pid === "string") {
      const p = byId.get(pid);
      if (!p) break;
      if (classesOf(p).has(cls)) return true;
      pid = parentOf.get(p.id);
    }
    return false;
  };

  /** True for logo/brand images: in a logo strip, or inside a media-only card. */
  const isDecorativeLogo = (img: BricksElement): boolean => {
    if (ancestorHasClass(img, "cdp-logo-row")) return true;
    let pid = parentOf.get(img.id);
    while (typeof pid === "string") {
      const p = byId.get(pid);
      if (!p) break;
      if (classesOf(p).has("cdp-card")) return isMediaOnlyCard(p);
      pid = parentOf.get(p.id);
    }
    return false;
  };

  /** Merge surface keys only when absent; hover/transition keys always. */
  const fill = (settings: Record<string, unknown>, frag: Record<string, unknown>, force = false): void => {
    for (const [k, v] of Object.entries(frag)) {
      if (force || settings[k] === undefined) settings[k] = v;
    }
  };
  const addEntrance = (e: BricksElement, animationType = "fadeInUp"): void => {
    if (e.settings._interactions !== undefined) return;
    Object.assign(e.settings, entranceInteraction(ids.next("intr"), animationType));
  };

  const primary = theme.primaryColor;

  for (const el of content) {
    const cls = classesOf(el);
    const insideCard = ancestorHasClass(el, "cdp-card");

    if (cls.has("cdp-card")) {
      const inFooter = ancestorHasClass(el, "cdp-footer");
      // Media-only cards (logo tiles) get no card chrome — the logos inside
      // are dimmed in the image branch below.
      if (!inFooter && !isMediaOnlyCard(el)) {
        fill(el.settings, cardBaseSettings()); // respect captured bg/border
        fill(el.settings, cardHoverSettings(), true); // hover/transition additive
        if (!insideCard) addEntrance(el, "fadeInUp");
      }
      continue;
    }

    if (el.name === "button" || cls.has("cdp-btn")) {
      fill(el.settings, buttonHoverSettings(primary), true);
      if (!insideCard && cls.has("cdp-primary-cta")) addEntrance(el, "fadeInUp");
      continue;
    }

    if (el.name === "image" && cls.has("cdp-media")) {
      if (isDecorativeLogo(el)) {
        fill(el.settings, logoSettings(), true); // dim + hover-brighten, no shadow
      } else {
        fill(el.settings, mediaSettings()); // rounded + shadow (product shots)
        if (!insideCard) addEntrance(el, "fadeIn");
      }
      continue;
    }

    // Section-level headings / hero copy that aren't inside a card.
    if (!insideCard && (cls.has("cdp-hero-title") || cls.has("cdp-hero-subtitle") || cls.has("cdp-section-title"))) {
      addEntrance(el, "fadeInUp");
    }
  }
}

/**
 * Turn each image's stashed `__cdpAspect` marker into an id-scoped CSS rule that
 * locks the source aspect ratio and lets height follow width (so the image is
 * its exact source box on desktop and shrinks proportionally when Bricks'
 * `max-width:100%` caps it in a narrow container). The marker is removed.
 */
function applyExactAspect(content: BricksElement[]): void {
  for (const el of content) {
    const aspect = el.settings.__cdpAspect;
    delete el.settings.__cdpAspect;
    if (typeof aspect !== "string" || aspect.length === 0) continue;
    const rule = `#brxe-${el.id}{aspect-ratio:${aspect};height:auto;}`;
    const existing = typeof el.settings._cssCustom === "string" ? el.settings._cssCustom : "";
    el.settings._cssCustom = existing ? `${existing}\n${rule}` : rule;
  }
}

// ---------------------------------------------------------------------------
// Flatten plan tree -> flat content array
// ---------------------------------------------------------------------------

function flattenNode(
  node: BricksPlanNode,
  parent: string | 0,
  ids: IdFactory,
  out: BricksElement[]
): string {
  const element: BricksElement = {
    id: ids.next(node.idHint ?? node.name),
    name: node.name,
    parent,
    children: [],
    settings: cleanSettings(node.settings),
  };
  out.push(element); // parent precedes its children in document order
  for (const child of node.children) {
    element.children.push(flattenNode(child, element.id, ids, out));
  }
  return element.id;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a full Bricks Builder template from a PageIR.
 * Root section elements get parent = 0 (ARCHITECTURE §14).
 */
export function generateBricksJson(ir: PageIR, opts?: GenerateJsonOptions): BricksTemplate {
  // "bricks" by default: import-safe ids (see IdFactory). "readable" ids like
  // "ico" are substrings of element names and get corrupted by Bricks' import
  // id-remapping (global string replace) — use them for debugging only.
  const ids = new IdFactory(opts?.idStyle ?? "bricks");
  const content: BricksElement[] = [];

  for (const section of ir.sections) {
    const plan = planSection(section, ir.theme, ids);
    applyThemeDefaults(plan, ir.theme);
    flattenNode(plan, 0, ids, content);
  }

  // Design + motion as NATIVE Bricks settings (cards, shadows, hover states,
  // scroll entrance animations) — editable in the builder, no custom-CSS blob.
  applyNativeDesign(content, ids, ir.theme);

  // Pure logo strips -> infinite horizontal marquee (跑馬燈). This is the one
  // effect that needs an @keyframes loop (no native setting expresses it), so
  // it carries a small self-contained stylesheet on the viewport's _cssCustom.
  applyLogoMarquee(content, ids);

  // Lock each image's exact source aspect ratio (stashed as __cdpAspect in
  // map-section) as id-scoped CSS. Runs AFTER the marquee duplication so every
  // cloned logo gets its OWN #brxe-<id> rule (Bricks emits _cssCustom verbatim,
  // so we must use the real id, not %root%).
  applyExactAspect(content);

  // Prominent split blocks (heading + media) become frosted glow cards with an
  // animated gradient border — the rich, layered CSS the source uses. Native
  // border/bg/padding (editable) + a small id-scoped _cssCustom for the glow.
  applyFeatureCards(content, ir.theme);

  const template: BricksTemplate = {
    content,
    source: "cdpVisualGenerated",
    version: "1.0",
    // Bricks-import niceties: a display name for the template library and the
    // template type ("content" = regular page content, insertable into a page).
    name: templateNameFromUrl(opts?.sourceUrl ?? ir.url),
    templateType: "content",
  };

  const sourceUrl = opts?.sourceUrl ?? ir.url;
  if (typeof sourceUrl === "string" && sourceUrl.trim().length > 0) {
    template.sourceUrl = sourceUrl.trim();
  }

  return template;
}

/** "https://example.com/pricing" -> "example.com pricing (CDP generated)". */
function templateNameFromUrl(url: string | undefined): string {
  const fallback = "CDP generated template";
  if (typeof url !== "string" || url.trim().length === 0) return fallback;
  try {
    const u = new URL(url);
    if (u.protocol === "file:") {
      const base = u.pathname.split("/").pop() ?? "";
      return base ? `${base} (CDP generated)` : fallback;
    }
    const pathPart = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).join(" ");
    return `${u.hostname}${pathPart ? " " + pathPart : ""} (CDP generated)`.slice(0, 80);
  } catch {
    return fallback;
  }
}
