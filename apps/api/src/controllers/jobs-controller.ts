/**
 * Jobs controller (ARCHITECTURE §4).
 *
 * createJob     POST /jobs                      -> { jobId, status: "queued" }
 * getJob        GET  /jobs/:id                  -> job + on-disk artifacts + validation summary
 * getReport     GET  /jobs/:id/report           -> analysis-report.json + validation-report.json merged
 * downloadJson  GET  /jobs/:id/download-json    -> template.json
 * downloadZip   GET  /jobs/:id/download-zip     -> template-kit.zip
 * listJobs      GET  /jobs                      -> all jobs (dashboard)
 * getIR         GET  /jobs/:id/ir               -> page-ir.json (dashboard mapping editor)
 * regenerate    POST /jobs/:id/regenerate       -> re-run generate + validate from an edited PageIR
 */
import { Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { ensureJobDirs, storagePaths } from "@bricks-cdp/export";
import { runGenerateStage, runValidateStage } from "@bricks-cdp/workers";
import {
  AnalysisReport,
  AnalysisResult,
  AssetsSnapshot,
  CaptureResult,
  CssSnapshot,
  DomSnapshot,
  JobMode,
  LayoutSnapshot,
  PageIR,
  ScreenshotSet,
  StageContext,
  ValidationReport,
  ViewportName,
  VisionAnalysis,
  VisionOptions,
  VIEWPORT_SIZES,
} from "@bricks-cdp/ir";
import { JsonDb, errorMessage, newJobId, nowIso, recordGenerateResult, recordValidateResult } from "../db";
import { JobQueue } from "../queue";

type JobPaths = ReturnType<typeof storagePaths>;

const ALL_VIEWPORTS = Object.keys(VIEWPORT_SIZES) as ViewportName[];
const VALID_MODES: JobMode[] = ["landing-page", "page", "section"];
const VALID_OUTPUTS = ["bricks-json", "bricks-zip"];

export type JobsControllerDeps = {
  db: JsonDb;
  queue: JobQueue;
  storageRoot: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonIfExists<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function storageUrl(storageRoot: string, absPath: string): string {
  return "/storage/" + path.relative(storageRoot, absPath).split(path.sep).join("/");
}

/** Collect only the artifact files that actually exist on disk. */
function collectArtifacts(
  paths: JobPaths,
  storageRoot: string
): { files: Record<string, string>; urls: Record<string, string> } {
  const files: Record<string, string> = {};
  const urls: Record<string, string> = {};
  const add = (key: string, absPath: string): void => {
    if (!fs.existsSync(absPath)) return;
    files[key] = absPath;
    urls[key] = storageUrl(storageRoot, absPath);
  };

  add("screenshotDesktop", paths.screenshot("desktop"));
  add("screenshotTablet", paths.screenshot("tablet"));
  add("screenshotMobile", paths.screenshot("mobile"));
  add("screenshotFullPage", paths.screenshot("full-page"));
  add("domSnapshot", paths.domSnapshot);
  add("cssSnapshot", paths.cssSnapshot);
  add("layoutSnapshot", paths.layoutSnapshot);
  add("assetsSnapshot", paths.assetsSnapshot);
  add("mobileLayoutSnapshot", paths.mobileLayoutSnapshot);
  add("pageIR", paths.pageIR);
  add("templateJson", paths.templateJson);
  add("templateZip", paths.templateZip);
  add("analysisReport", paths.analysisReport);
  add("validationReport", paths.validationReport);
  add("previewHtml", paths.previewHtml);
  add("previewScreenshot", paths.previewScreenshot);
  add("diffImage", paths.diffImage);
  return { files, urls };
}

/**
 * Rebuild an AnalysisResult around an edited PageIR so the generate/validate
 * stages can be re-run without re-capturing (dashboard "edit mapping" flow).
 */
function rebuildAnalysisResult(jobId: string, ir: PageIR, paths: JobPaths): AnalysisResult {
  const sections = Array.isArray(ir.sections) ? ir.sections : [];
  const stored = readJsonIfExists<AnalysisReport>(paths.analysisReport);
  const report: AnalysisReport =
    stored ?? {
      jobId,
      url: ir.url,
      pageType: ir.pageType,
      theme: ir.theme,
      sections: sections.map((s) => ({
        id: s.id,
        type: s.type,
        layout: s.layout,
        box: s.box,
        confidence: s.confidence,
        componentCount: Array.isArray(s.children) ? s.children.length : 0,
      })),
      createdAt: nowIso(),
    };

  const vision: VisionAnalysis = {
    pageType: ir.pageType,
    theme: {
      style: ir.theme.style,
      mode: ir.theme.mode,
      primaryColor: ir.theme.primaryColor,
      backgroundColor: ir.theme.backgroundColor,
      textColor: ir.theme.textColor,
      borderRadius: ir.theme.radius,
      fontStyle: ir.theme.fontFamily,
    },
    sections: sections.map((s) => ({
      id: s.id,
      type: s.type,
      layout: s.layout,
      box: s.box,
      confidence: s.confidence ?? 0.5,
    })),
  };

  return {
    vision,
    pageIR: ir,
    report,
    savedPaths: { pageIR: paths.pageIR, analysisReport: paths.analysisReport },
  };
}

/** Rebuild a CaptureResult from the snapshots already on disk (regenerate flow). */
function rebuildCaptureResult(jobId: string, url: string, paths: JobPaths): CaptureResult {
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

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export function createJobsController(deps: JobsControllerDeps) {
  const { db, queue, storageRoot } = deps;

  const createJob = (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!/^(https?|file):\/\//i.test(url)) {
      res.status(400).json({ error: "body.url is required and must start with http://, https:// or file://" });
      return;
    }

    let mode: JobMode = "landing-page";
    if (body.mode !== undefined) {
      if (typeof body.mode !== "string" || !VALID_MODES.includes(body.mode as JobMode)) {
        res.status(400).json({ error: `body.mode must be one of: ${VALID_MODES.join(", ")}` });
        return;
      }
      mode = body.mode as JobMode;
    }

    let viewports: ViewportName[] = [...ALL_VIEWPORTS];
    if (body.viewports !== undefined) {
      const ok =
        Array.isArray(body.viewports) &&
        body.viewports.length > 0 &&
        body.viewports.every((v) => typeof v === "string" && (ALL_VIEWPORTS as string[]).includes(v));
      if (!ok) {
        res.status(400).json({ error: `body.viewports must be a non-empty array of: ${ALL_VIEWPORTS.join(", ")}` });
        return;
      }
      viewports = body.viewports as ViewportName[];
    }

    // `output` only selects what the caller downloads afterwards; the
    // pipeline always writes both template.json and template-kit.zip.
    if (body.output !== undefined) {
      if (typeof body.output !== "string" || !VALID_OUTPUTS.includes(body.output)) {
        res.status(400).json({ error: `body.output must be one of: ${VALID_OUTPUTS.join(", ")}` });
        return;
      }
    }

    // AI vision (optional): body.vision "ai" fans out parallel claude-cli
    // vision subagents in the analyze stage for pixel-fidelity output.
    let vision: VisionOptions | undefined;
    if (body.vision !== undefined) {
      if (body.vision !== "ai" && body.vision !== "heuristic") {
        res.status(400).json({ error: 'body.vision must be "ai" or "heuristic"' });
        return;
      }
      vision = { mode: body.vision as "ai" | "heuristic" };
      if (typeof body.visionModel === "string" && body.visionModel.trim().length > 0) {
        const model = body.visionModel.trim();
        // The model is interpolated into the vision shell command — restrict it
        // to a safe charset so it can never be a shell-injection vector.
        if (model.length > 64 || !/^[A-Za-z0-9._-]+$/.test(model)) {
          res.status(400).json({ error: "body.visionModel must match [A-Za-z0-9._-] (max 64 chars)" });
          return;
        }
        vision.model = model;
      }
    }

    const jobId = newJobId();
    const now = nowIso();
    db.insert("jobs", {
      id: jobId,
      url,
      status: "queued",
      mode,
      created_at: now,
      updated_at: now,
      error_message: null,
    });
    const ctx: StageContext = { jobId, url, mode, viewports, storageRoot };
    if (vision) ctx.vision = vision;
    queue.enqueue(jobId, ctx);

    res.status(201).json({ jobId, status: "queued" });
  };

  const listJobs = (_req: Request, res: Response): void => {
    const jobs = db
      .list("jobs")
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    res.json({ jobs });
  };

  const getJob = (req: Request, res: Response): void => {
    const job = db.getById("jobs", req.params.id);
    if (!job) {
      res.status(404).json({ error: `job ${req.params.id} not found` });
      return;
    }
    const paths = storagePaths(job.id, storageRoot);
    const validation = readJsonIfExists<ValidationReport>(paths.validationReport);
    res.json({
      job,
      artifacts: collectArtifacts(paths, storageRoot),
      validation: validation
        ? {
            score: validation.score,
            layoutScore: validation.layoutScore,
            colorScore: validation.colorScore,
            spacingScore: validation.spacingScore,
            contentScore: validation.contentScore,
            warningCount: validation.warnings.length,
          }
        : null,
    });
  };

  const getReport = (req: Request, res: Response): void => {
    const job = db.getById("jobs", req.params.id);
    if (!job) {
      res.status(404).json({ error: `job ${req.params.id} not found` });
      return;
    }
    const paths = storagePaths(job.id, storageRoot);
    const analysis = readJsonIfExists<AnalysisReport>(paths.analysisReport);
    const validation = readJsonIfExists<ValidationReport>(paths.validationReport);
    if (!analysis && !validation) {
      res.status(404).json({ error: `no reports yet for job ${job.id} (status: ${job.status})` });
      return;
    }
    res.json({ jobId: job.id, status: job.status, analysis, validation });
  };

  const downloadJson = (req: Request, res: Response): void => {
    const job = db.getById("jobs", req.params.id);
    if (!job) {
      res.status(404).json({ error: `job ${req.params.id} not found` });
      return;
    }
    const paths = storagePaths(job.id, storageRoot);
    if (!fs.existsSync(paths.templateJson)) {
      res.status(404).json({
        error:
          `template.json is not ready for job ${job.id} (status: ${job.status}` +
          `${job.error_message ? `, error: ${job.error_message}` : ""})`,
      });
      return;
    }
    res.download(paths.templateJson, "template.json");
  };

  const downloadZip = (req: Request, res: Response): void => {
    const job = db.getById("jobs", req.params.id);
    if (!job) {
      res.status(404).json({ error: `job ${req.params.id} not found` });
      return;
    }
    const paths = storagePaths(job.id, storageRoot);
    if (!fs.existsSync(paths.templateZip)) {
      res.status(404).json({
        error:
          `template-kit.zip is not ready for job ${job.id} (status: ${job.status}` +
          `${job.error_message ? `, error: ${job.error_message}` : ""})`,
      });
      return;
    }
    res.download(paths.templateZip, "template-kit.zip");
  };

  const getIR = (req: Request, res: Response): void => {
    const job = db.getById("jobs", req.params.id);
    if (!job) {
      res.status(404).json({ error: `job ${req.params.id} not found` });
      return;
    }
    const paths = storagePaths(job.id, storageRoot);
    const ir = readJsonIfExists<PageIR>(paths.pageIR);
    if (!ir) {
      res.status(404).json({ error: `page-ir.json is not ready for job ${job.id} (status: ${job.status})` });
      return;
    }
    res.json(ir);
  };

  /**
   * Accept an edited PageIR and re-run generate + validate only — this powers
   * the dashboard "edit mapping" feature. Capture snapshots are reused from
   * disk; visual validation degrades gracefully if any are missing.
   */
  const regenerate = async (req: Request, res: Response): Promise<void> => {
    const job = db.getById("jobs", req.params.id);
    if (!job) {
      res.status(404).json({ error: `job ${req.params.id} not found` });
      return;
    }

    const body = req.body as Partial<PageIR> | null | undefined;
    if (
      !body ||
      typeof body !== "object" ||
      typeof body.pageType !== "string" ||
      !Array.isArray(body.sections)
    ) {
      res.status(400).json({ error: "body must be an edited PageIR object: { url, pageType, theme, sections }" });
      return;
    }

    const ir: PageIR = {
      url: typeof body.url === "string" ? body.url : job.url,
      pageType: body.pageType,
      theme: body.theme && typeof body.theme === "object" ? body.theme : {},
      sections: body.sections,
    };

    const previousStatus = job.status;
    const paths = storagePaths(job.id, storageRoot);

    try {
      ensureJobDirs(paths);
      // Persist the edited IR so getIR/downstream stages see the new mapping.
      fs.writeFileSync(paths.pageIR, JSON.stringify(ir, null, 2), "utf8");

      const ctx: StageContext = {
        jobId: job.id,
        url: job.url,
        mode: job.mode,
        viewports: [...ALL_VIEWPORTS],
        storageRoot,
      };
      const analysis = rebuildAnalysisResult(job.id, ir, paths);

      db.update("jobs", job.id, { status: "generating", updated_at: nowIso() });
      const generate = await runGenerateStage(ctx, analysis);
      recordGenerateResult(db, job.id, generate);

      db.update("jobs", job.id, { status: "validating", updated_at: nowIso() });
      const capture = rebuildCaptureResult(job.id, job.url, paths);
      const validate = await runValidateStage(ctx, { capture, analysis, generate });
      recordValidateResult(db, job.id, validate);

      db.update("jobs", job.id, { status: "done", error_message: null, updated_at: nowIso() });
      res.json({
        jobId: job.id,
        status: "done",
        jsonValidation: generate.jsonValidation,
        validation: validate.report,
        savedPaths: { ...generate.savedPaths, ...validate.savedPaths },
      });
    } catch (err) {
      // Regenerating from a bad edit must not poison the original job state.
      db.update("jobs", job.id, { status: previousStatus, updated_at: nowIso() });
      res.status(500).json({ error: `regenerate failed: ${errorMessage(err)}` });
    }
  };

  return { createJob, listJobs, getJob, getReport, downloadJson, downloadZip, getIR, regenerate };
}

export type JobsController = ReturnType<typeof createJobsController>;
