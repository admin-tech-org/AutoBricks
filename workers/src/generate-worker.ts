/**
 * Generate Worker (ARCHITECTURE §20).
 *
 * Reads the Page IR produced by the analyze stage, generates the flat Bricks
 * content array, validates it against the JSON validator (a template that
 * fails its own validator must never be exported) and writes
 * template.json + template-kit.zip.
 */
import * as fs from "fs";
import * as path from "path";
import { AnalysisResult, GenerateResult, StageContext } from "@bricks-cdp/ir";
import { generateBricksJson, validateBricksJson } from "@bricks-cdp/bricks";
import { storagePaths, writeTemplateJson, writeTemplateZip } from "@bricks-cdp/export";

export type GenerateStageOptions = {
  idStyle?: "readable" | "bricks";
};

export async function runGenerateStage(
  ctx: StageContext,
  analysis: AnalysisResult,
  opts?: GenerateStageOptions
): Promise<GenerateResult> {
  const provenance: Record<string, string> = {};
  const template = generateBricksJson(analysis.pageIR, {
    idStyle: opts?.idStyle,
    sourceUrl: ctx.url,
    provenanceOut: provenance,
  });

  const jsonValidation = validateBricksJson(template);
  if (!jsonValidation.valid) {
    throw new Error(
      `generated Bricks JSON failed validation (${jsonValidation.errors.length} error(s)): ` +
        jsonValidation.errors.join("; ")
    );
  }

  const paths = storagePaths(ctx.jobId, ctx.storageRoot);
  await writeTemplateJson(paths, template);
  await writeTemplateZip(paths);

  // brxeId -> source ComponentIR id, next to template.json. Consumed by the
  // element-delta comparator (validation/correspondence.ts) to align the
  // rendered #brxe-<id> elements back to their source boxes/styles in page-ir.json.
  const provenancePath = path.join(path.dirname(paths.templateJson), "provenance.json");
  await fs.promises.writeFile(provenancePath, JSON.stringify(provenance), "utf8");

  return {
    template,
    jsonValidation,
    savedPaths: {
      templateJson: paths.templateJson,
      templateZip: paths.templateZip,
    },
  };
}
