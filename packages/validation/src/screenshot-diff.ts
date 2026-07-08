/**
 * Screenshot diff (ARCHITECTURE §17 Visual Validator).
 *
 * Compares the original full-page screenshot against the generated preview
 * screenshot. Both images are scaled to a common width, then only the
 * overlapping top region (min of the two scaled heights) is diffed — tall
 * pages with mismatched aspect ratios are NOT penalized for uncovered height;
 * that is surfaced via `uncoveredHeightRatio` so callers can emit a warning.
 */

import * as fs from "fs";
import * as path from "path";
import { PNG } from "pngjs";
import pixelmatch = require("pixelmatch");

const TARGET_WIDTH = 720;

/** Simple nearest-neighbor resampler. */
function resizeNearest(src: PNG, dstW: number, dstH: number): PNG {
  const dst = new PNG({ width: dstW, height: dstH });
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / dstW));
      const si = (sy * src.width + sx) << 2;
      const di = (y * dstW + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

function loadPng(file: string): PNG {
  return PNG.sync.read(fs.readFileSync(file));
}

export type ScreenshotDiffResult = {
  similarity: number;
  diffPixels: number;
  /** Width of the compared (overlapping) region after scaling. */
  width: number;
  /** Height of the compared (overlapping) region after scaling. */
  height: number;
  /** Fraction (0..1) of the taller image's height that was NOT compared. */
  uncoveredHeightRatio: number;
};

export async function screenshotDiff(
  originalPng: string,
  generatedPng: string,
  diffOutPng: string
): Promise<ScreenshotDiffResult> {
  const original = loadPng(originalPng);
  const generated = loadPng(generatedPng);

  // Scale both to a common width, preserving aspect ratio.
  const h1 = Math.max(1, Math.round((original.height * TARGET_WIDTH) / Math.max(1, original.width)));
  const h2 = Math.max(1, Math.round((generated.height * TARGET_WIDTH) / Math.max(1, generated.width)));
  const a = resizeNearest(original, TARGET_WIDTH, h1);
  const b = resizeNearest(generated, TARGET_WIDTH, h2);

  // Compare only the overlapping top region (mismatched aspect ratios are a
  // warning for the caller, not diff pixels).
  const commonH = Math.min(h1, h2);
  const rowBytes = TARGET_WIDTH * 4;
  const regionA = a.data.subarray(0, commonH * rowBytes);
  const regionB = b.data.subarray(0, commonH * rowBytes);

  const diff = new PNG({ width: TARGET_WIDTH, height: commonH });
  const diffPixels = pixelmatch(regionA, regionB, diff.data, TARGET_WIDTH, commonH, {
    threshold: 0.15,
    includeAA: false,
  });

  fs.mkdirSync(path.dirname(diffOutPng), { recursive: true });
  fs.writeFileSync(diffOutPng, PNG.sync.write(diff));

  const totalPixels = TARGET_WIDTH * commonH;
  const similarity = totalPixels > 0 ? 1 - diffPixels / totalPixels : 0;
  const maxH = Math.max(h1, h2);
  const uncoveredHeightRatio = maxH > 0 ? 1 - commonH / maxH : 0;

  return { similarity, diffPixels, width: TARGET_WIDTH, height: commonH, uncoveredHeightRatio };
}
