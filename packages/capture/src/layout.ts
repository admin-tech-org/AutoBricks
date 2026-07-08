/**
 * Bounding-box (layout) extraction in page coordinates.
 *
 * Boxes are collected in the same single in-page pass as the DOM walk
 * (./dom.ts), which guarantees that node ids ("dom_1", "dom_2", ...) are
 * assigned by the identical traversal on every viewport — so the mobile
 * LayoutSnapshot keys line up with the desktop DomSnapshot for stacking
 * detection.
 */

import { Page } from "playwright";
import { Box, LayoutSnapshot, ViewportName } from "@bricks-cdp/ir";
import { extractPageData, RawPageData } from "./dom";

/** Shape raw page data into the LayoutSnapshot contract type. */
export function buildLayoutSnapshot(raw: RawPageData, viewport: ViewportName): LayoutSnapshot {
  const boxes: Record<string, Box> = {};
  for (const node of raw.nodes) {
    boxes[node.id] = node.box;
  }
  return {
    viewport,
    pageWidth: raw.pageWidth,
    pageHeight: raw.pageHeight,
    boxes,
  };
}

/**
 * Layout-only extraction (no computed styles) — used on the mobile context
 * for responsive/stacking detection. Reuses the exact same DOM traversal as
 * the full extraction so node ids match across viewports.
 */
export async function extractLayoutSnapshot(page: Page, viewport: ViewportName): Promise<LayoutSnapshot> {
  const raw = await extractPageData(page, { styleProps: [] });
  return buildLayoutSnapshot(raw, viewport);
}
