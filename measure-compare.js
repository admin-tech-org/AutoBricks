/**
 * Element-delta measure + compare (SPEC §5.4 harness).
 *
 * Usage: node measure-compare.js <jobId> [pageUrl]
 *
 * Renders the WordPress page (default page 89) that currently shows <jobId>'s
 * pushed template, measures every #brxe-<id>'s box + computed style, then runs
 * the pure comparator (packages/validation) against that job's source page-ir +
 * provenance + source dims, and prints the trustworthy element-delta VisualScore.
 *
 * Requires: the job's template is currently pushed to the page, and the repo is
 * built (npx tsc -b) so packages/validation/dist exists.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { computeCorrespondence } = require("./packages/validation/dist/correspondence.js");

const jobId = process.argv[2];
const pageUrl = process.argv[3] || "http://localhost:8080/?page_id=89";
if (!jobId) {
  console.error("usage: node measure-compare.js <jobId> [pageUrl]");
  process.exit(1);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const ir = readJson(path.join("storage", "ir", jobId, "page-ir.json"));
const provenance = readJson(path.join("storage", "templates", jobId, "provenance.json"));
const layout = readJson(path.join("storage", "snapshots", jobId, "layout.json"));
const srcDims = { pageWidth: layout.pageWidth, pageHeight: layout.pageHeight };

const STYLE_PROPS = [
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "background-color",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(pageUrl, { waitUntil: "load", timeout: 60000 }).catch((e) => console.warn("goto:", e.message));
  await page.waitForTimeout(1000);
  // Scroll through to settle layout / trigger lazy content, then back to top.
  await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 40; i++) {
      const total = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      if (window.scrollY + window.innerHeight >= total - 2) break;
      window.scrollBy(0, window.innerHeight);
      await wait(80);
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);

  const rendered = await page.evaluate((styleProps) => {
    const out = {};
    const els = document.querySelectorAll('[id^="brxe-"]');
    const sx = window.scrollX || 0;
    const sy = window.scrollY || 0;
    els.forEach((el) => {
      const id = el.id.slice(5); // strip "brxe-"
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      const style = {};
      for (const p of styleProps) {
        const v = cs.getPropertyValue(p);
        if (v) style[p] = v;
      }
      out[id] = {
        box: { x: Math.round(r.left + sx), y: Math.round(r.top + sy), width: Math.round(r.width), height: Math.round(r.height) },
        style,
      };
    });
    return {
      pageWidth: Math.round(document.documentElement.scrollWidth),
      pageHeight: Math.round(document.documentElement.scrollHeight),
      elements: out,
    };
  }, STYLE_PROPS);

  await browser.close();

  const report = computeCorrespondence(ir, provenance, rendered, srcDims);
  const s = report.score;

  console.log("");
  console.log(`=== Element-delta comparison — job ${jobId} ===`);
  console.log(`source components: ${s.sourceCount}   matched: ${s.matchedCount} (${(s.matchedFraction * 100).toFixed(0)}%)   rendered elems: ${Object.keys(rendered.elements).length}`);
  console.log(`off-screen source elems excluded from geometry (carousel slides): ${s.offscreenExcluded}`);
  console.log(`unmatched source: ${report.unmatchedSource.length}   unmatched rendered (wrappers etc.): ${report.unmatchedRendered.length}`);
  console.log(`src page ${srcDims.pageWidth}x${srcDims.pageHeight}   rendered page ${rendered.pageWidth}x${rendered.pageHeight}`);
  console.log("");
  console.log(`OVERALL fidelity: ${s.overall}   (1.0 = perfect)`);
  console.log(`  position OK (|dX| ≤ 8% pg):  ${(s.positionGood * 100).toFixed(0)}%   (median |dX| ${s.xFracMedianAbs})`);
  console.log(`  size OK     (|dW| ≤ 10% pg): ${(s.sizeGood * 100).toFixed(0)}%   (median |dW| ${s.widthFracMedianAbs})`);
  console.log(`  font OK     (≤ 3px):         ${(s.fontSizeGood * 100).toFixed(0)}%   (median ${s.fontSizeMedianPx}px)`);
  console.log(`  colour OK   (ΔE ≤ 8):        ${(s.colorGood * 100).toFixed(0)}%   (median ΔE ${s.textColorDeltaEMedian})`);
  console.log("");
  console.log("worst 12 elements (by severity):");
  for (const d of report.matched.slice(0, 12)) {
    const f = d.styles.find((x) => x.prop === "font-size");
    const c = d.styles.find((x) => x.prop === "color");
    const txt = (d.match.text || d.match.type || "").replace(/\s+/g, " ").slice(0, 24);
    const dw = d.box ? d.box.dwFrac.toFixed(3) : "-";
    const dx = d.box ? d.box.dxFrac.toFixed(3) : "-";
    const df = f && f.deltaPx !== undefined ? `${f.deltaPx}px` : "-";
    const dce = c && c.deltaE !== undefined ? c.deltaE.toFixed(1) : "-";
    console.log(`  [${d.severity.toFixed(2)}] ${d.match.type.padEnd(8)} dW=${dw} dX=${dx} font=${df} ΔE=${dce}  "${txt}"`);
  }
})();
