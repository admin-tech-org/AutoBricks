/**
 * Screenshot helpers: viewport screenshot, full-page screenshot, and a
 * standalone helper to screenshot a local HTML file (used by the validation
 * package for preview rendering).
 */

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { Page } from "playwright";
import { closeBrowser, createContext, launchBrowser } from "./browser";

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
}

/**
 * Screenshot the current viewport (clip = viewport rect at scroll top).
 * The caller is expected to have scrolled back to the top of the page.
 */
export async function screenshotViewport(
  page: Page,
  outPath: string,
  viewport: { width: number; height: number }
): Promise<void> {
  await ensureParentDir(outPath);
  await page.screenshot({
    path: outPath,
    fullPage: false,
    clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
  });
}

/** Full-page screenshot (playwright handles very tall pages internally). */
export async function screenshotFullPage(page: Page, outPath: string): Promise<void> {
  await ensureParentDir(outPath);
  await page.screenshot({ path: outPath, fullPage: true });
}

/**
 * Open a local HTML file via a file:// URL in a fresh headless Chromium and
 * screenshot it. Used by the validation package to render Bricks previews.
 */
export async function screenshotHtmlFile(
  htmlPath: string,
  outPng: string,
  viewport: { width: number; height: number },
  fullPage: boolean
): Promise<void> {
  const fileUrl = pathToFileURL(path.resolve(htmlPath)).href;
  const browser = await launchBrowser();
  try {
    const context = await createContext(browser, viewport);
    const page = await context.newPage();
    try {
      await page.goto(fileUrl, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      await page.goto(fileUrl, { waitUntil: "load", timeout: 30000 });
    }
    // Give local fonts/images one tick to settle.
    await page.waitForTimeout(100);
    if (fullPage) {
      await screenshotFullPage(page, outPng);
    } else {
      await screenshotViewport(page, outPng, viewport);
    }
  } finally {
    await closeBrowser(browser);
  }
}
