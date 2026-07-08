/**
 * Rebuild a CaptureResult from a job's persisted snapshots + screenshots so the
 * analyze -> generate -> validate stages can be re-run WITHOUT re-opening a
 * browser. This powers `--job <id>` (re-analyze, e.g. to apply AI vision to an
 * already-captured page) and the API regenerate endpoint.
 */
import * as fs from "fs";
import type {
  AssetsSnapshot,
  CaptureResult,
  CssSnapshot,
  DomSnapshot,
  LayoutSnapshot,
  ScreenshotSet,
} from "@bricks-cdp/ir";
import { storagePaths } from "@bricks-cdp/export";

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** True when the job has enough on disk to skip capture. */
export function canReconstructCapture(jobId: string, storageRoot: string): boolean {
  const paths = storagePaths(jobId, storageRoot);
  return (
    fs.existsSync(paths.domSnapshot) &&
    fs.existsSync(paths.cssSnapshot) &&
    fs.existsSync(paths.layoutSnapshot)
  );
}

export function reconstructCapture(jobId: string, storageRoot: string, url: string): CaptureResult {
  const paths = storagePaths(jobId, storageRoot);
  if (!canReconstructCapture(jobId, storageRoot)) {
    throw new Error(`cannot reconstruct capture for ${jobId}: missing dom/css/layout snapshots`);
  }

  const dom = readJson<DomSnapshot>(paths.domSnapshot);
  const css = readJson<CssSnapshot>(paths.cssSnapshot);
  const layout = readJson<LayoutSnapshot>(paths.layoutSnapshot);
  const assets: AssetsSnapshot = fs.existsSync(paths.assetsSnapshot)
    ? readJson<AssetsSnapshot>(paths.assetsSnapshot)
    : { url, assets: [] };
  const mobileLayout = fs.existsSync(paths.mobileLayoutSnapshot)
    ? readJson<LayoutSnapshot>(paths.mobileLayoutSnapshot)
    : undefined;

  const screenshots: ScreenshotSet = {};
  const map: Array<[Parameters<typeof paths.screenshot>[0], keyof ScreenshotSet]> = [
    ["desktop", "desktop"],
    ["tablet", "tablet"],
    ["mobile", "mobile"],
    ["full-page", "fullPage"],
  ];
  for (const [name, key] of map) {
    const p = paths.screenshot(name);
    if (fs.existsSync(p)) screenshots[key] = p;
  }

  return {
    jobId,
    url,
    screenshots,
    dom,
    css,
    layout,
    assets,
    mobileLayout,
    savedPaths: {
      screenshots,
      dom: paths.domSnapshot,
      css: paths.cssSnapshot,
      layout: paths.layoutSnapshot,
      assets: paths.assetsSnapshot,
    },
  };
}
