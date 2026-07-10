---
name: clone
description: 一條龍把任一網頁複刻成「設計部好編輯」的 Bricks Builder 1.12.5 頁面——CDP 接管真 Chrome（無自動化指紋）全面分析網頁（HTML/CSS/JS 動態，數字全實測）→ 寫施工 plan（結構已重組成極簡 Bricks 樹、element 參照 schema）→ 直接生成模板 JSON（驗證 gate 必過）→ 推進本機 Docker WP 實際渲染 → 多策略驗證成果（看 HTML 結構/CSS/JS/截圖對照）→ 迭代到過關。觸發詞（含口語與意圖）：「複刻這個網站 / clone 這個網頁 / 照這個網站做一版 / 抄這個版型 / 參考這個網站拉一版 / 把這個網址變 bricks / 網頁轉 bricks / 幫我 copy 這個網站 / 分析這個網站 / 做成模板」等，或使用者貼了一個要複刻的網址時，觸發。
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
   surface 的群組」才允許再加一層 `block`。內容元素距離 section **最多 4 層**（含 container）。
3. **每一層都要有存在的理由**（分欄、卡片底、需要獨立背景/邊框/定位的群組）。
   只有一個子元素、又沒有自己視覺效果的純 wrapper——**塌掉**，樣式併進子元素或父層。
4. **多個樣式來源疊在同一視覺結果**（外層 padding + 內層 margin + 再一層 wrapper 的
   position…）→ 合併成一層的等效樣式，不保留歷史。
5. **每個結構層給 zh-TW `label`**（「主視覺」「三欄卡片」「CTA 區」…）——設計部靠這個定位。
6. 驗證 gate 會對「單子純 wrapper」與「深度過深」發警告——**警告視同不及格，回頭壓平**。

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
3. 產一個批次 id：`<YYYYMMDD-HHMMSS-站名>`（`date +%Y%m%d-%H%M%S`），產物都放 `data/<id>/`。

## Phase 1 — 分析與量測（一次開頁、多面向；絕不重複爬）

1. `browser_navigate` 目標 URL → 等完整載入 → 逐屏捲到底觸發 lazy/入場動畫 → 回頂。
2. 全頁截圖（desktop，建議寬 1440）→ 之後存 `data/<id>/source-desktop.png`。
   輪播/marquee/影片/計數器記為**動態區**（之後驗證要遮罩）。
3. **結構掃描**：判讀語意區塊（header/hero/features/cards/pricing/footer…），找出各 section
   根節點 selector。
4. **逐 section 量測**（鐵則：plan 裡每個數字都來自這裡，不准對截圖目測）：
   讀 `<skill base>/measure.js` 整段貼進 `browser_evaluate`、參數換該 section 的 selector，
   `filename` 落到 `.browser/tmp/measure-<section>.json` 再讀重點。另外量**內容寬**
   （最外層置中容器實測寬）——之後釘 container `_widthMax` 用。
5. **動態效果**：掃 CSSOM（`@keyframes`/`transition`/`:hover` 規則）＋ `browser_hover` 實測
   主要按鈕/卡片 ＋ 捲動觀察入場動畫與 sticky。記 `{target, trigger, effect, css}`。
6. **tokens 與 assets**：統計重複色/字族/字級階/間距刻度；列 img/背景圖/SVG/字體
   （商用字體記最接近的免費替代）。

## Phase 2 — 寫 plan（然後直接上工，不停下來等指示）

存 `data/<id>/plan.json`。**plan 的樹＝Bricks 目標結構**——在這裡就完成「DOM → 極簡
Bricks 樹」的重組（鐵律 1–5），不是把 DOM 抄下來留給生成階段煩惱。

```json
{
  "id": "…", 
  "source": { "url": "", "viewport_width": 1440, "content_width": 1200, "page_height": 0 },
  "tokens": { "colors": {}, "typography": {}, "spacing_scale": [] },
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
  "validation_checklist": [ "hero 高 720±8px", "主色 #ff5a1f", "結構深度 ≤4" ]
}
```

- `bricks` 只准填 `<PLUGIN_DIR>/bricks-schema/elements/` 存在的 element 名
  （`h1–h6`→`heading`、內文→`text-basic`、CTA→`button`、圖→`image`）；對不上→`fallbacks`。
- 文字內容**逐字照抄**；measured 用實測原值（不吸附、不湊整）。
- plan 寫完**直接進 Phase 3**，不用問使用者。

## Phase 3 — 生成 Bricks JSON ＋ 驗證 gate

**先讀 `<skill base>/bricks-1125-gotchas.md` 整份**（1.12.5 已驗證形狀——`_gradient` 獨立
key、`_boxShadow` 是 object、字體拆 fallback、`%root%` 不替換…衝突時以它為準）；
每個 element 的 settings 欄位逐一對 `<PLUGIN_DIR>/bricks-schema/elements/<name>.json`
確認存在——**schema 沒有的欄位＝不存在，絕不發明**（`selectors` 等 2.x 特性 1.12.5 不可用）。

- 扁平陣列 `{id, name, parent, children, settings, label}`，根 `parent: 0`。
- **id：6 碼 `[a-z0-9]` 且至少 1 個數字**（匯入 id 全域字串替換的防撞規則）。
- container 用 plan 的 `content_width` 釘 `_widthMax`。
- native 設定優先（builder 可編輯＝設計部的命）；`_cssCustom` 只用在 fallbacks 指定處、
  **一律真實 `#brxe-<id>`**（id 定案後才寫）、**絕不 `%root%`**。
- 圖片釘 `_width` ＋ id-scoped `aspect-ratio`，不固定 `_height`。
- 動態效果照 gotchas 的**四層階梯**處理：自帶 JS 的原生元素（輪播/手風琴/counter…）
  → `_interactions` 原生互動 → hover 後綴/`_cssCustom` CSS 模擬 → 明列 unsupported。
- 寫進 `data/<id>/template.json` 後跑 gate：
  ```bash
  uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/src/validate_template.py" "data/<id>/template.json"
  ```
  **error 修到零；「純 wrapper」「深度」警告視同不及格**（鐵律 6），回頭壓平再驗。
- plan 每個 section 必須「已生成」或「unsupported＋原因」二選一，不許無聲消失。

## Phase 4 — 推 WP、實際渲染、多策略驗證

沒渲染過的一律不信。docker 環境在的話：

1. **推送**（寫 postmeta，不走 UI；預設建新頁，使用者指名才覆寫）：
   ```bash
   MSYS_NO_PATHCONV=1 docker cp "data/<id>/template.json" autobricks-wp:/tmp/template.json
   MSYS_NO_PATHCONV=1 docker cp "<PLUGIN_DIR>/docker/push-template.php" autobricks-wp:/tmp/
   MSYS_NO_PATHCONV=1 docker exec -e TEMPLATE=/tmp/template.json -e TITLE="<站名> (AutoBricks)" \
     autobricks-wp php /tmp/push-template.php    # 覆寫加 -e PAGE_ID=<n>
   ```
   （原理勿繞過：`wp_set_current_user(admin)` 否則 WP 靜默丟棄；`wp_slash` 否則剝引號。）
2. **多策略驗證**（用同一台 9222 Chrome 開 `http://localhost:8080/?page_id=<PAGE_ID>`，
   逐屏捲動後回頂）：
   - **看 HTML（編輯性）**：`browser_evaluate` 數渲染後的 `#brxe-*` 結構——最大深度、
     單子 wrapper 數。**跟原站比不重要，跟鐵律比才重要**：超標就回 Phase 3 壓平。
   - **看 CSS（保真）**：對關鍵元素量 `#brxe-<id>` 的 box/字級/顏色/間距，與 plan 的
     measured 相減——**元素級差值是主要修復訊號**；整頁像素比對只當煙霧警報。
   - **看 JS/動態**：hover 過去看效果有沒有出來、入場動畫/`_cssCustom` 的 keyframe 有沒有跑。
   - **看截圖**：全頁截圖存 `data/<id>/rendered-desktop.png`，與 `source-desktop.png` 並排
     判讀（plan 標 `dynamic: true` 的區域跳過）。
3. **迭代**：樣式數值差→直接改 template.json 對應 settings、重推同一頁（`-e PAGE_ID=<剛才的>`；
   Bricks 有 CSS 快取，樣式沒更新就後台重存該頁或把 CSS loading 改 inline）。
   結構性的差→回 Phase 2/3。**最多 3 輪**，未收斂就停下出報告，別無限燒。

## Phase 5 — 收尾

1. 關掉本次開的分頁（別關整台 Chrome）；清空 `.browser/tmp/` 與 `tmp/`；掃一眼專案根沒有垃圾。
2. 回報：plan 與 template 路徑、element 數/最大深度（編輯性指標）、驗證結論（過/不過＋
   差異清單）、PAGE_ID 與 permalink（有推的話）、unsupported 清單（有的話）。
3. 提醒使用者：也可在 WP 後台 Bricks → Templates → Import 直接匯入 `template.json`。
