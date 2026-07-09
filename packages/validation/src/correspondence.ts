/**
 * Element-delta comparator (SPEC §5.4 / §9) — the trustworthy fidelity signal.
 *
 * The pixel-diff-vs-preview score (score.ts) is a poor signal for structural
 * layout: it compares against an APPROXIMATION render and penalizes approximate
 * colors more than it rewards correct structure (SPEC §3). This module instead
 * aligns each source element to its rendered counterpart via the provenance map
 * (brxeId → source ComponentIR id, produced by generate-json.ts) and measures
 * exact per-element deltas: font-size (px), colour (ΔE), and box geometry
 * (normalised to each page's width so the two different-height renders compare).
 *
 * Source truth: ComponentIR.box / ComponentIR.style already in page-ir.json.
 * Rendered truth: getBoundingClientRect + getComputedStyle of each #brxe-<id>,
 * captured live off the WordPress render (see the measure harness).
 *
 * Pure and deterministic — no IO. The harness feeds it the measurements.
 */

import type { ComponentIR, PageIR } from "@bricks-cdp/ir";

// ---------------------------------------------------------------------------
// Contracts (SPEC §9)
// ---------------------------------------------------------------------------

export type RenderedElement = {
  box: { x: number; y: number; width: number; height: number };
  /** Computed style, camelCase keys (fontSize, color, backgroundColor, padding*). */
  style: Record<string, string>;
};

export type RenderedMeasurements = {
  pageWidth: number;
  pageHeight: number;
  /** Keyed by brxeId (== BricksElement.id, i.e. the id in #brxe-<id>). */
  elements: Record<string, RenderedElement>;
};

export type SourceDims = { pageWidth: number; pageHeight: number };

export type BoxDelta = {
  /** Deltas as a fraction of page width (rendered − source), scale-invariant. */
  dxFrac: number;
  dyFrac: number;
  dwFrac: number;
  dhFrac: number;
};

export type StyleDelta = {
  prop: string;
  source: string;
  rendered: string;
  deltaPx?: number;
  deltaE?: number;
};

export type ElementMatch = {
  irId: string;
  brxeId: string;
  type?: string;
  text?: string;
};

export type ElementDiff = {
  match: ElementMatch;
  box?: BoxDelta;
  styles: StyleDelta[];
  /** Weighted 0..1, higher = worse. Drives the "worst offenders" ranking. */
  severity: number;
  /** Source element sits off the visible page (a carousel slide scrolled out of
   *  view): its on-screen position is undefined, so box geometry is not scored. */
  offscreen?: boolean;
};

export type VisualScore = {
  /** matched source elements / total source components. */
  matchedFraction: number;
  matchedCount: number;
  sourceCount: number;
  /** Robust per-element PASS FRACTIONS (each element 0/1 — immune to the
   *  off-screen-carousel outliers that make RMSE useless). Higher = better. */
  positionGood: number; // |dxFrac| ≤ 0.08 (within 8% of page width horizontally)
  sizeGood: number; // |dwFrac| ≤ 0.10 (width within 10% of page width)
  fontSizeGood: number; // font-size within 3px
  colorGood: number; // text colour within ΔE 8
  /** Matched elements whose SOURCE box is off-screen (carousel slides), excluded
   *  from position/size scoring — reported so the exclusion is never silent. */
  offscreenExcluded: number;
  /** Diagnostics (medians — robust central tendency, not outlier-blown RMSE). */
  xFracMedianAbs: number;
  widthFracMedianAbs: number;
  fontSizeMedianPx: number;
  textColorDeltaEMedian: number;
  /** 0..1 composite, higher = better. Position/size (structural) weighted most. */
  overall: number;
};

export type CorrespondenceReport = {
  matched: ElementDiff[];
  unmatchedSource: string[];
  unmatchedRendered: string[];
  score: VisualScore;
};

// ---------------------------------------------------------------------------
// Colour distance (ΔE76 in CIE-Lab — simple, adequate for a fidelity metric)
// ---------------------------------------------------------------------------

type Rgb = { r: number; g: number; b: number; a: number };

export function parseColor(css: string | undefined): Rgb | null {
  if (!css) return null;
  const v = css.trim().toLowerCase();
  if (v === "" || v === "transparent" || v === "none") return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a: Number.isFinite(a) ? a : 1 };
  }
  return null;
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function rgbToLab({ r, g, b }: Rgb): [number, number, number] {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  // linear sRGB -> XYZ (D65)
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** ΔE76 between two CSS colours; undefined when either is unparseable/transparent. */
export function colorDeltaE(a: string | undefined, b: string | undefined): number | undefined {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb || ca.a === 0 || cb.a === 0) return undefined;
  const [l1, a1, b1] = rgbToLab(ca);
  const [l2, a2, b2] = rgbToLab(cb);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const px = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const m = /^(-?\d*\.?\d+)/.exec(v.trim());
  return m ? parseFloat(m[1]) : undefined;
};

const get = (s: Record<string, string> | undefined, ...keys: string[]): string | undefined => {
  if (!s) return undefined;
  for (const k of keys) if (s[k] !== undefined && s[k] !== "") return s[k];
  return undefined;
};

type SourceComp = { id: string; type: string; text?: string; box?: ComponentIR["box"]; style?: Record<string, string> };

function indexSource(ir: PageIR): Map<string, SourceComp> {
  const map = new Map<string, SourceComp>();
  const walk = (comps: ComponentIR[] | undefined): void => {
    if (!comps) return;
    for (const c of comps) {
      map.set(c.id, { id: c.id, type: c.type, text: c.text, box: c.box, style: c.style });
      walk(c.children);
    }
  };
  for (const s of ir.sections) walk(s.children);
  return map;
}

const medianAbs = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = xs.map(Math.abs).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const frac = (ok: number, n: number): number => (n > 0 ? ok / n : 1);

// ---------------------------------------------------------------------------
// Comparator
// ---------------------------------------------------------------------------

export function computeCorrespondence(
  ir: PageIR,
  provenance: Record<string, string>,
  rendered: RenderedMeasurements,
  srcDims: SourceDims
): CorrespondenceReport {
  const source = indexSource(ir);
  const srcW = srcDims.pageWidth > 0 ? srcDims.pageWidth : 1440;
  const renW = rendered.pageWidth > 0 ? rendered.pageWidth : 1440;

  const matched: ElementDiff[] = [];
  const unmatchedRendered: string[] = [];
  const matchedIrIds = new Set<string>();
  let offscreenCount = 0;

  for (const [brxeId, rel] of Object.entries(rendered.elements)) {
    const irId = provenance[brxeId];
    const src = irId ? source.get(irId) : undefined;
    if (!src) {
      unmatchedRendered.push(brxeId);
      continue;
    }
    matchedIrIds.add(irId);

    const styles: StyleDelta[] = [];

    // font-size (absolute px — directly comparable)
    const sFont = px(get(src.style, "fontSize", "font-size"));
    const rFont = px(get(rel.style, "fontSize", "font-size"));
    if (sFont !== undefined && rFont !== undefined) {
      styles.push({ prop: "font-size", source: `${sFont}`, rendered: `${rFont}`, deltaPx: Math.abs(sFont - rFont) });
    }

    // text colour (ΔE)
    const sColor = get(src.style, "color");
    const rColor = get(rel.style, "color");
    const dText = colorDeltaE(sColor, rColor);
    if (dText !== undefined) styles.push({ prop: "color", source: sColor!, rendered: rColor!, deltaE: dText });

    // background colour (ΔE) — only when the source painted one
    const sBg = get(src.style, "backgroundColor", "background-color");
    const rBg = get(rel.style, "backgroundColor", "background-color");
    const dBg = colorDeltaE(sBg, rBg);
    if (dBg !== undefined) styles.push({ prop: "background-color", source: sBg!, rendered: rBg!, deltaE: dBg });

    // padding (px) — sum of the four sides
    const sPad = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].map((k) => px(get(src.style, k)) ?? 0);
    const rPad = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"].map((k) => px(get(rel.style, k)) ?? 0);
    const padDelta = Math.abs(sPad.reduce((a, x) => a + x, 0) - rPad.reduce((a, x) => a + x, 0));

    // A source element whose horizontal centre lies off the visible page is a
    // carousel slide scrolled out of view. Our replica wraps such strips into a
    // visible grid, so the rendered position is deliberately different — there is
    // no on-screen source position to compare. Keep it matched (content present)
    // but do not score its geometry, else it registers as a huge phantom dX.
    let box: BoxDelta | undefined;
    let offscreen = false;
    if (src.box) {
      const cx = src.box.x + src.box.width / 2;
      offscreen = cx > srcW || cx < 0;
      if (offscreen) offscreenCount++;
      else {
        box = {
          dxFrac: rel.box.x / renW - src.box.x / srcW,
          dyFrac: rel.box.y / renW - src.box.y / srcW,
          dwFrac: rel.box.width / renW - src.box.width / srcW,
          dhFrac: rel.box.height / renW - src.box.height / srcW,
        };
      }
    }

    const sev = severityOf(box, styles, padDelta);
    matched.push({
      match: { irId, brxeId, type: src.type, text: src.text },
      box,
      styles: padDelta > 0 ? [...styles, { prop: "padding", source: `${sPad}`, rendered: `${rPad}`, deltaPx: padDelta }] : styles,
      severity: sev,
      offscreen,
    });
  }

  const unmatchedSource = [...source.keys()].filter((id) => !matchedIrIds.has(id));
  matched.sort((a, b) => b.severity - a.severity);

  const score = scoreOf(matched, source.size, offscreenCount);
  return { matched, unmatchedSource, unmatchedRendered, score };
}

function styleDelta(styles: StyleDelta[], prop: string): StyleDelta | undefined {
  return styles.find((s) => s.prop === prop);
}

function severityOf(box: BoxDelta | undefined, styles: StyleDelta[], padDelta: number): number {
  let s = 0;
  if (box) s += Math.abs(box.dxFrac) * 2 + Math.abs(box.dwFrac) * 2 + Math.abs(box.dyFrac) * 0.2;
  const font = styleDelta(styles, "font-size");
  if (font?.deltaPx) s += Math.min(1, font.deltaPx / 16) * 0.5;
  const col = styleDelta(styles, "color");
  if (col?.deltaE) s += Math.min(1, col.deltaE / 30) * 0.5;
  s += Math.min(1, padDelta / 64) * 0.2;
  return Math.round(s * 1000) / 1000;
}

function scoreOf(matched: ElementDiff[], sourceCount: number, offscreenExcluded: number): VisualScore {
  const xFrac: number[] = [];
  const widthFrac: number[] = [];
  const fontDeltas: number[] = [];
  const textDeltaE: number[] = [];

  let boxed = 0;
  let posOk = 0;
  let sizeOk = 0;
  let fontN = 0;
  let fontOk = 0;
  let colorN = 0;
  let colorOk = 0;

  for (const m of matched) {
    if (m.box) {
      boxed++;
      xFrac.push(m.box.dxFrac);
      widthFrac.push(m.box.dwFrac);
      if (Math.abs(m.box.dxFrac) <= 0.08) posOk++;
      if (Math.abs(m.box.dwFrac) <= 0.1) sizeOk++;
    }
    const f = styleDelta(m.styles, "font-size");
    if (f?.deltaPx !== undefined) {
      fontN++;
      fontDeltas.push(f.deltaPx);
      if (f.deltaPx <= 3) fontOk++;
    }
    const c = styleDelta(m.styles, "color");
    if (c?.deltaE !== undefined) {
      colorN++;
      textDeltaE.push(c.deltaE);
      if (c.deltaE <= 8) colorOk++;
    }
  }

  const matchedFraction = sourceCount > 0 ? matched.length / sourceCount : 0;
  const positionGood = frac(posOk, boxed);
  const sizeGood = frac(sizeOk, boxed);
  const fontSizeGood = frac(fontOk, fontN);
  const colorGood = frac(colorOk, colorN);

  // Robust composite of per-element pass fractions (immune to the off-screen-
  // carousel outliers that make an RMSE score meaningless). POSITION is the
  // dominant visual-fidelity factor — an element in the wrong PLACE reads as
  // more wrong than one slightly mis-sized — so it carries the most weight,
  // then coverage, then size, font, colour.
  const overall =
    0.4 * positionGood + 0.2 * matchedFraction + 0.15 * sizeGood + 0.15 * fontSizeGood + 0.1 * colorGood;

  return {
    matchedFraction: round3(matchedFraction),
    matchedCount: matched.length,
    sourceCount,
    positionGood: round3(positionGood),
    sizeGood: round3(sizeGood),
    fontSizeGood: round3(fontSizeGood),
    colorGood: round3(colorGood),
    offscreenExcluded,
    xFracMedianAbs: round3(medianAbs(xFrac)),
    widthFracMedianAbs: round3(medianAbs(widthFrac)),
    fontSizeMedianPx: round3(medianAbs(fontDeltas)),
    textColorDeltaEMedian: round3(medianAbs(textDeltaE)),
    overall: round3(overall),
  };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
