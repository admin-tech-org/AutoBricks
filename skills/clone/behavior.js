// AutoBricks 行為普查器 — 在 Playwright MCP 的 browser_evaluate 內執行（回傳 Promise，觀測窗約 2 秒）。
// 用法：把整個函式貼進 browser_evaluate，參數換成該 section 根節點的 CSS selector（全頁普查用 "body"）；
//       結果大，一律用 filename 落到 .browser/tmp/behavior-<section>.json 再讀重點。
// 定位：measure.js 量「長什麼樣」，本檔量「會做什麼」——視覺只存在於截圖裡，行為只存在於這份清單裡。
// 回傳五類證據：
//   1. animations  — 正在跑的 CSS animation/transition/WAAPI（iterations=Infinity＝常駐動畫）
//   2. keyframes / animRules / hoverRules — CSSOM 宣告層（computed 讀不到的設計意圖：hover、入場、marquee）
//   3. interactive — 可點/可展開/表單/已知程式庫 data- 指紋的元素盤點
//   4. libs        — 全域 JS 程式庫指紋（Swiper/GSAP/AOS…＝原站行為的實作線索）
//   5. hotspots    — 觀測窗內無互動也在變的 DOM 熱點（輪播/跑馬燈/計數器抓漏網）
// 鐵則：這份清單的每一項都必須登錄進該區 plan 的 dynamic_tests，或明列排除理由——
//       普查有、合約沒有＝該行為不會被驗＝克隆等於沒做。
(rootSel) =>
  new Promise((resolve) => {
    const root = document.querySelector(rootSel);
    if (!root) return resolve({ error: "not found: " + rootSel });

    const brief = (el) => {
      let s = el.tagName.toLowerCase();
      if (el.id) s += "#" + el.id;
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      if (cls) s += "." + cls;
      const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
      return t ? s + ' "' + t + '"' : s;
    };

    // 1) 執行中的動畫（getAnimations 連 WAAPI/JS 驅動的都抓得到）
    const animations = (document.getAnimations ? document.getAnimations({ subtree: true }) : [])
      .filter((a) => a.effect && a.effect.target && root.contains(a.effect.target))
      .slice(0, 60)
      .map((a) => {
        const t = a.effect.getTiming();
        return {
          type: a.constructor.name, // CSSAnimation / CSSTransition / Animation
          name: a.animationName || a.transitionProperty || "",
          target: brief(a.effect.target),
          duration: t.duration,
          delay: t.delay || 0,
          easing: t.easing,
          iterations: t.iterations === Infinity ? "Infinity" : t.iterations,
          playState: a.playState,
        };
      });

    // 2) CSSOM 宣告層：@keyframes 全名單＋子樹內命中的 animation/transition 與 :hover 規則
    //    （精確 px/色值以量測為準；旋轉/hover/入場這類「意圖」以這裡的宣告為準）
    const keyframes = [], animRules = [], hoverRules = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // 跨網域 stylesheet 讀不到，略過
      for (const r of rules || []) {
        if (keyframes.length >= 40 && animRules.length >= 60 && hoverRules.length >= 60) break;
        if (r.type === CSSRule.KEYFRAMES_RULE) {
          if (keyframes.length < 40) keyframes.push({ name: r.name, css: r.cssText.slice(0, 500) });
        } else if (r.type === CSSRule.STYLE_RULE) {
          const sel = r.selectorText || "";
          if (sel.includes(":hover") && hoverRules.length < 60) {
            const base = sel.replace(/:hover/g, "").trim();
            try {
              if (base && (root.matches(base) || root.querySelector(base)))
                hoverRules.push({ selector: sel.slice(0, 120), css: r.style.cssText.slice(0, 300) });
            } catch {}
          } else if (/(?:^|;|\s)(animation|transition)/.test(r.style.cssText) && animRules.length < 60) {
            try {
              if (root.matches(sel) || root.querySelector(sel))
                animRules.push({ selector: sel.slice(0, 120), css: r.style.cssText.slice(0, 300) });
            } catch {}
          }
        }
      }
    }

    // 3) 互動元素盤點（含已知輪播/動畫程式庫的 class 與 data- 指紋）
    const INTERACTIVE_SEL = [
      "a[href]", "button", "[onclick]", '[role="button"]', '[role="tab"]', "[aria-expanded]",
      "[aria-haspopup]", "[aria-controls]", "summary", "input", "select", "textarea", "form",
      "video", "audio", "dialog", ".swiper", ".splide", ".slick-slider", ".glide", "[data-aos]",
      "[data-swiper]", "[data-splide]", "[data-countup]", "[data-lottie]",
    ].join(", ");
    const interactive = [];
    for (const el of root.querySelectorAll(INTERACTIVE_SEL)) {
      if (interactive.length >= 120) break;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue; // 隱藏的互動元素（選單內容等）由展開測試自己驗
      const attrs = {};
      for (const a of ["role", "aria-expanded", "aria-controls", "aria-haspopup", "type", "href", "data-aos"])
        if (el.hasAttribute(a)) attrs[a] = (el.getAttribute(a) || "").slice(0, 80);
      interactive.push({
        target: brief(el),
        tag: el.tagName.toLowerCase(),
        cursor: getComputedStyle(el).cursor,
        onclick: el.hasAttribute("onclick") || undefined,
        attrs: Object.keys(attrs).length ? attrs : undefined,
      });
    }

    // 4) 全域 JS 程式庫指紋（原站怎麼實作＝我方選階梯層的線索：有 Swiper→slider-nested、有 AOS→_interactions…）
    const LIB_NAMES = ["Swiper", "Splide", "Glide", "Flickity", "gsap", "ScrollTrigger", "AOS",
      "Alpine", "jQuery", "lottie", "CountUp", "Lenis", "barba", "anime"];
    const libs = LIB_NAMES.filter((n) => typeof window[n] !== "undefined");

    // 5) 自主動態熱點：觀測 ~2 秒，無互動也在變的節點（輪播自動播放、跑馬燈、倒數、計數器）
    const hot = new Map();
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!el) continue;
        const k = brief(el);
        const rec = hot.get(k) || { count: 0, kinds: new Set() };
        rec.count++;
        rec.kinds.add(m.type + (m.attributeName ? ":" + m.attributeName : ""));
        hot.set(k, rec);
      }
    });
    mo.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });

    setTimeout(() => {
      mo.disconnect();
      const hotspots = [...hot.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 20)
        .map(([k, v]) => ({ target: k, mutations: v.count, kinds: [...v.kinds].slice(0, 5) }));
      resolve({
        rootSel,
        counts: {
          animations: animations.length, keyframes: keyframes.length, animRules: animRules.length,
          hoverRules: hoverRules.length, interactive: interactive.length, hotspots: hotspots.length,
        },
        animations, keyframes, animRules, hoverRules, interactive, libs, hotspots,
      });
    }, 2000);
  })
