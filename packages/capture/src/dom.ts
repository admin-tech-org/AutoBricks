/**
 * DOM tree extraction (single in-page evaluate pass).
 *
 * One page.evaluate() walks document.body breadth-first and returns, per node:
 * DOM data (tag/text/attrs), bounding box in page coordinates, visibility and
 * whitelisted computed styles. The raw result is then shaped into the
 * DomSnapshot / CssSnapshot / LayoutSnapshot / AssetsSnapshot contract types
 * by ./dom.ts, ./css.ts, ./layout.ts and ./assets.ts.
 *
 * NOTE: this package compiles with lib ES2022 (no DOM lib). The evaluate
 * callback runs inside Chromium, so DOM globals are declared as `any` below.
 * These declarations are erased at compile time and never touched in Node.
 */

import { Page } from "playwright";
import { DomNode, DomSnapshot, ViewportName } from "@bricks-cdp/ir";
import { CSS_STYLE_WHITELIST } from "./css";

// In-page globals (browser side only — never referenced in Node code paths).
declare const document: any;
declare const window: any;

/** A DomNode plus its whitelisted computed styles, as returned by the in-page pass. */
export type RawCapturedNode = DomNode & { styles: Record<string, string> };

/** Result of the single in-page extraction pass. */
export type RawPageData = {
  /** Final document URL (after redirects). */
  url: string;
  title: string;
  pageWidth: number;
  pageHeight: number;
  nodes: RawCapturedNode[];
};

/** Plain-JSON parameters passed into the in-page callback (no Node closures). */
export type InPageExtractionParams = {
  maxNodes: number;
  textCap: number;
  classNameCap: number;
  /** camelCase computed-style property names to capture (may be empty). */
  styleProps: string[];
};

export const DEFAULT_MAX_NODES = 4000;
export const DEFAULT_TEXT_CAP = 500;
export const DEFAULT_CLASSNAME_CAP = 200;

/**
 * Self-contained in-page extraction callback. Must not close over anything
 * except its single plain-JSON argument — playwright serializes the function
 * source and runs it inside the page.
 */
function extractInPage(params: InPageExtractionParams): RawPageData {
  const body = document.body;
  if (!body) {
    throw new Error(
      "Capture failed: document has no <body> element (url: " + String(document.URL || "unknown") + ")"
    );
  }

  const skipTags = ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "IFRAME"];
  const scrollX = Number(window.scrollX) || 0;
  const scrollY = Number(window.scrollY) || 0;
  const pageProtocol = String((window.location && window.location.protocol) || "");
  const pageOrigin = String((window.location && window.location.origin) || "");

  /**
   * Choose between the browser-resolved absolute URL and the raw attribute
   * value. On file:// pages the browser resolves root-relative paths like
   * "/signup" to broken "file:///C:/signup" URLs, so the raw attribute is
   * preferred there (data: URIs always pass through unchanged). When
   * preferRawSameOrigin is set (used for href), the raw attribute is also
   * preferred for same-origin http(s) URLs so internal links stay relative;
   * genuine external links keep their resolved absolute URL.
   */
  const pickUrl = (resolved: string, rawAttr: string, preferRawSameOrigin: boolean): string => {
    if (!resolved) return rawAttr;
    if (!rawAttr) return resolved;
    if (rawAttr.slice(0, 5).toLowerCase() === "data:") return rawAttr;
    if (pageProtocol === "file:") return rawAttr;
    if (preferRawSameOrigin) {
      try {
        const parsed = new URL(resolved);
        if (parsed.origin && parsed.origin !== "null" && parsed.origin === pageOrigin) {
          return rawAttr;
        }
      } catch (e) {
        // unparsable resolved URL — fall through and keep it as-is
      }
    }
    return resolved;
  };

  const nodes: any[] = [];
  const queue: Array<{ el: any; parentId: string | null; depth: number }> = [
    { el: body, parentId: null, depth: 0 },
  ];
  let head = 0;
  let counter = 0;

  while (head < queue.length && nodes.length < params.maxNodes) {
    const item = queue[head];
    head += 1;
    const el = item.el;
    const tagUpper = String(el.tagName || "").toUpperCase();
    if (skipTags.indexOf(tagUpper) !== -1) continue;

    counter += 1;
    const id = "dom_" + counter;
    const tag = tagUpper.toLowerCase();
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);

    const box = {
      x: Math.round(rect.left + scrollX),
      y: Math.round(rect.top + scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    // checkVisibility() also accounts for ANCESTOR opacity/visibility — the
    // per-element computed checks below miss children of an opacity-0 mega-menu
    // panel (computed opacity does not inherit), which would leak hidden nav
    // dropdown content into the DOM snapshot. Both option spellings are passed
    // to cover the older and newer Chrome APIs; unknown keys are ignored.
    const passesCheckVisibility =
      typeof el.checkVisibility === "function"
        ? el.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
            opacityProperty: true,
            visibilityProperty: true,
          })
        : true;
    // Fully off-screen (above/left of the page) elements are hidden UI too.
    const offScreen = rect.left + scrollX + rect.width <= 0 || rect.top + scrollY + rect.height <= 0;
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      cs.display !== "none" &&
      cs.visibility !== "hidden" &&
      cs.opacity !== "0" &&
      passesCheckVisibility &&
      !offScreen;

    // Own direct text: concatenate direct child text nodes only.
    let text = "";
    const childNodes = el.childNodes;
    for (let i = 0; i < childNodes.length; i++) {
      const child = childNodes[i];
      if (child && child.nodeType === 3 && child.textContent) text += child.textContent;
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > params.textCap) text = text.slice(0, params.textCap);

    const styles: Record<string, string> = {};
    for (let i = 0; i < params.styleProps.length; i++) {
      const prop = params.styleProps[i];
      const value = cs[prop];
      if (typeof value === "string" && value !== "") styles[prop] = value;
    }

    const node: any = { id, parentId: item.parentId, tag, depth: item.depth, box, visible, styles };
    if (text) node.text = text;

    // href: raw attribute preferred on file:// pages and for same-origin
    // links; resolved absolute URL kept for genuine external links.
    const rawHref = el.getAttribute ? String(el.getAttribute("href") || "") : "";
    const resolvedHref = typeof el.href === "string" && el.href ? el.href : "";
    const href = pickUrl(resolvedHref, rawHref, true);
    if (href) node.href = href;

    // src: raw attribute preferred on file:// pages (data: URIs pass through
    // unchanged); on http(s) pages the resolved absolute URL is kept so
    // assets stay downloadable.
    const rawSrc = el.getAttribute ? String(el.getAttribute("src") || "") : "";
    const resolvedSrc =
      typeof el.currentSrc === "string" && el.currentSrc
        ? el.currentSrc
        : typeof el.src === "string" && el.src
          ? el.src
          : "";
    const src = pickUrl(resolvedSrc, rawSrc, false);
    if (src) node.src = src;
    const alt = el.getAttribute ? el.getAttribute("alt") : null;
    if (alt) node.alt = alt;
    const ariaLabel = el.getAttribute ? el.getAttribute("aria-label") : null;
    if (ariaLabel) node.ariaLabel = ariaLabel;
    const role = el.getAttribute ? el.getAttribute("role") : null;
    if (role) node.role = role;
    let className =
      typeof el.className === "string"
        ? el.className
        : el.getAttribute
          ? el.getAttribute("class") || ""
          : "";
    className = String(className).replace(/\s+/g, " ").trim();
    if (className) node.className = className.slice(0, params.classNameCap);
    if (typeof el.id === "string" && el.id) node.domId = el.id;

    nodes.push(node);

    // Do not descend into inline <svg> internals (path/g/defs are noise for
    // layout generation); the svg element itself is recorded as one node and
    // becomes an "inline:<nodeId>" asset.
    if (tag !== "svg") {
      const children = el.children;
      for (let i = 0; i < children.length; i++) {
        queue.push({ el: children[i], parentId: id, depth: item.depth + 1 });
      }
    }
  }

  const de = document.documentElement;
  const pageWidth = Math.round(
    Math.max(de ? de.scrollWidth : 0, body.scrollWidth || 0, Number(window.innerWidth) || 0)
  );
  const pageHeight = Math.round(
    Math.max(de ? de.scrollHeight : 0, body.scrollHeight || 0, Number(window.innerHeight) || 0)
  );

  return {
    url: String(document.URL || ""),
    title: String(document.title || ""),
    pageWidth,
    pageHeight,
    nodes: nodes,
  };
}

/**
 * Run the single-pass in-page extraction on the current page state.
 * Pass `{ styleProps: [] }` for a layout-only run (e.g. mobile viewport).
 */
export async function extractPageData(
  page: Page,
  overrides?: Partial<InPageExtractionParams>
): Promise<RawPageData> {
  const params: InPageExtractionParams = {
    maxNodes: DEFAULT_MAX_NODES,
    textCap: DEFAULT_TEXT_CAP,
    classNameCap: DEFAULT_CLASSNAME_CAP,
    styleProps: [...CSS_STYLE_WHITELIST],
    ...overrides,
  };
  const raw = await page.evaluate(extractInPage, params);
  return raw as RawPageData;
}

/** Shape raw page data into the DomSnapshot contract type (styles stripped). */
export function buildDomSnapshot(raw: RawPageData, viewport: ViewportName): DomSnapshot {
  const nodes: DomNode[] = raw.nodes.map((node) => {
    const { styles: _styles, ...rest } = node;
    return rest;
  });
  const snapshot: DomSnapshot = { url: raw.url, viewport, nodes };
  if (raw.title) snapshot.title = raw.title;
  return snapshot;
}
