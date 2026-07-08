/**
 * Robust extraction + validation of vision-model JSON verdicts.
 *
 * A language model's text output is untrusted: it may wrap JSON in ``` fences,
 * emit out-of-range numbers, invent CSS, or hallucinate colors. Every value is
 * hand-validated and clamped into the typed result — parsing NEVER throws, it
 * drops what it cannot trust and keeps the rest. Dropped fields simply fall
 * back to the heuristic IR downstream.
 */

import type {
  VisionAIBackground,
  VisionAIButtonStyle,
  VisionAIComponentFix,
  VisionAIGlobalResult,
  VisionAILayoutHints,
  VisionAISectionResult,
  VisionAITypography,
} from "@bricks-cdp/ir";

// ---------------------------------------------------------------------------
// Primitive guards
// ---------------------------------------------------------------------------

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hex(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!HEX_RE.test(s)) return undefined;
  let h = s.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h.toLowerCase()}`;
}

function clampInt(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const r = Math.round(n);
  return r < min || r > max ? undefined : r;
}

function clampFloat(v: unknown, min: number, max: number, decimals = 2): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  if (n < min || n > max) return undefined;
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

function shortStr(v: unknown, max = 80): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate a CSS gradient string: linear/radial, ≤ 300 chars, balanced parens, ≥ 2 hex colors. */
function gradientCss(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s.length > 300 || !/^(linear|radial)-gradient\(/i.test(s)) return undefined;
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return undefined;
  }
  if (depth !== 0) return undefined;
  const hexCount = (s.match(/#[0-9a-f]{3,6}\b/gi) || []).length;
  return hexCount >= 2 ? s : undefined;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/** Strip ``` fences and pull out the first balanced {...} block, then JSON.parse. */
export function extractJson(text: string): Record<string, unknown> | undefined {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const block = t.slice(start, i + 1);
        try {
          const parsed = JSON.parse(block);
          return isRecord(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Fragment validators
// ---------------------------------------------------------------------------

const ALIGN_ITEMS = ["flex-start", "center", "flex-end", "stretch"] as const;
const JUSTIFY = ["flex-start", "center", "flex-end", "space-between"] as const;
const TEXT_ALIGN = ["left", "center", "right"] as const;
const TEXT_TRANSFORM = ["none", "uppercase", "lowercase", "capitalize"] as const;
const LAYOUT_TYPES = ["one-column", "two-column", "three-card-grid", "grid", "centered"] as const;

function typography(v: unknown): VisionAITypography | undefined {
  if (!isRecord(v)) return undefined;
  const t: VisionAITypography = {};
  const fs = clampInt(v.fontSizePx, 8, 160);
  if (fs !== undefined) t.fontSizePx = fs;
  const fw = clampInt(v.fontWeight, 100, 900);
  if (fw !== undefined) t.fontWeight = Math.round(fw / 100) * 100;
  const lh = clampFloat(v.lineHeight, 0.8, 3);
  if (lh !== undefined) t.lineHeight = lh;
  const ls = clampFloat(v.letterSpacingPx, -5, 20);
  if (ls !== undefined) t.letterSpacingPx = ls;
  const c = hex(v.color);
  if (c) t.color = c;
  const ta = oneOf(v.textAlign, TEXT_ALIGN);
  if (ta) t.textAlign = ta;
  const tt = oneOf(v.textTransform, TEXT_TRANSFORM);
  if (tt) t.textTransform = tt;
  return Object.keys(t).length > 0 ? t : undefined;
}

function background(v: unknown): VisionAIBackground | undefined {
  if (!isRecord(v)) return undefined;
  const kind = oneOf(v.kind, ["solid", "gradient", "image"] as const);
  if (!kind) return undefined;
  const bg: VisionAIBackground = { kind };
  const c = hex(v.color);
  if (c) bg.color = c;
  const g = gradientCss(v.gradientCss);
  if (g) bg.gradientCss = g;
  if (typeof v.imageUrl === "string" && /^https?:\/\//i.test(v.imageUrl.trim()) && v.imageUrl.length < 500) {
    bg.imageUrl = v.imageUrl.trim();
  }
  // A gradient/image kind with nothing usable degrades to its solid color, if any.
  if (kind === "gradient" && !bg.gradientCss) bg.kind = bg.color ? "solid" : kind;
  if (kind === "image" && !bg.imageUrl) bg.kind = bg.color ? "solid" : kind;
  if (bg.kind === "solid" && !bg.color) return undefined;
  return bg;
}

function layout(v: unknown): VisionAILayoutHints | undefined {
  if (!isRecord(v)) return undefined;
  const l: VisionAILayoutHints = {};
  const ty = oneOf(v.type, LAYOUT_TYPES);
  if (ty) l.type = ty;
  const cols = clampInt(v.columns, 1, 8);
  if (cols !== undefined) l.columns = cols;
  const cg = clampInt(v.columnGapPx, 0, 400);
  if (cg !== undefined) l.columnGapPx = cg;
  const rg = clampInt(v.rowGapPx, 0, 400);
  if (rg !== undefined) l.rowGapPx = rg;
  const ai = oneOf(v.alignItems, ALIGN_ITEMS);
  if (ai) l.alignItems = ai;
  const jc = oneOf(v.justifyContent, JUSTIFY);
  if (jc) l.justifyContent = jc;
  const mw = clampInt(v.contentMaxWidthPx, 320, 1600);
  if (mw !== undefined) l.contentMaxWidthPx = mw;
  const pt = clampInt(v.paddingTopPx, 0, 400);
  if (pt !== undefined) l.paddingTopPx = pt;
  const pb = clampInt(v.paddingBottomPx, 0, 400);
  if (pb !== undefined) l.paddingBottomPx = pb;
  const ta = oneOf(v.textAlign, TEXT_ALIGN);
  if (ta) l.textAlign = ta;
  return Object.keys(l).length > 0 ? l : undefined;
}

function button(v: unknown): VisionAIButtonStyle | undefined {
  if (!isRecord(v)) return undefined;
  const b: VisionAIButtonStyle = {};
  const tsw = shortStr(v.textStartsWith, 40);
  if (tsw) b.textStartsWith = tsw;
  const bgc = hex(v.backgroundColor);
  if (bgc) b.backgroundColor = bgc;
  const c = hex(v.color);
  if (c) b.color = c;
  const r = clampInt(v.radiusPx, 0, 80);
  if (r !== undefined) b.radiusPx = r;
  const bc = hex(v.borderColor);
  if (bc) b.borderColor = bc;
  const bw = clampInt(v.borderWidthPx, 0, 12);
  if (bw !== undefined) b.borderWidthPx = bw;
  const px = clampInt(v.paddingXPx, 0, 120);
  if (px !== undefined) b.paddingXPx = px;
  const py = clampInt(v.paddingYPx, 0, 120);
  if (py !== undefined) b.paddingYPx = py;
  const fsz = clampInt(v.fontSizePx, 8, 80);
  if (fsz !== undefined) b.fontSizePx = fsz;
  const fw = clampInt(v.fontWeight, 100, 900);
  if (fw !== undefined) b.fontWeight = Math.round(fw / 100) * 100;
  return Object.keys(b).length > 0 ? b : undefined;
}

const FIX_STYLE_KEYS = new Set([
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "borderRadius",
  "border",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "marginTop",
  "marginBottom",
  "maxWidth",
  "width",
  "backgroundImage",
]);

function fix(v: unknown): VisionAIComponentFix | undefined {
  if (!isRecord(v) || !isRecord(v.match)) return undefined;
  const action = oneOf(v.action, ["restyle", "drop"] as const);
  if (!action) return undefined;
  const m = v.match as Record<string, unknown>;
  const match: VisionAIComponentFix["match"] = {};
  const ty = shortStr(m.type, 20);
  if (ty) match.type = ty;
  const tsw = shortStr(m.textStartsWith, 60);
  if (tsw) match.textStartsWith = tsw;
  const sr = shortStr(m.styleRole, 40);
  if (sr) match.styleRole = sr;
  const nth = clampInt(m.nth, 1, 100);
  if (nth !== undefined) match.nth = nth;
  if (Object.keys(match).length === 0) return undefined;

  const out: VisionAIComponentFix = { match, action };
  if (action === "restyle" && isRecord(v.style)) {
    const style: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.style)) {
      if (FIX_STYLE_KEYS.has(k) && typeof val === "string" && val.trim().length > 0 && val.length < 200) {
        style[k] = val.trim();
      }
    }
    if (Object.keys(style).length === 0) return undefined;
    out.style = style;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public parsers
// ---------------------------------------------------------------------------

export function parseSectionResult(text: string, sectionId: string): VisionAISectionResult | undefined {
  const obj = extractJson(text);
  if (!obj) return undefined;
  const out: VisionAISectionResult = { sectionId };

  const bg = background(obj.background);
  if (bg) out.background = bg;
  const tc = hex(obj.textColor);
  if (tc) out.textColor = tc;
  const l = layout(obj.layout);
  if (l) out.layout = l;

  if (isRecord(obj.typography)) {
    const typo: Record<string, VisionAITypography> = {};
    for (const [role, val] of Object.entries(obj.typography)) {
      const t = typography(val);
      if (t) typo[role] = t;
    }
    if (Object.keys(typo).length > 0) out.typography = typo;
  }

  if (Array.isArray(obj.buttons)) {
    const btns = obj.buttons.map(button).filter((b): b is VisionAIButtonStyle => Boolean(b)).slice(0, 8);
    if (btns.length > 0) out.buttons = btns;
  }

  if (Array.isArray(obj.fixes)) {
    const fixes = obj.fixes.map(fix).filter((f): f is VisionAIComponentFix => Boolean(f)).slice(0, 20);
    if (fixes.length > 0) out.fixes = fixes;
  }

  if (Array.isArray(obj.notes)) {
    const notes = obj.notes.map((n) => shortStr(n, 160)).filter((n): n is string => Boolean(n)).slice(0, 8);
    if (notes.length > 0) out.notes = notes;
  }

  const conf = clampFloat(obj.confidence, 0, 1);
  if (conf !== undefined) out.confidence = conf;

  return out;
}

export function parseGlobalResult(text: string): VisionAIGlobalResult | undefined {
  const obj = extractJson(text);
  if (!obj) return undefined;
  const out: VisionAIGlobalResult = {};
  const ff = shortStr(obj.fontFamily, 60);
  if (ff) out.fontFamily = ff;
  const fst = shortStr(obj.fontStack, 200);
  if (fst) out.fontStack = fst;
  const pc = hex(obj.primaryColor);
  if (pc) out.primaryColor = pc;
  const bg = hex(obj.backgroundColor);
  if (bg) out.backgroundColor = bg;
  const tc = hex(obj.textColor);
  if (tc) out.textColor = tc;
  const mtc = hex(obj.mutedTextColor);
  if (mtc) out.mutedTextColor = mtc;
  const r = clampInt(obj.radiusPx, 0, 80);
  if (r !== undefined) out.radiusPx = r;
  const mode = oneOf(obj.mode, ["light", "dark"] as const);
  if (mode) out.mode = mode;
  if (Array.isArray(obj.notes)) {
    const notes = obj.notes.map((n) => shortStr(n, 160)).filter((n): n is string => Boolean(n)).slice(0, 8);
    if (notes.length > 0) out.notes = notes;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
