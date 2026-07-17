// AutoBricks 行為普查器 — 在 Playwright MCP 的 browser_evaluate 內執行（回傳 Promise，觀測窗約 2 秒）。
// 用法：把整個函式貼進 browser_evaluate，參數換成該 section 根節點的 CSS selector（全頁普查用 "body"）；
//       結果大，一律用 filename 落到 .browser/tmp/behavior-<section>.json 再讀重點。
// 定位：measure.js 量「長什麼樣」，本檔量「會做什麼」——視覺只存在於截圖裡，行為只存在於這份清單裡。
// 回傳七類證據：
//   1. animations  — 正在跑的 CSS animation/transition/WAAPI（iterations=Infinity＝常駐動畫）
//   2. keyframes / animRules / hoverRules — CSSOM 宣告層（computed 讀不到的設計意圖：hover、入場、marquee；
//                    跨網域 stylesheet 受 CORS 讀不到——那半邊由 parse_css.py 離線普查補）
//   3. interactive — 可點/可展開/表單/已知程式庫 data- 指紋的元素盤點（特徵推測，候選名單）
//   4. libs        — 全域 JS 程式庫指紋（Swiper/GSAP/AOS…＝原站行為的實作線索）
//   5. hotspots    — 觀測窗內無互動也在變的 DOM 熱點（輪播/跑馬燈/計數器抓漏網）
//   6. handlers/ioTargets ＋ page.{globalHandlers,timers,rafDelta} — spy 帳本（Phase 1「載入前」
//                    注入 spy.js 才有）。語意是「登記史」：曾登記過、不保證此刻仍活躍（timer 被
//                    clear 會標記 cleared）。handlers/ioTargets 是元素級（可歸屬本區）；page.* 是
//                    全頁級——只在全局普查過帳一次，逐區歸屬要靠 sweep/Mutation 相關性，別讓同一顆
//                    全域 timer 在每區重複產生義務。spyInjected:false＝沒注入；spyLate:true＝事後注入。
//   7. handlers 內 source:"react"/"jquery" — 框架名冊（React fiber props 繞過事件委派逐顆列
//                    onClick/onMouseEnter；jQuery $._data 含委派 selector）——不需 spy 注入也能讀
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

    // brief 給人看、會撞名（兩張同款卡片同 brief）；path 給機器定位：id 短路，否則 nth-of-type 路徑
    const path = (el) => {
      if (!el || el.nodeType !== 1) return "";
      const segs = [];
      let n = el;
      for (let d = 0; n && n.nodeType === 1 && d < 5; d++) {
        if (n.id) { segs.unshift("#" + n.id); break; }
        let i = 1, s = n;
        while ((s = s.previousElementSibling)) if (s.tagName === n.tagName) i++;
        segs.unshift(n.tagName.toLowerCase() + ":nth-of-type(" + i + ")");
        n = n.parentElement;
      }
      return segs.join(" > ");
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
    const mediaOf = (r) => { // 規則所在的 @media 條件（可能巢狀在 @media/@supports 裡）
      for (let p = r.parentRule; p; p = p.parentRule) if (p.media) return p.media.mediaText;
      return "";
    };
    for (const sheet of document.styleSheets) {
      let top;
      try { top = sheet.cssRules; } catch { continue; } // 跨網域 stylesheet 讀不到，略過（parse_css.py 離線補）
      const stack = [...(top || [])];
      while (stack.length) {
        const r = stack.shift();
        if (keyframes.length >= 40 && animRules.length >= 60 && hoverRules.length >= 60) break;
        if (r.type === CSSRule.KEYFRAMES_RULE) {
          if (keyframes.length < 40) keyframes.push({ name: r.name, css: r.cssText.slice(0, 500) });
        } else if (r.cssRules && r.cssRules.length) {
          stack.push(...r.cssRules); // @media/@supports/@layer 群組要下探——只掃第一層會漏掉斷點內的 hover
        } else if (r.type === CSSRule.STYLE_RULE) {
          const sel = r.selectorText || "";
          const mq = mediaOf(r);
          if (sel.includes(":hover") && hoverRules.length < 60) {
            const base = sel.replace(/:hover/g, "").trim();
            try {
              if (base && (root.matches(base) || root.querySelector(base)))
                hoverRules.push({ selector: sel.slice(0, 120), css: r.style.cssText.slice(0, 300), ...(mq ? { media: mq } : {}) });
            } catch {}
          } else if (/(?:^|;|\s)(animation|transition)/.test(r.style.cssText) && animRules.length < 60) {
            try {
              if (root.matches(sel) || root.querySelector(sel))
                animRules.push({ selector: sel.slice(0, 120), css: r.style.cssText.slice(0, 300), ...(mq ? { media: mq } : {}) });
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

    // 6) spy 帳本（Phase 1 若已「載入前」注入 spy.js——執行期登記的事實；沒注入＝空，靠 sweep 保底）
    const spyRaw = window.__abSpy || null;
    const raf0 = spyRaw ? spyRaw.rafCount : 0; // 觀測窗前後相減＝rAF 活躍度
    const handlers = [];       // 元素級（在本區內）——可直接歸屬本區的證據
    const globalHandlers = []; // window/document/body 級——全頁級訊號，只在全局普查過帳
    const seenHandler = new Set();
    const pushHandler = (el, types, source) => {
      if (!el || !types.length || handlers.length + globalHandlers.length >= 140) return;
      const isGlobal = el === window || el === document || el === document.documentElement || el === document.body;
      if (!isGlobal) {
        try {
          if (el.nodeType !== 1 || !el.isConnected || !root.contains(el)) return;
        } catch { return; }
      }
      const target = el === window ? "window" : el === document ? "document" : brief(el);
      const key = source + "|" + target + "|" + types.join(",");
      if (seenHandler.has(key)) return;
      seenHandler.add(key);
      if (isGlobal) globalHandlers.push({ target, types, source });
      else handlers.push({ target, selector: path(el), types, source });
    };
    if (spyRaw) {
      const byEl = new Map();
      for (const rec of spyRaw.listeners) {
        if (!byEl.has(rec.el)) byEl.set(rec.el, new Set());
        byEl.get(rec.el).add(rec.type);
      }
      for (const [el, types] of byEl) pushHandler(el, [...types].sort(), "listener");
    }

    // 7) 框架名冊：React 用 fiber props 繞過事件委派（生產版也有 __reactProps$）；jQuery 讀 $._data（含委派 selector）
    let reactKey = null;
    let walked = 0;
    for (const el of root.querySelectorAll("*")) {
      if (++walked > 2500 || handlers.length >= 120) break;
      if (!reactKey)
        reactKey = Object.keys(el).find((k) => k.startsWith("__reactProps$") || k.startsWith("__reactEventHandlers$")) || null;
      const props = reactKey ? el[reactKey] : null;
      if (!props || typeof props !== "object") continue;
      const types = Object.keys(props).filter((k) => /^on[A-Z]/.test(k) && typeof props[k] === "function");
      if (types.length) pushHandler(el, types.sort(), "react");
    }
    const jq = window.jQuery;
    if (jq && jq._data) {
      const jqTargets = [document, document.body, ...root.querySelectorAll("a, button, li, [class*=menu], [class*=tab], [class*=slide]")];
      let checked = 0;
      for (const t of jqTargets) {
        if (++checked > 400 || handlers.length >= 120) break;
        let ev;
        try { ev = jq._data(t, "events"); } catch { continue; }
        if (!ev) continue;
        const types = Object.keys(ev).sort();
        const delegated = [];
        for (const hs of Object.values(ev))
          for (const h of hs || []) if (h && h.selector && delegated.length < 6) delegated.push(h.selector);
        pushHandler(t, types, delegated.length ? "jquery(delegate: " + delegated.join(", ") + ")" : "jquery");
      }
    }
    const timers = spyRaw ? spyRaw.timers.slice(0, 40) : []; // 全頁級（timer 沒有所屬元素）
    let ioCount = 0;
    const ioTargets = []; // 元素級：本區內被 IntersectionObserver 盯著的對象（入場動畫觸發器）
    if (spyRaw)
      for (const rec of spyRaw.io) {
        try {
          if (rec.el && rec.el.isConnected && root.contains(rec.el)) {
            ioCount++;
            if (ioTargets.length < 12) ioTargets.push({ target: brief(rec.el), selector: path(rec.el) });
          }
        } catch {}
      }

    // 5) 自主動態熱點：觀測 ~2 秒，無互動也在變的節點（輪播自動播放、跑馬燈、倒數、計數器）
    const hot = new Map(); // key＝元素本身——brief 會撞名（兩張同款卡片），必須分開計
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (!el) continue;
        const rec = hot.get(el) || { count: 0, kinds: new Set() };
        rec.count++;
        rec.kinds.add(m.type + (m.attributeName ? ":" + m.attributeName : ""));
        hot.set(el, rec);
      }
    });
    mo.observe(root, { subtree: true, attributes: true, childList: true, characterData: true });

    setTimeout(() => {
      mo.disconnect();
      const hotspots = [...hot.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 20)
        .map(([el, v]) => ({ target: brief(el), selector: path(el), mutations: v.count, kinds: [...v.kinds].slice(0, 5) }));
      // 全頁級：2 秒內 rAF 呼叫數——框架 idle scheduler 也會貢獻，高≠必有動畫，當「疑似」訊號
      const rafDelta = spyRaw ? spyRaw.rafCount - raf0 : 0;
      resolve({
        rootSel,
        spyInjected: !!spyRaw,
        spyLate: spyRaw ? spyRaw.late : undefined,
        counts: {
          animations: animations.length, keyframes: keyframes.length, animRules: animRules.length,
          hoverRules: hoverRules.length, interactive: interactive.length,
          handlers: handlers.length, ioTargets: ioCount, hotspots: hotspots.length,
        },
        animations, keyframes, animRules, hoverRules, interactive, libs,
        handlers, ioTargets, ioCount,
        page: { globalHandlers, timers, rafDelta }, // 全頁級訊號池——只在全局普查過帳一次
        hotspots,
      });
    }, 2000);
  })
