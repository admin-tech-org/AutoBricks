/**
 * AI Vision refinement orchestrator (ARCHITECTURE §8 upgrade).
 *
 * Fans out parallel headless `claude -p` vision subagents — one per section
 * crop plus one global (full-page) task — each reading rendered pixels and
 * returning a JSON verdict on colors, gradients, typography and layout. The
 * verdicts are validated/clamped, then merged into a clone of the heuristic
 * Page IR. Nothing here throws: any failure falls back to the heuristic IR.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  PageIR,
  VisionAIGlobalResult,
  VisionAIReport,
  VisionAISectionResult,
  VisionAITaskInfo,
  VisionOptions,
} from "@bricks-cdp/ir";
import { cropSections } from "./crop";
import { mapWithConcurrency, runClaude } from "./claude-cli";
import { buildGlobalPrompt, buildSectionPrompt } from "./prompts";
import { parseGlobalResult, parseSectionResult } from "./parse";
import { applyVisionAI } from "./merge";

export { cropSections } from "./crop";

export type RunVisionAIInput = {
  pageIR: PageIR;
  screenshotPath: string;
  pageWidth: number;
  pageHeight: number;
  jobId: string;
  storageRoot: string;
  url: string;
};

export type RunVisionAIOutput = {
  pageIR: PageIR;
  report: VisionAIReport;
  savedPaths: { visionAIReport: string; cropsDir: string };
};

const DEFAULT_MODEL = "sonnet";
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 120000;

type Task =
  | { id: string; kind: "section"; sectionId: string; prompt: string }
  | { id: string; kind: "global"; prompt: string };

export async function runVisionAI(input: RunVisionAIInput, opts: VisionOptions): Promise<RunVisionAIOutput> {
  const model = opts.model || DEFAULT_MODEL;
  const concurrency = opts.concurrency || DEFAULT_CONCURRENCY;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const clone: PageIR = JSON.parse(JSON.stringify(input.pageIR));

  const reportPath = path.join(input.storageRoot, "reports", input.jobId, "vision-ai-report.json");
  const cropsDir = path.join(input.storageRoot, "vision", input.jobId);

  const report: VisionAIReport = {
    jobId: input.jobId,
    backend: "claude-cli",
    model,
    concurrency,
    tasks: [],
    sections: [],
    createdAt: new Date().toISOString(),
  };

  const finish = (): RunVisionAIOutput => {
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    } catch {
      /* ignore persist failure */
    }
    return { pageIR: clone, report, savedPaths: { visionAIReport: reportPath, cropsDir } };
  };

  // 1. crop sections + full page
  let crop;
  try {
    crop = cropSections(clone.sections, input.screenshotPath, input.pageWidth, input.pageHeight, input.jobId, input.storageRoot);
  } catch (e) {
    report.tasks.push({ id: "crop", kind: "global", status: "failed", error: `crop failed: ${String(e).slice(0, 200)}` });
    return finish();
  }
  for (const skipped of crop.skipped) {
    report.tasks.push({ id: `section:${skipped}`, kind: "section", sectionId: skipped, status: "skipped" });
  }

  // 2. build tasks
  const sectionById = new Map(clone.sections.map((s) => [s.id, s]));
  const tasks: Task[] = [];
  for (const sc of crop.sections) {
    const section = sectionById.get(sc.sectionId);
    if (!section) continue;
    tasks.push({
      id: `section:${sc.sectionId}`,
      kind: "section",
      sectionId: sc.sectionId,
      prompt: buildSectionPrompt(section, sc.imagePath, input.url),
    });
  }
  if (crop.fullImagePath) {
    tasks.push({ id: "global", kind: "global", prompt: buildGlobalPrompt(crop.fullImagePath, input.url) });
  }
  if (tasks.length === 0) return finish();

  // 3. run the pool (multi-threaded subagents). The whole pool is guarded so a
  // rare unexpected throw degrades to the heuristic IR instead of failing the job.
  const sectionResults: VisionAISectionResult[] = [];
  let globalResult: VisionAIGlobalResult | undefined;

  try {
    await mapWithConcurrency(tasks, concurrency, async (task) => {
      const started = Date.now();
      const info: VisionAITaskInfo = {
        id: task.id,
        kind: task.kind,
        status: "failed",
        durationMs: 0,
      };
      if (task.kind === "section") info.sectionId = task.sectionId;
      try {
        const res = await runClaude(task.prompt, model, timeoutMs);
        info.durationMs = Date.now() - started;
        if (!res.ok) {
          info.error = res.error;
        } else if (task.kind === "section") {
          const parsed = parseSectionResult(res.text, task.sectionId);
          if (parsed) {
            sectionResults.push(parsed);
            info.status = "ok";
          } else {
            info.error = "unparseable/empty verdict";
          }
        } else {
          const parsed = parseGlobalResult(res.text);
          if (parsed) {
            globalResult = parsed;
            info.status = "ok";
          } else {
            info.error = "unparseable/empty verdict";
          }
        }
      } catch (e) {
        info.durationMs = Date.now() - started;
        info.error = `task threw: ${String(e).slice(0, 200)}`;
      }
      report.tasks.push(info);
    });
  } catch (e) {
    report.tasks.push({ id: "pool", kind: "global", status: "failed", error: `pool failed: ${String(e).slice(0, 200)}` });
  }

  // 4. merge verdicts into the clone
  report.sections = sectionResults;
  if (globalResult) report.global = globalResult;
  try {
    applyVisionAI(clone, sectionResults, globalResult);
  } catch (e) {
    report.tasks.push({ id: "merge", kind: "global", status: "failed", error: `merge failed: ${String(e).slice(0, 200)}` });
  }

  return finish();
}
