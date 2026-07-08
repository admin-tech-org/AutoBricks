/**
 * Component classification (ARCHITECTURE §21).
 *
 * The per-node rules (heading / button / image / icon / divider / text with
 * the "no classified descendant" constraint, hero-title selection and
 * header/footer nav collapsing) are implemented once in
 * @bricks-cdp/ir/merge-dom-vision — the ir package cannot depend on the
 * analyzer, and mergeDomVision needs them to build ComponentIR children.
 * This module re-exports them and provides the analyzer-facing drivers.
 */

import type {
  ComponentIR,
  CssSnapshot,
  DomSnapshot,
  LayoutSnapshot,
  VisionSection,
} from "@bricks-cdp/ir";
import { classifyDomNode, classifyNodes, hasButtonStyling } from "@bricks-cdp/ir";

export { classifyDomNode, classifyNodes, hasButtonStyling };
export type { ClassifyOptions, ClassifyNodesOptions } from "@bricks-cdp/ir";

/**
 * Classify every visible DOM node of the page into a flat ComponentIR list
 * in reading order. Useful standalone (fallback "content" section) and for
 * unit tests.
 */
export function classifyComponents(
  dom: DomSnapshot,
  css: CssSnapshot,
  layout: LayoutSnapshot
): ComponentIR[] {
  const visible = dom.nodes.filter((n) => n.visible);
  return classifyNodes(visible, dom, css, layout, { pageWidth: layout.pageWidth });
}

/**
 * Classify only the nodes belonging to one vision section (node center-y
 * inside the section band). Applies the header/footer nav-list rule.
 */
export function classifySectionComponents(
  section: VisionSection,
  dom: DomSnapshot,
  css: CssSnapshot,
  layout: LayoutSnapshot
): ComponentIR[] {
  const band = section.box;
  const nodes = dom.nodes.filter((n) => {
    if (!n.visible) return false;
    if (!band) return true;
    const b = layout.boxes[n.id] || n.box;
    const cy = b.y + b.height / 2;
    return cy >= band.y && cy < band.y + band.height;
  });
  return classifyNodes(nodes, dom, css, layout, {
    sectionType: section.type,
    pageWidth: layout.pageWidth,
  });
}

/** Count components including nested block children. */
export function countComponents(comps: ComponentIR[]): number {
  let total = 0;
  for (const c of comps) {
    total += 1;
    if (c.children && c.children.length > 0) total += countComponents(c.children);
  }
  return total;
}
