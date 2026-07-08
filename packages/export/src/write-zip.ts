/**
 * Template kit zip builder.
 *
 * IMPORTANT — Bricks import behavior: when a .zip is imported via
 * Bricks → Templates → Import, Bricks treats EVERY *.json file inside the
 * archive as one template. So the kit must contain exactly ONE .json file
 * (template.json, at the root); all intermediate artifacts are stored under
 * meta/ with a ".txt" suffix appended so Bricks ignores them.
 *
 * Layout of <templates>/<jobId>/template-kit.zip:
 *   template.json                      (the ONLY .json — safe to import as-is)
 *   README.txt                         (how to import / what meta files are)
 *   meta/page-ir.json.txt              (if it exists)
 *   meta/analysis-report.json.txt      (if it exists)
 *   meta/validation-report.json.txt    (if it exists)
 *   screenshots/*.png                  (when include.screenshots)
 */

import AdmZip from "adm-zip";
import * as fs from "fs";
import * as path from "path";
import type { JobPaths } from "./paths";

function addIfExists(zip: AdmZip, filePath: string, zipName: string, zipDir = ""): boolean {
  if (!fs.existsSync(filePath)) return false;
  zip.addLocalFile(filePath, zipDir, zipName);
  return true;
}

const KIT_README = `Bricks CDP Visual Generator - template kit
==========================================

HOW TO IMPORT INTO BRICKS BUILDER
1. WordPress admin -> Bricks -> Templates -> Import Templates.
2. Import this whole .zip (it contains exactly one template), or extract it
   and import template.json only.
3. The template appears under "My Templates". Importing never creates a
   WordPress page by itself: create a new Page -> "Edit with Bricks" ->
   open the template library -> insert the imported template.

WHAT ELSE IS IN THIS ARCHIVE
- meta/page-ir.json.txt            The intermediate Page IR the template was
                                   generated from (rename to .json to reuse).
- meta/analysis-report.json.txt    Section/theme detection report.
- meta/validation-report.json.txt  Visual validation scores, if produced.
- screenshots/*.png                Screenshots of the original page, if included.

The meta files carry a .txt suffix ON PURPOSE: Bricks would otherwise import
every .json in the zip as a separate (broken) template.
`;

/**
 * Build the template kit zip at paths.templateZip and return that path.
 * template.json must already exist (write it via writeTemplateJson first).
 */
export function writeTemplateZip(paths: JobPaths, include?: { screenshots?: boolean }): string {
  if (!fs.existsSync(paths.templateJson)) {
    throw new Error(`writeTemplateZip: template.json not found at ${paths.templateJson} — write it first`);
  }

  const zip = new AdmZip();
  // The one and only .json in the archive — Bricks imports exactly one template.
  addIfExists(zip, paths.templateJson, "template.json");
  zip.addFile("README.txt", Buffer.from(KIT_README, "utf8"));
  addIfExists(zip, paths.pageIR, "page-ir.json.txt", "meta");
  addIfExists(zip, paths.analysisReport, "analysis-report.json.txt", "meta");
  addIfExists(zip, paths.validationReport, "validation-report.json.txt", "meta");

  if (include?.screenshots && fs.existsSync(paths.screenshotsDir)) {
    const pngs = fs
      .readdirSync(paths.screenshotsDir)
      .filter((f) => f.toLowerCase().endsWith(".png"))
      .sort();
    for (const png of pngs) {
      addIfExists(zip, path.join(paths.screenshotsDir, png), png, "screenshots");
    }
  }

  fs.mkdirSync(path.dirname(paths.templateZip), { recursive: true });
  zip.writeZip(paths.templateZip);
  return paths.templateZip;
}
