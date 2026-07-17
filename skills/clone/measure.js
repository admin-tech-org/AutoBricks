// AutoBricks 量測器 — 在 Playwright MCP 的 browser_evaluate 內執行。
// 用法：把整個函式貼進 browser_evaluate，參數換成該 section 根節點的 CSS selector；
//       結果大，一律用 filename 落到 .browser/tmp/measure-<section>.json 再讀重點。
// 回傳該子樹內所有「可見」元素的 tag/class/text/box（頁面座標）＋ computed style 白名單，
// 以及 ::before/::after 偽元素普查（content 非 none 才輸出——裝飾線/badge/overlay 常藏在這）。
// plan 裡的每個數字都應來自這裡（或同等量測），不准對著截圖目測。
// 注意 truncated 旗標：nodeLimitHit/depthLimitHit 為 true＝量測被上限截斷（深頁分多個
// section 量），count 到頂不代表「量完了」。
(rootSel) => {
  const WHITELIST = [
    "display", "position", "flex-direction", "flex-wrap", "justify-content", "align-items",
    "gap", "row-gap", "column-gap", "grid-template-columns", "grid-template-rows",
    "grid-auto-flow", "grid-auto-columns", "grid-auto-rows",
    "box-sizing", "min-width", "max-width", "min-height", "max-height",
    "top", "right", "bottom", "left",
    "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
    "white-space", "text-transform", "text-decoration-line", "text-overflow",
    "color", "background-color", "background-image",
    "background-size", "background-position", "background-repeat", "object-position",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "border-radius", "border-width", "border-style", "border-color", "box-shadow",
    "opacity", "z-index", "overflow", "object-fit", "aspect-ratio", "transform", "transition",
    "filter", "backdrop-filter", "clip-path", "mask-image", "mix-blend-mode",
  ];
  // 各屬性的預設值——等於這些就不輸出（防雜訊；normal/auto/none/0px 是共通預設）
  const SKIP = new Set(["normal", "auto", "none", "0px", "content-box", "repeat", "50% 50%", "auto auto", "clip"]);
  const root = document.querySelector(rootSel);
  if (!root) return { error: "not found: " + rootSel };
  const sx = window.scrollX, sy = window.scrollY;
  const out = [];
  let nodeLimitHit = false, depthLimitHit = false;
  const pickStyles = (cs) => {
    const style = {};
    for (const p of WHITELIST) {
      const v = cs.getPropertyValue(p);
      if (v && !SKIP.has(v)) style[p] = v;
    }
    return style;
  };
  const walk = (el, depth) => {
    if (depth > 14) { depthLimitHit = true; return; } // 防爆量：深頁分多個 section 量
    if (out.length > 400) { nodeLimitHit = true; return; }
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const style = pickStyles(cs);
    // ::before/::after 普查：content 有東西才輸出（裝飾線/badge/引號/overlay 的藏身處）
    const pseudo = {};
    for (const pe of ["::before", "::after"]) {
      const pcs = getComputedStyle(el, pe);
      const content = pcs.getPropertyValue("content");
      if (!content || content === "none" || pcs.display === "none") continue;
      pseudo[pe] = Object.assign({ content: content.slice(0, 60) }, pickStyles(pcs));
    }
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    out.push({
      tag: el.tagName.toLowerCase(),
      depth,
      cls: typeof el.className === "string" ? el.className.slice(0, 80) : "",
      text: ownText.slice(0, 160),
      src: el.tagName === "IMG" ? (el.currentSrc || el.src || "").slice(0, 300) : undefined,
      box: {
        x: Math.round(r.left + sx),
        y: Math.round(r.top + sy),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      style,
      pseudo: Object.keys(pseudo).length ? pseudo : undefined,
    });
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return {
    pageWidth: document.documentElement.scrollWidth,
    pageHeight: document.documentElement.scrollHeight,
    count: out.length,
    truncated: nodeLimitHit || depthLimitHit,
    nodeLimitHit,
    depthLimitHit,
    nodes: out,
  };
}
