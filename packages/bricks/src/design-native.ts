/**
 * Native Bricks design fragments (schema v2.3).
 *
 * Instead of dumping a raw `_cssCustom` blob, these helpers return NATIVE
 * Bricks setting fragments so the styling and motion are editable in the
 * builder UI and use Bricks' own systems:
 *
 *  - hover effects        -> `_transform:hover` / `_boxShadow:hover` /
 *                            `_border:hover` (colon pseudo-class variants)
 *  - smooth transitions   -> `_cssTransition`
 *  - card / media surface -> `_background` / `_border` / `_boxShadow` / `_padding`
 *  - scroll entrance anim  -> `_interactions` (trigger "enterView" +
 *                            action "startAnimation"), the non-deprecated
 *                            Bricks Interactions system (the old `_animation`
 *                            entry-animation control is deprecated since 1.6).
 *
 * Colors use {rgb} (to keep alpha) or {hex}. Numeric strings match how Bricks
 * stores box-shadow / border / spacing values (the theme appends units).
 */

type Settings = Record<string, unknown>;

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function rgba(hexTriplet: string, alpha: number): { rgb: string } {
  return { rgb: `rgba(${hexTriplet}, ${alpha})` };
}

/** "#ff6c37" -> "255, 108, 55" (falls back to Postman orange). */
function primaryTriplet(primaryHex?: string): string {
  const hex = primaryHex && /^#[0-9a-f]{6}$/i.test(primaryHex) ? primaryHex : "#ff6c37";
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}

const sides = (v: string) => ({ top: v, right: v, bottom: v, left: v });

/**
 * Card surface: soft tinted background, hairline border, rounded corners,
 * depth shadow, generous padding — plus a lift-on-hover and a smooth
 * transition. Base surface keys are omitted here when the element already
 * carries a captured background/border (merge respects existing values).
 */
export function cardBaseSettings(): Settings {
  return {
    _background: { color: rgba("255, 255, 255", 0.035) },
    _border: {
      width: sides("1"),
      style: "solid",
      color: rgba("255, 255, 255", 0.09),
      radius: sides("18"),
    },
    _boxShadow: { values: { offsetX: "0", offsetY: "14", blur: "44", spread: "0" }, color: rgba("0, 0, 0", 0.42) },
    _padding: sides("30"),
  };
}

/** Card motion: lift + stronger shadow + brighter border on hover. */
export function cardHoverSettings(): Settings {
  return {
    _cssTransition: `all 0.45s ${EASE}`,
    "_transform:hover": { translateY: "-6px" },
    "_boxShadow:hover": { values: { offsetX: "0", offsetY: "26", blur: "70", spread: "0" }, color: rgba("0, 0, 0", 0.6) },
    "_border:hover": { color: rgba("255, 255, 255", 0.18) },
  };
}

/** Button motion: subtle lift + primary-tinted glow on hover. */
export function buttonHoverSettings(primaryHex?: string): Settings {
  const tri = primaryTriplet(primaryHex);
  return {
    _cssTransition: `all 0.25s ${EASE}`,
    "_transform:hover": { translateY: "-2px" },
    "_boxShadow:hover": { values: { offsetX: "0", offsetY: "12", blur: "30", spread: "0" }, color: rgba(tri, 0.42) },
  };
}

/** Media surface: rounded corners + depth shadow (product screenshots). */
export function mediaSettings(): Settings {
  return {
    _border: { radius: sides("12") },
    _boxShadow: { values: { offsetX: "0", offsetY: "14", blur: "44", spread: "0" }, color: rgba("0, 0, 0", 0.5) },
  };
}

/** Logo strip images: dimmed at rest, full opacity on hover. */
export function logoSettings(): Settings {
  return {
    _opacity: "0.55",
    _cssTransition: `opacity 0.3s ${EASE}`,
    "_opacity:hover": "1",
  };
}

/**
 * Scroll entrance animation via the native Interactions system: when the
 * element enters the viewport, Bricks plays the given animate.css animation
 * once. `id` must be a unique 6-char id (from the IdFactory).
 */
export function entranceInteraction(id: string, animationType = "fadeInUp"): Settings {
  return {
    _interactions: [
      {
        id,
        trigger: "enterView",
        action: "startAnimation",
        target: "self",
        animationType,
        runOnce: true,
      },
    ],
  };
}
