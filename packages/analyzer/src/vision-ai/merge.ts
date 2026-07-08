/**
 * Merge validated vision-AI verdicts back into the Page IR.
 *
 * Operates on a deep clone (caller supplies it). Vision wins for appearance
 * (§22: Color / Theme style come from the screenshot); DOM-sourced text/links
 * are never touched. Every write is defensive — a missing field just leaves the
 * heuristic value in place.
 */

import type {
  ComponentIR,
  PageIR,
  SectionIR,
  VisionAIGlobalResult,
  VisionAISectionResult,
  VisionAITypography,
} from "@bricks-cdp/ir";

function setStyle(target: { style?: Record<string, string> }, key: string, value: string): void {
  if (!target.style) target.style = {};
  target.style[key] = value;
}

function applyTypography(comp: ComponentIR, t: VisionAITypography): void {
  if (t.fontSizePx !== undefined) setStyle(comp, "fontSize", `${t.fontSizePx}px`);
  if (t.fontWeight !== undefined) setStyle(comp, "fontWeight", String(t.fontWeight));
  if (t.lineHeight !== undefined) setStyle(comp, "lineHeight", String(t.lineHeight));
  if (t.letterSpacingPx !== undefined) setStyle(comp, "letterSpacing", `${t.letterSpacingPx}px`);
  if (t.color) setStyle(comp, "color", t.color);
  if (t.textAlign) setStyle(comp, "textAlign", t.textAlign);
  if (t.textTransform) setStyle(comp, "textTransform", t.textTransform);
}

/** Depth-first walk of every component in a section. */
function walkComps(children: ComponentIR[], fn: (c: ComponentIR) => void): void {
  for (const c of children) {
    fn(c);
    if (c.children && c.children.length > 0) walkComps(c.children, fn);
  }
}

/** Remove the nth (1-based) matching component from the tree; nth undefined = all matches. */
function removeMatching(
  children: ComponentIR[],
  pred: (c: ComponentIR) => boolean,
  nth?: number
): number {
  let seen = 0;
  let removed = 0;
  const recurse = (list: ComponentIR[]): ComponentIR[] => {
    const kept: ComponentIR[] = [];
    for (const c of list) {
      if (pred(c)) {
        seen++;
        if (nth === undefined || seen === nth) {
          removed++;
          continue; // drop it (and its subtree)
        }
      }
      if (c.children && c.children.length > 0) c.children = recurse(c.children);
      kept.push(c);
    }
    return kept;
  };
  const result = recurse(children);
  children.length = 0;
  children.push(...result);
  return removed;
}

function applySection(section: SectionIR, r: VisionAISectionResult): void {
  // Background
  if (r.background) {
    const bg = r.background;
    if (bg.kind === "solid" && bg.color) {
      setStyle(section, "backgroundColor", bg.color);
      if (section.style) delete section.style.backgroundImage;
    } else if (bg.kind === "gradient" && bg.gradientCss) {
      setStyle(section, "backgroundImage", bg.gradientCss);
      if (bg.color) setStyle(section, "backgroundColor", bg.color);
    } else if (bg.kind === "image" && bg.imageUrl) {
      setStyle(section, "backgroundImage", `url(${bg.imageUrl})`);
      if (bg.color) setStyle(section, "backgroundColor", bg.color);
    }
  }

  // Body text color hint (planner/theme inherit it)
  if (r.textColor) setStyle(section, "color", r.textColor);

  // Layout
  if (r.layout) {
    if (r.layout.type) section.layout = r.layout.type;
    section.layoutHints = { ...(section.layoutHints || {}), ...r.layout };
    if (r.layout.paddingTopPx !== undefined) setStyle(section, "paddingTop", `${r.layout.paddingTopPx}px`);
    if (r.layout.paddingBottomPx !== undefined) setStyle(section, "paddingBottom", `${r.layout.paddingBottomPx}px`);
  }

  // Typography by styleRole ("body" = unroled text)
  if (r.typography) {
    for (const [role, t] of Object.entries(r.typography)) {
      walkComps(section.children, (c) => {
        const matches = role === "body" ? c.type === "text" && !c.styleRole : c.styleRole === role;
        if (matches) applyTypography(c, t);
      });
    }
  }

  // Buttons
  if (r.buttons) {
    for (const b of r.buttons) {
      walkComps(section.children, (c) => {
        if (c.type !== "button") return;
        if (b.textStartsWith) {
          const label = (c.text || "").toLowerCase();
          if (!label.startsWith(b.textStartsWith.toLowerCase())) return;
        }
        if (b.backgroundColor) setStyle(c, "backgroundColor", b.backgroundColor);
        if (b.color) setStyle(c, "color", b.color);
        if (b.radiusPx !== undefined) setStyle(c, "borderRadius", `${b.radiusPx}px`);
        if (b.borderColor) setStyle(c, "border", `${b.borderWidthPx ?? 1}px solid ${b.borderColor}`);
        if (b.paddingXPx !== undefined) {
          setStyle(c, "paddingLeft", `${b.paddingXPx}px`);
          setStyle(c, "paddingRight", `${b.paddingXPx}px`);
        }
        if (b.paddingYPx !== undefined) {
          setStyle(c, "paddingTop", `${b.paddingYPx}px`);
          setStyle(c, "paddingBottom", `${b.paddingYPx}px`);
        }
        if (b.fontSizePx !== undefined) setStyle(c, "fontSize", `${b.fontSizePx}px`);
        if (b.fontWeight !== undefined) setStyle(c, "fontWeight", String(b.fontWeight));
      });
    }
  }

  // Fixes (drop / restyle). A hallucinated broad drop must never empty the
  // section — normalizeIR prunes zero-child sections, which would silently
  // delete real content. Snapshot the top-level children and restore if the
  // drops emptied them.
  if (r.fixes) {
    const topLevelSnapshot = [...section.children];
    for (const f of r.fixes) {
      const pred = (c: ComponentIR): boolean => {
        if (f.match.type && c.type !== f.match.type) return false;
        if (f.match.styleRole && c.styleRole !== f.match.styleRole) return false;
        if (f.match.textStartsWith) {
          const label = (c.text || "").toLowerCase();
          if (!label.startsWith(f.match.textStartsWith.toLowerCase())) return false;
        }
        return true;
      };
      if (f.action === "drop") {
        removeMatching(section.children, pred, f.match.nth);
      } else if (f.action === "restyle" && f.style) {
        let seen = 0;
        walkComps(section.children, (c) => {
          if (!pred(c)) return;
          seen++;
          if (f.match.nth !== undefined && seen !== f.match.nth) return;
          c.style = { ...(c.style || {}), ...f.style };
        });
      }
    }
    if (section.children.length === 0 && topLevelSnapshot.length > 0) {
      section.children.push(...topLevelSnapshot);
    }
  }
}

function applyGlobal(ir: PageIR, g: VisionAIGlobalResult): void {
  const theme = ir.theme || (ir.theme = {});
  const font = g.fontStack || g.fontFamily;
  if (font) theme.fontFamily = font;
  if (g.primaryColor) theme.primaryColor = g.primaryColor;
  if (g.backgroundColor) theme.backgroundColor = g.backgroundColor;
  if (g.textColor) theme.textColor = g.textColor;
  if (g.mutedTextColor) theme.mutedTextColor = g.mutedTextColor;
  if (g.mode) theme.mode = g.mode;
  if (g.radiusPx !== undefined) theme.radius = `${g.radiusPx}px`;
}

/** Apply all vision verdicts to a (already cloned) PageIR, in place. */
export function applyVisionAI(
  ir: PageIR,
  sectionResults: VisionAISectionResult[],
  global?: VisionAIGlobalResult
): void {
  if (global) applyGlobal(ir, global);
  const byId = new Map(ir.sections.map((s) => [s.id, s]));
  for (const r of sectionResults) {
    const section = byId.get(r.sectionId);
    if (section) applySection(section, r);
  }
}
