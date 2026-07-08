/**
 * Job routes (ARCHITECTURE §4).
 *
 *   POST /jobs                    create a generate job
 *   GET  /jobs/:id                job status + artifacts
 *   GET  /jobs/:id/report         analysis + validation reports (merged)
 *   GET  /jobs/:id/download-json  template.json
 *   GET  /jobs/:id/download-zip   template-kit.zip
 *
 * Dashboard extras:
 *   GET  /jobs                    list jobs
 *   GET  /jobs/:id/ir             page-ir.json
 *   POST /jobs/:id/regenerate     re-run generate + validate from edited PageIR
 */
import { Router } from "express";
import { createJobsController, JobsControllerDeps } from "../controllers/jobs-controller";

export function createJobsRouter(deps: JobsControllerDeps): Router {
  const controller = createJobsController(deps);
  const router = Router();

  router.post("/jobs", controller.createJob);
  router.get("/jobs", controller.listJobs);
  router.get("/jobs/:id", controller.getJob);
  router.get("/jobs/:id/report", controller.getReport);
  router.get("/jobs/:id/download-json", controller.downloadJson);
  router.get("/jobs/:id/download-zip", controller.downloadZip);
  router.get("/jobs/:id/ir", controller.getIR);
  router.post("/jobs/:id/regenerate", controller.regenerate);

  return router;
}
