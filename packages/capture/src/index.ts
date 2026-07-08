/**
 * @bricks-cdp/capture — public API.
 *
 * Renders a real website in headless Chromium and captures screenshots,
 * DOM/CSS/layout snapshots and an asset list per the shared contract types
 * in @bricks-cdp/ir.
 */

export { captureUrl } from "./capture-url";
export { launchBrowser, closeBrowser, createContext, createViewportContext } from "./browser";
export type { LaunchBrowserOptions } from "./browser";
export { screenshotHtmlFile, screenshotViewport, screenshotFullPage } from "./screenshot";
export { extractPageData, buildDomSnapshot } from "./dom";
export type { RawPageData, RawCapturedNode, InPageExtractionParams } from "./dom";
export { CSS_STYLE_WHITELIST, buildCssSnapshot } from "./css";
export { buildLayoutSnapshot, extractLayoutSnapshot } from "./layout";
export { collectAssets, backgroundImageUrls } from "./assets";
