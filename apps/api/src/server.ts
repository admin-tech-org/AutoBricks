/**
 * API Server (ARCHITECTURE §3, §4).
 *
 * Receives generate requests, creates jobs, exposes job status/reports and
 * the generated template downloads, serves the dashboard and the storage
 * directory (screenshots, snapshots, reports) read-only under /storage.
 */
import express, { NextFunction, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { defaultStorageRoot } from "@bricks-cdp/export";
import { JsonDb } from "./db";
import { JobQueue } from "./queue";
import { createJobsRouter } from "./routes/jobs";

const storageRoot = defaultStorageRoot();
fs.mkdirSync(storageRoot, { recursive: true });

const db = new JsonDb(storageRoot);
const queue = new JobQueue(db, storageRoot);

const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "bricks-cdp-visual-generator", time: new Date().toISOString() });
});

app.use(createJobsRouter({ db, queue, storageRoot }));

// Read-only artifact serving: screenshots, snapshots, IR, templates, reports.
app.use("/storage", express.static(storageRoot, { index: false }));

// Dashboard static files (apps/dashboard/public), served at "/".
const dashboardDir = path.resolve(__dirname, "..", "..", "dashboard", "public");
app.use("/", express.static(dashboardDir));

// JSON 404 for anything unmatched.
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `not found: ${req.method} ${req.path}` });
});

// JSON error handler (body parse failures etc.) — keeps the process alive.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  res.status(400).json({ error: message });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`[api] Bricks CDP Visual Generator API listening on http://localhost:${port}`);
  console.log(`[api] Dashboard:       http://localhost:${port}/`);
  console.log(`[api] Health:          GET  http://localhost:${port}/health`);
  console.log(`[api] Create job:      POST http://localhost:${port}/jobs   {"url":"https://example.com"}`);
  console.log(`[api] Job status:      GET  http://localhost:${port}/jobs/:id`);
  console.log(`[api] Report:          GET  http://localhost:${port}/jobs/:id/report`);
  console.log(`[api] Download JSON:   GET  http://localhost:${port}/jobs/:id/download-json`);
  console.log(`[api] Download ZIP:    GET  http://localhost:${port}/jobs/:id/download-zip`);
  console.log(`[api] Storage root:    ${storageRoot} (served at /storage)`);
  console.log(`[api] Worker concurrency: ${queue.concurrency}`);
});
