/**
 * Feature-card treatment for prominent split blocks (e.g. Postman's "Meet the
 * AI Engineer"): a frosted, bordered card with an animated gradient GLOW border.
 *
 * Measured from the source: a 1px purple hairline (rgba(179,135,245,0.5)),
 * 10-12px radius, a translucent elevated background (rgba(9,7,13,0.5)) with a
 * 10px backdrop-blur, and a gradient glow border overlay that intensifies on
 * hover. The base surface (border / background / padding / hover) is emitted as
 * NATIVE Bricks settings (editable in the builder); the glow ring itself needs a
 * masked `::before` with a rotating conic-gradient + `@keyframes`, which no
 * native setting expresses, so it rides on a small id-scoped `_cssCustom`
 * (Bricks emits it verbatim — hence the real `#brxe-<id>` selector, only known
 * after flatten, so this runs as a post-flatten pass).
 */

import type { BricksElement, ThemeIR } from "@bricks-cdp/ir";

type Settings = Record<string, unknown>;

const rgba = (triplet: string, alpha: number): { rgb: string } => ({ rgb: `rgba(${triplet}, ${alpha})` });
const sides = (v: string) => ({ top: v, right: v, bottom: v, left: v });

/** The animated gradient glow border + frosted backdrop, scoped to one element id. */
function glowCss(id: string): string {
  const sel = `#brxe-${id}`;
  return [
    `${sel}{position:relative;isolation:isolate;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);}`,
    `${sel}>*{position:relative;z-index:1;}`,
    // Masked ::before = a 1px ring painted with a rotating conic gradient (glow).
    `${sel}::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;`,
    `background:conic-gradient(from var(--cdp-ang,120deg),rgba(255,108,55,.85),rgba(179,135,245,.55) 25%,transparent 45%,transparent 62%,rgba(255,108,55,.75));`,
    `-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;`,
    `pointer-events:none;z-index:2;opacity:.5;transition:opacity .5s ease;animation:cdp-glow-spin 9s linear infinite;}`,
    `${sel}:hover::before{opacity:1;}`,
    // Soft glow under the symbol art.
    `${sel} img{filter:drop-shadow(0 12px 34px rgba(122,47,138,.45));}`,
    // Smoothly animate the conic angle (progressive enhancement — falls back to a
    // static glow where @property is unsupported).
    `@property --cdp-ang{syntax:"<angle>";inherits:false;initial-value:120deg;}`,
    `@keyframes cdp-glow-spin{to{--cdp-ang:480deg;}}`,
    `@media (prefers-reduced-motion:reduce){${sel}::before{animation:none;}}`,
  ].join("");
}

/**
 * Give every prominent split block (heading + media side by side) the frosted
 * glow-card treatment. Base surface keys are only filled when absent; hover /
 * transition / glow are additive. Uses the element's real id, so this must run
 * after flatten.
 */
export function applyFeatureCards(content: BricksElement[], _theme: ThemeIR): void {
  const byId = new Map(content.map((e) => [e.id, e]));
  const parentOf = new Map<string, string | 0>();
  for (const e of content) for (const c of e.children) parentOf.set(c, e.id);
  const has = (e: BricksElement, c: string): boolean =>
    typeof e.settings._cssClasses === "string" && e.settings._cssClasses.split(/\s+/).includes(c);
  const ancestorHasClass = (e: BricksElement, cls: string): boolean => {
    let pid = parentOf.get(e.id);
    while (typeof pid === "string") {
      const p = byId.get(pid);
      if (!p) break;
      if (has(p, cls)) return true;
      pid = parentOf.get(p.id);
    }
    return false;
  };
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

  for (const el of content) {
    if (!has(el, "cdp-split")) continue;
    // Heroes are full-bleed, not bordered cards — leave them alone. The glow
    // card is for standalone feature blocks (e.g. a "Meet the AI Engineer" CTA).
    if (ancestorHasClass(el, "cdp-hero")) continue;
    const names = descendants(el).map((k) => k.name);
    // Only a real feature block: heading text next to a media image.
    if (!names.includes("heading") || !names.includes("image")) continue;

    const s: Settings = el.settings;
    if (s._border === undefined) {
      s._border = { width: sides("1"), style: "solid", color: rgba("179, 135, 245", 0.5), radius: sides("12") };
    }
    if (s._background === undefined) s._background = { color: rgba("9, 7, 13", 0.5) };
    if (s._padding === undefined) s._padding = sides("48");
    s._cssTransition = "border-color .5s ease, box-shadow .5s ease";
    s["_border:hover"] = { color: rgba("179, 135, 245", 0.9) };

    const existing = typeof s._cssCustom === "string" ? s._cssCustom : "";
    s._cssCustom = existing ? `${existing}\n${glowCss(el.id)}` : glowCss(el.id);
  }
}
