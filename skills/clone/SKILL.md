---
name: clone
description: 一條龍把任一網頁複刻成「設計部好編輯」的 Bricks Builder 頁面——CDP 接管真 Chrome（無自動化指紋）全面分析網頁（HTML/CSS/JS 動態，數字全實測）→ 寫施工 plan（結構已重組成極簡 Bricks 樹、element 參照 schema）→ 直接生成模板 JSON（驗證 gate 必過）→ 推進本機 Docker WP 實際渲染 → 照區塊清單逐區驗證（視覺截圖／HTML 結構／CSS 套用／動態操作實測）、逐區微調 → RWD 逐斷點驗證。觸發詞（含口語與意圖）：「複刻這個網站 / clone 這個網頁 / 照這個網站做一版 / 抄這個版型 / 參考這個網站拉一版 / 把這個網址變 bricks / 網頁轉 bricks / 幫我 copy 這個網站 / 分析這個網站 / 做成模板」等，或使用者貼了一個要複刻的網址時，觸發。
---

# clone

網址 → 分析 → plan → Bricks JSON → 推 WP → 驗證，一次做完。
產出是**給設計部接手小改的開端稿**——所以最高原則不是像素還原，是**好編輯**。

## ⭐ 結構鐵律（整條流程的最高原則，每一階段都要回頭對照）

照翻 HTML div 層次的轉換結果，會讓設計部在 builder 裡定位一個元件要扒開五六層冗容器
——**本 skill 的存在理由就是消滅這種結構**。

1. **絕不照翻 DOM 層次。** HTML 的多層 div 是疊樣式和歷史包袱；Bricks 結構只服務兩件事：
   版面成立、人好編輯。**樣式外觀特效達到就好，結構自己重新設計。**
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
2. **WP 靶場**（要實測才需要）：`docker ps` 找 `autobricks-wp`；沒起 →
   `docker compose -f "<PLUGIN_DIR>/docker/docker-compose.yml" up -d`；全新環境先跑
   `bash "<PLUGIN_DIR>/docker/init-wp.sh"`（Bricks theme 解壓進 `docker/wp/wp-content/themes/bricks/`）。
   **docker 起不來就先做到 template.json 為止**，跟使用者說明即可，別卡死。
3. **viewport 校準（量測與驗證共用的尺，歪了全盤皆歪）**：版面是視口寬度的函數——
   寬度不同就是在看「另一個版本的頁面」。`browser_resize` 到目標寬（桌機基準 1440）後，
   **必驗 `window.innerWidth` 是否等於目標**——Windows 顯示縮放（如 125%）會讓實際值
   變小，此時按 devicePixelRatio 補償（例：目標 1440、縮放 1.25 → resize 1800）。
   與使用者共用視窗時導航後設定可能失效：**每次導航後重驗一次**。
   **同一機制也是 RWD 的開關**：resize 到 768/375 就是在切斷點層——校準不準會掉進
   錯的斷點（以為在測 768 的 tablet 層，實際 614 已落入 mobile 層），測了等於沒測。
4. 產一個批次 id：`<YYYYMMDD-HHMMSS-站名>`（`date +%Y%m%d-%H%M%S`），產物都放 `data/<id>/`。

## Phase 1 — 分析與量測（一次開頁、多面向；絕不重複爬）

1. `browser_navigate` 目標 URL → 等完整載入 → 逐屏捲到底觸發 lazy/入場動畫 → 回頂。
2. 全頁截圖（於已校準的 1440 基準）→ 之後存 `data/<id>/source-desktop.png`。
   輪播/marquee/影片/計數器記為**動態區**（之後驗證要遮罩）。
3. **結構掃描（從 `body` 盤點，不是從 `main`）**：判讀語意區塊（header/hero/features/
   cards/pricing/footer…），找出各 section 根節點 selector。鐵則：
   - 從 `document.body` 往下走訪，**`main` 之外的兄弟節點一併盤點**——公告跑馬燈條、
     導覽列、footer、浮動裝飾常在 `main` 外面，只掃 `main` 必漏。
   - **矮的條狀區塊（高 40–100px 的公告列/跑馬燈）也是 section**，別用高度門檻濾掉。
   - 盤點完與全頁截圖**互相對照**：截圖上看得到的每一塊都要在清單裡，缺了就回頭補掃。
   - 第三方浮動 widget（客服泡泡、樣式切換工具列等 `position:fixed` 且非設計本體）
     標記排除，不進 plan。
4. **原始碼分析（宣告真相；與量測互補，缺一不可）**：computed style 只給「結果值」，
   讀不到設計意圖——rotate 常量出 `none`、hover 效果完全不在 computed 裡、斷點行為看不見。
   所以必須讀 source：
   - 抓 `document.documentElement.outerHTML` 落 `.browser/tmp/source.html`；主要 stylesheet
     一併抓下（`[...document.styleSheets]` 的 href 用 fetch 取回或直接讀 cssRules 全文落檔）。
   - 從 `body` 由上而下走 HTML 結構樹（header/nav/main/section/footer…），**逐區塊**讀該區
     元素的 class 清單——utility class（Tailwind 之類）就是設計意圖的明文：`-rotate-2`＝
     旋轉、`shadow-[8px_8px_0_#000]`＝硬陰影、`hover:-translate-y-1`＝hover 浮起、
     `md:`/`lg:` 前綴＝斷點行為。逐一登錄進該區的分析。
   - **兩邊互相印證**：精確 px/色值以量測為準；rotate/hover/斷點/偽元素以宣告為準。
   - **樣式元件化**：把重複出現的樣式組合提取成語意化元件（如「neo 卡片」＝白底+4px 黑框+
     硬陰影；「neo 按鈕」＝…含 hover 行為）→ 進 plan 的 `classes`，生成時變 Bricks
     Global Classes（見 Phase 3）。
5. **逐 section 量測**（鐵則：plan 裡每個數字都來自量測，不准對截圖目測）。兩段式：
   - **語意摘要**（每區必做）：用 targeted `browser_evaluate` 萃取——標題（字級/字重/盒樣式）、
     **重複群組偵測**（同父、同高的 ≥3 個兄弟 = 卡片格，記欄數/gap/一張代表卡的樣式）、
     按鈕/連結樣式、圖片清單。結果小就直接 inline 回傳，大才落 `.browser/tmp/`。
   - **重點深量**（複雜區才做）：`<skill base>/measure.js` 全樹 dump 落檔後讀重點。
   - **隱藏文案採集**（必做）：手風琴答案、輪播非可見卡、tab 內容都不在畫面上——
     從 DOM 撈全文，別只抄截圖看得到的。
   - 另外量**內容寬**（最外層置中容器實測寬）——之後釘 container 寬用。
6. **動態效果**：原始碼的 hover/animation class 為主（第 4 步已登錄）＋ `browser_hover` 實測
   主要按鈕/卡片（**必須用真實指標的 browser_hover 工具**；`browser_evaluate` 派發合成
   mouseover 事件不會觸發 CSS `:hover`，量了等於沒量）＋ 捲動觀察入場動畫與 sticky。
   記 `{target, trigger, effect, css}`。
7. **RWD 實測（必做，行動流量是行銷頁的大宗）**：
   - 宣告面：第 4 步已登錄的 `sm:/md:/lg:` 斷點 class ＝ 原站的響應意圖，對映到
     Bricks 斷點（desktop-first：後綴＝該寬以下生效，與 Tailwind mobile-first
     方向相反，換算時「基準」與「後綴」要互換）。
   - 實測面：`browser_resize` 到 **768 與 375**（皆做 viewport 校準）各做一輪——
     全頁截圖＋逐區記錄行為：幾欄變幾欄、導覽列收合成什麼、哪些元素隱藏、
     字級/間距縮多少。
   - 每區的響應行為寫成 plan `responsive.rules` 的一條（例：「三欄卡片 → tablet 2 欄
     → mobile 1 欄」「跑馬燈字級 20→16」）。
8. **tokens 與 assets**：統計重複色/字族/字級階/間距刻度；列 img/背景圖/SVG/字體
   （商用字體記最接近的免費替代）。

## Phase 2 — 寫 plan（寫完直接上工，不停下來等使用者指示）

> **plan 的定位：基礎參考，不是絕對標準。** 寫 plan 是為了兩件事：把**跨區決策**
>（tokens、classes 提取、內容寬）收斂下來——這些只有看過全景才做得了；把**測試合約**
>（dynamic_tests、responsive.rules、static_checklist）白紙黑字——長任務 context 會漂移，
> 寫下來的才可靠。但**最終仲裁者永遠是 Phase 4 渲染出來的真頁面對照原站**——
> 做完一定回看、微調到 OK 為止。生成/驗證中發現 plan 錯或不足：數值層的微調直接改
> 產出、驗過即可；**合約層的變更**（classes 定義、測試項、響應規則）才回寫 plan，
> 因為後續階段還要引用它。plan 服務流程，不是流程服務 plan。
> **尺寸原則**：全域決策與合約必寫；逐區只寫結構＋measured＋逐字文案，不寫敘事。

存 `data/<id>/plan.json`。**plan 的樹＝Bricks 目標結構**——在這裡就完成「DOM → 極簡
Bricks 樹」的重組（鐵律 1–5），不是把 DOM 抄下來留給生成階段煩惱。

```json
{
  "id": "…", 
  "source": { "url": "", "viewport_width": 1440, "content_width": 1200, "page_height": 0 },
  "tokens": { "colors": {}, "typography": {}, "spacing_scale": [] },
  "classes": [ { "name": "neo-card", "desc": "白底+4px黑框+8px硬陰影", "hover": "浮起：translate(-4,-4)+陰影加深" } ],
  "assets": [ { "name": "", "url": "", "kind": "image", "used_in": "" } ],
  "sections": [
    { "label": "主視覺", "bricks": "section", "dynamic": false,
      "measured": { "h": 720, "padding": [96, 0, 96, 0], "bg": "#0b0b0f" },
      "children": [
        { "bricks": "container", "measured": { "w": 1200 }, "children": [
          { "bricks": "heading", "tag": "h1", "text": "逐字照抄的標題",
            "measured": { "font-size": "56px", "font-weight": "700", "color": "#fff" } }
        ] }
      ],
      "interactions": [ { "target": "CTA", "trigger": "hover", "effect": "…", "css": "…" } ]
    }
  ],
  "responsive": { "breakpoints_observed": {}, "rules": [] },
  "fallbacks": [ { "target": "", "why": "native 無此效果", "strategy": "id-scoped _cssCustom" } ],
  "static_checklist": [ "hero 高 720±8px", "主色 #ff5a1f", "結構深度 ≤4" ],
  "dynamic_tests": [
    { "target": "主 CTA 按鈕", "action": "hover", "expect": "浮起 translate(-4,-4)、陰影加深、有 transition" },
    { "target": "FAQ 手風琴", "action": "click 第 1 題", "expect": "答案展開且文字與 plan 一致" },
    { "target": "頂部跑馬燈", "action": "觀察 2 個時間點", "expect": "持續左移；hover 暫停" }
  ]
}
```

- `bricks` 只准填 schema 查得到的 element 名（live schema 已抽就以它為準；
  否則 `<PLUGIN_DIR>/bricks-schema/elements/`）
  （`h1–h6`→`heading`、內文→`text-basic`、CTA→`button`、圖→`image`）；對不上→`fallbacks`。
- 文字內容**逐字照抄**；measured 用實測原值（不吸附、不湊整）。
- **`responsive.rules` 必須填**（Phase 1 第 7 步的產出）：每條寫「哪一區、哪個斷點、
  行為變化、目標值」——這是 Phase 3 產斷點後綴設定的依據；空著＝產出沒有 RWD。
- **`dynamic_tests` 是 Phase 4 動態測試的合約**：分析時看到的每個互動/動態行為
  （hover、點擊展開、輪播、sticky、表單…）都要在這裡登錄成一條測試案例——
  `target`（哪個元件）、`action`（怎麼操作）、`expect`（原站的預期行為，講清楚）。
  沒登錄的行為 Phase 4 不會測，等於沒驗。
- plan 寫完**直接進 Phase 3**，不用問使用者。

## Phase 3 — 生成 Bricks JSON ＋ 驗證 gate

**先讀 ground truth（順序即優先序；plugin 不內建版本知識、絕不假設 Bricks 版本）**：
1. **使用者專案的 `bricks-gotchas.local.md`**（若存在）——本專案累積的實證經驗
   （設定值形狀與渲染地雷，每條標註驗證版本）。
2. **live schema（元素/欄位存在性的最高權威）**：docker 環境在時，確保
   `data/bricks-schema-live.json` 存在——沒有就跑
   `uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/src/extract_bricks_schema.py"`
   （直接從**使用者裝的 theme** PHP 原始碼抽出 schema，版本自動對齊）。
   值的「形狀」不確定、經驗又沒記載時：用 live schema 各 element 的 `file` 欄位
   開對應 theme 原始碼查 control 定義，或推 WP 渲染實測定案——不猜。
3. `<PLUGIN_DIR>/bricks-schema/`——官方 v2.3 副本（對應 Bricks 2.x）：live 不可用時
   的 fallback。**官方有、live 查無的欄位＝使用者的版本沒有，絕不發明。**

- 扁平陣列 `{id, name, parent, children, settings, label}`，根 `parent: 0`。
- **id：6 碼 `[a-z0-9]` 且至少 1 個數字**（匯入 id 全域字串替換的防撞規則）。
- container 用 plan 的 `content_width` 釘 `_widthMax`。
- **樣式用 Global Classes 組裝**（plan 的 `classes` → template 頂層 `globalClasses`
  陣列 `{id,name,settings}`，元素以 `_cssGlobalClasses:[classId,…]` 掛用，可掛多個）——
  重複樣式只定義一次，設計部改 class 全站連動。元素自己的 settings 只放「這顆獨有」的值。
- 圖片釘 `_width` ＋ id-scoped `aspect-ratio`，不固定 `_height`。
- **RWD 用斷點後綴 key 落地**（`_direction:mobile_portrait`、`_typography:tablet_portrait`、
  `_padding:mobile_portrait`…，斷點鍵名讀 WP option
  `bricks_breakpoints`，未自訂＝預設 tablet_portrait ≤991／mobile_landscape ≤767／
  mobile_portrait ≤478）：依 plan 的 `responsive.rules` 逐條
  轉成對應元素的後綴設定——欄數收合（row→column 或 wrap）、字級降階、間距縮減、
  `_display:none` 隱藏。Global Classes 的 settings 同樣支援斷點後綴，共用樣式的響應
  行為寫在 class 裡一次搞定。
- 動態與視覺效果照**四層階梯**處理：自帶 JS 的原生元素（輪播/手風琴/
  counter…）→ `_interactions` 原生互動 → CSS 層（**優先 native 狀態設定**：`_transform`
  旋轉、`_boxShadow:hover`/`_transform:hover` 浮起——builder 可編輯；native 表達不了的
  keyframes/偽元素/pattern 才用 `_cssCustom`——共用的放 class、單顆的放元素，
  **一律真實 `#brxe-<id>`、絕不 `%root%`**，id 定案後才寫）→ 明列 unsupported。
- **元素多（約 >80）就別手寫 JSON**：寫一支 `tmp/build_template.py` 做機械展開——
  設計決策（結構、樣式、文案）以資料形式寫在腳本裡，id 產生與 parent/children 接線交給
  程式；**random seed 固定**，迭代重建時 id 不變（重推同頁、量測對照都穩）。
  修版面 = 改腳本重跑，不手改 JSON。腳本屬過程檔，收尾清掉。
- 寫進 `data/<id>/template.json` 後跑 gate：
  ```bash
  uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/src/validate_template.py" "data/<id>/template.json"
  ```
  **error 修到零；「純 wrapper」警告一律壓平；「深度」警告逐一審核**（鐵律 6）——
  有正當理由的層記為已審例外，其餘壓平再驗。
- plan 每個 section 必須「已生成」或「unsupported＋原因」二選一，不許無聲消失。

## Phase 4 — 推 WP、逐區驗證與微調

沒渲染過的一律不信。docker 環境在的話：

1. **推送**（寫 postmeta，不走 UI；預設建新頁，使用者指名才覆寫）：
   ```bash
   MSYS_NO_PATHCONV=1 docker cp "data/<id>/template.json" autobricks-wp:/tmp/template.json
   MSYS_NO_PATHCONV=1 docker cp "<PLUGIN_DIR>/docker/push-template.php" autobricks-wp:/tmp/
   MSYS_NO_PATHCONV=1 docker exec -e TEMPLATE=/tmp/template.json -e TITLE="<站名> (AutoBricks)" \
     autobricks-wp php /tmp/push-template.php    # 覆寫加 -e PAGE_ID=<n>
   ```
   （原理勿繞過：`wp_set_current_user(admin)` 否則 WP 靜默丟棄；`wp_slash` 否則剝引號。
   template 帶 `globalClasses` 時 push 腳本會合併寫入 `bricks_global_classes` option。）
2. **驗證主迴圈：照 plan 的區塊清單「逐區驗證、逐區微調」**。
   定位先分清楚：**腳本驗證（validate_template.py）只是語法層級的靜態測試**，Phase 3 已把關；
   「像不像、會不會動」只有 Agent 用 CDP 測得出來——而且要**跟分析同一份區塊清單、
   同一個順序，各個擊破**：一區驗完（含微調）才進下一區，修錯才有局部性。
   開測前置：**移除 `#wpadminbar`**（污染截圖與座標）、**重驗 viewport 校準 1440**（見 Phase 0）、
   全域快檢一次（`#brxe-*` 元素數＝template 數、最大深度對鐵律、無水平溢出）。

   **對 plan 的每一個 section，依序做三項檢查＋判定：**
   - **a. 視覺（CDP 截圖）**：該區元素截圖 ↔ 原站對應區截圖**並排判讀**——版型、色塊、
     陰影、角度、間距；`dynamic: true` 的區只驗結構佈局、不做像素級比對。
   - **b. 程式碼（HTML 結構＋CSS 套用）**：`browser_evaluate` 讀該區——
     HTML：該區 `#brxe-*` 深度/wrapper 對照鐵律；
     CSS：關鍵元素的 computed（box/字級/色/間距）與 plan 的 measured 相減
     （**元素級差值是主要修復訊號**），並確認 Global Classes 有掛上（classList 含 class 名）。
   - **c. 操作（動態效果實測）**：執行**屬於該區**的 `dynamic_tests`——每條＝
     **操作 → 取證 → 判定**：真實指標 `browser_hover`／`browser_click`／捲動／輸入，
     操作**前後各取證**（截圖存 `.browser/tmp/test-<區>-<n>.png`＋量測 transform/shadow/
     高度變化），與 `expect` 比對。常見測法：hover＝前後 transform/box-shadow 差；
     手風琴/tab＝點開後內容出現且文字正確；跑馬燈/輪播＝隔 1–2 秒兩讀 transform 證明
     在動＋hover 暫停；sticky＝捲動後仍在頂；表單＝可輸入。
   - **d. 判定與當場微調**：a/b/c 任一 FAIL → **當場只修該區**（改 build script 該區資料
     或該 class → rebuild → 重推同頁 `-e PAGE_ID=<n>` → **只重驗該區**）→ 過了才進下一區。
     同一區修 2 次仍不過 → 記入報告「待人工」，繼續下一區，別整批卡死。
     （Bricks 有 CSS 快取：樣式沒更新就後台重存該頁、或把 CSS loading 改 inline。）

   全區掃完產出**逐區驗證表**（區塊｜視覺｜程式碼｜操作｜判定），並存全頁截圖
   `data/<id>/rendered-desktop.png` 留檔。
3. **RWD 驗證：同一條思路降維再掃（桌機全區過了才開始）**：
   - `browser_resize` 768（**過校準**）→ 依**同一份區塊清單**逐區掃：視覺（與原站 768 的
     該區並排）＋ 程式碼（欄數收合/隱藏/字級對照 `responsive.rules`、該區無水平溢出）；
     FAIL → 微調該區的**斷點後綴設定** → 重推 → 只重驗該區。
   - 再 375 同上。動態操作只重測「行為隨斷點變化」的項目（如導覽收合），其餘不重複。
   - 只修「桌機已對、行動版壞掉」的設定（動後綴、不動基準值），避免弄壞已收斂的桌機版。

## Phase 5 — 收尾

1. **新知識的歸宿（鐵則）**：驗證中發現的新平台知識（渲染怪癖、欄位行為、版面雷）寫進
   **使用者專案的 `bricks-gotchas.local.md`**（不存在就建立；一條＝現象＋解法＋驗證當時的
   Bricks 版本）。**絕不寫 plugin 目錄**——plugin 只該有通用方法，且 marketplace update
   時會重新複製出全新的版本資料夾，寫在 plugin 內的任何修改都會無聲蒸發。
2. 關掉本次開的分頁（別關整台 Chrome）；清空 `.browser/tmp/` 與 `tmp/`；掃一眼專案根沒有垃圾。
3. 回報：plan 與 template 路徑、element 數/最大深度（編輯性指標）、**逐區驗證表**
   （區塊｜視覺｜程式碼｜操作｜判定）＋ **RWD 逐斷點結果**、「待人工」清單（有的話）、
   PAGE_ID 與 permalink（有推的話）、unsupported 清單（有的話）。
4. 提醒使用者：也可在 WP 後台 Bricks → Templates → Import 直接匯入 `template.json`。
