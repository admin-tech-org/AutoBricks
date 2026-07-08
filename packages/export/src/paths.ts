import * as path from "path";
import * as fs from "fs";

/**
 * Storage layout (ARCHITECTURE §19):
 *
 * storage/
 * ├── screenshots/<jobId>/{desktop,tablet,mobile,full-page}.png
 * ├── snapshots/<jobId>/{dom,css,layout,assets}.json
 * ├── ir/<jobId>/page-ir.json
 * ├── templates/<jobId>/{template.json,template-kit.zip}
 * └── reports/<jobId>/{analysis-report.json,validation-report.json,preview.html,preview.png,diff.png}
 */

export function defaultStorageRoot(): string {
  return process.env.STORAGE_DIR || path.resolve(__dirname, "..", "..", "..", "storage");
}

export type JobPaths = {
  root: string;
  screenshotsDir: string;
  snapshotsDir: string;
  irDir: string;
  templatesDir: string;
  reportsDir: string;
  screenshot: (name: "desktop" | "tablet" | "mobile" | "full-page") => string;
  domSnapshot: string;
  cssSnapshot: string;
  layoutSnapshot: string;
  assetsSnapshot: string;
  mobileLayoutSnapshot: string;
  pageIR: string;
  templateJson: string;
  templateZip: string;
  analysisReport: string;
  validationReport: string;
  previewHtml: string;
  previewScreenshot: string;
  diffImage: string;
};

export function storagePaths(jobId: string, storageRoot?: string): JobPaths {
  const root = storageRoot || defaultStorageRoot();
  const screenshotsDir = path.join(root, "screenshots", jobId);
  const snapshotsDir = path.join(root, "snapshots", jobId);
  const irDir = path.join(root, "ir", jobId);
  const templatesDir = path.join(root, "templates", jobId);
  const reportsDir = path.join(root, "reports", jobId);
  return {
    root,
    screenshotsDir,
    snapshotsDir,
    irDir,
    templatesDir,
    reportsDir,
    screenshot: (name) => path.join(screenshotsDir, `${name}.png`),
    domSnapshot: path.join(snapshotsDir, "dom.json"),
    cssSnapshot: path.join(snapshotsDir, "css.json"),
    layoutSnapshot: path.join(snapshotsDir, "layout.json"),
    assetsSnapshot: path.join(snapshotsDir, "assets.json"),
    mobileLayoutSnapshot: path.join(snapshotsDir, "layout-mobile.json"),
    pageIR: path.join(irDir, "page-ir.json"),
    templateJson: path.join(templatesDir, "template.json"),
    templateZip: path.join(templatesDir, "template-kit.zip"),
    analysisReport: path.join(reportsDir, "analysis-report.json"),
    validationReport: path.join(reportsDir, "validation-report.json"),
    previewHtml: path.join(reportsDir, "preview.html"),
    previewScreenshot: path.join(reportsDir, "preview.png"),
    diffImage: path.join(reportsDir, "diff.png"),
  };
}

export function ensureJobDirs(paths: JobPaths): void {
  for (const dir of [paths.screenshotsDir, paths.snapshotsDir, paths.irDir, paths.templatesDir, paths.reportsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
