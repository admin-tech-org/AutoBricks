---
name: clone
description: 一條龍把任一網頁複刻成「設計部好編輯」的 Bricks Builder 頁面——CDP 接管真 Chrome（無自動化指紋）先做全局分析（區塊工作清單、global 樣式、tokens、元件化 classes）→ 逐區塊各個擊破：區塊分析 → plan 初稿 → 生成 → 推本機 WP 渲染 → CDP 同時對照原站與渲染頁、微調到過，一區收斂才做下一區 → RWD 每個斷點把同一套逐區迴圈確實再走一遍（驗證 gate 全程把關）。觸發詞（含口語與意圖）：「複刻這個網站 / clone 這個網頁 / 照這個網站做一版 / 抄這個版型 / 參考這個網站拉一版 / 把這個網址變 bricks / 網頁轉 bricks / 幫我 copy 這個網站 / 分析這個網站 / 做成模板」等，或使用者貼了一個要複刻的網址時，觸發。
---

# clone

網址 → 全局分析 → 逐區塊「分析 → plan 初稿 → 實作 → 渲染對照原站 → 微調」→
RWD 逐斷點把同一套迴圈再走一遍 → 全頁總檢。
產出是**給設計部接手小改的開端稿**——結構極簡好編輯是鐵律；在此結構前提下，
外觀與動態**盡可能還原**（不必像素完美，但缺樣式、缺效果就是沒做完）。

> **節奏提示（先讀，貫穿全程）**：本流程很長——全局分析之後，每個區塊各走一輪
> 「分析＋實作＋渲染＋對照＋微調」，RWD 每個斷點還要再確實走一遍。**長是設計，
> 不是負擔**：LLM 在長上下文本來就容易遺失細節，「一次只顧一個區塊、當場收斂、
> 才前進」正是解法。不急、不焦慮，扎實一步步做好就對了。
> `plan.json` 的 `sections[].status` 是進度錨點，迷航時回去看。

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
> 產物寫使用者專案 `data/<id>/`（plan.json、template.json、截圖）；暫存寫 `.browser/tmp/`
>（瀏覽器流程）或 `tmp/`（過程檔），收尾清空、專案根不留垃圾。
> Windows（Git Bash）跑 `docker exec`/`docker cp` 一律加 `MSYS_NO_PATHCONV=1` 前綴。

## Phase 0 — 前置

1. **CDP Chrome**：`curl -s "${PLAYWRIGHT_CDP_URL:-http://127.0.0.1:9222}/json/version"`
   有回應→直接接管；連不上→跑 `.browser/` 啟動腳本（Windows
   `cmd //c "$(pwd)/.browser/launch-chrome-cdp.bat"`；mac/Linux `bash …sh`；腳本不在就從
   `<PLUGIN_DIR>/templates/` 複製過去）。目標網站要登入就請使用者在該視窗登一次。
2. **WP 靶場（本流程的核心依賴——每個區塊都要渲染對照）**：`docker ps` 找
   `autobricks-wp`；沒起 → `docker compose -f "<PLUGIN_DIR>/docker/docker-compose.yml" up -d`；
   全新環境先跑 `bash "<PLUGIN_DIR>/docker/init-wp.sh"`（Bricks theme 解壓進
   `docker/wp/wp-content/themes/bricks/`）。**docker 起不來 → 退化為批次模式**
   （逐區生成、只做靜態 gate、無渲染對照），明確告知使用者驗證受限，別卡死。
3. **viewport 校準（量測與驗證共用的尺，歪了全盤皆歪）**：版面是視口寬度的函數——
   寬度不同就是在看「另一個版本的頁面」。`browser_resize` 到目標寬（桌機基準 1440）後，
   **必驗 `window.innerWidth` 是否等於目標**——Windows 顯示縮放（如 125%）會讓實際值
   變小，此時按 devicePixelRatio 補償（例：目標 1440、縮放 1.25 → resize 1800）。
   與使用者共用視窗時導航後設定可能失效：**每次導航後重驗一次**。
   **同一機制也是 RWD 的開關**：resize 到 768/375 就是在切斷點層——校準不準會掉進
   錯的斷點（以為在測 768 的 tablet 層，實際 614 已落入 mobile 層），測了等於沒測。
4. 產一個批次 id：`<YYYYMMDD-HHMMSS-站名>`（`date +%Y%m%d-%H%M%S`），產物都放 `data/<id>/`。

## Phase 1 — 全局分析（只收斂跨區決策；逐區深量留給主迴圈當場做）

1. `browser_navigate` 目標 URL → 等完整載入 → 逐屏捲到底觸發 lazy/入場動畫 → 回頂。
2. **全頁截圖三份基準**：1440 存 `data/<id>/source-desktop.png`；resize 768、375
   （皆過校準）各存 `source-tablet.png`／`source-mobile.png`（Phase 3 的對照基準）
   → 回 1440 重校準。輪播/marquee/影片/計數器記為**動態區**（對照時遮罩）。
3. **結構掃描（從 `body` 盤點，不是從 `main`）→ 區塊工作清單**（主迴圈就照這份清單
   的順序跑）：每區記 label、根節點 selector、概略高度、是否動態區。鐵則：
   - 從 `document.body` 往下走訪，**`main` 之外的兄弟節點一併盤點**——公告跑馬燈條、
     導覽列、footer、浮動裝飾常在 `main` 外面，只掃 `main` 必漏。
   - **矮的條狀區塊（高 40–100px 的公告列/跑馬燈）也是 section**，別用高度門檻濾掉。
   - 盤點完與全頁截圖**互相對照**：截圖上看得到的每一塊都要在清單裡，缺了就回頭補掃。
   - 第三方浮動 widget（客服泡泡、樣式切換工具列等 `position:fixed` 且非設計本體）
     標記排除，不進清單。
4. **全頁行為普查（視覺之外的另一半真相；工具：`<skill base>/behavior.js`）**：
   截圖量得到「長什麼樣」，量不到「會做什麼」——行為只存在於這份普查裡。對 `body`
   跑一次 behavior.js（結果落 `.browser/tmp/behavior-global.json`），得到五類證據：
   執行中動畫（`iterations:"Infinity"`＝常駐 marquee/spinner）、@keyframes 與 hover 規則
   （computed 讀不到的設計意圖）、互動元素盤點、JS 程式庫指紋（Swiper/GSAP/AOS…＝
   原站實作線索，主迴圈選階梯層時用）、2 秒 Mutation 熱點（自動輪播/跑馬燈/計數器
   抓漏網）。命中結果按區塊掛回工作清單（`dynamic` 標記＋行為摘要）——**清單上每一項
   行為之後都要有下落**（主迴圈登錄成 dynamic_tests 實作並實測，或明列 excluded／
   unsupported＋理由），不許無聲消失。
5. **原始碼分析（全局層；宣告真相與量測互補，缺一不可）**：computed style 只給
   「結果值」，讀不到設計意圖——rotate 常量出 `none`、hover 效果完全不在 computed 裡、
   斷點行為看不見。所以：
   - 抓 `document.documentElement.outerHTML` 落 `.browser/tmp/source.html`；主要 stylesheet
     一併抓下（`[...document.styleSheets]` 的 href 用 fetch 取回或直接讀 cssRules 全文落檔）
     ——主迴圈逐區讀 class 意圖時就查這兩份落檔，不重抓。
   - 讀 **global 樣式**：body 字族/底色、CSS variables、utility class 慣例（Tailwind 之類
     就是設計意圖的明文：`-rotate-2`＝旋轉、`shadow-[8px_8px_0_#000]`＝硬陰影、
     `hover:-translate-y-1`＝hover 浮起、`md:`/`lg:` 前綴＝斷點行為）。
   - **樣式元件化**：跨區重複出現的樣式組合提取成語意化元件（如「neo 卡片」＝白底+
     4px 黑框+硬陰影；「neo 按鈕」＝…含 hover 行為）→ 進 plan 的 `classes`，
     生成時＝Bricks Global Classes。
6. **tokens 與 assets**：統計重複色/字族/字級階/間距刻度；列 img/背景圖/SVG/字體
   （商用字體記最接近的免費替代）。另量**內容寬**（最外層置中容器實測寬）——
   之後釘 container 寬用。
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
    { "label": "主視覺", "selector": "main > section:nth-child(1)", "dynamic": false, "status": "todo" }
  ],
  "responsive": { "status": { "tablet": "todo", "mobile": "todo" } }
}
```

- **plan 的定位：初稿＋進度帳本，不是鐵則。** 全局版只收斂**跨區決策**（tokens、
  classes、內容寬、區塊工作清單）——這些只有看過全景才做得了。每區的細節（結構、
  measured、逐字文案、dynamic_tests）由主迴圈**當場分析、當場補進該 section、當場
  實作驗證**——細節不過夜、不跨區持有，這就是抗長上下文漂移的機制。
  最終仲裁者永遠是渲染實測對照原站；plan 服務流程，不是流程服務 plan。
- 逐區內容只寫結構＋measured＋逐字文案＋測試合約，不寫敘事。
- plan 寫完**直接進主迴圈**，不停下來等使用者指示。

## Phase 2 — 主迴圈：逐區塊「分析 → 實作 → 渲染對照 → 微調」（一區收斂才下一區）

**絕不「整頁生成完才回頭驗」**——每區實作完立刻推 WP、立刻在渲染分頁與原站分頁
並排對照，細節趁新鮮修掉。

**前置（進迴圈前做一次）**：
- 建構腳本 `tmp/build_template.py`：逐區迭代會反覆重建整份 template，**一律用腳本**——
  設計決策（結構、樣式、文案）以資料形式寫在腳本裡，id 產生與 parent/children 接線
  交給程式；**random seed 固定**，每次重建 id 不變（重推同頁、量測對照都穩）。
  先放 tokens 與 Global Classes（plan 的 `classes` → template 頂層 `globalClasses`
  陣列 `{id,name,settings}`，元素以 `_cssGlobalClasses:[classId,…]` 掛用，可掛多個）。
  修版面＝改腳本重跑，不手改 JSON。腳本屬過程檔，收尾清掉。
- **推送指令**（第一次推＝建新頁，記下回傳的 PAGE_ID；之後每輪加 `-e PAGE_ID=<n>`
  重推同一頁）：
  ```bash
  MSYS_NO_PATHCONV=1 docker cp "data/<id>/template.json" autobricks-wp:/tmp/template.json
  MSYS_NO_PATHCONV=1 docker cp "<PLUGIN_DIR>/docker/push-template.php" autobricks-wp:/tmp/
  MSYS_NO_PATHCONV=1 docker exec -e TEMPLATE=/tmp/template.json -e TITLE="<站名> (AutoBricks)" \
    autobricks-wp php /tmp/push-template.php    # 之後重推加 -e PAGE_ID=<n>
  ```
  （原理勿繞過：`wp_set_current_user(admin)` 否則 WP 靜默丟棄；`wp_slash` 否則剝引號。
  template 帶 `globalClasses` 時 push 腳本會合併寫入 `bricks_global_classes` option。
  預設建新頁，使用者指名才覆寫既有頁。）
- 對照台＝**兩個分頁**：原站沿用 Phase 1 的分頁、渲染頁另開一個，兩邊都做 1440 校準；
  渲染頁若帶登入態，**移除 `#wpadminbar`**（污染截圖與座標）。

**對工作清單的每一個區塊，依序做完 1–6 才碰下一區：**

1. **區塊分析（深量；鐵則：每個數字都來自量測，不准對截圖目測）**：
   - 語意摘要：targeted `browser_evaluate` 萃取——標題（字級/字重/盒樣式）、
     **重複群組偵測**（同父、同高的 ≥3 個兄弟＝卡片格，記欄數/gap/一張代表卡的樣式）、
     按鈕/連結樣式、圖片清單。結果小就 inline 回傳，大才落 `.browser/tmp/`。
   - 複雜區用 `<skill base>/measure.js` 全樹 dump 落檔後讀重點。
   - **隱藏文案採集（必做）**：手風琴答案、輪播非可見卡、tab 內容都不在畫面上——
     從 DOM 撈全文，別只抄截圖看得到的。
   - 該區原始碼 class 意圖逐一登錄（查 Phase 1 落檔的 source/CSS，兩邊互相印證：
     精確 px/色值以量測為準；rotate/hover/斷點/偽元素以宣告為準）；
     `sm:/md:/lg:` 斷點宣告**先登錄**進該區 plan，實作留給 Phase 3。
   - **區塊行為普查（必做）**：以該區根節點跑 `<skill base>/behavior.js`
     （落 `.browser/tmp/behavior-<區>.json`），加上全局普查掛到本區的項目＝該區行為清單；
     hover 效果再用真實指標 `browser_hover` 實測補證（`browser_evaluate` 派發合成
     mouseover **不會**觸發 CSS `:hover`，量了等於沒量）＋捲動觀察入場動畫/sticky。
2. **區塊 plan 初稿**（補進 plan.json 的該 section；**初稿非鐵則**，渲染實測後隨時改）：
   - Bricks 目標結構＝**極簡樹**——在這裡完成「DOM → Bricks」的重組（鐵律 1–5），
     不是把 DOM 抄下來。
   - **element 選型必查 `<skill base>/element-map.md`**：以第 1 步的量測＋行為普查
     為證據走決策漏斗（認角色 → 行為型 native 優先 → 沒有就基本元素拼裝），
     兩難時選設計部在 builder 裡改得動的那個；候選定案前查 live schema 確認存在，
     查無＝記 fallback 策略，絕不發明。**靜態複刻禁用 QUERY／WORDPRESS／SINGLE／
     WooCommerce 類元素**（吃 WP 資料庫的動態元素；細節與簽章對照表見 element-map）。
   - measured 用實測原值（不吸附、不湊整）；文字內容**逐字照抄**。
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
     5. 明列 unsupported＋原因——**只准是真後端功能**（登入、購物車、真實表單送出、
        即時資料…）：本 skill 產的是前端複刻，後端行為以 UI 狀態模擬或明列不做；
        純前端行為走不到這層。
4. **渲染對照（原站分頁 ↔ 渲染分頁，同一區並排看差異）**：
   - **a. 視覺**：兩邊該區各截圖、**並排判讀**——版型、色塊、陰影、角度、間距；
     `dynamic: true` 的區只驗結構佈局、不做像素級比對。
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
5. **微調**：a/b/c 任一 FAIL → **當場只修該區**（改 build script 該區資料或該 class）→
   rebuild → gate → 重推 → **只重驗該區**。同一區修 2 次仍不過 → status 記 `"manual"`、
   列入待人工清單，繼續下一區，別整批卡死。（Bricks 有外部 CSS 檔快取：重推後前端
   樣式沒動＝快取沒重生，用 `docker exec … php` 把 Bricks 全域設定的 CSS loading
   改成 inline——**勿用瀏覽器登入後台處理**。）
6. **收帳**：plan.json 該區 `status` → `"done"`（或 `"unsupported"`＋原因）。每區必須
   二選一，不許無聲消失。微調中改到**合約層**（classes 定義、dynamic_tests、響應規則）
   要同步回寫 plan——後面的斷點輪還要引用；數值層的微調直接改產出、驗過即可。

## Phase 3 — RWD：每個斷點把同一套迴圈確實再走一遍

行動流量是行銷頁的大宗——RWD 不是加分項。桌機全區 done 才開始；
**先 768（tablet）整輪走完，再 375（mobile）整輪**。每輪開始：**原站與渲染頁兩個
分頁都 resize＋過校準**（校準歪＝掉進錯的斷點層，測了等於沒測）；Phase 1 存的
`source-tablet.png`／`source-mobile.png` 當輔助基準，但以當下原站分頁實測為準。

對**同一份區塊清單**逐區（同 Phase 2 節奏，一區收斂才下一區）：
1. **分析**：原站該 viewport 的該區實測（幾欄變幾欄、導覽收合成什麼、哪些隱藏、
   字級/間距縮多少）＋ Phase 2 已登錄的斷點宣告 → 該區響應規則。
2. **實作**：轉成**斷點後綴設定**（`_direction:mobile_portrait`、
   `_typography:tablet_portrait`、`_padding:mobile_portrait`…；斷點鍵名讀 WP option
   `bricks_breakpoints`，未自訂＝預設 tablet_portrait ≤991／mobile_landscape ≤767／
   mobile_portrait ≤478；注意 Bricks 是 desktop-first——後綴＝該寬以下生效，與
   Tailwind mobile-first 方向相反，換算時「基準」與「後綴」要互換）。常見手法：
   欄數收合（row→column 或 wrap）、字級降階、間距縮減、`_display:none` 隱藏；
   共用樣式的響應行為寫進 Global Class（class settings 同樣支援斷點後綴）。
   **只動後綴、不動基準值**——桌機已收斂，不准弄壞。→ rebuild → gate → 重推。
3. **對照**：兩邊該區並排截圖＋computed 對照＋**該區無水平溢出**；
   行為隨斷點變化的動態項重測（如導覽收合），其餘不重複。
4. **微調**到過才下一區；同區 2 次不過記待人工。
每輪走完：`responsive.status` 該斷點 → `"done"`。

## Phase 4 — 全頁總檢＋收尾

1. **全頁總檢（區塊各自對了 ≠ 整頁對了）**：三個斷點各做——`#brxe-*` 元素數＝
   template 數、整頁捲一遍看**區塊銜接**（背景相接、間距節奏、sticky/fixed 層疊）、
   **全頁無水平溢出**、全頁截圖與原站並排總對照。桌機存
   `data/<id>/rendered-desktop.png`（768/375 也各存一份）。發現跨區問題，
   照 Phase 2 第 5 步的微調做法修相關區塊。
2. **新知識的歸宿（鐵則）**：驗證中發現的新平台知識（渲染怪癖、欄位行為、版面雷）寫進
   **使用者專案的 `bricks-gotchas.local.md`**（不存在就建立；一條＝現象＋解法＋驗證當時的
   Bricks 版本）。**絕不寫 plugin 目錄**——plugin 只該有通用方法，且 marketplace update
   時會重新複製出全新的版本資料夾，寫在 plugin 內的任何修改都會無聲蒸發。
3. 關掉本次開的分頁（別關整台 Chrome）；清空 `.browser/tmp/` 與 `tmp/`；掃一眼專案根沒有垃圾。
4. 回報：plan 與 template 路徑、element 數/最大深度（編輯性指標）、**逐區驗證表**
   （區塊｜視覺｜程式碼｜操作｜桌機/768/375 判定）、**行為覆蓋帳**（普查條目 →
   dynamic_tests → PASS／excluded／unsupported，一條不漏——這就是「不只複刻外觀」
   的交付證明）、「待人工」清單（有的話）、PAGE_ID 與 permalink、
   unsupported 清單（有的話）。
5. 提醒使用者：也可在 WP 後台 Bricks → Templates → Import 直接匯入 `template.json`。
