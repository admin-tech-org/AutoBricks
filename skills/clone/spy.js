// AutoBricks 執行期記帳 spy — 要在「頁面任何 JS 執行之前」注入（browser_run_code_unsafe
// 的 page.addInitScript；降級：導航後用 browser_evaluate 事後注入，漏掉載入瞬間、其後照記）。
// 原理：頁面要做任何動態，都得先向瀏覽器「登記」——本檔把四個登記窗口各包一層，
// 登記內容記進 window.__abSpy；頁面行為完全不受影響（全數轉呼原始 API、包一層 try 防衛）。
// behavior.js 普查時讀這本帳，把「特徵猜互動」升級成「讀登記事實」：
//   listeners — 誰綁過哪些事件（vanilla/Vue 直綁全中；React 委派由 behavior.js 的 fiber 名冊繞道）
//   timers    — setInterval/setTimeout 登記（≥250ms 才記——慢速自動輪播/跑馬燈/倒數的心跳，
//               不受 behavior.js 2 秒觀測窗限制；clearTimeout/clearInterval 會回標 cleared:true）
//   io        — IntersectionObserver 觀察對象（入場動畫的觸發名單）
//   rafCount  — requestAnimationFrame 累計呼叫數（框架 idle scheduler 也會貢獻——高≠必有動畫，疑似訊號）
// 語意注意：這本帳是「登記史」（spy 生效後曾登記過），不是「此刻活躍清單」——除 timer 的
// clear 有回標外，不追蹤 removeEventListener/unobserve；活不活著以 sweep 實測與 Mutation 佐證定案。
(() => {
  if (window.__abSpy) return; // 防重複注入
  const S = (window.__abSpy = {
    listeners: [], // {el, type}（同一元素同一事件只記一次）
    timers: [], // {kind, delay, fn 前 80 字}
    io: [], // {el}
    rafCount: 0,
    t0: Date.now(),
    late: !!document.body, // true＝事後注入（body 已存在），載入瞬間的註冊沒看到
  });
  // 只記「互動/行為」相關事件——mousemove/analytics 類雜訊不進帳，防帳本爆量
  const TYPES = new Set([
    "click", "dblclick", "mousedown", "mouseup", "mouseenter", "mouseleave", "mouseover",
    "pointerdown", "pointerenter", "touchstart", "focus", "focusin", "blur",
    "keydown", "change", "input", "submit", "scroll", "wheel", "toggle",
  ]);

  const seen = new WeakMap(); // el -> Set(type)
  const origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    try {
      if (TYPES.has(type) && S.listeners.length < 3000) {
        let set = seen.get(this);
        if (!set) seen.set(this, (set = new Set()));
        if (!set.has(type)) {
          set.add(type);
          S.listeners.push({ el: this, type });
        }
      }
    } catch {}
    return origAdd.call(this, type, ...rest);
  };

  const timerIndex = new Map(); // tid → record：clear 時回標，普查能分辨「已停」的計時器
  const wrapTimer = (name, kind) => {
    const orig = window[name];
    window[name] = function (fn, delay, ...rest) {
      const tid = orig.call(this, fn, delay, ...rest);
      try {
        if ((delay || 0) >= 250 && S.timers.length < 300) {
          const rec = { kind, delay: delay || 0, fn: String(fn).replace(/\s+/g, " ").slice(0, 80) };
          S.timers.push(rec);
          timerIndex.set(tid, rec);
        }
      } catch {}
      return tid;
    };
  };
  wrapTimer("setInterval", "interval");
  wrapTimer("setTimeout", "timeout");
  for (const name of ["clearInterval", "clearTimeout"]) {
    const orig = window[name];
    window[name] = function (tid) {
      try {
        const rec = timerIndex.get(tid);
        if (rec) rec.cleared = true;
      } catch {}
      return orig.call(this, tid);
    };
  }

  if (window.IntersectionObserver) {
    const origObserve = IntersectionObserver.prototype.observe;
    IntersectionObserver.prototype.observe = function (el) {
      try {
        if (S.io.length < 500) S.io.push({ el });
      } catch {}
      return origObserve.call(this, el);
    };
  }

  const origRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (fn) {
    S.rafCount++;
    return origRaf.call(this, fn);
  };
})();
