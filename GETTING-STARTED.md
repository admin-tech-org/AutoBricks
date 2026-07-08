# Getting Started — Bricks CDP Visual Generator

本系統透過 CDP/Playwright 渲染真實網站、擷取螢幕截圖並提取 DOM/CSS/版面配置，合併為 **Page IR**，再生成可匯入的 **Bricks Builder JSON**。

## 安裝

```bash
npm install
npx playwright install chromium   # 下載瀏覽器（僅需 1 次）
npm run build                     # 建置整個 workspace（tsc -b + esbuild dashboard）
```

## 方式 1 — CLI（直接執行 pipeline）

```bash
npm run generate -- --url https://example.com
# 或使用本地 fixture 進行測試：
npm run generate -- --url "file:///C:/Users/User/Desktop/CDP_AutoBricks/test-fixtures/landing.html"
```

選項：

```text
--url <url>              http(s):// 或 file://（擷取時必填）
--job <jobId>            重新分析 1 個已擷取的 job（不重新開啟 browser）
--mode landing-page      （預設）
--viewports desktop,tablet,mobile
--storage <dir>          （預設 ./storage）
--id-style readable|bricks
--vision heuristic|ai    （預設 heuristic）
--vision-model <model>   AI vision 使用的 model（預設 sonnet）
--vision-concurrency <n> 並行執行的 vision subagent 數量（預設 4）
```

輸出位於 `storage/`：

```text
storage/
├── screenshots/<jobId>/{desktop,tablet,mobile,full-page}.png
├── snapshots/<jobId>/{dom,css,layout,assets}.json
├── ir/<jobId>/page-ir.json
├── templates/<jobId>/{template.json, template-kit.zip}
└── reports/<jobId>/{analysis-report.json, validation-report.json, preview.html, preview.png, diff.png}
```

## AI Vision 模式（pixel-fidelity）

Analyzer 預設為純 heuristic（rule engine + 像素取樣）。啟用 `--vision ai`
可達到更高的還原度：analyzer 會 **fan-out 多個 `claude -p` subagent 並行
執行** — 每個 section 一個 subagent，外加一個全域 subagent — 讀取各
section 的裁切圖，再依照真實 pixel 渲染結果修正 **背景色 / gradient / typography / 版面配置 / 按鈕顏色**（§8、§22：Color/Theme 樣式取自螢幕截圖）。

```bash
# 擷取並以 AI vision 分析：
npm run generate -- --url https://example.com --vision ai

# 以 AI vision 重新分析 1 個已擷取的 job（不重新開啟 browser）：
npm run generate -- --job job_xxxxxxxx --vision ai
```

需求：機器上的 Claude CLI 已登入（以 `claude --version` 檢查）。每個
subagent 呼叫約 5–15 秒，並行執行（預設 4 條執行緒，以 `--vision-concurrency` 調整）。
vision 結果儲存於 `storage/reports/<jobId>/vision-ai-report.json`，裁切圖位於
`storage/vision/<jobId>/`。任一 subagent 的所有錯誤都會平順地 fallback 回該 section 的 heuristic
結果 — pipeline 絕不會因 vision 而失敗。

API：在 `POST /jobs` 的 body 中加入 `"vision": "ai"`（並可選擇加入 `"visionModel": "sonnet"`）。

## Design system + 動態效果（NATIVE Bricks settings）

Design 與 motion 是以 **Bricks 的 NATIVE 設定** 套用（而非 `_cssCustom` blob），
因此 **可直接在 builder UI 中編輯**，並像其他任何 element 一樣在匯入時隨 template 一併帶入。
`packages/bricks/src/generate-json.ts` 中的 `applyNativeDesign` pass（fragment 位於
`packages/bricks/src/design-native.ts`）會在 flatten 之後走訪 content 並掛上：

- **卡片（card）**：卡面 `_background` + `_border`（圓角 + hairline）+ `_boxShadow`（深度
  陰影）+ `_padding`；hover 時以 `_transform:hover` / `_boxShadow:hover` /
  `_border:hover` + `_cssTransition` 抬升卡片（pseudo-class 變體，可在 UI 中編輯）。
- **按鈕（button）**：hover 時輕微抬升 + 依 primary 色的光暈（`_boxShadow:hover` 依
  `theme.primaryColor` 上色）。
- **產品圖（media）**：圓角 + 陰影；**logo**（logo-row 中的圖片或純圖卡中的圖片）
  以 `_opacity: 0.55` 淡化，並在 hover 時提亮。
- **捲動時的進場動畫**：**Interactions native** 系統（`_interactions`：
  trigger `enterView` + action `startAnimation` + animate.css `fadeInUp`、`runOnce`）。這是
  未被 deprecated 的做法（`_animation` entry-animation 控制項自 Bricks 1.6 起已 deprecated）。

Planner（`map-section.ts`）仍會在 element 上掛語意 class `.cdp-*`（cdp-card、cdp-hero-title、cdp-btn、
cdp-primary-cta、cdp-media、cdp-logo-row...）— native pass 會利用這些 class 來
決定哪個 element 接收什麼（內容卡 ≠ logo tile ≠ footer 欄）。

**無需啟用 code-execution**：Bricks 會將這些設定輸出為依 id 作用的 CSS scope
（`#brxe-xxx {...}`、`#brxe-xxx:hover {...}`）+ `data-interactions`，並自動 enqueue
`animate.min.css` + `bricks.min.js`（interactions engine）。若關閉 JS，element 進場仍會
正常顯示（Bricks 只是以 JS 加入的 attribute 暫時隱藏 — 安全 degrade）。

**Logo 帶狀 = 無限捲動 marquee（跑馬燈）**（`packages/bricks/src/logo-marquee.ts`）：一個
所有子項皆為 logo card（≥4）的 container 會被重建為 `overflow:hidden` 的 viewport，
其中包含一條帶有 **加倍** logo 組的 `flex nowrap` track → 以
`@keyframes translateX(0 → -50%)` 連續橫向捲動（兩份彼此對齊，因此 loop 無縫接續），以
`mask-image` 淡化兩端邊緣，hover 時暫停，`prefers-reduced-motion` 時回到靜態格線。這是唯一
必須使用 `@keyframes` 的效果（Bricks 的 native 設定無法表達無限迴圈），
因此僅此區塊會在 viewport 的 `_cssCustom` 中攜帶一小段 CSS — 仍會在匯入時隨 template 一併帶入，無需 gate。

**Feature-card glow**（`packages/bricks/src/feature-card.ts`）：突出的 split 區塊（heading + media，
而非 hero）會被建構為 **帶有發光 gradient 邊框的 frosted card**，如同現代網頁的
「feature」區塊：半透明背景 + `backdrop-blur`、hairline 邊框、圓角、寬 padding
（native，可在 builder 中編輯）+ 一個以 `@property`/`@keyframes` 旋轉的 `::before` gradient-border mask
（glow 恆常動態，hover 時更濃），置於依 id 作用的 `_cssCustom` scope 中。
僅套用於 hero 以外的 split，以免「glow 錯」一般的 2 欄版面配置。

## 方式 2 — API Server + Dashboard

```bash
npm run api
# → http://localhost:4000  (dashboard)
```

Endpoints（依 ARCHITECTURE §4）：

```text
POST /jobs                        { "url": "...", "mode": "landing-page", "viewports": [...], "output": "bricks-json" }
GET  /jobs/:id                    job 狀態 + artifact paths
GET  /jobs/:id/report             analysis report + validation report
GET  /jobs/:id/download-json      template.json
GET  /jobs/:id/download-zip       template-kit.zip
GET  /jobs                        job 清單（dashboard）
GET  /jobs/:id/ir                 Page IR
POST /jobs/:id/regenerate         修改 IR → 重新生成 Bricks JSON（調整 mapping）
```

Dashboard 允許：檢視原始螢幕截圖、檢視 detected sections（overlay box）、檢視 Bricks structure 樹、修改 Page IR 後 regenerate、檢視 validation 分數、下載 JSON/ZIP。

## 匯入 Bricks Builder

1. WordPress → Bricks → Templates → **Import Templates** → 選擇 `template.json`（或整個 `template-kit.zip` — 該 zip 已設計為僅包含恰好 1 個 .json 檔，因此只會建立 **1 個 template**）。
2. Template 會以 `example.com (CDP generated)` 這類名稱出現在 **My Templates** 中。
3. 匯入 **不會自動建立頁面**：建立新的 Page → **Edit with Bricks** → 開啟 template library → 插入剛匯入的 template → Save。

> ⚠️ Bricks 將 zip 中的每個 `.json` 檔都視為 1 個獨立 template。因此 kit 中的中間檔案（`page-ir`、`analysis-report`、`validation-report`）副檔名被改為 `.json.txt` 並置於 `meta/` 目錄中 — 若要重複使用，去掉 `.txt` 副檔名即可。

## MVP 相對於 production 架構的說明

| 元件 | 目前 MVP | Production（依 ARCHITECTURE） |
|---|---|---|
| Queue | In-memory queue（透過 `WORKER_CONCURRENCY` 控制 concurrency） | BullMQ + Redis |
| Database | `storage/db.json`（依 §18 具備完整 5 張表） | PostgreSQL |
| Preview validation | 從 Bricks JSON 近似渲染 HTML + 螢幕截圖 diff | WordPress staging render（MVP 3） |
| Assets | 保留 remote URL（狀態 `remote`） | 上傳 WordPress Media Library（MVP 4） |
| Vision analyzer | Heuristic（像素取樣 + box model + rule engine §21） | 可替換為 vision model |

## 法律注意事項

僅供用於您自己的網站／已獲客戶授權的網站／內部 rebuild／學習目的（參見 ARCHITECTURE §25）。
