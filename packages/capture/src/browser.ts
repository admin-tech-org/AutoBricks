/**
 * Chromium lifecycle helpers: launch/close a headless browser and create
 * viewport-sized browser contexts.
 */

import { chromium, Browser, BrowserContext } from "playwright";
import { ViewportName, VIEWPORT_SIZES } from "@bricks-cdp/ir";

export type LaunchBrowserOptions = {
  /** Defaults to true. */
  headless?: boolean;
};

/** Launch a headless Chromium instance. */
export async function launchBrowser(options?: LaunchBrowserOptions): Promise<Browser> {
  return chromium.launch({ headless: options?.headless ?? true });
}

/** Close the browser, swallowing errors (safe to call from finally blocks). */
export async function closeBrowser(browser: Browser | null | undefined): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
  } catch (err) {
    console.warn(
      `[capture] Failed to close browser: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Create a browser context with an explicit pixel viewport. */
export async function createContext(
  browser: Browser,
  viewport: { width: number; height: number }
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });
}

/** Create a browser context for a named viewport (desktop/tablet/mobile). */
export async function createViewportContext(
  browser: Browser,
  viewport: ViewportName
): Promise<BrowserContext> {
  return createContext(browser, VIEWPORT_SIZES[viewport]);
}
