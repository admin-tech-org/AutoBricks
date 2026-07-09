/**
 * Phase 5 — Sub Agent Generator entry (Website_Design_Analytics.md).
 *
 * Reads the finalized planner (Page IR) for a job and generates valid Bricks
 * Builder JSON from it. The planner is a READ-ONLY contract: this script does
 * NOT mutate it (no re-analysis, no colour/layout edits) — it only maps the
 * blueprint to a flat Bricks element array via the deterministic generator,
 * validates it, and writes template.json + provenance.json.
 *
 * Usage: node generate-planner.js <jobId>
 */
const fs = require("fs");
const path = require("path");
const ROOT = __dirname;
const { runGenerateStage } = require(path.join(ROOT, "workers/dist/generate-worker.js"));

const jobId = process.argv[2];
if (!jobId) {
  console.error("usage: node generate-planner.js <jobId>");
  process.exit(1);
}

const irPath = path.join(ROOT, "storage/ir", jobId, "page-ir.json");
const pageIR = JSON.parse(fs.readFileSync(irPath, "utf8"));

const sectionIds = pageIR.sections.map((s) => s.id);
console.log(`planner: ${sectionIds.length} sections | layouts: ${[...new Set(pageIR.sections.map((s) => s.layout))].join(",")}`);

const ctx = { jobId, url: pageIR.url || "", storageRoot: path.resolve(ROOT, "storage") };
runGenerateStage(ctx, { pageIR }, { idStyle: "bricks" })
  .then((r) => {
    const el = Array.isArray(r.template.content) ? r.template.content.length : 0;
    console.log(`generated: ${r.savedPaths.templateJson}`);
    console.log(`elements: ${el} | JSON valid: ${r.jsonValidation.valid} | errors: ${r.jsonValidation.errors.length}`);
    console.log(`SECTION_IDS: ${JSON.stringify(sectionIds)}`);
  })
  .catch((e) => {
    console.error("GENERATE FAIL:", e.message);
    process.exit(1);
  });
