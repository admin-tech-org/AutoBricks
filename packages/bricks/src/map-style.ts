/**
 * Style Mapper (ARCHITECTURE §15).
 *
 * Normalizes raw CSS-ish IR style records into Bricks-native settings keys.
 *
 * DELIBERATE DEVIATION FROM ARCHITECTURE §14:
 * The §14 example shows a plain `direction` settings key, but the README hard
 * requirement is "JSON có thể import được vào Bricks Builder" — i.e. the JSON
 * must actually import into Bricks Builder. Bricks Builder stores layout and
 * design settings under underscore-prefixed keys (`_direction`,
 * `_justifyContent`, `_typography`, `_background`, `_padding`, ...), so we emit
 * those. For spec parity the planner ALSO mirrors a plain `direction` key on
 * row containers — Bricks ignores unknown keys, so the extra key is harmless.
 *
 * Normalization rules (§15, idempotent — IR values may already be normalized):
 * - px values are rounded to integers; spacing values snap to a 4px grid.
 * - line-height in px is converted to a unitless ratio against font-size.
 * - colors are normalized to #rrggbb hex; transparent values are dropped.
 * - undefined/unknown values are omitted ENTIRELY (never written as
 *   undefined/null) — generate-json deep-cleans as a final safety net.
 */

import type { ComponentIR, SectionIR, ThemeIR } from "@bricks-cdp/ir";

type StyleRecord = Record<string, string> | undefined;
type Settings = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Low-level normalization helpers
// ---------------------------------------------------------------------------

/** kebab-case -> camelCase ("font-size" -> "fontSize"). */
function toCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Look up a style value by its kebab-case CSS property name, tolerating both
 * kebab-case and camelCase keys in the IR style record.
 */
export function getStyleValue(style: StyleRecord, property: string): string | undefined {
  if (!style) return undefined;
  const raw = style[property] ?? style[toCamel(property)];
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

/** Parse a CSS length; returns the numeric px value or undefined. */
function parsePx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^(-?\d*\.?\d+)(px)?$/.exec(value.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** Round a px value to the nearest integer. */
export function roundPx(n: number): number {
  return Math.round(n);
}

/** Snap a px value to the 4px grid (17 -> 16, 18 -> 20). Idempotent. */
export function snapToGrid(n: number, grid = 4): number {
  return Math.round(n / grid) * grid;
}

/**
 * Normalize a spacing value into a unitless px number string ("16"), using the
 * EXACT measured value (rounded to the nearest px — no 4px-grid snapping) so
 * padding / margin / gaps match the source pixel-for-pixel. Non-px values
 * ("auto", "1em", "50%") pass through as-is.
 */
export function pxToGridString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const n = parsePx(value);
  if (n === undefined) return value === "auto" || /%$/.test(value) ? value : undefined;
  return String(roundPx(n));
}

/** Normalize a size value: px -> rounded unitless string; %/auto pass through. */
function sizeString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const n = parsePx(value);
  if (n !== undefined) return String(roundPx(n));
  if (value === "auto" || /%$|vw$|vh$/.test(value)) return value;
  return undefined;
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Normalize a CSS color into "#rrggbb". Handles hex and rgb()/rgba().
 * Fully transparent colors (and "transparent") return undefined so callers
 * don't paint elements with a bogus background.
 */
export function cssColorToHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "transparent" || v === "none" || v === "inherit" || v === "initial") return undefined;
  if (HEX_RE.test(v)) {
    let hex = v.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length === 8) {
      const alpha = parseInt(hex.slice(6, 8), 16);
      if (alpha === 0) return undefined;
      hex = hex.slice(0, 6);
    }
    return `#${hex}`;
  }
  const m = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(v);
  if (m) {
    const alphaRaw = m[4];
    if (alphaRaw !== undefined) {
      const alpha = alphaRaw.endsWith("%") ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
      if (alpha === 0) return undefined;
    }
    const toHex2 = (s: string) => Math.min(255, parseInt(s, 10)).toString(16).padStart(2, "0");
    return `#${toHex2(m[1])}${toHex2(m[2])}${toHex2(m[3])}`;
  }
  return undefined;
}

/**
 * Normalize line-height to a unitless ratio string ("1.12").
 * px values are divided by font-size; unitless ratios pass through.
 */
function normalizeLineHeight(lineHeight: string | undefined, fontSizePx: number | undefined): string | undefined {
  if (!lineHeight || lineHeight === "normal") return undefined;
  const px = parsePx(lineHeight);
  if (px !== undefined && /px\s*$/.test(lineHeight)) {
    if (!fontSizePx || fontSizePx <= 0) return undefined;
    return String(Math.round((px / fontSizePx) * 100) / 100);
  }
  const ratio = parseFloat(lineHeight);
  if (Number.isFinite(ratio) && String(ratio) === lineHeight.trim()) {
    return String(Math.round(ratio * 100) / 100);
  }
  return px !== undefined && fontSizePx ? String(Math.round((px / fontSizePx) * 100) / 100) : undefined;
}

function normalizeFontWeight(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "normal") return "400";
  if (v === "bold") return "700";
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 100 && n <= 900 ? String(n) : undefined;
}

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
]);

/**
 * Split a CSS font stack into Bricks' primary family + separate generic
 * fallback. Bricks renders `font-family: "<family>"` (always quoted as ONE
 * name) and appends a SEPARATE unquoted `fallback` key — so a stack must NOT
 * be jammed into font-family (Bricks would quote the whole thing as a single
 * bogus family, and the browser falls back to its default serif). Keeping the
 * trailing generic as `fallback` lets a brand font the target WordPress lacks
 * (e.g. "degular", "inter") degrade to the RIGHT family, not serif.
 */
export function splitFontFamily(value: string | undefined): { family: string; fallback?: string } | undefined {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((p) => p.trim().replace(/^["']|["']$/g, ""))
    .filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  const family = parts[0];
  const last = parts[parts.length - 1].toLowerCase();
  const fallback = parts.length > 1 && GENERIC_FAMILIES.has(last) ? last : undefined;
  return fallback ? { family, fallback } : { family };
}

/** Assign only when the value is defined — never writes undefined keys. */
function setIfDefined(target: Settings, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== "") {
    target[key] = value;
  }
}

/**
 * Parse a 1-4 value CSS box shorthand ("16px 24px") into TRBL, or read the
 * per-side longhands ("padding-top", ...). Values snap to the 4px grid.
 */
function mapBoxSides(style: StyleRecord, property: "padding" | "margin"): Settings | undefined {
  const sides: Settings = {};
  const shorthand = getStyleValue(style, property);
  if (shorthand && !/calc|var\(/.test(shorthand)) {
    const parts = shorthand.split(/\s+/).map(pxToGridString);
    if (parts.length >= 1 && parts.every((p) => p !== undefined)) {
      const [a, b = a, c = a, d = b] = parts as string[];
      sides.top = a;
      sides.right = b;
      sides.bottom = c;
      sides.left = d;
    }
  }
  for (const side of ["top", "right", "bottom", "left"] as const) {
    setIfDefined(sides, side, pxToGridString(getStyleValue(style, `${property}-${side}`)));
  }
  return Object.keys(sides).length > 0 ? sides : undefined;
}

/** Split a comma list at top level only (ignores commas inside rgb()/rgba()/calc()). */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** A Bricks color object: {hex} for opaque colors, {rgb} to preserve alpha < 1. */
function toBricksColor(raw: string): Settings | undefined {
  const v = raw.trim();
  const rgba = /^rgba?\(\s*[\d.]+\s*[, ]\s*[\d.]+\s*[, ]\s*[\d.]+\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(v);
  if (rgba) {
    const alphaRaw = rgba[1];
    const alpha =
      alphaRaw === undefined ? 1 : alphaRaw.endsWith("%") ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
    if (alpha <= 0) return undefined;
    // Alpha < 1 has no hex equivalent — keep the raw rgb() string so the
    // translucency (e.g. soft box-shadows) survives.
    if (alpha < 1) return { rgb: v.replace(/\s+/g, "") };
    const hex = cssColorToHex(v);
    return hex ? { hex } : undefined;
  }
  const hex = cssColorToHex(v);
  return hex ? { hex } : undefined;
}

const GRADIENT_RE = /^(repeating-)?(linear|radial|conic)-gradient\s*\((.*)\)$/is;

/**
 * Parse a CSS gradient string into the Bricks 1.12.5 `_gradient` shape.
 * Supports linear/radial with hex or rgb(a) color stops and optional % stops.
 */
export function mapGradient(value: string | undefined): Settings | undefined {
  if (!value) return undefined;
  const m = GRADIENT_RE.exec(value.trim());
  if (!m) return undefined;
  const gradientType = m[2].toLowerCase();
  if (gradientType === "conic") return undefined; // Bricks supports it but keep MVP to linear/radial
  const inner = m[3];
  const parts = splitTopLevel(inner);
  if (parts.length < 2) return undefined;

  let angle = "180";
  let idx = 0;
  const head = parts[0].trim();
  const angleMatch = /^(-?\d+(?:\.\d+)?)deg$/i.exec(head);
  if (gradientType === "linear" && angleMatch) {
    angle = String(Math.round(parseFloat(angleMatch[1])));
    idx = 1;
  } else if (gradientType === "linear" && /^to\s+/i.test(head)) {
    // "to right" ~ 90deg, "to bottom" ~ 180deg, "to top" ~ 0, "to left" ~ 270
    const dir = head.toLowerCase();
    angle = /right/.test(dir) ? "90" : /left/.test(dir) ? "270" : /top/.test(dir) ? "0" : "180";
    idx = 1;
  } else if (gradientType === "radial" && !/#|rgb/i.test(head)) {
    idx = 1; // skip shape/position header ("circle at center")
  }

  const stopParts = parts.slice(idx).slice(0, 6);
  const colors: Array<Settings> = [];
  stopParts.forEach((part, i) => {
    // "<color> <pos%>" — color may itself contain spaces only inside rgb()
    const posMatch = /\s(-?\d+(?:\.\d+)?)%?\s*$/.exec(part);
    let colorRaw = part;
    let stop: string | undefined;
    if (posMatch) {
      colorRaw = part.slice(0, posMatch.index).trim();
      stop = String(Math.round(parseFloat(posMatch[1])));
    }
    const color = toBricksColor(colorRaw);
    if (!color) return;
    // Distribute evenly when no explicit stop given.
    if (stop === undefined) {
      stop = String(Math.round((i / Math.max(1, stopParts.length - 1)) * 100));
    }
    colors.push({ color, stop });
  });
  if (colors.length < 2) return undefined;

  const out: Settings = { applyTo: "background", gradientType, colors };
  if (gradientType === "linear") out.angle = angle;
  return out;
}

/**
 * Parse the FIRST shadow of a CSS box-shadow list into the Bricks 1.12.5
 * `_boxShadow` OBJECT shape { values:{offsetX,offsetY,blur,spread}, color }.
 * Returns undefined when it cannot parse (caller then omits the key).
 */
export function mapBoxShadow(value: string | undefined): Settings | undefined {
  if (!value || value === "none") return undefined;
  let first = splitTopLevel(value)[0];
  if (!first) return undefined;
  first = first.trim();

  let inset = false;
  if (/(^|\s)inset(\s|$)/i.test(first)) {
    inset = true;
    first = first.replace(/(^|\s)inset(\s|$)/i, " ").trim();
  }

  // Pull the color out (rgb/rgba/hex/named) wherever it sits.
  let color: Settings | undefined;
  const colorMatch = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b)/i.exec(first);
  if (colorMatch) {
    color = toBricksColor(colorMatch[1]);
    first = (first.slice(0, colorMatch.index) + first.slice(colorMatch.index + colorMatch[1].length)).trim();
  }

  const nums = first.split(/\s+/).map((t) => parsePx(t));
  const lengths = nums.filter((n): n is number => n !== undefined);
  if (lengths.length < 2) return undefined; // need at least offsetX + offsetY

  const [offsetX, offsetY, blur = 0, spread = 0] = lengths;
  const out: Settings = {
    values: {
      offsetX: String(Math.round(offsetX)),
      offsetY: String(Math.round(offsetY)),
      blur: String(Math.round(blur)),
      spread: String(Math.round(spread)),
    },
  };
  if (color) out.color = color;
  if (inset) out.inset = true;
  return out;
}

/**
 * Full `_border`: merge shorthand ("1px solid #e5e7eb") + per-side longhands
 * (border-width/-style/-color) with radius into one Bricks border object.
 */
function mapBorder(style: StyleRecord): Settings | undefined {
  const border: Settings = {};

  // Shorthand "border: 1px solid #e5e7eb"
  const shorthand = getStyleValue(style, "border");
  let width: string | undefined;
  let borderStyle: string | undefined;
  let color: string | undefined;
  if (shorthand && !/^none/i.test(shorthand)) {
    const w = /(-?\d*\.?\d+)px/.exec(shorthand);
    if (w) width = String(roundPx(parseFloat(w[1])));
    const st = /\b(solid|dashed|dotted|double|groove|ridge|inset|outset)\b/i.exec(shorthand);
    if (st) borderStyle = st[1].toLowerCase();
    const c = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}\b)/i.exec(shorthand);
    if (c) color = c[1];
  }
  // Longhands override the shorthand.
  const wLong = getStyleValue(style, "border-width");
  if (wLong) {
    const n = parsePx(wLong.split(/\s+/)[0]);
    if (n !== undefined) width = String(roundPx(n));
  }
  const stLong = getStyleValue(style, "border-style");
  if (stLong && stLong !== "none") borderStyle = stLong.split(/\s+/)[0];
  const cLong = getStyleValue(style, "border-color");
  if (cLong) color = cLong.split(/\s+/)[0] === cLong ? cLong : cLong.split(/\s+/)[0];

  if (width && borderStyle && borderStyle !== "none" && parseFloat(width) > 0) {
    border.width = { top: width, right: width, bottom: width, left: width };
    border.style = borderStyle;
    const col = color ? toBricksColor(color) : undefined;
    if (col) border.color = col;
  }

  const radius = mapBorderRadius(style);
  if (radius) border.radius = radius;

  return Object.keys(border).length > 0 ? border : undefined;
}

/** border-radius shorthand/longhands -> Bricks _border.radius TRBL (TL/TR/BR/BL). */
function mapBorderRadius(style: StyleRecord): Settings | undefined {
  const radius: Settings = {};
  const shorthand = getStyleValue(style, "border-radius");
  if (shorthand && !/[/]|calc|var\(/.test(shorthand)) {
    const parts = shorthand.split(/\s+/).map(sizeString);
    if (parts.length >= 1 && parts.every((p) => p !== undefined)) {
      const [a, b = a, c = a, d = b] = parts as string[];
      radius.top = a; // top-left
      radius.right = b; // top-right
      radius.bottom = c; // bottom-right
      radius.left = d; // bottom-left
    }
  }
  const corners: Array<[string, string]> = [
    ["border-top-left-radius", "top"],
    ["border-top-right-radius", "right"],
    ["border-bottom-right-radius", "bottom"],
    ["border-bottom-left-radius", "left"],
  ];
  for (const [cssKey, brickKey] of corners) {
    setIfDefined(radius, brickKey, sizeString(getStyleValue(style, cssKey)));
  }
  return Object.keys(radius).length > 0 ? radius : undefined;
}

// ---------------------------------------------------------------------------
// Shared fragment mappers
// ---------------------------------------------------------------------------

const TEXT_ALIGNS = new Set(["left", "center", "right", "justify"]);
const TEXT_TRANSFORMS = new Set(["none", "uppercase", "lowercase", "capitalize"]);
const TEXT_DECORATIONS = new Set(["none", "underline", "line-through", "overline"]);
const FLEX_DIRECTIONS = new Set(["row", "column", "row-reverse", "column-reverse"]);
const JUSTIFY = new Set(["flex-start", "flex-end", "center", "space-between", "space-around", "space-evenly"]);
const ALIGN = new Set(["flex-start", "flex-end", "center", "baseline", "stretch"]);
const WRAP = new Set(["nowrap", "wrap", "wrap-reverse"]);

/** Typography fragment: settings._typography (only known keys, no undefined). */
export function mapTypography(style: StyleRecord): Settings | undefined {
  const t: Settings = {};
  const fontSizePx = parsePx(getStyleValue(style, "font-size"));
  const ff = splitFontFamily(getStyleValue(style, "font-family"));
  if (ff) {
    t["font-family"] = ff.family;
    if (ff.fallback) t.fallback = ff.fallback;
  }
  if (fontSizePx !== undefined) t["font-size"] = `${roundPx(fontSizePx)}px`;
  setIfDefined(t, "font-weight", normalizeFontWeight(getStyleValue(style, "font-weight")));
  setIfDefined(t, "line-height", normalizeLineHeight(getStyleValue(style, "line-height"), fontSizePx));
  const letterSpacing = parsePx(getStyleValue(style, "letter-spacing"));
  if (letterSpacing !== undefined && letterSpacing !== 0) {
    t["letter-spacing"] = `${Math.round(letterSpacing * 100) / 100}px`;
  }
  const color = cssColorToHex(getStyleValue(style, "color"));
  if (color) t.color = { hex: color };
  const align = getStyleValue(style, "text-align");
  if (align && TEXT_ALIGNS.has(align)) t["text-align"] = align;
  const transform = getStyleValue(style, "text-transform");
  if (transform && TEXT_TRANSFORMS.has(transform)) t["text-transform"] = transform;
  const decoration = getStyleValue(style, "text-decoration");
  if (decoration) {
    const d = decoration.split(/\s+/)[0];
    if (TEXT_DECORATIONS.has(d)) t["text-decoration"] = d;
  }
  return Object.keys(t).length > 0 ? t : undefined;
}

/**
 * Box/layout fragment shared by components and sections:
 * background, padding/margin, flex, width, border-radius, box-shadow.
 */
function mapBoxStyle(style: StyleRecord, opts: { widths: boolean }): Settings {
  const s: Settings = {};

  // Background: solid color + optional image; a gradient wins as a separate
  // _gradient control (Bricks emits it as background-image).
  const background: Settings = {};
  const bg = cssColorToHex(getStyleValue(style, "background-color") ?? getStyleValue(style, "background"));
  if (bg) background.color = { hex: bg };

  const bgImage = getStyleValue(style, "background-image");
  const gradient = bgImage ? mapGradient(bgImage) : undefined;
  if (gradient) {
    s._gradient = gradient;
  } else if (bgImage) {
    const url = extractUrl(bgImage);
    if (url && /^https?:\/\//i.test(url)) {
      background.image = { url, external: true, filename: filenameFromUrl(url) };
      background.size = "cover";
      background.position = "center center";
      background.repeat = "no-repeat";
    }
  }
  if (Object.keys(background).length > 0) s._background = background;

  setIfDefined(s, "_padding", mapBoxSides(style, "padding"));
  setIfDefined(s, "_margin", mapBoxSides(style, "margin"));

  // Flex layout (only when the source explicitly declares it).
  const display = getStyleValue(style, "display");
  const direction = getStyleValue(style, "flex-direction");
  if (direction && FLEX_DIRECTIONS.has(direction) && (display === undefined || /flex/.test(display))) {
    s._direction = direction;
  }
  const justify = getStyleValue(style, "justify-content");
  if (justify && JUSTIFY.has(justify)) s._justifyContent = justify;
  const alignItems = getStyleValue(style, "align-items");
  if (alignItems && ALIGN.has(alignItems)) s._alignItems = alignItems;
  const wrap = getStyleValue(style, "flex-wrap");
  if (wrap && WRAP.has(wrap)) s._flexWrap = wrap;

  const gap = getStyleValue(style, "gap");
  const gapParts = gap ? gap.split(/\s+/) : [];
  const rowGap = pxToGridString(getStyleValue(style, "row-gap") ?? gapParts[0]);
  const columnGap = pxToGridString(getStyleValue(style, "column-gap") ?? gapParts[1] ?? gapParts[0]);
  setIfDefined(s, "_columnGap", columnGap);
  setIfDefined(s, "_rowGap", rowGap);

  if (opts.widths) {
    setIfDefined(s, "_width", sizeString(getStyleValue(style, "width")));
    setIfDefined(s, "_widthMax", sizeString(getStyleValue(style, "max-width")));
  }

  const border = mapBorder(style);
  if (border) s._border = border;

  const shadow = mapBoxShadow(getStyleValue(style, "box-shadow"));
  if (shadow) s._boxShadow = shadow;

  return s;
}

/** Extract the url() target from a background-image value. */
function extractUrl(value: string): string | undefined {
  const m = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(value);
  return m ? m[2].trim() : undefined;
}

/** Best-effort filename from a URL (Bricks external images want a filename). */
function filenameFromUrl(url: string): string {
  try {
    const clean = url.split(/[?#]/)[0];
    const base = clean.substring(clean.lastIndexOf("/") + 1);
    return base || "image";
  } catch {
    return "image";
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a ComponentIR's style into a Bricks settings fragment.
 * The theme is accepted for future scale-aware normalization; component
 * settings never invent values the IR did not provide.
 */
export function mapComponentStyle(c: ComponentIR, _theme: ThemeIR): Settings {
  const settings = mapBoxStyle(c.style, { widths: true });
  const typography = mapTypography(c.style);
  if (typography) settings._typography = typography;
  return settings;
}

/**
 * Map a SectionIR's style into a Bricks settings fragment for the section
 * element (background, padding, radius, shadow — sections are full width, so
 * no _width/_widthMax here).
 */
export function mapSectionStyle(s: SectionIR, _theme: ThemeIR): Settings {
  const settings = mapBoxStyle(s.style, { widths: false });
  // Sections themselves should not carry flex row/gap settings — the planner
  // owns inner layout. Keep background/spacing/visual keys only.
  delete settings._direction;
  delete settings._justifyContent;
  delete settings._alignItems;
  delete settings._flexWrap;
  delete settings._columnGap;
  delete settings._rowGap;
  return settings;
}
