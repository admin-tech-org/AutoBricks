/**
 * Computed CSS extraction for captured nodes.
 *
 * The actual reading of computed styles happens inside the single in-page
 * extraction pass (see ./dom.ts extractPageData). This module owns:
 *   - the whitelist of computed CSS properties we capture (ARCHITECTURE §6)
 *   - shaping the raw extraction result into a CssSnapshot.
 */

import { CssSnapshot, ViewportName } from "@bricks-cdp/ir";
import type { RawPageData } from "./dom";

/**
 * Whitelisted computed CSS properties (camelCase, as exposed on
 * CSSStyleDeclaration). Border is captured per-side (width/style/color)
 * because the `border` shorthand only serializes when all sides are equal.
 */
export const CSS_STYLE_WHITELIST: readonly string[] = [
  // Layout / box
  "display",
  "position",
  "width",
  "height",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "gap",
  "rowGap",
  "columnGap",
  // Color / background
  "color",
  "backgroundColor",
  "backgroundImage",
  // Typography
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  // Border (per side)
  "borderTopWidth",
  "borderTopStyle",
  "borderTopColor",
  "borderRightWidth",
  "borderRightStyle",
  "borderRightColor",
  "borderBottomWidth",
  "borderBottomStyle",
  "borderBottomColor",
  "borderLeftWidth",
  "borderLeftStyle",
  "borderLeftColor",
  // Visual
  "boxShadow",
  "borderRadius",
  // Flex
  "flexDirection",
  "flexWrap",
  "justifyContent",
  "alignItems",
  // Misc
  "objectFit",
  "maxWidth",
  "minHeight",
];

/** Build a CssSnapshot (nodeId -> whitelisted computed styles) from raw page data. */
export function buildCssSnapshot(raw: RawPageData, viewport: ViewportName): CssSnapshot {
  const styles: Record<string, Record<string, string>> = {};
  for (const node of raw.nodes) {
    styles[node.id] = node.styles;
  }
  return { viewport, styles };
}
