/**
 * Analyze Worker (ARCHITECTURE §20).
 *
 * Reads the capture output (screenshots + DOM/CSS/layout snapshots), detects
 * theme/sections/layout, classifies components, merges everything into the
 * Page IR and writes page-ir.json + analysis-report.json (all delegated to
 * @bricks-cdp/analyzer).
 */
import { AnalysisResult, CaptureResult, StageContext } from "@bricks-cdp/ir";
import { analyzeCapture } from "@bricks-cdp/analyzer";

export async function runAnalyzeStage(ctx: StageContext, capture: CaptureResult): Promise<AnalysisResult> {
  return analyzeCapture(capture, ctx);
}
