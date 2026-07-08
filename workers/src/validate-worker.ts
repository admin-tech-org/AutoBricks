/**
 * Validate Worker (ARCHITECTURE §20).
 *
 * Runs the visual validation (preview render + screenshot diff + scoring) via
 * @bricks-cdp/validation. Visual validation is best-effort: if anything in it
 * fails (no browser available, staging render broken, diff error...), the
 * stage degrades gracefully to a neutral structural-only report with a
 * warning instead of failing the whole job — the template itself has already
 * passed JSON validation in the generate stage.
 */
import * as fs from "fs";
import {
  AnalysisResult,
  CaptureResult,
  GenerateResult,
  StageContext,
  ValidateResult,
  ValidationReport,
} from "@bricks-cdp/ir";
import { runVisualValidation } from "@bricks-cdp/validation";
import { storagePaths } from "@bricks-cdp/export";

export async function runValidateStage(
  ctx: StageContext,
  artifacts: { capture: CaptureResult; analysis: AnalysisResult; generate: GenerateResult }
): Promise<ValidateResult> {
  try {
    return await runVisualValidation(ctx, artifacts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const report: ValidationReport = {
      score: 0.5,
      layoutScore: 0.5,
      colorScore: 0.5,
      spacingScore: 0.5,
      contentScore: 0.5,
      warnings: [`visual validation failed: ${message}`],
    };

    const paths = storagePaths(ctx.jobId, ctx.storageRoot);
    try {
      fs.mkdirSync(paths.reportsDir, { recursive: true });
      fs.writeFileSync(paths.validationReport, JSON.stringify(report, null, 2), "utf8");
    } catch {
      // Even a failure to persist the fallback report must not fail the stage.
    }

    return {
      report,
      savedPaths: { validationReport: paths.validationReport },
    };
  }
}
