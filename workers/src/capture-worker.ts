/**
 * Capture Worker (ARCHITECTURE §20).
 *
 * Receives the job URL, opens a real browser via CDP/Playwright (delegated to
 * @bricks-cdp/capture), sets viewports, screenshots the page and extracts
 * DOM / CSS / layout / asset snapshots into the job's storage directories.
 */
import { CaptureResult, StageContext } from "@bricks-cdp/ir";
import { captureUrl } from "@bricks-cdp/capture";
import { ensureJobDirs, storagePaths } from "@bricks-cdp/export";

export async function runCaptureStage(ctx: StageContext): Promise<CaptureResult> {
  const paths = storagePaths(ctx.jobId, ctx.storageRoot);
  ensureJobDirs(paths);
  return captureUrl({
    url: ctx.url,
    jobId: ctx.jobId,
    storageRoot: paths.root,
    viewports: ctx.viewports,
    maxNodes: ctx.maxNodes,
  });
}
