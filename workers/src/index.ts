/**
 * Worker package entry point (ARCHITECTURE §5, §20).
 *
 * Exposes the four pipeline stages plus runPipeline(), which chains
 * capture -> analyze -> generate -> validate and emits job status
 * transitions so callers (queue, CLI) can persist progress.
 */
import {
  AnalysisResult,
  CaptureResult,
  GenerateResult,
  JobStatus,
  StageContext,
  ValidateResult,
} from "@bricks-cdp/ir";
import { runCaptureStage } from "./capture-worker";
import { runAnalyzeStage } from "./analyze-worker";
import { GenerateStageOptions, runGenerateStage } from "./generate-worker";
import { runValidateStage } from "./validate-worker";

export { runCaptureStage } from "./capture-worker";
export { runAnalyzeStage } from "./analyze-worker";
export { runGenerateStage } from "./generate-worker";
export type { GenerateStageOptions } from "./generate-worker";
export { runValidateStage } from "./validate-worker";

export type PipelineResult = {
  capture: CaptureResult;
  analysis: AnalysisResult;
  generate: GenerateResult;
  validate: ValidateResult;
};

export async function runPipeline(
  ctx: StageContext,
  onStage?: (status: JobStatus) => void,
  opts?: GenerateStageOptions
): Promise<PipelineResult> {
  const emit = (status: JobStatus): void => {
    if (onStage) onStage(status);
  };

  emit("capturing");
  const capture = await runCaptureStage(ctx);

  emit("analyzing");
  const analysis = await runAnalyzeStage(ctx, capture);

  emit("generating");
  const generate = await runGenerateStage(ctx, analysis, opts);

  emit("validating");
  const validate = await runValidateStage(ctx, { capture, analysis, generate });

  // template.json / template-kit.zip are already written inside the generate
  // stage; "exporting" is emitted here for status parity with JobStatus.
  emit("exporting");
  emit("done");

  return { capture, analysis, generate, validate };
}
