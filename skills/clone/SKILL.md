---
name: clone
description: 一條龍把任一網頁複刻成「設計部好編輯」的 Bricks Builder 頁面——CDP 接管真 Chrome（無自動化指紋）先做全局分析（區塊工作清單、global 樣式、tokens、元件化 classes）→ 逐區塊各個擊破：區塊分析 → plan 初稿 → 生成 → 推本機 WP 渲染 → CDP 同時對照原站與渲染頁、微調到過，一區收斂才做下一區 → RWD 每個斷點把同一套逐區迴圈確實再走一遍（驗證 gate 全程把關）。觸發詞（含口語與意圖）：「複刻這個網站 / clone 這個網頁 / 照這個網站做一版 / 抄這個版型 / 參考這個網站拉一版 / 把這個網址變 bricks / 網頁轉 bricks / 幫我 copy 這個網站 / 分析這個網站 / 做成模板」等，或使用者貼了一個要複刻的網址時，觸發。
---

# clone

網址 → 全局分析 → 逐區塊「分析 → plan 初稿 → 實作 → 渲染對照原站 → 微調」→
RWD 逐斷點把同一套迴圈再走一遍 → 全頁總檢。
產出是**給設計部接手小改的開端稿**——結構極簡好編輯是鐵律；在此結構前提下，
外觀與動態**盡可能還原**（不必像素完美，但缺樣式、缺效果就是沒做完）。

## 流程總覽（30 秒地圖，細節在各 Phase）

```text
Phase 0 前置    CDP 埠探測 → WP 靶場（必備）→ viewport 校準 → 批次 id
Phase 1 全局    spy 注入 → 導航 → 3 斷點基準截圖 → 區塊工作清單（從 body 盤點）
                → 行為普查 behavior.js → 快照落 data/<id>/source/ ＋離線 CSS 普查
                → tokens／Global Classes → 讀 ground truth → 寫 plan.json → 直接進主迴圈
Phase 2 主迴圈  對每一區：深量（元件盤點＋hover/click-sweep）→ 區 plan（element-map
                選型＋components 覆蓋合約＋dynamic_tests 行為合約）→ build + gate → 推 WP →
                對照【a 視覺｜b 程式碼｜c 操作｜d 元素覆蓋核對】→ 微調 → 收帳（雙帳結清）
                ——一區收斂才下一區
Phase 3 RWD     768 整輪 → 375 整輪（同一套逐區迴圈；只動斷點後綴、不動基準）
Phase 4 收尾    全頁總檢（3 斷點）→ 新知識回寫 gotchas → 清暫存 → 回報（驗證表＋行為覆蓋帳）
```

> **節奏提示（先讀，貫穿全程）**：本流程很長——全局分析之後，每個區塊各走一輪
> 「分析＋實作＋渲染＋對照＋微調」，RWD 每個斷點還要再確實走一遍。**長是設計，
> 不是負擔**：LLM 在長上下文本來就容易遺失細節，「一次只顧一個區塊、當場收斂、
> 才前進」正是解法。不急、不焦慮，扎實一步步做好就對了。
> `plan.json` 的 `sections[].status` 是進度錨點，迷航時回去看；原站宣告層快照固定在
> `data/<id>/source/`（HTML＋CSS 全文）——上下文被壓縮後讀檔即可重建認知，不必重爬。
> **續跑規則**：狀態非 done 的第一個區，一律從「rebuild → gate → 推送 → 驗證」重來
> ——build script 固定 seed、推送鎖 `page_id`，重跑冪等安全，不必猜上次停在哪半步。

## ⭐ 結構鐵律（整條流程的最高原則，每一階段都要回頭對照）

照翻 HTML div 層次的轉換結果，會讓設計部在 builder 裡定位一個元件要扒開五六層冗容器
——**本 skill 的存在理由就是消滅這種結構**。

1. **絕不照翻 DOM 層次。** HTML 的多層 div 是疊樣式和歷史包袱；Bricks 結構只服務兩件事：
   版面成立、設計部好編輯。**樣式外觀特效達到就好，結構由 Claude 重新設計。**
2. **標準深度**：`section → container → 內容元素`。只有「真的要分欄」或「卡片這種帶
   surface 的群組」才允許再加一層 `block`。內容元素距離 section 以 **4 層為標準**
   （含 container）；要超過，每一層都得說得出理由（見第 6 條的審核）。
3. **每一層都要有存在的理由**（分欄、卡片底、需要獨立背景/邊框/定位的群組）。
   只有一個子元素、又沒有自己視覺效果的純 wrapper——**塌掉**，樣式併進子元素或父層。
4. **多個樣式來源疊在同一視覺結果**（外層 padding + 內層 margin + 再一層 wrapper 的
   position…）→ 合併成一層的等效樣式，不保留歷史。
5. **每個結構層給 zh-TW `label`**（「主視覺」「三欄卡片」「CTA 區」…）——設計部靠這個定位。
6. 驗證 gate 會對「單子純 wrapper」與「深度過深」發警告——**純 wrapper 警告一律壓平；
   深度警告逐一審核**：該層有正當理由（分欄、卡片 surface、必要群組）才可放行，
   並在回報中列為「已審例外」；說不出理由的就壓平。

> **路徑規約**：Base directory（`<plugin>/skills/clone`）上兩層＝`<PLUGIN_DIR>`。plugin 唯讀；
> 產物寫使用者專案 `data/<id>/`（plan.json、template.json、截圖、原站快照 `source/`）；暫存寫 `.browser/tmp/`
>（瀏覽器流程）或 `tmp/`（過程檔），收尾清空、專案根不留垃圾。
> Windows（Git Bash）跑 `docker exec`/`docker cp` 一律加 `MSYS_NO_PATHCONV=1` 前綴。

## Phase 0 — 前置

1. **CDP Chrome**——埠優先序：env `PLAYWRIGHT_CDP_URL` →（沒設時）`.browser/cdp.env`
   的 `CDP_PORT` → 預設 9222（env 寫在 settings 要新 session 才生效，cdp.env 才是
   使用者實際設定的埠，別只 fallback 9222 就誤判連不上）：
   ```bash
   PORT=$(grep -s '^CDP_PORT=' .browser/cdp.env | head -1 | cut -d= -f2 | tr -d ' \r'); PORT=${PORT:-9222}
   CDP="${PLAYWRIGHT_CDP_URL:-http://127.0.0.1:$PORT}"; curl -s "$CDP/json/version"
   ```
   - 有回應 → 直接接管。
   - 連不上 → 跑 `.browser/` 啟動腳本：Windows `cmd //c "$(pwd)/.browser/launch-chrome-cdp.bat"`、
     mac/Linux `bash …sh`；腳本不在就從 `<PLUGIN_DIR>/templates/` 複製過去。
   - 目標網站要登入 → 請使用者在該視窗登一次即可（profile 會記住）。
2. **WP 靶場（必備——每個區塊都要渲染對照，沒有它就沒有品質）**：
   - `docker ps` 找 `autobricks-wp`；沒起 →
     `docker compose -f "<PLUGIN_DIR>/docker/docker-compose.yml" up -d`。
   - 全新環境先跑 `bash "<PLUGIN_DIR>/docker/init-wp.sh"`（Bricks theme 解壓進
     `docker/wp/wp-content/themes/bricks/`）。
   - **docker 起不來 → 停下來**請使用者啟動 Docker Desktop（或跑 `/autobricks:setup`），
     確認起來後才開工——不做無渲染對照的半成品複刻。
3. **viewport 校準（量測與驗證共用的尺，歪了全盤皆歪）**——版面是視口寬度的函數，
   寬度不同就是在看「另一個版本的頁面」：
   - `browser_resize` 到目標寬（桌機基準 1440）後，**必驗 `window.innerWidth` 是否等於目標**。
   - Windows 顯示縮放（如 125%）會讓實際值變小 → 按 devicePixelRatio 補償
     （例：目標 1440、縮放 1.25 → resize 1800）。
   - 與使用者共用視窗時導航後設定可能失效：**每次導航後重驗一次**。
   - **同一機制也是 RWD 的開關**：resize 到 768/375 就是在切斷點層——校準不準會掉進
     錯的斷點（以為在測 768 的 tablet 層，實際 614 已落入 mobile 層），測了等於沒測。
4. 產一個批次 id：`<YYYYMMDD-HHMMSS-站名>`（`date +%Y%m%d-%H%M%S`），產物都放 `data/<id>/`。

## Phase 1 — 全局分析（只收斂跨區決策；逐區深量留給主迴圈當場做）

1. **注入 spy → 導航**：`<skill base>/spy.js`（執行期記帳——事件監聽/≥250ms 計時器/
   IntersectionObserver/rAF 的「登記簿」，頁面做任何動態前都得先登記）要在頁面任何
   JS 之前生效：用 `browser_run_code_unsafe` 對原站分頁 `page.addInitScript(<spy.js 全文>)`
   （此工具在 ask 權限、會跳框請使用者核可一次）→ `browser_navigate` 目標 URL →
   等完整載入 → 逐屏捲到底觸發 lazy/入場動畫 → 回頂。
   - unsafe 工具不可用或被拒 → **降級**：導航後立刻用一般 `browser_evaluate` 把 spy.js
     整段執行（漏掉載入瞬間的註冊、其後照記；behavior.js 會回報 `spyLate:true`），
     缺的靠 Phase 2 sweep 保底。
   - 只注原站分頁；渲染頁不需要。
2. **全頁截圖三份基準**：1440 存 `data/<id>/source-desktop.png`；resize 768、375
   （皆過校準）各存 `source-tablet.png`／`source-mobile.png`（Phase 3 的對照基準）
   → 回 1440 重校準。輪播/marquee/影片/計數器記為**動態區**（對照時遮罩）。
3. **結構掃描（從 `body` 盤點，不是從 `main`）→ 區塊工作清單**（主迴圈就照這份清單
   的順序跑）：每區記 label、根節點 selector、概略高度、是否動態區。鐵則：
   - 從 `document.body` 往下走訪，**`main` 之外的兄弟節點一併盤點**——公告跑馬燈條、
     導覽列、footer、浮動裝飾常在 `main` 外面，只掃 `main` 必漏。
   - **矮的條狀區塊（高 40–100px 的公告列/跑馬燈）也是 section**，別用高度門檻濾掉。
   - 盤點完與全頁截圖**互相對照**：截圖上看得到的每一塊都要在清單裡，缺了就回頭補掃。
   - 第三方浮動 widget（客服泡泡、cookie 條、樣式切換工具列等 `position:fixed` 且
     非設計本體）不進區塊清單，改登錄 plan 頂層 `excluded`（帶理由——交付報告會列出，
     使用者自行決定是否在正式站安裝原服務）。**判準：「拿掉它，設計有沒有少東西」**
     ——sticky 導覽/回頂鈕/固定 CTA 條是設計本體、要複刻；猶豫時看來源：外部 script
     執行期注入的（DOM 有 intercom/tawk/fb-customer-chat 這類指紋）傾向排除。
4. **全頁行為普查（視覺之外的另一半真相；工具：`<skill base>/behavior.js`）**：
   截圖量得到「長什麼樣」，量不到「會做什麼」——行為只存在於這份普查裡。對 `body`
   跑一次 behavior.js（結果落 `.browser/tmp/behavior-global.json`），得到七類證據：
   - 執行中動畫（`iterations:"Infinity"`＝常駐 marquee/spinner）；
   - @keyframes 與 hover 規則（computed 讀不到的設計意圖）；
   - 互動元素盤點（可點/可展開/表單/程式庫 data- 指紋——**特徵推測**的候選名單）；
   - JS 程式庫指紋（Swiper/GSAP/AOS…＝原站實作線索，主迴圈選階梯層時用）；
   - 2 秒 Mutation 熱點（自動輪播/跑馬燈/計數器抓漏網）；
   - **spy 帳本**（步驟 1 有注入才有；語意是**登記史**——曾登記過、不保證此刻仍活躍，
     timer 被 clear 會標記）——分兩池：**元素級** `handlers`（誰綁過事件，vanilla/Vue
     直綁全中）與 `ioTargets`（被 IntersectionObserver 盯著＝入場動畫觸發器），可直接
     歸屬所在區塊；**全頁級** `page.timers`（≥250ms 計時器——慢速自動輪播在這現形，
     不受 2 秒窗限制）、`page.globalHandlers`（window/document 層）、`page.rafDelta`
     （疑似常駐動畫，框架 idle 也會貢獻）。**記帳規則：全頁級訊號只在全局普查過帳
     一次**——逐區只登「能歸屬該區」的證據（元素級命中、sweep 實測、Mutation 相關性），
     別讓同一顆全域 timer 在每一區重複產生義務；
   - **框架名冊**（不需注入，`handlers` 內 `source:"react"/"jquery"`）——React 用
     `__reactProps$` fiber props **繞過事件委派**逐顆列出 onClick/onMouseEnter；
     jQuery 讀 `$._data` 事件登記表（含委派 selector）。

   注意：它的 @keyframes/hover 掃描走 CSSOM，**跨網域 stylesheet 受 CORS 限制讀不到
   （直接跳過）**——原站 CSS 放 CDN 時，那一半由第 5 步的離線 CSS 普查補。
   命中結果（與離線普查合併後）按區塊掛回工作清單（`dynamic` 標記＋行為摘要）——
   **清單上每一項行為之後都要有下落**（主迴圈登錄成 dynamic_tests 實作並實測，
   或明列 excluded／unsupported＋理由），不許無聲消失。
5. **原始碼分析（全局層；宣告真相與量測互補，缺一不可）**：computed style 只給
   「結果值」，讀不到設計意圖——rotate 常量出 `none`、hover 效果完全不在 computed 裡、
   斷點行為看不見。所以：
   - **宣告層快照（交付物，不是暫存）**：抓 `document.documentElement.outerHTML` 落
     `data/<id>/source/source.html`；**所有** stylesheet 抓「全文」落 `data/<id>/source/css/`
     （檔名帶序號＋來源 host）。取法：
     - inline `<style>` → 讀 `ownerNode.textContent`；
     - 外部 href → 在頁面 context 用 fetch 取回；
     - **fetch 因 CORS 失敗** → 開一個分頁直接導航到該 `.css` 網址、讀
       `document.body.innerText` 落檔（top-level 導航不受 CORS 限制），存完關分頁。
     - **CSS 內的 `@import` 也要抓**：離線普查會列出未解析的 `imports` 清單——
       逐一取回同目錄、重跑普查，直到清單清空（漏抓＝那份 CSS 裡的 hover/keyframes 蒸發）。

     放 `data/` 而非 tmp 的理由：主迴圈逐區讀 class 意圖查這份、不重抓；
     上下文壓縮後續跑讀檔重建認知、不重爬；日後原站改版有存證可比對。
   - **離線 CSS 普查（補 behavior.js 的 CORS 盲區）**：
     ```bash
     uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/skills/clone/parse_css.py" "data/<id>/source/css" -o tmp/css-census.json
     ```
     解析快照全文抽 hover 規則、@keyframes、animation/transition 規則、media query
     （`breakpointHints`＝原站斷點寬度明文，Phase 3 直接引用）、@font-face 清單，
     與 behavior.js 結果**合併**掛回工作清單——同樣一項都不許無聲消失。
   - 讀 **global 樣式**：body 字族/底色、CSS variables、utility class 慣例（Tailwind 之類
     就是設計意圖的明文：`-rotate-2`＝旋轉、`shadow-[8px_8px_0_#000]`＝硬陰影、
     `hover:-translate-y-1`＝hover 浮起、`md:`/`lg:` 前綴＝斷點行為）。
   - **樣式元件化**：跨區重複出現的樣式組合提取成語意化元件（如「neo 卡片」＝白底+
     4px 黑框+硬陰影；「neo 按鈕」＝…含 hover 行為）→ 進 plan 的 `classes`，
     生成時＝Bricks Global Classes。
6. **tokens 與 assets**：統計重複色/字族/字級階/間距刻度；列 img/背景圖/SVG/字體
   （@font-face 清單查離線普查的 `fontFaces`；商用字體記最接近的免費替代）。
   另量**內容寬**（最外層置中容器實測寬）——之後釘 container 寬用。
7. **讀 ground truth（一次讀、全程用；plugin 不內建版本知識、絕不假設 Bricks 版本）**：
   1. **使用者專案的 `bricks-gotchas.local.md`**（若存在）——本專案累積的實證經驗
      （設定值形狀與渲染地雷，每條標註驗證版本）。
   2. **live schema（元素/欄位存在性的最高權威）**：確保 `data/bricks-schema-live.json`
      存在——沒有就跑
      `uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/src/extract_bricks_schema.py"`
      （直接從**使用者裝的 theme** PHP 原始碼抽出 schema，版本自動對齊；
      theme 原始碼不在本機＝抽不了，直接用第 3 項 fallback）。
      值的「形狀」不確定、經驗又沒記載時：用 live schema 各 element 的 `file` 欄位
      開對應 theme 原始碼查 control 定義，或推 WP 渲染實測定案——不猜。
   3. `<PLUGIN_DIR>/bricks-schema/`——官方 v2.3 副本（對應 Bricks 2.x）：live 不可用時
      的 fallback。**官方有、live 查無的欄位＝使用者的版本沒有，絕不發明。**
8. 寫 `data/<id>/plan.json`（全局版）：

```json
{
  "id": "…",
  "source": { "url": "", "viewport_width": 1440, "content_width": 1200 },
  "tokens": { "colors": {}, "typography": {}, "spacing_scale": [] },
  "classes": [ { "name": "neo-card", "desc": "白底+4px黑框+8px硬陰影", "hover": "浮起：translate(-4,-4)+陰影加深" } ],
  "assets": [ { "name": "", "url": "", "kind": "image", "used_in": "" } ],
  "sections": [
    { "label": "頂部跑馬燈", "selector": "body > div.ticker", "dynamic": true, "status": "todo" },
    { "label": "主視覺", "selector": "main > section:nth-child(1)", "dynamic": false, "status": "todo",
      "components": [
        { "item": "搜尋框「全站」範圍下拉", "kind": "dropdown", "text": "全站 ▾", "status": "todo" },
        { "item": "放大鏡搜尋鈕", "kind": "icon", "text": "🔍", "status": "todo" },
        { "item": "熱門關鍵字列", "kind": "text", "text": "evian 洗衣機 平板 …", "status": "todo" },
        { "item": "分類分隔線", "kind": "divider", "status": "todo" }
      ],
      "dynamic_tests": []
    }
  ],
  "excluded": [ { "target": "Intercom 客服泡泡", "reason": "第三方 SaaS 注入、非設計本體；正式站可直接安裝原服務" } ],
  "responsive": { "status": { "tablet": "todo", "mobile": "todo" } },
  "page_id": null
}
```

- **plan 的定位：初稿＋進度帳本，不是鐵則。**
  - 全局版只收斂**跨區決策**（tokens、classes、內容寬、區塊工作清單）——這些只有
    看過全景才做得了。
  - 每區的細節（結構、measured、逐字文案、dynamic_tests）由主迴圈**當場分析、當場
    補進該 section、當場實作驗證**——細節不過夜、不跨區持有，這就是抗長上下文漂移的機制。
  - 最終仲裁者永遠是渲染實測對照原站；plan 服務流程，不是流程服務 plan。
- 逐區內容只寫結構＋measured＋逐字文案＋測試合約，不寫敘事。
- `page_id`：第一次推送建頁後**當場回寫**——之後重推與續跑都讀它，別只記在對話裡
  （上下文被壓縮後，漏了它就會重推開出新頁）。
- plan 寫完**直接進主迴圈**，不停下來等使用者指示。

## Phase 2 — 主迴圈：逐區塊「分析 → 實作 → 渲染對照 → 微調」（一區收斂才下一區）

**絕不「整頁生成完才回頭驗」**——每區實作完立刻推 WP、立刻在渲染分頁與原站分頁
並排對照，細節趁新鮮修掉。

**前置（進迴圈前做一次）**：
- 建構腳本 `tmp/build_template.py`——逐區迭代會反覆重建整份 template，**一律用腳本**；
  修版面＝改腳本重跑，不手改 JSON（腳本屬過程檔，收尾清掉）：
  - 設計決策（結構、樣式、文案）以資料形式寫在腳本裡；id 產生與 parent/children
    接線交給程式。
  - **random seed 固定**——每次重建 id 不變（重推同頁、量測對照、id-scoped CSS 都靠它）。
  - 先放 tokens 與 Global Classes（plan 的 `classes` → template 頂層 `globalClasses`
    陣列 `{id,name,settings}`；元素以 `_cssGlobalClasses:[classId,…]` 掛用，可掛多個）。
  - **頂層同時輸出 `global_classes`（同一陣列）＋ `title`（頁名）＋ `type:"content"`**——
    Bricks 後台 Import 認的是蛇形鍵名（1.12.5 `templates.php` 實證），少了它，
    交付檔匯進正式站會**無聲丟掉所有 classes**；駝峰鍵留給 push 腳本（兩鍵都通）。
- **推送指令**（第一次推＝建新頁；之後每輪加 `-e PAGE_ID=<n>` 重推同一頁）：
  ```bash
  MSYS_NO_PATHCONV=1 docker cp "data/<id>/template.json" autobricks-wp:/tmp/template.json
  MSYS_NO_PATHCONV=1 docker cp "<PLUGIN_DIR>/docker/push-template.php" autobricks-wp:/tmp/
  MSYS_NO_PATHCONV=1 docker exec -e TEMPLATE=/tmp/template.json -e TITLE="<站名> (AutoBricks)" \
    autobricks-wp php /tmp/push-template.php    # 之後重推加 -e PAGE_ID=<n>
  ```
  - 第一次推回傳的 PAGE_ID **當場回寫 plan.json 的 `page_id`**——重推與續跑都讀它。
  - 原理勿繞過：`wp_set_current_user(admin)` 否則 WP 靜默丟棄；`wp_slash` 否則剝引號。
  - template 帶 `globalClasses` 時 push 腳本會合併寫入 `bricks_global_classes` option。
  - 預設建新頁，使用者指名才覆寫既有頁。
- 對照台＝**兩個分頁**：原站沿用 Phase 1 的分頁、渲染頁另開一個，兩邊都做 1440 校準；
  渲染頁若帶登入態，**移除 `#wpadminbar`**（污染截圖與座標）。

**對工作清單的每一個區塊，依序做完 1–6 才碰下一區：**

1. **區塊分析（深量；鐵則：每個數字都來自量測，不准對截圖目測）**：
   - **⭐ 元件盤點（必做，第一步；元件覆蓋帳的底稿）**——**先窮舉、才建構**：把該區
     **每個看得見的子元素/文字/資產逐一列成清單**，一項一列。這是與 `dynamic_tests`
     對稱的**靜態覆蓋合約**——行為那條鏈防「會做什麼」漏掉，這條鏈防「長什麼樣的
     每個零件」漏掉。**盤點要涵蓋容易被目測滑過的細節**：分隔線/邊框線、圖示 icon
     （放大鏡、caret ▾、箭頭）、下拉/範圍選單（如搜尋框「全站」）、熱門關鍵字列、
     徽章/角標、佔位/輸入框、每一段文字（逐字）。取法：measure.js 全樹 dump ＋
     一支覆蓋普查（回傳該區**去重後的可見文字集合、img 數、互動元素數
     〈a/button/input/select〉、分隔線/徽章存在旗標**）——這份清單就是第 2 步
     `components` 的原料，也是第 4 步 d「元素覆蓋核對」的比對基準。**沒盤點完不准動手建。**
   - 語意摘要：targeted `browser_evaluate` 萃取——標題（字級/字重/盒樣式）、
     **重複群組偵測**（同父、同高的 ≥3 個兄弟＝卡片格，記欄數/gap/一張代表卡的樣式）、
     按鈕/連結樣式、圖片清單。結果小就 inline 回傳，大才落 `.browser/tmp/`。
   - 複雜區用 `<skill base>/measure.js` 全樹 dump 落檔後讀重點。
   - **隱藏文案採集（必做）**：手風琴答案、輪播非可見卡、tab 內容都不在畫面上——
     從 DOM 撈全文，別只抄截圖看得到的（隱藏文案也是元件盤點的一員）。
   - 該區原始碼 class 意圖逐一登錄（查 Phase 1 的 `data/<id>/source/` 快照與
     `tmp/css-census.json` 離線普查，兩邊互相印證：
     精確 px/色值以量測為準；rotate/hover/斷點/偽元素以宣告為準）；
     `sm:/md:/lg:` 斷點宣告**先登錄**進該區 plan，實作留給 Phase 3。
   - **區塊行為普查（必做）**：以該區根節點跑 `<skill base>/behavior.js`
     （落 `.browser/tmp/behavior-<區>.json`），加上全局普查掛到本區的項目＝該區行為清單；
     hover 效果再用真實指標 `browser_hover` 實測補證（`browser_evaluate` 派發合成
     mouseover **不會**觸發 CSS `:hover`，量了等於沒量）＋捲動觀察入場動畫/sticky。
   - **hover-sweep（實案教訓：靜掃漏掉 mega menu）**——behavior.js 的 interactive
     盤點只是候選名單：
     - 掃描對象**優先取 behavior.js 的 `handlers` 名冊**（登記過 click/hover 的元素
       ＝事實，必掃）；再用特徵補漏（cursor:pointer、aria-expanded/haspopup、button、
       含子面板的 a/li）。同類同樣式簽名的取代表一個。
     - hover 前後對比：新面板出現（display 翻轉/新節點 mount）、`open`/`is-active` 類
       class 變化、aria-expanded 翻轉、transform/陰影變化——每個命中都是一條 dynamic_test。
     - SPA 常「殼預渲染、料 hover 才灌」：面板內容要在 hover **當下**讀，
       靜態 DOM 讀到的是上一次 hover 的殘留。
   - **click-sweep（hover 掃不到的另一半）**——帶 toggle 指示的元素（▾/▲ caret、
     aria-haspopup、select 樣式膠囊）hover 不會開，**必須真實點擊**再量
     （實案：搜尋框「全站」範圍選單就是 click-only，hover-sweep 全程漏掉）：
     - 點擊型面板多測三件事：選項點下去後**觸發器文字/active 是否更新**、
       面板是否關閉、**點外部是否關閉**。
     - 真實滑鼠自動化兩個坑：導航後第一下 click 會被 Chromium 吞掉
       （先對中性點打一下暖身）；CDP input 進的是**視窗目前顯示的分頁**
       （互動前先 bringToFront）。
   - **行為偵察 escalation（最後一刀）**：sweep 掃了、帳本讀了仍查不明的行為——在
     `data/<id>/source/` 快照 grep 關鍵字（class 名／selector／文案；第一方小 JS 可另抓回
     `tmp/` 一起 grep），**只讀命中段落（±200 行）給 Claude 判讀，絕不整包 bundle
     吞進上下文**（token 黑洞、絕大多數是無關框架碼；讀碼得到的是「可能性」，
     定案仍以實測為準）。
2. **區塊 plan 初稿**（補進 plan.json 的該 section；**初稿非鐵則**，渲染實測後隨時改）：
   - Bricks 目標結構＝**極簡樹**——在這裡完成「DOM → Bricks」的重組（鐵律 1–5），
     不是把 DOM 抄下來。
   - **element 選型必查 `<skill base>/element-map.md`**：以第 1 步的量測＋行為普查
     為證據走決策漏斗（認角色 → 行為型 native 優先 → 沒有就基本元素拼裝），
     兩難時選設計部在 builder 裡改得動的那個；候選定案前查 live schema 確認存在，
     查無＝記 fallback 策略，絕不發明。**靜態複刻禁用 QUERY／WORDPRESS／SINGLE／
     WooCommerce 類元素**（吃 WP 資料庫的動態元素；細節與簽章對照表見 element-map）。
   - measured 用實測原值（不吸附、不湊整）；文字內容**逐字照抄**。
   - **`components`（該區的靜態覆蓋合約）**：把第 1 步元件盤點逐項登錄成
     `{item, kind, text/asset, status:"todo"}`（kind＝text/image/link/button/icon/
     divider/badge/input/dropdown…）。決定不做或合併的登錄 `{item, excluded/merged: "<理由>"}`
     （純裝飾、與他項合併…）。**盤點有、components 沒有＝第 4 步 d 不會核到＝會漏**——
     這是「乍看很像卻少零件」的防線。
   - **`dynamic_tests`（該區的動態測試合約）**：以**行為普查清單為底稿逐項過帳**——
     每個互動/動態行為（hover、點擊展開、輪播、sticky、表單、入場動畫…）登錄成
     `{target, action, expect}`；決定不做的項目登錄成 `{target, excluded: "<理由>"}`
     （第三方 widget、純裝飾雜訊…）。普查有、合約沒有＝該行為第 4 步不會測，
     等於沒驗——**行為不是加分項，缺效果就是沒做完**。
3. **實作**：該區資料加進 build script → rebuild `data/<id>/template.json` → 驗證 gate
   （語法層級的靜態測試）：
   ```bash
   uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/src/validate_template.py" "data/<id>/template.json"
   ```
   **error 清零；純 wrapper 警告一律壓平；深度警告逐一審核**（鐵律 6）→ 推送
   （第一區建新頁並記 PAGE_ID，之後 `-e PAGE_ID=<n>` 重推同頁）。落地要點：
   - **element 名與 settings 鍵一律以 live schema（原始碼抽出）為準**——不確定就
     當場查 `data/bricks-schema-live.json` 或對應 PHP 原始碼，絕不憑記憶發明鍵名
     （gate 也會用 live schema 逐鍵複查）。
   - 扁平陣列 `{id, name, parent, children, settings, label}`，根 `parent: 0`；
     **id：6 碼 `[a-z0-9]` 且至少 1 個數字**（匯入 id 全域字串替換的防撞規則）。
   - container 用 plan 的 `content_width` 釘 `_widthMax`；圖片釘 `_width` ＋
     id-scoped `aspect-ratio`，不固定 `_height`。
   - 重複樣式一律掛 Global Classes（前置已定義；設計部改 class 全站連動）；
     元素自己的 settings 只放「這顆獨有」的值。
   - 動態與視覺效果照**五層階梯**（由上往下找，落在越上層越好——越上層設計部越能
     在 builder 裡編輯；普查到的 JS 程式庫指紋是選層線索：有 Swiper→slider-nested、
     有 AOS→`_interactions` 入場…）：
     1. 自帶 JS 的原生元素（slider/accordion/counter/tabs/countdown/animated-typing…）；
     2. `_interactions` 原生互動（入場動畫、scroll 觸發、顯示/隱藏切換）；
     3. CSS 層——**優先 native 狀態設定**（`_transform` 旋轉、hover 後綴——builder
        可編輯）；native 表達不了的 keyframes/偽元素/pattern 才用 `_cssCustom`
        （共用的放 class、單顆的放元素，**一律真實 `#brxe-<id>`、絕不 `%root%`**，
        id 定案後才寫）；
     4. **自訂 JS（`code` 元素）——1–3 層表達不了的行為才落到這層**（自製分頁/篩選
        邏輯、捲動觸發 class 切換、視差、倒數/計數、複合輪播…），別再把它記
        unsupported。鐵則：
        - settings 形狀：純 JS（不含 `<script>` 標籤）放 `javascriptCode` ＋
          `executeCode: true`；附帶 markup 放 `code`、樣式放 `cssCode`；
          不需輸出容器時 `noRoot: true`。
        - **vanilla、自包含、冪等**：不載外部 CDN、不動全域、不 `document.write`；
          包 IIFE ＋ DOM ready 防衛；selector 一律鎖真實 `#brxe-<id>`（絕不 `%root%`）。
        - 一區至多一顆 code 元素打包該區行為，`label` 註明「〈區名〉行為 JS」——
          設計部找得到、也改得動。
        - **前台會不會執行不是理所當然**：Bricks 對 code 元素有 code execution 權限
          與程式碼簽章機制（版本相關）——第 4 步實測沒跑時，用 live schema 的 `file`
          欄位開 code element 的 PHP 原始碼查簽章/開關真相（不猜），解法回寫 gotchas。
     5. 明列 unsupported＋原因——准入兩類：**真後端功能**（登入、購物車、真實表單
        送出、即時資料…以 UI 狀態模擬或明列不做）；**重造顯著不划算的重型前端**
        （WebGL/canvas 場景、物理模擬、專有嵌入 widget——記 `unsupported_complexity`
        ＋替代方案：靜態截圖/影片/iframe embed）。一般純前端行為仍走不到這層——
        「有點難」不是理由，1–4 層接得住。
4. **渲染對照（原站分頁 ↔ 渲染分頁，同一區並排看差異）**：
   > **鐵則（實案教訓，違者必翻車）**：只要動到一個區的**結構或 settings**——換元素
   > 型別、重寫 settings、增刪子元素——該區 a/b/c/d **全套重驗，絕不准只驗 c（操作）**。
   > 功能測試全過 ≠ 畫面沒壞：換型別時 settings 重寫漏掉版面鍵（block/div 預設
   > `flex-direction: column`，橫排群組必須明寫 `_direction:"row"`）不會讓任何行為
   > 測試 fail，但整條版面直接撐爆。回報「完成」前，至少把本輪動過的每一區
   > 截圖跟原站並排看過一眼。
   - **a. 視覺**：兩邊該區各截圖、**並排判讀**——版型、色塊、陰影、角度、間距；
     `dynamic: true` 的區**遮罩動態元素再比**（該區 plan 記 `dynamic_masks` selector
     清單：輪播軌、計數字、跑馬燈內容…），其餘靜態部分照常並排比對——
     **別因一顆輪播放棄整區的視覺驗證**（背景/標題/CTA/間距都還是靜態的）。
   - **b. 程式碼**：渲染頁 `browser_evaluate` 讀該區——HTML：`#brxe-*` 深度/wrapper
     對照鐵律；CSS：關鍵元素的 computed（box/字級/色/間距）**與原站同一元素相減**
     （元素級差值是主要修復訊號），並確認 Global Classes 有掛上（classList 含 class 名）。
   - **c. 操作**：執行該區的 `dynamic_tests`，每條＝**操作 → 取證 → 判定**：
     真實指標 `browser_hover`／`browser_click`／捲動／輸入，操作**前後各取證**
     （截圖存 `.browser/tmp/test-<區>-<n>.png`＋量測 transform/shadow/高度變化），
     與 `expect` 比對。常見測法：hover＝前後 transform/box-shadow 差；手風琴/tab＝
     點開後內容出現且文字正確；跑馬燈/輪播＝隔 1–2 秒兩讀 transform 證明在動＋
     hover 暫停；sticky＝捲動後仍在頂；表單＝可輸入；入場動畫＝捲入前後 opacity/
     transform 差。**階梯第 4 層（自訂 JS）的行為必逐條實測**——console 無錯但行為
     不動＝多半被 Bricks code execution／簽章擋下，照階梯 4 的辦法查明、勿當作過。
   - **d. 元素覆蓋核對（防「乍看很像卻少零件」）**：對渲染頁該區跑同一支覆蓋普查
     （可見文字集合、img 數、互動元素數〈a/button/input/select〉、分隔線/徽章旗標），
     **與 plan 的 `components` 逐項相減**：合約每項都要在渲染頁找到對應（或已標
     excluded/merged）；**原站有、渲染頁缺的文字/元件＝FAIL**（實案：漏了搜尋框
     「全站」下拉、放大鏡 icon、熱門關鍵字列、分類分隔線——都是這一步該抓的）。
     這道核對是**機器比對**，不靠「並排看起來像」的目測，補上視覺目測會滑過子元素的缺口。
5. **微調**：a/b/c/d 任一 FAIL → **當場只修該區**（改 build script 該區資料或該 class）→
   rebuild → gate → 重推 → **只重驗該區**。**同一問題修 2 次無明顯改善**（差值沒在縮小）
   → status 記 `"manual"`、列入待人工清單，繼續下一區，別整批卡死
   （第二輪修的是**新發現的不同問題**則不計入——判準是收斂與否，不是機械數次數）。（Bricks 有外部 CSS 檔快取：重推後前端
   樣式沒動＝快取沒重生，用 `docker exec … php` 把 Bricks 全域設定的 CSS loading
   改成 inline——**勿用瀏覽器登入後台處理**。）
6. **收帳**：plan.json 該區 `status` → `"done"`（或 `"unsupported"`＋原因）。每區必須
   二選一，不許無聲消失。**收帳前雙帳都要結清**：`components`（每項 implemented／
   merged／excluded）＋ `dynamic_tests`（每項 PASS／excluded／unsupported）——
   任一還有 `todo` 就不算 done。微調中改到**合約層**（classes 定義、components、
   dynamic_tests、響應規則）要同步回寫 plan——後面的斷點輪還要引用；數值層的微調
   直接改產出、驗過即可。

## Phase 3 — RWD：每個斷點把同一套迴圈確實再走一遍

行動流量是行銷頁的大宗——RWD 不是加分項。桌機全區 done 才開始；
**先 768（tablet）整輪走完，再 375（mobile）整輪**。每輪開始：**原站與渲染頁兩個
分頁都 resize＋過校準**（校準歪＝掉進錯的斷點層，測了等於沒測）；Phase 1 存的
`source-tablet.png`／`source-mobile.png` 當輔助基準，但以當下原站分頁實測為準。

對**同一份區塊清單**逐區（同 Phase 2 節奏，一區收斂才下一區）：
1. **分析**：原站該 viewport 的該區實測（幾欄變幾欄、導覽收合成什麼、哪些隱藏、
   字級/間距縮多少）＋ Phase 2 已登錄的斷點宣告 → 該區響應規則
   （原站斷點寬度總表查 `tmp/css-census.json` 的 `breakpointHints`）。
2. **實作**：轉成**斷點後綴設定**（`_direction:mobile_portrait`、
   `_typography:tablet_portrait`、`_padding:mobile_portrait`…）→ rebuild → gate → 重推：
   - 斷點鍵名讀 WP option `bricks_breakpoints`；未自訂＝預設 tablet_portrait ≤991／
     mobile_landscape ≤767／mobile_portrait ≤478。
   - 注意 Bricks 是 **desktop-first**——後綴＝該寬以下生效，與 Tailwind mobile-first
     方向相反，換算時「基準」與「後綴」要互換。
   - 常見手法：欄數收合（row→column 或 wrap）、字級降階、間距縮減、`_display:none` 隱藏。
   - 共用樣式的響應行為寫進 Global Class（class settings 同樣支援斷點後綴）。
   - **只動後綴、不動基準值**——桌機已收斂，不准弄壞。
3. **對照**：兩邊該區並排截圖＋computed 對照＋**該區無水平溢出**；
   行為隨斷點變化的動態項重測（如導覽收合），其餘不重複。
4. **微調**到過才下一區；同區 2 次不過記待人工。
每輪走完：`responsive.status` 該斷點 → `"done"`。

## Phase 4 — 全頁總檢＋收尾

1. **全頁總檢（區塊各自對了 ≠ 整頁對了）**——三個斷點各做一輪：
   - `#brxe-*` 元素數 ＝ template 元素數；
   - 整頁捲一遍看**區塊銜接**（背景相接、間距節奏、sticky/fixed 層疊）；
   - **全頁無水平溢出**；
   - 全頁截圖與原站並排總對照——桌機存 `data/<id>/rendered-desktop.png`
     （768/375 也各存一份）。

   發現跨區問題，照 Phase 2 第 5 步的微調做法修相關區塊。
2. **新知識的歸宿（鐵則）**：驗證中發現的新平台知識（渲染怪癖、欄位行為、版面雷）寫進
   **使用者專案的 `bricks-gotchas.local.md`**（不存在就建立；一條＝現象＋解法＋驗證當時的
   Bricks 版本）。**絕不寫 plugin 目錄**——plugin 只該有通用方法，且 marketplace update
   時會重新複製出全新的版本資料夾，寫在 plugin 內的任何修改都會無聲蒸發。
3. 關掉本次開的分頁（別關整台 Chrome）；清空 `.browser/tmp/` 與 `tmp/`；掃一眼專案根沒有垃圾。
4. 回報：plan 與 template 路徑（原站宣告層快照在 `data/<id>/source/`）、
   element 數/最大深度（編輯性指標）、**逐區驗證表**
   （區塊｜視覺｜程式碼｜操作｜覆蓋｜桌機/768/375 判定）、
   **元件覆蓋帳**（元件盤點 → components → implemented／merged／excluded，一項不漏
   ——這是「乍看很像卻少零件」的交付證明，與行為覆蓋帳對稱）、
   **行為覆蓋帳**（普查條目 → dynamic_tests → PASS／excluded／unsupported，一條不漏
   ——這就是「不只複刻外觀」的交付證明）、**圖片替換清單**（從 plan 的 assets 產：位置 label｜外連 URL｜
   實測尺寸，同尺寸重複圖合併計數如「商品卡圖 ×94」——**圖片全為外連原站、僅供
   佔位撐版面，上線前必須逐一替換為自有素材**（版權）；複刻對象是自家站要搬遷
   資產時，才另走下載進媒體庫模式）、「待人工」清單（有的話）、PAGE_ID 與
   permalink、unsupported 清單（有的話）。
5. 提醒使用者：也可在 WP 後台 Bricks → Templates → Import 直接匯入 `template.json`
   （頂層 `global_classes` 會一併帶入，**同名 class 直接映射目標站既有定義、不覆蓋**
   ——class 命名要帶站名前綴防撞）；模板含階梯第 4 層 JS 時，目標站要自行開啟
   Bricks 的 code execution（管理員決定的安全取捨）。
