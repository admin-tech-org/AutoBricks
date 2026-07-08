/**
 * Asset collection (ARCHITECTURE §6 "Asset"):
 *   - <img> src                          -> type "image"
 *   - computed background-image url(...) -> type "background-image"
 *   - inline <svg>                       -> type "svg", url "inline:<nodeId>"
 *   - unique font families               -> type "font" (url = family name)
 *
 * Works purely on the raw single-pass extraction result — no extra page round
 * trips.
 */

import { AssetItem, AssetsSnapshot } from "@bricks-cdp/ir";
import type { RawPageData } from "./dom";

/** Generic/system font keywords that are not downloadable font assets. */
const GENERIC_FONT_FAMILIES = new Set([
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
  "emoji",
  "math",
  "fangsong",
  "inherit",
  "initial",
  "unset",
  "-apple-system",
  "blinkmacsystemfont",
]);

/** First non-generic family from a computed font-family stack, unquoted. */
function primaryFontFamily(fontFamily: string): string | null {
  for (const part of fontFamily.split(",")) {
    const family = part.trim().replace(/^["']+|["']+$/g, "").trim();
    if (!family) continue;
    if (GENERIC_FONT_FAMILIES.has(family.toLowerCase())) continue;
    return family;
  }
  return null;
}

/**
 * Extract url(...) references from a computed background-image value.
 * Computed values already contain absolute URLs. data: URIs are skipped
 * (they are embedded, not downloadable assets, and would bloat assets.json).
 */
export function backgroundImageUrls(value: string): string[] {
  const urls: string[] = [];
  const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const url = (match[2] || "").trim();
    if (url && !url.toLowerCase().startsWith("data:")) urls.push(url);
  }
  return urls;
}

/** Collect the AssetsSnapshot from raw page data (deduplicated per type+url). */
export function collectAssets(raw: RawPageData): AssetsSnapshot {
  const assets: AssetItem[] = [];
  const seen = new Set<string>();

  const pushUnique = (item: AssetItem): void => {
    const key = `${item.type}|${item.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    assets.push(item);
  };

  for (const node of raw.nodes) {
    if (node.tag === "img" && node.src) {
      const item: AssetItem = { type: "image", url: node.src, nodeId: node.id };
      if (node.alt) item.alt = node.alt;
      pushUnique(item);
    }

    if (node.tag === "svg") {
      pushUnique({ type: "svg", url: `inline:${node.id}`, nodeId: node.id });
    }

    const bg = node.styles["backgroundImage"];
    if (bg && bg !== "none") {
      for (const url of backgroundImageUrls(bg)) {
        pushUnique({ type: "background-image", url, nodeId: node.id });
      }
    }

    const fontFamily = node.styles["fontFamily"];
    if (fontFamily) {
      const family = primaryFontFamily(fontFamily);
      if (family) pushUnique({ type: "font", url: family });
    }
  }

  return { url: raw.url, assets };
}
