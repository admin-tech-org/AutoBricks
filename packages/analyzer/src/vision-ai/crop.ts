/**
 * Section cropping for AI vision (ARCHITECTURE §8 upgrade).
 *
 * Slices each section band out of the full-page screenshot so a vision
 * subagent can read one section's rendered pixels in isolation, plus a
 * downscaled full-page image for the global (theme/font) task.
 *
 * Screenshots may be device-scaled (retina) relative to the CSS-px layout
 * snapshot, so every IR box is scaled by png.width / pageWidth before
 * cropping. Crops are downscaled (nearest-neighbour) to keep vision-model
 * input cheap and within token limits.
 */

import * as fs from "fs";
import * as path from "path";
import { PNG } from "pngjs";
import type { SectionIR } from "@bricks-cdp/ir";
import { readPng } from "../analyze-screenshot";

const MAX_CROP_WIDTH = 1200;
const MAX_CROP_HEIGHT = 1800;
const MAX_FULL_WIDTH = 1200;
const MAX_FULL_HEIGHT = 6000;
const MIN_SECTION_HEIGHT = 40;
const MAX_SECTIONS = 12;

export type SectionCrop = {
  sectionId: string;
  imagePath: string;
};

export type CropResult = {
  cropsDir: string;
  fullImagePath?: string;
  sections: SectionCrop[];
  skipped: string[];
};

/** Nearest-neighbour downscale so the longest side fits the caps. Returns src if no scaling needed. */
function downscale(src: PNG, maxW: number, maxH: number): PNG {
  const scale = Math.min(1, maxW / src.width, maxH / src.height);
  if (scale >= 1) return src;
  const dstW = Math.max(1, Math.round(src.width * scale));
  const dstH = Math.max(1, Math.round(src.height * scale));
  const dst = new PNG({ width: dstW, height: dstH });
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const si = (src.width * sy + sx) << 2;
      const di = (dstW * y + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

/** Copy a clamped rectangle out of src into a fresh PNG. */
function cropRect(src: PNG, x0: number, y0: number, w: number, h: number): PNG {
  const cx = Math.max(0, Math.min(src.width - 1, Math.floor(x0)));
  const cy = Math.max(0, Math.min(src.height - 1, Math.floor(y0)));
  const cw = Math.max(1, Math.min(src.width - cx, Math.round(w)));
  const ch = Math.max(1, Math.min(src.height - cy, Math.round(h)));
  const dst = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = (src.width * (cy + y) + (cx + x)) << 2;
      const di = (cw * y + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

function writePng(png: PNG, filePath: string): void {
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

/**
 * Crop every section band + a downscaled full page into
 * `<storageRoot>/vision/<jobId>/`. Never throws for a single bad section —
 * it is added to `skipped` instead.
 */
export function cropSections(
  sections: SectionIR[],
  screenshotPath: string,
  pageWidth: number,
  pageHeight: number,
  jobId: string,
  storageRoot: string
): CropResult {
  const cropsDir = path.join(storageRoot, "vision", jobId);
  fs.mkdirSync(cropsDir, { recursive: true });

  const src = readPng(screenshotPath);
  const scaleX = src.width / pageWidth;
  const scaleY = src.height / pageHeight;

  const result: CropResult = { cropsDir, sections: [], skipped: [] };

  // Full-page (downscaled) for the global theme/font task.
  try {
    const full = downscale(src, MAX_FULL_WIDTH, MAX_FULL_HEIGHT);
    const fullPath = path.join(cropsDir, "full.png");
    writePng(full, fullPath);
    result.fullImagePath = fullPath;
  } catch {
    result.fullImagePath = undefined;
  }

  for (const section of sections.slice(0, MAX_SECTIONS)) {
    const box = section.box;
    if (!box || box.height < MIN_SECTION_HEIGHT || box.width <= 0) {
      result.skipped.push(section.id);
      continue;
    }
    try {
      const cropped = cropRect(src, box.x * scaleX, box.y * scaleY, box.width * scaleX, box.height * scaleY);
      const scaled = downscale(cropped, MAX_CROP_WIDTH, MAX_CROP_HEIGHT);
      const imagePath = path.join(cropsDir, `${section.id}.png`);
      writePng(scaled, imagePath);
      result.sections.push({ sectionId: section.id, imagePath });
    } catch {
      result.skipped.push(section.id);
    }
  }

  return result;
}
