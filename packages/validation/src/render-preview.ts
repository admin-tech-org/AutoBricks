/**
 * Preview renderer.
 *
 * NOTE (ARCHITECTURE §17 Visual Validator / MVP 3): the "real" flow renders the
 * generated Bricks JSON inside a WordPress/Bricks staging site and screenshots
 * that. This module is the MVP stand-in: it builds a standalone HTML string
 * that approximates how Bricks renders the flat content array, writes it to
 * reports/<jobId>/preview.html and screenshots it locally. Swap renderPreview()
 * for the staging-site renderer later without touching the rest of the pipeline.
 */

import * as fs from "fs";
import * as path from "path";
import { screenshotHtmlFile } from "@bricks-cdp/capture";
import type { BricksElement, BricksTemplate, PageIR, StageContext } from "@bricks-cdp/ir";

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : undefined;
}

function asStr(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim() !== "") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** Escape text for safe use in HTML text nodes and attribute values. */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "16" -> "16px", "1.5" -> "1.5px"?? no: bare numbers become px, everything else passes through. */
function cssLen(v: unknown): string {
  const s = String(v).trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? `${s}px` : s;
}

/** Bricks side-box setting ({ top, right, bottom, left }) -> margin/padding declarations. */
function sideBoxCss(prop: "padding" | "margin", v: unknown): string[] {
  const r = asRec(v);
  if (!r) return [];
  const out: string[] = [];
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const raw = r[side];
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      out.push(`${prop}-${side}:${cssLen(raw)}`);
    }
  }
  return out;
}

/** _typography -> css declarations. */
function typographyCss(v: unknown): string[] {
  const t = asRec(v);
  if (!t) return [];
  const out: string[] = [];
  const ff = asStr(t["font-family"] ?? t["fontFamily"]);
  if (ff) out.push(`font-family:${ff}`);
  const fs_ = t["font-size"] ?? t["fontSize"];
  if (asStr(fs_)) out.push(`font-size:${cssLen(fs_)}`);
  const fw = asStr(t["font-weight"] ?? t["fontWeight"]);
  if (fw) out.push(`font-weight:${fw}`);
  const lh = t["line-height"] ?? t["lineHeight"];
  if (asStr(lh)) out.push(`line-height:${String(lh).trim()}`);
  const hex = asStr(asRec(t["color"])?.["hex"]);
  if (hex) out.push(`color:${hex}`);
  const ta = asStr(t["text-align"] ?? t["textAlign"]);
  if (ta) out.push(`text-align:${ta}`);
  return out;
}

/** Derive inline CSS for one Bricks element from its settings. */
function styleFor(el: BricksElement, ir: PageIR): string {
  const s: Rec = asRec(el.settings) ?? {};
  const css: string[] = [];

  css.push(...typographyCss(s["_typography"]));

  const bgHex = asStr(asRec(asRec(s["_background"])?.["color"])?.["hex"]);
  if (bgHex) css.push(`background-color:${bgHex}`);

  css.push(...sideBoxCss("padding", s["_padding"]));
  css.push(...sideBoxCss("margin", s["_margin"]));

  const isLayout = el.name === "section" || el.name === "container" || el.name === "block";
  const direction = asStr(s["_direction"]);
  const justify = asStr(s["_justifyContent"]);
  const align = asStr(s["_alignItems"]);
  const colGap = s["_columnGap"];
  const rowGap = s["_rowGap"];
  const wrap = asStr(s["_flexWrap"]);
  if (isLayout && (direction || justify || align || asStr(colGap) || asStr(rowGap) || wrap)) {
    css.push("display:flex");
    css.push(`flex-direction:${direction || "column"}`);
    if (justify) css.push(`justify-content:${justify}`);
    if (align) css.push(`align-items:${align}`);
    if (asStr(colGap)) css.push(`column-gap:${cssLen(colGap)}`);
    if (asStr(rowGap)) css.push(`row-gap:${cssLen(rowGap)}`);
    if (wrap) css.push(`flex-wrap:${wrap}`);
  }

  if (asStr(s["_width"])) css.push(`width:${cssLen(s["_width"])}`);
  if (asStr(s["_widthMax"])) {
    css.push(`max-width:${cssLen(s["_widthMax"])}`);
  } else if (el.name === "container") {
    // Bricks containers are centered with a theme max-width by default.
    css.push(`max-width:${cssLen(ir.theme.containerMaxWidth ?? "1200px")}`);
  }
  if (el.name === "container" && !asRec(s["_margin"])) css.push("margin:0 auto");

  const radius = asRec(s["_border"])?.["radius"];
  const rr = asRec(radius);
  if (rr) {
    const tl = cssLen(rr["top"] ?? 0);
    const tr = cssLen(rr["right"] ?? 0);
    const br = cssLen(rr["bottom"] ?? 0);
    const bl = cssLen(rr["left"] ?? 0);
    css.push(`border-radius:${tl} ${tr} ${br} ${bl}`);
  }

  const shadow = asRec(s["_boxShadow"]);
  const sv = asRec(shadow?.["values"]);
  if (sv) {
    const hex = asStr(asRec(shadow?.["color"])?.["hex"]) ?? "rgba(0,0,0,0.15)";
    css.push(
      `box-shadow:${cssLen(sv["offsetX"] ?? 0)} ${cssLen(sv["offsetY"] ?? 0)} ${cssLen(sv["blur"] ?? 0)} ${cssLen(sv["spread"] ?? 0)} ${hex}`
    );
  }

  return css.join(";");
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function renderElement(el: BricksElement, byId: Map<string, BricksElement>, ir: PageIR): string {
  const s: Rec = asRec(el.settings) ?? {};
  const style = styleFor(el, ir);
  const styleAttr = style ? ` style="${esc(style)}"` : "";
  const childrenHtml = (el.children || [])
    .map((id) => byId.get(id))
    .filter((c): c is BricksElement => !!c)
    .map((c) => renderElement(c, byId, ir))
    .join("\n");

  switch (el.name) {
    case "section":
      return `<section${styleAttr}>${childrenHtml}</section>`;
    case "container":
    case "block":
      return `<div${styleAttr}>${childrenHtml}</div>`;
    case "heading": {
      const rawTag = asStr(s["tag"])?.toLowerCase() ?? "h2";
      const tag = HEADING_TAGS.has(rawTag) ? rawTag : "h2";
      return `<${tag}${styleAttr}>${esc(asStr(s["text"]) ?? "")}</${tag}>`;
    }
    case "text-basic":
    case "text":
      return `<p${styleAttr}>${esc(asStr(s["text"]) ?? "")}</p>`;
    case "button": {
      const href = asStr(asRec(s["link"])?.["url"]) ?? "#";
      return `<a class="btn" href="${esc(href)}"${styleAttr}>${esc(asStr(s["text"]) ?? "")}</a>`;
    }
    case "image": {
      const img = asRec(s["image"]);
      const src = asStr(img?.["url"]) ?? asStr(img?.["external"]) ?? asStr(s["src"]) ?? "";
      const alt = asStr(s["altText"]) ?? asStr(img?.["alt"]) ?? "";
      return `<img src="${esc(src)}" alt="${esc(alt)}"${styleAttr}>`;
    }
    case "icon":
      return `<span class="icon"${styleAttr}>&#9670;</span>`;
    case "divider":
      return `<hr${styleAttr}>`;
    default:
      // Unknown element: render as a neutral wrapper so children still show.
      return `<div${styleAttr}>${childrenHtml}</div>`;
  }
}

/**
 * Build a standalone HTML document approximating the Bricks rendering of the
 * flat content array (MVP stand-in for the WordPress staging preview).
 */
export function renderPreviewHtml(template: BricksTemplate, ir: PageIR): string {
  const content = Array.isArray(template.content) ? template.content : [];
  const byId = new Map<string, BricksElement>();
  for (const el of content) byId.set(el.id, el);
  const roots = content.filter((el) => el.parent === 0);
  const body = roots.map((el) => renderElement(el, byId, ir)).join("\n");

  const bodyBg = ir.theme.backgroundColor ?? "#ffffff";
  const bodyColor = ir.theme.textColor ?? "#111111";
  const bodyFont =
    ir.theme.fontFamily ??
    "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const primary = ir.theme.primaryColor ?? "#333333";

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(ir.url)} — generated preview</title>`,
    "<style>",
    "*,*::before,*::after{box-sizing:border-box}",
    `body{margin:0;background:${esc(bodyBg)};color:${esc(bodyColor)};font-family:${esc(bodyFont)}}`,
    "img{max-width:100%;height:auto;display:block}",
    "h1,h2,h3,h4,h5,h6,p{margin:0 0 0.5em}",
    `.btn{display:inline-block;padding:12px 24px;background:${esc(primary)};color:#ffffff;text-decoration:none;border-radius:8px}`,
    "hr{border:none;border-top:1px solid rgba(128,128,128,0.35);width:100%}",
    ".icon{display:inline-block}",
    "</style>",
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * Write preview.html for the job and screenshot it (1440x900, full page).
 * Storage layout mirrors packages/export/src/paths.ts:
 *   <storageRoot>/reports/<jobId>/{preview.html, preview.png}
 */
export async function renderPreview(
  ctx: StageContext,
  template: BricksTemplate,
  ir: PageIR
): Promise<{ htmlPath: string; screenshotPath: string }> {
  const reportsDir = path.join(ctx.storageRoot, "reports", ctx.jobId);
  fs.mkdirSync(reportsDir, { recursive: true });
  const htmlPath = path.join(reportsDir, "preview.html");
  const screenshotPath = path.join(reportsDir, "preview.png");
  fs.writeFileSync(htmlPath, renderPreviewHtml(template, ir), "utf8");
  await screenshotHtmlFile(htmlPath, screenshotPath, { width: 1440, height: 900 }, true);
  return { htmlPath, screenshotPath };
}
