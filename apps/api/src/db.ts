/**
 * Tiny JSON-file database for the MVP.
 *
 * Persists the five tables of ARCHITECTURE §18 (jobs, captures,
 * analysis_reports, generated_templates, assets) to <storageRoot>/db.json.
 *
 * This is deliberately a single-process, synchronous store: every operation
 * reads the file fresh and writes it back atomically (temp file + rename).
 * PostgreSQL is the production target per ARCHITECTURE §5/§18 — swap this
 * module for a real repository layer when moving beyond the MVP.
 */
import * as fs from "fs";
import * as path from "path";
import {
  AnalysisReportRecord,
  AnalysisResult,
  AssetRecord,
  CaptureRecord,
  CaptureResult,
  GeneratedTemplateRecord,
  GenerateResult,
  JobRecord,
  ValidateResult,
} from "@bricks-cdp/ir";

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export type DbTables = {
  jobs: JobRecord[];
  captures: CaptureRecord[];
  analysis_reports: AnalysisReportRecord[];
  generated_templates: GeneratedTemplateRecord[];
  assets: AssetRecord[];
};

export type TableName = keyof DbTables;
type RowOf<T extends TableName> = DbTables[T][number];

function emptyTables(): DbTables {
  return {
    jobs: [],
    captures: [],
    analysis_reports: [],
    generated_templates: [],
    assets: [],
  };
}

// ---------------------------------------------------------------------------
// Small shared helpers (used by db, queue, controllers and CLI)
// ---------------------------------------------------------------------------

export function nowIso(): string {
  return new Date().toISOString();
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function randomSuffix(length: number): string {
  let s = "";
  while (s.length < length) {
    s += Math.random().toString(36).slice(2);
  }
  return s.slice(0, length);
}

/** "job_" + Date.now().toString(36) + 4 random chars — shared by API and CLI. */
export function newJobId(): string {
  return `job_${Date.now().toString(36)}${randomSuffix(4)}`;
}

export function newRowId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomSuffix(4)}`;
}

// ---------------------------------------------------------------------------
// JsonDb
// ---------------------------------------------------------------------------

export class JsonDb {
  readonly filePath: string;

  constructor(storageRoot: string) {
    this.filePath = path.join(storageRoot, "db.json");
  }

  /** Read the whole database from disk (empty tables if missing/corrupt). */
  load(): DbTables {
    const tables = emptyTables();
    if (!fs.existsSync(this.filePath)) return tables;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object") {
        for (const key of Object.keys(tables) as TableName[]) {
          const value = (parsed as Record<string, unknown>)[key];
          if (Array.isArray(value)) {
            (tables as Record<TableName, unknown[]>)[key] = value;
          }
        }
      }
    } catch (err) {
      console.error(`[db] failed to read ${this.filePath}: ${errorMessage(err)} — using empty tables`);
    }
    return tables;
  }

  /** Write the whole database atomically: temp file in same dir, then rename. */
  save(tables: DbTables): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tables, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  insert<T extends TableName>(table: T, row: RowOf<T>): RowOf<T> {
    const tables = this.load();
    (tables[table] as RowOf<T>[]).push(row);
    this.save(tables);
    return row;
  }

  update<T extends TableName>(table: T, id: string, patch: Partial<RowOf<T>>): RowOf<T> | undefined {
    const tables = this.load();
    const rows = tables[table] as RowOf<T>[];
    const row = rows.find((r) => r.id === id);
    if (!row) return undefined;
    Object.assign(row, patch);
    this.save(tables);
    return row;
  }

  getById<T extends TableName>(table: T, id: string): RowOf<T> | undefined {
    const rows = this.load()[table] as RowOf<T>[];
    return rows.find((r) => r.id === id);
  }

  list<T extends TableName>(table: T, filter?: (row: RowOf<T>) => boolean): RowOf<T>[] {
    const rows = this.load()[table] as RowOf<T>[];
    return filter ? rows.filter(filter) : rows;
  }
}

// ---------------------------------------------------------------------------
// Record-keeping helpers shared by queue.ts and cli.ts
// ---------------------------------------------------------------------------

/** Insert captures rows (one per screenshot) + assets rows for a capture stage. */
export function recordCaptureResult(db: JsonDb, jobId: string, capture: CaptureResult): void {
  const shots = capture.savedPaths.screenshots;
  const entries: Array<[CaptureRecord["viewport"], string | undefined]> = [
    ["desktop", shots.desktop],
    ["tablet", shots.tablet],
    ["mobile", shots.mobile],
    ["full-page", shots.fullPage],
  ];
  for (const [viewport, screenshotPath] of entries) {
    if (!screenshotPath) continue;
    // DOM/CSS/layout snapshots are captured on the primary (desktop) viewport.
    const isPrimary = viewport === "desktop";
    db.insert("captures", {
      id: newRowId("cap"),
      job_id: jobId,
      viewport,
      screenshot_path: screenshotPath,
      dom_snapshot_path: isPrimary ? capture.savedPaths.dom : null,
      css_snapshot_path: isPrimary ? capture.savedPaths.css : null,
      layout_snapshot_path: isPrimary ? capture.savedPaths.layout : null,
      created_at: nowIso(),
    });
  }

  // MVP asset pipeline (ARCHITECTURE §16): assets stay as remote URLs; the
  // production version downloads and uploads them to the WP Media Library.
  for (const asset of capture.assets.assets) {
    db.insert("assets", {
      id: newRowId("asset"),
      job_id: jobId,
      original_url: asset.url,
      local_path: null,
      wordpress_attachment_id: null,
      type: asset.type,
      status: "remote",
    });
  }
}

/** Insert an analysis_reports row for an analyze stage. */
export function recordAnalysisResult(db: JsonDb, jobId: string, analysis: AnalysisResult): void {
  db.insert("analysis_reports", {
    id: newRowId("ar"),
    job_id: jobId,
    page_type: analysis.report.pageType,
    theme_json: JSON.stringify(analysis.report.theme),
    sections_json: JSON.stringify(analysis.report.sections),
    confidence_json: JSON.stringify(
      analysis.report.sections.map((s) => ({ id: s.id, confidence: s.confidence ?? null }))
    ),
    created_at: nowIso(),
  });
}

/** Insert a generated_templates row for a generate stage. */
export function recordGenerateResult(db: JsonDb, jobId: string, generate: GenerateResult): void {
  db.insert("generated_templates", {
    id: newRowId("tpl"),
    job_id: jobId,
    json_path: generate.savedPaths.templateJson,
    zip_path: generate.savedPaths.templateZip,
    bricks_json: JSON.stringify(generate.template),
    validation_score: null,
    created_at: nowIso(),
  });
}

/** Attach the visual validation score to the latest generated template row. */
export function recordValidateResult(db: JsonDb, jobId: string, validate: ValidateResult): void {
  const rows = db.list("generated_templates", (r) => r.job_id === jobId);
  const latest = rows[rows.length - 1];
  if (latest) {
    db.update("generated_templates", latest.id, { validation_score: validate.report.score });
  }
}

export type PipelineArtifacts = {
  capture: CaptureResult;
  analysis: AnalysisResult;
  generate: GenerateResult;
  validate: ValidateResult;
};

/** Record all stage rows for a finished pipeline run (shared by queue + CLI). */
export function recordPipelineArtifacts(db: JsonDb, jobId: string, artifacts: PipelineArtifacts): void {
  recordCaptureResult(db, jobId, artifacts.capture);
  recordAnalysisResult(db, jobId, artifacts.analysis);
  recordGenerateResult(db, jobId, artifacts.generate);
  recordValidateResult(db, jobId, artifacts.validate);
}
