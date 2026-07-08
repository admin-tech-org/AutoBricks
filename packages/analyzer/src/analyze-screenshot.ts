/**
 * Screenshot pixel analysis (ARCHITECTURE §8) — heuristic, no AI.
 *
 * Loads a PNG with pngjs, downsamples the pixel grid and computes:
 *  - dominant colors via a quantized histogram,
 *  - a background color estimate from the border pixels,
 *  - average luminance -> "light" | "dark" mode.
 *
 * All exported functions are small and pure (except the file readers).
 */

import * as fs from "fs";
import { PNG } from "pngjs";

export type Rgb = { r: number; g: number; b: number };

export type DominantColor = {
  rgb: Rgb;
  hex: string;
  /** Share of sampled pixels in this color bucket, 0..1. */
  ratio: number;
  saturation: number;
};

export type ScreenshotStats = {
  width: number;
  height: number;
  sampleCount: number;
  dominantColors: DominantColor[];
  /** Hex estimate from border pixels. */
  backgroundColor: string;
  /** 0..1 */
  averageLuminance: number;
  mode: "light" | "dark";
};

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

function clampChannel(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)));
}

export function rgbToHex(c: Rgb): string {
  const to2 = (n: number): string => clampChannel(n).toString(16).padStart(2, "0");
  return `#${to2(c.r)}${to2(c.g)}${to2(c.b)}`.toUpperCase();
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let v = m[1];
  if (v.length === 3) v = v.split("").map((ch) => ch + ch).join("");
  return {
    r: parseInt(v.slice(0, 2), 16),
    g: parseInt(v.slice(2, 4), 16),
    b: parseInt(v.slice(4, 6), 16),
  };
}

const NAMED_COLORS: Record<string, string> = {
  white: "#FFFFFF",
  black: "#000000",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  gray: "#808080",
  grey: "#808080",
  silver: "#C0C0C0",
  orange: "#FFA500",
  yellow: "#FFFF00",
  purple: "#800080",
  navy: "#000080",
  teal: "#008080",
};

/**
 * Parse a computed CSS color ("#fff", "rgb(1, 2, 3)", "rgba(0,0,0,0.5)",
 * a few named colors). Returns null for transparent/none/unparseable.
 */
export function parseCssColor(value: string | undefined | null): Rgb | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (v === "" || v === "transparent" || v === "none" || v === "currentcolor") return null;
  if (v.startsWith("#")) return hexToRgb(v);
  if (NAMED_COLORS[v]) return hexToRgb(NAMED_COLORS[v]);
  const m = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/\s]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const alphaRaw = m[4] as string | undefined;
    if (alphaRaw) {
      const alpha = alphaRaw.endsWith("%") ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
      if (Number.isFinite(alpha) && alpha === 0) return null;
    }
    return {
      r: clampChannel(parseFloat(m[1])),
      g: clampChannel(parseFloat(m[2])),
      b: clampChannel(parseFloat(m[3])),
    };
  }
  return null;
}

/** Perceptual luminance, 0..1. */
export function luminance(c: Rgb): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

/** HSV-style saturation, 0..1. */
export function saturation(c: Rgb): number {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Euclidean RGB distance, 0..~441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function quantizeColor(c: Rgb, step = 32): Rgb {
  const q = (n: number): number => Math.min(255, Math.floor(n / step) * step + step / 2);
  return { r: q(c.r), g: q(c.g), b: q(c.b) };
}

// ---------------------------------------------------------------------------
// Pixel sampling
// ---------------------------------------------------------------------------

export function readPng(filePath: string): PNG {
  return PNG.sync.read(fs.readFileSync(filePath));
}

function pixelAt(png: PNG, x: number, y: number): Rgb | null {
  const idx = (png.width * y + x) << 2;
  const a = png.data[idx + 3];
  if (a < 128) return null;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] };
}

/** Downsample the image to at most maxSamples pixels (grid stride sampling). */
export function samplePixels(png: PNG, maxSamples = 40000): Rgb[] {
  const total = png.width * png.height;
  if (total <= 0) return [];
  const stride = Math.max(1, Math.ceil(Math.sqrt(total / Math.max(1, maxSamples))));
  const out: Rgb[] = [];
  for (let y = 0; y < png.height; y += stride) {
    for (let x = 0; x < png.width; x += stride) {
      const p = pixelAt(png, x, y);
      if (p) out.push(p);
    }
  }
  return out;
}

/** Pixels along the four image borders (used for background estimation). */
export function borderPixels(png: PNG, thickness = 10, step = 4): Rgb[] {
  const out: Rgb[] = [];
  const t = Math.min(thickness, Math.floor(Math.min(png.width, png.height) / 2));
  if (t <= 0) return out;
  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < t; x++) {
      const left = pixelAt(png, x, y);
      if (left) out.push(left);
      const right = pixelAt(png, png.width - 1 - x, y);
      if (right) out.push(right);
    }
  }
  for (let x = 0; x < png.width; x += step) {
    for (let y = 0; y < t; y++) {
      const top = pixelAt(png, x, y);
      if (top) out.push(top);
      const bottom = pixelAt(png, x, png.height - 1 - y);
      if (bottom) out.push(bottom);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

type Bucket = { count: number; r: number; g: number; b: number };

function histogram(pixels: Rgb[], step: number): Map<string, Bucket> {
  const map = new Map<string, Bucket>();
  for (const p of pixels) {
    const q = quantizeColor(p, step);
    const key = `${q.r},${q.g},${q.b}`;
    const bucket = map.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += p.r;
      bucket.g += p.g;
      bucket.b += p.b;
    } else {
      map.set(key, { count: 1, r: p.r, g: p.g, b: p.b });
    }
  }
  return map;
}

function bucketMean(bucket: Bucket): Rgb {
  return {
    r: clampChannel(bucket.r / bucket.count),
    g: clampChannel(bucket.g / bucket.count),
    b: clampChannel(bucket.b / bucket.count),
  };
}

/** Dominant colors via quantized histogram, sorted by frequency. */
export function dominantColors(pixels: Rgb[], top = 8, step = 32): DominantColor[] {
  if (pixels.length === 0) return [];
  const buckets = [...histogram(pixels, step).values()].sort((a, b) => b.count - a.count).slice(0, top);
  return buckets.map((bucket) => {
    const rgb = bucketMean(bucket);
    return {
      rgb,
      hex: rgbToHex(rgb),
      ratio: bucket.count / pixels.length,
      saturation: saturation(rgb),
    };
  });
}

export function averageLuminance(pixels: Rgb[]): number {
  if (pixels.length === 0) return 1;
  let sum = 0;
  for (const p of pixels) sum += luminance(p);
  return sum / pixels.length;
}

/** Background color estimate: modal quantized color of the border pixels. */
export function estimateBackgroundColor(png: PNG): string {
  const border = borderPixels(png);
  if (border.length === 0) return "#FFFFFF";
  const buckets = [...histogram(border, 16).values()].sort((a, b) => b.count - a.count);
  return rgbToHex(bucketMean(buckets[0]));
}

/**
 * Dominant background color of a horizontal band of the page (a section box
 * projected onto the full-page screenshot). Samples only the band's EDGE
 * strips (left/right columns + top rows) where the true background shows,
 * so large foreground content (product screenshots, cards) can't hijack the
 * estimate. Returns undefined when the band is out of range or too small.
 */
export function dominantColorInBand(png: PNG, yTop: number, yBottom: number): string | undefined {
  return dominantColorInRect(png, { x: 0, y: yTop, width: png.width, height: yBottom - yTop }, "edges");
}

/**
 * Dominant color of a rectangular region of the screenshot.
 * - "edges": samples the rect's left/right strips + top strip — where the true
 *   background shows around foreground content. Can be fooled by page-level
 *   white margins around a full-bleed band.
 * - "interior": samples a grid over the inset interior — robust for bands that
 *   are mostly background (gradients), fooled by large foreground blocks.
 * Callers combine both with a text-contrast guard.
 */
export type Rect = { x: number; y: number; width: number; height: number };

export function dominantColorInRect(png: PNG, rect: Rect, mode: "edges" | "interior", excludeRects?: Rect[]): string | undefined {
  const palette = dominantPaletteInRect(png, rect, mode, excludeRects);
  return palette.length > 0 ? palette[0].hex : undefined;
}

/**
 * Quantized color palette of a rectangular screenshot region, largest share
 * first. `excludeRects` masks out known foreground boxes (e.g. a hero's big
 * product image) so they cannot hijack the background estimate.
 * - "edges": left/right strips + top strip of the rect.
 * - "interior": grid over the inset interior.
 */
export function dominantPaletteInRect(
  png: PNG,
  rect: Rect,
  mode: "edges" | "interior",
  excludeRects?: Rect[]
): Array<{ hex: string; ratio: number }> {
  const left = Math.max(0, Math.floor(rect.x));
  const right = Math.min(png.width, Math.ceil(rect.x + rect.width));
  const top = Math.max(0, Math.floor(rect.y));
  const bottom = Math.min(png.height, Math.ceil(rect.y + rect.height));
  const w = right - left;
  const h = bottom - top;
  if (h < 8 || w < 24) return [];

  const excluded = (x: number, y: number): boolean => {
    if (!excludeRects) return false;
    for (const r of excludeRects) {
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return true;
    }
    return false;
  };
  const pixels: Rgb[] = [];
  const push = (x: number, y: number) => {
    if (excluded(x, y)) return;
    const idx = (png.width * y + x) << 2;
    if (png.data[idx + 3] < 200) return; // skip transparent
    pixels.push({ r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2] });
  };

  if (mode === "edges") {
    const stepY = Math.max(2, Math.floor(h / 120));
    const stripW = Math.max(4, Math.floor(w * 0.08));
    const inset = Math.max(2, Math.floor(w * 0.01));
    for (let y = top; y < bottom; y += stepY) {
      for (let x = left + inset; x < left + inset + stripW; x += 4) push(x, y);
      for (let x = right - inset - stripW; x < right - inset; x += 4) push(x, y);
    }
    const topStrip = top + Math.max(4, Math.floor(h * 0.12));
    for (let y = top; y < topStrip; y += Math.max(2, Math.floor((topStrip - top) / 12))) {
      for (let x = left + inset; x < right - inset; x += 8) push(x, y);
    }
  } else {
    const insetX = Math.max(2, Math.floor(w * 0.08));
    const insetY = Math.max(2, Math.floor(h * 0.08));
    const stepX = Math.max(3, Math.floor((w - insetX * 2) / 140));
    const stepY = Math.max(3, Math.floor((h - insetY * 2) / 90));
    for (let y = top + insetY; y < bottom - insetY; y += stepY) {
      for (let x = left + insetX; x < right - insetX; x += stepX) push(x, y);
    }
  }
  if (pixels.length < 50) return [];
  const buckets = [...histogram(pixels, 24).values()].sort((a, b) => b.count - a.count);
  const total = pixels.length;
  return buckets.slice(0, 8).map((b) => ({ hex: rgbToHex(bucketMean(b)), ratio: b.count / total }));
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function analyzeScreenshot(png: PNG): ScreenshotStats {
  const pixels = samplePixels(png);
  const avg = averageLuminance(pixels);
  return {
    width: png.width,
    height: png.height,
    sampleCount: pixels.length,
    dominantColors: dominantColors(pixels),
    backgroundColor: estimateBackgroundColor(png),
    averageLuminance: avg,
    mode: avg >= 0.5 ? "light" : "dark",
  };
}

export function analyzeScreenshotFile(filePath: string): ScreenshotStats {
  return analyzeScreenshot(readPng(filePath));
}
