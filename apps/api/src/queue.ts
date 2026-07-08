/**
 * In-memory job queue (ARCHITECTURE §5).
 *
 * Capture/analyze/generate/validate is too slow to run inside the HTTP
 * request, so jobs are queued and processed FIFO with a small worker pool
 * (WORKER_CONCURRENCY, default 2).
 *
 * This is the MVP implementation: single process, no persistence of the
 * queue itself (job state lives in the jobs table). The production swap-in
 * is BullMQ + Redis per ARCHITECTURE §5 — this class intentionally mirrors
 * that enqueue/process shape.
 */
import { JobStatus, StageContext, ViewportName, VIEWPORT_SIZES } from "@bricks-cdp/ir";
import { runPipeline } from "@bricks-cdp/workers";
import { JsonDb, errorMessage, nowIso, recordPipelineArtifacts } from "./db";

const ALL_VIEWPORTS = Object.keys(VIEWPORT_SIZES) as ViewportName[];

export class JobQueue {
  readonly concurrency: number;

  private readonly db: JsonDb;
  private readonly storageRoot: string;
  private readonly pending: string[] = [];
  private readonly contexts = new Map<string, StageContext>();
  private active = 0;

  constructor(db: JsonDb, storageRoot: string, concurrency?: number) {
    this.db = db;
    this.storageRoot = storageRoot;
    const fromEnv = Number(process.env.WORKER_CONCURRENCY ?? 2);
    const wanted = concurrency ?? fromEnv;
    this.concurrency = Number.isFinite(wanted) && wanted >= 1 ? Math.floor(wanted) : 2;
  }

  /**
   * Add a job to the queue. `ctx` carries the requested viewports; when
   * omitted, the context is rebuilt from the jobs table with all viewports.
   */
  enqueue(jobId: string, ctx?: StageContext): void {
    if (ctx) this.contexts.set(jobId, ctx);
    this.pending.push(jobId);
    this.tick();
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get activeCount(): number {
    return this.active;
  }

  private tick(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const jobId = this.pending.shift();
      if (!jobId) break;
      this.active += 1;
      // The queue must never crash the process: process() catches everything.
      void this.process(jobId);
    }
  }

  private contextFor(jobId: string): StageContext | null {
    const known = this.contexts.get(jobId);
    if (known) return known;
    const job = this.db.getById("jobs", jobId);
    if (!job) return null;
    return {
      jobId,
      url: job.url,
      mode: job.mode,
      viewports: [...ALL_VIEWPORTS],
      storageRoot: this.storageRoot,
    };
  }

  private async process(jobId: string): Promise<void> {
    try {
      const ctx = this.contextFor(jobId);
      if (!ctx) {
        console.error(`[queue] job ${jobId} has no record — skipping`);
        return;
      }

      console.log(`[queue] job ${jobId} started (${ctx.url})`);
      const onStage = (status: JobStatus): void => {
        this.db.update("jobs", jobId, { status, updated_at: nowIso() });
        if (status !== "done") console.log(`[queue] job ${jobId} -> ${status}`);
      };

      const artifacts = await runPipeline(ctx, onStage);
      recordPipelineArtifacts(this.db, jobId, artifacts);
      this.db.update("jobs", jobId, { status: "done", error_message: null, updated_at: nowIso() });
      console.log(
        `[queue] job ${jobId} done (visual score ${artifacts.validate.report.score}, ` +
          `${artifacts.validate.report.warnings.length} warning(s))`
      );
    } catch (err) {
      const message = errorMessage(err);
      try {
        this.db.update("jobs", jobId, { status: "failed", error_message: message, updated_at: nowIso() });
      } catch (dbErr) {
        console.error(`[queue] job ${jobId}: failed to persist failure: ${errorMessage(dbErr)}`);
      }
      console.error(`[queue] job ${jobId} failed: ${message}`);
    } finally {
      this.contexts.delete(jobId);
      this.active -= 1;
      this.tick();
    }
  }
}
