/**
 * @bricks-cdp/validation — visual validation stage (ARCHITECTURE §17, MVP 3).
 *
 * runVisualValidation() orchestrates: render preview -> screenshot diff vs the
 * original capture -> score -> write validation-report.json. Every sub-step is
 * fault-isolated: preview/diff failures degrade to structural scoring with a
 * warning; the stage never throws for visual issues.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  AnalysisResult,
  CaptureResult,
  GenerateResult,
  StageContext,
  ValidateResult,
} from "@bricks-cdp/ir";
import { renderPreview, renderPreviewHtml } from "./render-preview";
import { screenshotDiff, ScreenshotDiffResult } from "./screenshot-diff";
import { scoreValidation } from "./score";

export { renderPreview, renderPreviewHtml } from "./render-preview";
export { screenshotDiff, ScreenshotDiffResult } from "./screenshot-diff";
export { scoreValidation } from "./score";
export {
  computeCorrespondence,
  colorDeltaE,
  parseColor,
} from "./correspondence";
export type {
  RenderedElement,
  RenderedMeasurements,
  SourceDims,
  BoxDelta,
  StyleDelta,
  ElementMatch,
  ElementDiff,
  VisualScore,
  CorrespondenceReport,
} from "./correspondence";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runVisualValidation(
  ctx: StageContext,
  artifacts: { capture: CaptureResult; analysis: AnalysisResult; generate: GenerateResult }
): Promise<ValidateResult> {
  // Same layout as packages/export/src/paths.ts:
  //   <storageRoot>/reports/<jobId>/{validation-report.json, preview.html, preview.png, diff.png}
  const reportsDir = path.join(ctx.storageRoot, "reports", ctx.jobId);
  const validationReportPath = path.join(reportsDir, "validation-report.json");
  const previewHtmlPath = path.join(reportsDir, "preview.html");
  const previewScreenshotPath = path.join(reportsDir, "preview.png");
  const diffImagePath = path.join(reportsDir, "diff.png");

  const warnings: string[] = [];
  try {
    fs.mkdirSync(reportsDir, { recursive: true });
  } catch (err) {
    warnings.push(`Could not create reports directory: ${errMsg(err)}`);
  }

  // 1) Render preview (HTML + screenshot). Degrades to structural-only scoring.
  let previewOk = false;
  try {
    await renderPreview(ctx, artifacts.generate.template, artifacts.analysis.pageIR);
    previewOk = true;
  } catch (err) {
    warnings.push(`Preview render failed, structural scores only: ${errMsg(err)}`);
  }

  // 2) Screenshot diff against the original full-page (or desktop) capture.
  let pixelSimilarity: number | undefined;
  let diffOk = false;
  const originalScreenshot =
    artifacts.capture.savedPaths.screenshots.fullPage ?? artifacts.capture.savedPaths.screenshots.desktop;
  if (previewOk && originalScreenshot) {
    try {
      const diff: ScreenshotDiffResult = await screenshotDiff(
        originalScreenshot,
        previewScreenshotPath,
        diffImagePath
      );
      pixelSimilarity = diff.similarity;
      diffOk = true;
      if (diff.uncoveredHeightRatio > 0.1) {
        warnings.push(
          `Screenshot heights differ: ${Math.round(diff.uncoveredHeightRatio * 100)}% of the taller page was not compared`
        );
      }
    } catch (err) {
      warnings.push(`Screenshot diff failed: ${errMsg(err)}`);
    }
  } else if (previewOk && !originalScreenshot) {
    warnings.push("No original screenshot available for visual diff");
  }

  // 3) Score (always succeeds — pure structural computation).
  const report = scoreValidation({
    ir: artifacts.analysis.pageIR,
    template: artifacts.generate.template,
    pixelSimilarity,
    warnings,
  });

  // 4) Persist the report. A write failure is reported, never thrown.
  try {
    fs.writeFileSync(validationReportPath, JSON.stringify(report, null, 2), "utf8");
  } catch (err) {
    report.warnings.push(`Could not write validation-report.json: ${errMsg(err)}`);
  }

  const savedPaths: ValidateResult["savedPaths"] = { validationReport: validationReportPath };
  if (fs.existsSync(previewHtmlPath)) savedPaths.previewHtml = previewHtmlPath;
  if (previewOk && fs.existsSync(previewScreenshotPath)) savedPaths.previewScreenshot = previewScreenshotPath;
  if (diffOk && fs.existsSync(diffImagePath)) savedPaths.diffImage = diffImagePath;

  return { report, savedPaths };
}
