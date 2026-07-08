/**
 * JSON writers for the export stage (ARCHITECTURE §19 storage layout).
 */

import * as fs from "fs";
import * as path from "path";
import type { BricksTemplate } from "@bricks-cdp/ir";
import type { JobPaths } from "./paths";

/**
 * Write any value as pretty-printed JSON, creating parent directories as
 * needed. Returns the absolute file path written.
 */
export function writeJson(filePath: string, data: unknown): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  return filePath;
}

/** Write the generated Bricks template to <templates>/<jobId>/template.json. */
export function writeTemplateJson(paths: JobPaths, template: BricksTemplate): string {
  return writeJson(paths.templateJson, template);
}
