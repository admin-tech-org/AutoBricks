/**
 * Bricks generator types.
 *
 * The wire-level output types (BricksElement / BricksTemplate) live in the
 * shared "@bricks-cdp/ir" contract and are re-exported here for convenience.
 * This module adds the *internal* planning types used between the Bricks
 * Planner (map-section.ts) and the Bricks JSON Generator (generate-json.ts).
 */

export type {
  BricksElement,
  BricksTemplate,
  AllowedElementName,
  JsonValidationResult,
} from "@bricks-cdp/ir";

export { ALLOWED_ELEMENTS } from "@bricks-cdp/ir";

import type { AllowedElementName } from "@bricks-cdp/ir";

/**
 * A node in the Bricks plan tree produced by the planner (ARCHITECTURE §13).
 *
 * The plan is a *nested* tree — real element ids are only assigned when the
 * tree is flattened into the Bricks content array (generate-json.ts).
 * `idHint` is a human-readable slug hint ("sec_hero", "col_left", "hdg", ...)
 * used by the "readable" id style; the IdFactory guarantees uniqueness.
 */
export type BricksPlanNode = {
  name: AllowedElementName;
  settings: Record<string, unknown>;
  children: BricksPlanNode[];
  idHint?: string;
  /** Source ComponentIR id this node was built from — carried through flatten
   *  into a brxeId → irId provenance map so the element-delta comparator
   *  (validation/correspondence.ts) can align rendered elements to source. */
  irId?: string;
};
