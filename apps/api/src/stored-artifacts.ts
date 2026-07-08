/**
 * Helpers for reading pipeline artifacts back from disk (shared by the jobs
 * controller regenerate flow and the CLI `--job` re-analyze flow).
 *
 * restoreCaptureResult() mirrors exactly what the capture stage persists
 * (see @bricks-cdp/capture -> CaptureResult.savedPaths):
 *   storage/snapshots/<jobId>/{dom,css,layout,assets}.json (+ layout-mobile.json)
 *   storage/screenshots/<jobId>/{desktop,tablet,mobile,full-page}.png
 */
import * as fs from "fs";
import { JobPaths } from "@bricks-cdp/export";
import {
  AssetsSnapshot,
  CaptureResult,
  CssSnapshot,
  DomSnapshot,
  LayoutSnapshot,
  ScreenshotSet,
} from "@bricks-cdp/ir";

export function readJsonIfExists<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export type RestoreCaptureOptions = {
  /**
   * When true, the core snapshots (dom/css/layout/assets.json) must exist on
   * disk — re-analyzing without them would produce a garbage IR. When false
   * (regenerate flow), missing snapshots degrade to empty structures because
   * generate/validate only need them best-effort.
   */
  strict?: boolean;
};

/** Rebuild a CaptureResult from the snapshots/screenshots already on disk. */
export function restoreCaptureResult(
  jobId: string,
  url: string,
  paths: JobPaths,
  opts?: RestoreCaptureOptions
): CaptureResult {
  if (opts?.strict) {
    const required: Array<[string, string]> = [
      ["dom.json", paths.domSnapshot],
      ["css.json", paths.cssSnapshot],
      ["layout.json", paths.layoutSnapshot],
      ["assets.json", paths.assetsSnapshot],
    ];
    const missing = required.filter(([, file]) => !fs.existsSync(file)).map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(
        `cannot restore capture for job ${jobId}: missing ${missing.join(", ")} in ${paths.snapshotsDir}` +
          ` (was the capture stage ever run for this job?)`
      );
    }
  }

  const dom: DomSnapshot =
    readJsonIfExists<DomSnapshot>(paths.domSnapshot) ?? { url, viewport: "desktop", nodes: [] };
  const css: CssSnapshot =
    readJsonIfExists<CssSnapshot>(paths.cssSnapshot) ?? { viewport: "desktop", styles: {} };
  const layout: LayoutSnapshot =
    readJsonIfExists<LayoutSnapshot>(paths.layoutSnapshot) ?? {
      viewport: "desktop",
      pageWidth: 0,
      pageHeight: 0,
      boxes: {},
    };
  const assets: AssetsSnapshot =
    readJsonIfExists<AssetsSnapshot>(paths.assetsSnapshot) ?? { url, assets: [] };
  const mobileLayout = readJsonIfExists<LayoutSnapshot>(paths.mobileLayoutSnapshot);

  const screenshots: ScreenshotSet = {};
  if (fs.existsSync(paths.screenshot("desktop"))) screenshots.desktop = paths.screenshot("desktop");
  if (fs.existsSync(paths.screenshot("tablet"))) screenshots.tablet = paths.screenshot("tablet");
  if (fs.existsSync(paths.screenshot("mobile"))) screenshots.mobile = paths.screenshot("mobile");
  if (fs.existsSync(paths.screenshot("full-page"))) screenshots.fullPage = paths.screenshot("full-page");

  return {
    jobId,
    url,
    screenshots,
    dom,
    css,
    layout,
    assets,
    ...(mobileLayout ? { mobileLayout } : {}),
    savedPaths: {
      screenshots,
      dom: paths.domSnapshot,
      css: paths.cssSnapshot,
      layout: paths.layoutSnapshot,
      assets: paths.assetsSnapshot,
    },
  };
}
