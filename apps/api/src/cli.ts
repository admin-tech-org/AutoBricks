#!/usr/bin/env node
/**
 * CLI pipeline runner — runs the full capture -> analyze -> generate ->
 * validate pipeline inline (no server/queue) and records everything in
 * db.json exactly like the queue does.
 *
 * Two modes:
 *   --url <url>   Capture a live page then analyze/generate/validate.
 *   --job <id>    RE-analyze an already-captured job from its stored snapshots
 *                 (no browser) — e.g. to apply AI vision to a prior capture.
 *
 * AI vision (--vision ai) fans out parallel headless `claude -p` vision
 * subagents that read section screenshots and correct colors/gradients/
 * typography/layout for pixel-fidelity output.
 */
import * as path from "path";
import { defaultStorageRoot, ensureJobDirs, storagePaths } from "@bricks-cdp/export";
import {
  JobMode,
  JobStatus,
  StageContext,
  ViewportName,
  VIEWPORT_SIZES,
  VisionOptions,
} from "@bricks-cdp/ir";
import {
  PipelineResult,
  runAnalyzeStage,
  runGenerateStage,
  runPipeline,
  runValidateStage,
} from "@bricks-cdp/workers";
import { JsonDb, errorMessage, newJobId, nowIso, recordPipelineArtifacts } from "./db";
import { canReconstructCapture, reconstructCapture } from "./reconstruct-capture";

const ALL_VIEWPORTS = Object.keys(VIEWPORT_SIZES) as ViewportName[];
const VALID_MODES: JobMode[] = ["landing-page", "page", "section"];

type CliOptions = {
  url: string;
  jobId?: string; // set => re-analyze existing capture
  mode: JobMode;
  viewports: ViewportName[];
  storageRoot: string;
  idStyle?: "readable" | "bricks";
  vision: VisionOptions;
};

const USAGE = `Usage:
  node apps/api/dist/cli.js --url <url> [options]
  node apps/api/dist/cli.js --job <jobId> [--vision ai] [options]   (re-analyze a stored capture)

Options:
  --url <url>              Page to generate from (http://, https:// or file://).
  --job <jobId>            Re-analyze an already-captured job (no browser). --url optional.
  --mode <mode>            ${VALID_MODES.join(" | ")} (default: landing-page)
  --viewports <list>       Comma-separated subset of: ${ALL_VIEWPORTS.join(",")} (default: all)
  --storage <dir>          Storage root directory (default: STORAGE_DIR or <repo>/storage)
  --id-style <style>       readable | bricks (default: readable)
  --vision <mode>          heuristic | ai (default: heuristic). "ai" = parallel claude-cli vision subagents.
  --vision-model <model>   Model for AI vision (default: sonnet)
  --vision-concurrency <n> Parallel vision subagents (default: 4)
  -h, --help               Show this help`;

function fail(message: string): never {
  console.error(`[cli] ${message}\n\n${USAGE}`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  let url = "";
  let jobId: string | undefined;
  let mode: JobMode = "landing-page";
  let viewports: ViewportName[] = [...ALL_VIEWPORTS];
  let storageRoot = defaultStorageRoot();
  let idStyle: "readable" | "bricks" | undefined;
  let visionMode: "heuristic" | "ai" = "heuristic";
  let visionModel = "sonnet";
  let visionConcurrency: number | undefined;

  let i = 0;
  const next = (flag: string): string => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing value for ${flag}`);
    i += 1;
    return value;
  };

  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--url":
        url = next(arg).trim();
        break;
      case "--job":
        jobId = next(arg).trim();
        break;
      case "--mode": {
        const value = next(arg);
        if (!VALID_MODES.includes(value as JobMode)) {
          fail(`invalid --mode "${value}" (expected: ${VALID_MODES.join(" | ")})`);
        }
        mode = value as JobMode;
        break;
      }
      case "--viewports": {
        const parts = next(arg)
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
        if (parts.length === 0 || !parts.every((p) => (ALL_VIEWPORTS as string[]).includes(p))) {
          fail(`invalid --viewports (expected comma-separated subset of: ${ALL_VIEWPORTS.join(",")})`);
        }
        viewports = parts as ViewportName[];
        break;
      }
      case "--storage":
        storageRoot = path.resolve(next(arg));
        break;
      case "--id-style": {
        const value = next(arg);
        if (value !== "readable" && value !== "bricks") {
          fail(`invalid --id-style "${value}" (expected: readable | bricks)`);
        }
        idStyle = value;
        break;
      }
      case "--vision": {
        const value = next(arg);
        if (value !== "heuristic" && value !== "ai") {
          fail(`invalid --vision "${value}" (expected: heuristic | ai)`);
        }
        visionMode = value;
        break;
      }
      case "--vision-model": {
        const value = next(arg).trim();
        // Restricted charset: the model is interpolated into the vision shell command.
        if (value.length > 64 || !/^[A-Za-z0-9._-]+$/.test(value)) {
          fail("invalid --vision-model (allowed: [A-Za-z0-9._-], max 64 chars)");
        }
        visionModel = value;
        break;
      }
      case "--vision-concurrency": {
        const n = parseInt(next(arg), 10);
        if (!Number.isFinite(n) || n < 1 || n > 16) fail("invalid --vision-concurrency (expected 1-16)");
        visionConcurrency = n;
        break;
      }
      case "-h":
      case "--help":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        fail(`unknown argument "${arg}"`);
    }
    i += 1;
  }

  const vision: VisionOptions = { mode: visionMode, model: visionModel };
  if (visionConcurrency !== undefined) vision.concurrency = visionConcurrency;

  if (jobId) {
    // Re-analyze mode: url is optional (read from db/snapshots when omitted).
    return { url, jobId, mode, viewports, storageRoot, idStyle, vision };
  }
  if (!/^(https?|file):\/\//i.test(url)) {
    fail("provide --url (http/https/file) to capture, or --job <id> to re-analyze a stored capture");
  }
  return { url, mode, viewports, storageRoot, idStyle, vision };
}

/** Resolve the URL for a --job re-analyze: explicit --url, else db, else snapshot. */
function resolveJobUrl(db: JsonDb, opts: CliOptions): string {
  if (opts.url) return opts.url;
  const job = db.getById("jobs", opts.jobId!) as { url?: string } | undefined;
  if (job && typeof job.url === "string" && job.url.length > 0) return job.url;
  try {
    const paths = storagePaths(opts.jobId!, opts.storageRoot);
    const fs = require("fs") as typeof import("fs");
    const dom = JSON.parse(fs.readFileSync(paths.domSnapshot, "utf8"));
    if (dom && typeof dom.url === "string") return dom.url;
  } catch {
    /* ignore */
  }
  return "";
}

function printResult(opts: CliOptions, result: PipelineResult, startedAt: number): void {
  const { capture, analysis, generate, validate } = result;
  console.log("");
  console.log(`[cli] DONE in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log("");
  console.log("[cli] Saved files:");
  for (const [name, file] of Object.entries(capture.savedPaths.screenshots)) {
    if (file) console.log(`[cli]   screenshot (${name}): ${file}`);
  }
  console.log(`[cli]   page IR:            ${analysis.savedPaths.pageIR}`);
  console.log(`[cli]   analysis report:    ${analysis.savedPaths.analysisReport}`);
  if (analysis.savedPaths.visionAIReport) {
    console.log(`[cli]   vision AI report:   ${analysis.savedPaths.visionAIReport}`);
  }
  console.log(`[cli]   template.json:      ${generate.savedPaths.templateJson}`);
  console.log(`[cli]   template-kit.zip:   ${generate.savedPaths.templateZip}`);
  console.log(`[cli]   validation report:  ${validate.savedPaths.validationReport}`);
  console.log("");
  if (analysis.report.visionMode) console.log(`[cli] analyzer: ${analysis.report.visionMode}`);

  const jv = generate.jsonValidation;
  console.log(
    `[cli] JSON validation: ${jv.valid ? "valid" : "INVALID"}` +
      ` (${jv.errors.length} error(s), ${jv.warnings.length} warning(s))`
  );
  for (const warning of jv.warnings) console.log(`[cli]   - ${warning}`);

  const report = validate.report;
  console.log(
    `[cli] Visual validation: score=${report.score} layout=${report.layoutScore}` +
      ` color=${report.colorScore} spacing=${report.spacingScore} content=${report.contentScore}`
  );
  for (const warning of report.warnings) console.log(`[cli]   - ${warning}`);
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const db = new JsonDb(opts.storageRoot);
  const genOpts = opts.idStyle ? { idStyle: opts.idStyle } : undefined;

  // -------------------------------------------------------------------------
  // Re-analyze mode (--job): reconstruct the capture, then analyze/gen/validate.
  // -------------------------------------------------------------------------
  if (opts.jobId) {
    const jobId = opts.jobId;
    if (!canReconstructCapture(jobId, opts.storageRoot)) {
      fail(`no stored capture for job "${jobId}" under ${opts.storageRoot} (need snapshots/${jobId}/dom.json etc.)`);
    }
    const url = resolveJobUrl(db, opts);
    const ctx: StageContext = {
      jobId,
      url,
      mode: opts.mode,
      viewports: opts.viewports,
      storageRoot: opts.storageRoot,
      vision: opts.vision,
    };

    console.log(`[cli] re-analyze job: ${jobId}`);
    console.log(`[cli] url:            ${url || "(unknown)"}`);
    console.log(`[cli] vision:         ${opts.vision.mode}${opts.vision.mode === "ai" ? ` (${opts.vision.model})` : ""}`);
    console.log(`[cli] storage:        ${opts.storageRoot}`);
    console.log("");

    const startedAt = Date.now();
    try {
      const capture = reconstructCapture(jobId, opts.storageRoot, url);
      console.log("[cli] analyzing (from stored capture)...");
      const analysis = await runAnalyzeStage(ctx, capture);
      console.log("[cli] generating...");
      const generate = await runGenerateStage(ctx, analysis, genOpts);
      console.log("[cli] validating...");
      const validate = await runValidateStage(ctx, { capture, analysis, generate });
      const result: PipelineResult = { capture, analysis, generate, validate };
      recordPipelineArtifacts(db, jobId, result);
      db.update("jobs", jobId, { status: "done", error_message: null, updated_at: nowIso() });
      printResult(opts, result, startedAt);
      return 0;
    } catch (err) {
      const message = errorMessage(err);
      console.error(`\n[cli] FAILED after ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${message}`);
      return 1;
    }
  }

  // -------------------------------------------------------------------------
  // Capture mode (--url): full pipeline.
  // -------------------------------------------------------------------------
  const jobId = newJobId();
  const ctx: StageContext = {
    jobId,
    url: opts.url,
    mode: opts.mode,
    viewports: opts.viewports,
    storageRoot: opts.storageRoot,
    vision: opts.vision,
  };
  const paths = storagePaths(jobId, opts.storageRoot);
  ensureJobDirs(paths);

  const now = nowIso();
  db.insert("jobs", {
    id: jobId,
    url: opts.url,
    status: "queued",
    mode: opts.mode,
    created_at: now,
    updated_at: now,
    error_message: null,
  });

  console.log(`[cli] job:       ${jobId}`);
  console.log(`[cli] url:       ${opts.url}`);
  console.log(`[cli] mode:      ${opts.mode}`);
  console.log(`[cli] viewports: ${opts.viewports.join(", ")}`);
  console.log(`[cli] vision:    ${opts.vision.mode}${opts.vision.mode === "ai" ? ` (${opts.vision.model})` : ""}`);
  console.log(`[cli] storage:   ${opts.storageRoot}`);
  console.log("");

  const startedAt = Date.now();
  let currentStage: JobStatus | null = null;
  let stageStartedAt = startedAt;

  const onStage = (status: JobStatus): void => {
    const at = Date.now();
    if (currentStage) {
      console.log(`[cli]   ${currentStage} finished in ${((at - stageStartedAt) / 1000).toFixed(1)}s`);
    }
    currentStage = status === "done" ? null : status;
    stageStartedAt = at;
    if (status !== "done") console.log(`[cli] ${status}...`);
    db.update("jobs", jobId, { status, updated_at: nowIso() });
  };

  try {
    const result = await runPipeline(ctx, onStage, genOpts);
    recordPipelineArtifacts(db, jobId, result);
    db.update("jobs", jobId, { status: "done", error_message: null, updated_at: nowIso() });
    printResult(opts, result, startedAt);
    return 0;
  } catch (err) {
    const message = errorMessage(err);
    try {
      db.update("jobs", jobId, { status: "failed", error_message: message, updated_at: nowIso() });
    } catch {
      // reporting the failure matters more than persisting it
    }
    console.error("");
    console.error(`[cli] FAILED after ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${message}`);
    return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`[cli] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
