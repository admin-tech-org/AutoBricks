/**
 * Capture orchestrator (ARCHITECTURE §7 browser capture flow):
 *
 *  1. Launch headless Chromium.
 *  2. One browser context per requested viewport, processed concurrently.
 *  3. goto with wait-strategy fallback chain (networkidle -> load -> domcontentloaded).
 *  4. Best-effort dismissal of common cookie/consent overlays.
 *  5. Stepwise scroll to the bottom to trigger lazy loading, then back to top.
 *  6. Viewport screenshots for every viewport + full-page shot on desktop.
 *  7. Desktop only: single-pass DOM/CSS/layout/assets extraction.
 *  8. Mobile only: layout-only extraction (stacking detection).
 *  9. Write snapshots to storage/snapshots/<jobId>/, screenshots to
 *     storage/screenshots/<jobId>/ (same layout as @bricks-cdp/export paths).
 * 10. Always close the browser (finally).
 *
 * Only the desktop (primary) viewport is mandatory: failures on other
 * viewports are logged via console.warn and skipped.
 */

import * as fs from "fs";
import * as path from "path";
import { Browser } from "playwright";
import type { Page } from "playwright";
import {
  CaptureOptions,
  CaptureResult,
  LayoutSnapshot,
  PRIMARY_VIEWPORT,
  ScreenshotSet,
  VIEWPORT_SIZES,
  ViewportName,
} from "@bricks-cdp/ir";
import { closeBrowser, createContext, launchBrowser } from "./browser";
import { buildDomSnapshot, extractPageData, RawPageData } from "./dom";
import { buildCssSnapshot } from "./css";
import { buildLayoutSnapshot, extractLayoutSnapshot } from "./layout";
import { collectAssets } from "./assets";
import { screenshotFullPage, screenshotViewport } from "./screenshot";

// In-page globals (browser side only — used inside page.evaluate callbacks).
declare const document: any;
declare const window: any;

type WaitStrategy = NonNullable<CaptureOptions["waitStrategy"]>;

const DEFAULT_TIMEOUT_MS = 45000;

type ViewportTaskConfig = {
  url: string;
  waitStrategy: WaitStrategy;
  timeoutMs: number;
  scrollPage: boolean;
  dismissOverlays: boolean;
  screenshotsDir: string;
};

type ViewportOutcome = {
  viewport: ViewportName;
  screenshotPath: string;
  /** Only set for the primary (desktop) viewport. */
  fullPagePath?: string;
  /** Only set for the primary (desktop) viewport. */
  raw?: RawPageData;
  /** Only set for the mobile viewport. */
  mobileLayout?: LayoutSnapshot;
};

/** page.goto with fallback chain: requested strategy -> load -> domcontentloaded. */
async function gotoWithFallback(
  page: Page,
  url: string,
  strategy: WaitStrategy,
  timeoutMs: number
): Promise<void> {
  const chain: WaitStrategy[] = [];
  for (const s of [strategy, "load", "domcontentloaded"] as WaitStrategy[]) {
    if (!chain.includes(s)) chain.push(s);
  }
  let lastError: unknown = null;
  for (const waitUntil of chain) {
    try {
      await page.goto(url, { waitUntil, timeout: timeoutMs });
      return;
    } catch (err) {
      lastError = err;
      console.warn(
        `[capture] goto ${url} (waitUntil="${waitUntil}") failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  throw new Error(
    `Failed to load ${url} within ${timeoutMs}ms (tried waitUntil: ${chain.join(", ")}). Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

/**
 * Best-effort dismissal of common cookie/consent overlays. Every step is
 * wrapped in try/catch — this must never fail the capture.
 */
async function tryDismissOverlays(page: Page): Promise<void> {
  try {
    const clicked = await page.evaluate(() => {
      const containerSelector =
        '[id*="cookie"], [class*="cookie"], [class*="consent"], [id*="consent"], [class*="gdpr"]';
      const acceptPattern = /^(accept|agree|allow|got it|ok|同意|接受|đồng ý)/i;
      let clicks = 0;
      try {
        const containers = document.querySelectorAll(containerSelector);
        for (let i = 0; i < containers.length && clicks < 3; i++) {
          const container = containers[i];
          const candidates = container.querySelectorAll(
            'button, [role="button"], a, input[type="button"], input[type="submit"]'
          );
          for (let j = 0; j < candidates.length && clicks < 3; j++) {
            const candidate = candidates[j];
            const label = String(candidate.innerText || candidate.value || candidate.textContent || "").trim();
            if (label && acceptPattern.test(label)) {
              try {
                candidate.click();
                clicks += 1;
              } catch (e) {
                // ignore individual click failures
              }
            }
          }
        }
      } catch (e) {
        // ignore query failures
      }
      return clicks;
    });
    if (clicked > 0) await page.waitForTimeout(350);
  } catch (err) {
    // Never fail the capture because of overlay handling.
  }
}

/**
 * Scroll stepwise (viewport-height steps, ~150ms apart, max ~30 steps) to
 * trigger lazy loading, then scroll back to top and settle ~400ms.
 */
async function scrollThroughPage(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
      const maxSteps = 30;
      for (let i = 0; i < maxSteps; i++) {
        const doc = document.documentElement;
        const total = Math.max(
          doc ? doc.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0
        );
        if (window.scrollY + window.innerHeight >= total - 2) break;
        window.scrollBy(0, window.innerHeight);
        await wait(150);
      }
      window.scrollTo(0, 0);
    });
  } catch (err) {
    console.warn(
      `[capture] Lazy-load scroll failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  await page.waitForTimeout(400);
}

/** Capture a single viewport in its own browser context. */
async function captureViewport(
  browser: Browser,
  viewport: ViewportName,
  cfg: ViewportTaskConfig
): Promise<ViewportOutcome> {
  const size = VIEWPORT_SIZES[viewport];
  const context = await createContext(browser, size);
  try {
    const page = await context.newPage();
    await gotoWithFallback(page, cfg.url, cfg.waitStrategy, cfg.timeoutMs);

    const hasBody = await page.evaluate(() => !!document.body);
    if (!hasBody) {
      throw new Error(`Capture failed for ${cfg.url} (${viewport}): page has no <body> element`);
    }

    if (cfg.dismissOverlays) await tryDismissOverlays(page);

    if (cfg.scrollPage) {
      await scrollThroughPage(page);
    } else {
      try {
        await page.evaluate(() => {
          window.scrollTo(0, 0);
        });
      } catch {
        // ignore
      }
    }

    const screenshotPath = path.join(cfg.screenshotsDir, `${viewport}.png`);
    await screenshotViewport(page, screenshotPath, size);

    const outcome: ViewportOutcome = { viewport, screenshotPath };

    if (viewport === PRIMARY_VIEWPORT) {
      const fullPagePath = path.join(cfg.screenshotsDir, "full-page.png");
      await screenshotFullPage(page, fullPagePath);
      outcome.fullPagePath = fullPagePath;
      // Single in-page pass: DOM + CSS + layout + assets source data.
      outcome.raw = await extractPageData(page);
    } else if (viewport === "mobile") {
      outcome.mobileLayout = await extractLayoutSnapshot(page, "mobile");
    }

    return outcome;
  } finally {
    try {
      await context.close();
    } catch {
      // ignore context close failures
    }
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Capture a URL across viewports and persist screenshots + snapshots.
 * Storage layout: storage/screenshots/<jobId>/*.png and
 * storage/snapshots/<jobId>/*.json (same as @bricks-cdp/export paths.ts).
 */
export async function captureUrl(options: CaptureOptions): Promise<CaptureResult> {
  const { url, jobId } = options;
  const storageRoot = path.resolve(options.storageRoot);
  const waitStrategy: WaitStrategy = options.waitStrategy ?? "networkidle";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scrollPage = options.scrollPage !== false;
  const dismissOverlays = options.dismissOverlays !== false;

  // Default: all three viewports. The primary (desktop) viewport is always
  // captured — snapshots and the full-page screenshot depend on it.
  const requested =
    options.viewports && options.viewports.length > 0
      ? options.viewports
      : (Object.keys(VIEWPORT_SIZES) as ViewportName[]);
  const viewports: ViewportName[] = [];
  for (const vp of requested) {
    if (!viewports.includes(vp)) viewports.push(vp);
  }
  if (!viewports.includes(PRIMARY_VIEWPORT)) viewports.unshift(PRIMARY_VIEWPORT);

  const screenshotsDir = path.join(storageRoot, "screenshots", jobId);
  const snapshotsDir = path.join(storageRoot, "snapshots", jobId);
  await fs.promises.mkdir(screenshotsDir, { recursive: true });
  await fs.promises.mkdir(snapshotsDir, { recursive: true });

  const cfg: ViewportTaskConfig = {
    url,
    waitStrategy,
    timeoutMs,
    scrollPage,
    dismissOverlays,
    screenshotsDir,
  };

  const browser = await launchBrowser();
  try {
    // Concurrent multi-viewport capture. Non-primary viewport failures are
    // logged and skipped; only the primary (desktop) viewport is mandatory.
    const outcomes = await Promise.all(
      viewports.map(async (viewport): Promise<ViewportOutcome | null> => {
        if (viewport === PRIMARY_VIEWPORT) {
          return captureViewport(browser, viewport, cfg);
        }
        try {
          return await captureViewport(browser, viewport, cfg);
        } catch (err) {
          console.warn(
            `[capture] Viewport "${viewport}" capture failed for ${url} (continuing): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          return null;
        }
      })
    );

    const primary = outcomes.find((o) => o !== null && o.viewport === PRIMARY_VIEWPORT);
    if (!primary || !primary.raw) {
      throw new Error(`Capture failed for ${url}: primary (${PRIMARY_VIEWPORT}) viewport produced no data`);
    }
    const raw = primary.raw;

    const dom = buildDomSnapshot(raw, PRIMARY_VIEWPORT);
    const css = buildCssSnapshot(raw, PRIMARY_VIEWPORT);
    const layout = buildLayoutSnapshot(raw, PRIMARY_VIEWPORT);
    const assets = collectAssets(raw);

    let mobileLayout: LayoutSnapshot | undefined;
    for (const outcome of outcomes) {
      if (outcome && outcome.mobileLayout) mobileLayout = outcome.mobileLayout;
    }

    const domPath = path.join(snapshotsDir, "dom.json");
    const cssPath = path.join(snapshotsDir, "css.json");
    const layoutPath = path.join(snapshotsDir, "layout.json");
    const assetsPath = path.join(snapshotsDir, "assets.json");

    const writes: Array<Promise<void>> = [
      writeJson(domPath, dom),
      writeJson(cssPath, css),
      writeJson(layoutPath, layout),
      writeJson(assetsPath, assets),
    ];
    if (mobileLayout) {
      writes.push(writeJson(path.join(snapshotsDir, "layout-mobile.json"), mobileLayout));
    }
    await Promise.all(writes);

    const screenshots: ScreenshotSet = {};
    for (const outcome of outcomes) {
      if (!outcome) continue;
      screenshots[outcome.viewport] = outcome.screenshotPath;
      if (outcome.fullPagePath) screenshots.fullPage = outcome.fullPagePath;
    }

    const result: CaptureResult = {
      jobId,
      url,
      screenshots,
      dom,
      css,
      layout,
      assets,
      savedPaths: {
        screenshots: { ...screenshots },
        dom: domPath,
        css: cssPath,
        layout: layoutPath,
        assets: assetsPath,
      },
    };
    if (mobileLayout) result.mobileLayout = mobileLayout;
    return result;
  } finally {
    await closeBrowser(browser);
  }
}
