# Website_Design_Analytics.md

## 總覽

一套 AI 驅動的流水線：透過 CDP（Chrome DevTools Protocol）分析網站，
並將其重建為**有效的 Bricks Builder JSON**，且視覺保真度經過驗證。

**適用範圍與授權**：僅限你擁有、或已獲明確授權可複製的網站。

**目標建構器**：僅限 Bricks Builder。輸出永遠是扁平元素陣列
（flat element array），以 `id` / `parent` / `children` 建立關聯。
不支援 Elementor，也不做 builder 通用輸出 —— 正因為只鎖定一個
builder，Phase 3 的 schema 校準（grounding）才有可能成立。

------------------------------------------------------------------------

# 核心架構

```text
Claude / Main Agent
    ↓ 控制 CDP
開啟原始 URL
    ↓
Phase 1  CDP Website Analyzer        （一次擷取，多面向分析）
    ↓
Phase 2  Structure & Behavior Analyzer
    ↓
Phase 3  Bricks Grounding            （版本偵測 + 文件反思）
    ↓
Phase 4  Bricks Planner              （施工藍圖）
    ↓ planner 即是契約
Phase 5  Sub Agent Generator         （嚴格依 planner 生成 JSON）
    ↓ json + 生成報告
Phase 6  Main Agent Evaluator        （驗證 → 渲染 → 對比）
    ├── 低於門檻 → 修正指令 / 升級處理
    └── 全部關卡通過 → Export
```

**一句話原則**：Main Agent 負責看懂、規劃、評估；
Sub Agent 只負責按照計畫生成。

------------------------------------------------------------------------

# Agent 角色與互動協議

## Main Agent

1. 控制 CDP 分析原始網站（Phase 1–2）
2. 每個 mapping 決策都以已確認的 Bricks 版本文件為依據（Phase 3）
3. 產出 Bricks Planner（Phase 4）
4. 將 planner 派發給 Sub Agent
5. 驗證 JSON、渲染、與原站對比（Phase 6）
6. 下達修正指令、升級處理、或執行匯出

## Sub Agent

1. 接收 planner —— 視其為**唯讀契約**
2. 嚴格依照 planner 生成 Bricks JSON
3. 絕不猜測結構、絕不自創 schema 欄位、絕不修改 planner
4. 任何不清楚或無法對應的項目一律寫入報告的 `unsupported_items` ——
   禁止即興發揮
5. 回傳 `bricks_json` + `generation_report`

## 硬性協議規則

- 所有知識由 Main 流向 Sub，**只能透過 planner**。
- 所有結果由 Sub 流向 Main，**只能透過報告**。
- Sub Agent 絕不直接碰瀏覽器、原始網站或 Bricks 文件 ——
  如果 planner 缺少資訊，那是 planner 的 bug，修正迴圈必須
  回到 Main Agent，不能繞過它。

------------------------------------------------------------------------

# Phase 1 — CDP Website Analyzer

**一次擷取，多面向分析。** 每個 viewport 只開一次 URL，擷取所有資料，
再從這一次擷取的結果衍生出 DOM / CSS / 版面 / 字體 / 顏色分析
（可平行處理）。絕不為了不同分析面向而重複爬取網站。

步驟：

- 透過 CDP 開啟 URL；等待 JS 完整渲染（network idle + 字體載入完成）
- 全頁截圖：desktop（1920）、tablet（768）、mobile（375）
- 擷取渲染後的 DOM
- 擷取 computed CSS + 所有版面關鍵元素的 bounding box
- 列舉 network assets：圖片、字體、SVG、icon、影片、CDN 來源
- 偵測 framework（React / Vue / WP 主題…）、lazy loading、動畫、動態內容
- **截圖前先凍結動態內容**：暫停輪播與動畫、強制載入 lazy 內容、
  遮蔽明顯動態的區域（時間戳、輪換的見證區塊）。Phase 6 對 clone
  截圖時必須套用完全相同的凍結處理 —— 否則對比毫無意義。

輸出：

```json
{
  "url": "",
  "viewport": "desktop",
  "dom": {},
  "computed_css": {},
  "bounding_boxes": {},
  "assets": [],
  "framework": "",
  "dynamic_regions": [],
  "screenshots": []
}
```

------------------------------------------------------------------------

# Phase 2 — Structure & Behavior Analyzer

完全基於 Phase 1 的輸出運作（不再瀏覽網站）。結構分析與動態分析合併，
因為兩者讀的是同一份擷取資料。

結構：

- 辨識語意區塊：header / nav / hero / section / card / footer
- 建立 parent-child tree 與 section 順序
- 記錄 container / wrapper / grid / flex，以及**實測**的寬度、
  padding、margin、gap（來自 bounding box 與 computed CSS ——
  絕不用估的）
- 將可重複的 component（卡片、清單項目）標記為
  「一個 component + 實例資料」

行為：

- 值得保留的 class / id / aria / data 屬性
- 互動行為：hover、dropdown、modal、slider、tabs、sticky header、
  responsive collapse、scroll 效果、lazy loading
- 各斷點的響應行為：什麼會換行、收合、隱藏

多頁規則：clone 多個頁面時，共用的 header / footer 在此階段識別出來，
並規劃為 **Bricks Templates + conditions** —— 絕不在每一頁重複複製。

輸出：

```json
{
  "page_structure": [
    { "type": "header", "measured": {}, "children": [] },
    { "type": "hero",   "measured": {}, "children": [] }
  ],
  "components": [],
  "dynamic_behaviors": ["hover", "dropdown", "sticky", "responsive-collapse"],
  "shared_templates": ["header", "footer"]
}
```

------------------------------------------------------------------------

# Phase 3 — Bricks Grounding（版本偵測 + 文件反思）

**規則：目標專案的 Bricks 版本決定唯一允許使用的 schema。
絕不混用不同版本的 schema 知識。**

版本偵測：

- 偵測目標專案的 Bricks 版本
- 版本未知 → 發出 `version-check` 任務並**停止**。
  絕不基於猜測的版本進行生成。

文件反思（每個 mapping 決策之前）：

- 確認該 element type 在此版本中存在
- 確認每個 settings 欄位名稱與值的格式
- 確認 breakpoint 寫法
- 確認 section / container / block / div 的對應方式
- 不確定 → 標記為 `unknown`，並排除在 planner mapping 之外。
  **絕不猜測 schema 欄位。**

針對 Bricks **1.12.x**，本機 skill `bricks-native-json` 是 element
settings 的唯一真相來源（已對照主題原始碼驗證）。h2b 2.x 的文件
已知在 1.12.x 上是錯的 —— `h2b` 只用於轉換機制，settings 一律
以 `bricks-native-json` 為準修正。

輸出：

```json
{
  "bricks_version": "x.x.x",
  "confirmed_elements": [],
  "unsupported_features": [],
  "unknowns": [],
  "mapping_notes": []
}
```

------------------------------------------------------------------------

# Phase 4 — Bricks Planner

施工藍圖 —— Main Agent 與 Sub Agent 之間的**唯一契約**。
generator 需要的一切都必須在 planner 裡；不在 planner 裡的東西
絕不能出現在輸出中。

Planner 內容：

- 頁面總覽 + section 清單（依順序）
- Component tree，含可重複項目的實例資料
- 版面約束：每個 section 的實測 px 值
  （width / max-width / padding / margin / gap）
- Design tokens：顏色、字體、間距規模
- Assets 清單（含本機 / 媒體庫的存放目的地）
- 各斷點的響應規則
- 互動規則
- Bricks element mapping —— **僅限已確認的 element**（來自 Phase 3）
- Fallback 指派（見下方 policy）
- Phase 6 用的驗證 checklist

## Token policy

擷取出的 design tokens 對應到 **Bricks Global Colors / Global Classes /
Theme Styles**。重複的值絕不逐一 inline 到每個 element ——
一個用了 40 次的顏色，就是一個被引用 40 次的 global color。
這是 planner 的決策，不是 generator 的決策。

## Fallback policy（由 planner 決定，絕不由 generator 決定）

| 情況 | 策略 |
|---|---|
| 存在原生 Bricks element | 使用它 —— 永遠是第一選擇 |
| 純 CSS/JS 效果、無原生設定 | `_cssCustom` 並以 `%root%` scope（依 `bricks-css-motion`） |
| 第三方 widget（地圖、客服、複雜 slider） | Code element + placeholder，或最接近的原生等價物 —— planner 二選一，報告記錄 |
| 完全無法表達 | 明確跳過 + 寫入報告。絕不無聲丟棄 |

## Asset policy

- 圖片：下載後重新上傳到 WP 媒體庫。禁止 hotlink。
- 字體：Google Fonts → 使用相同字族。商業字體 → 換成最接近的
  有授權 / 免費替代品，並記錄在報告中。絕不複製你沒有授權的字體檔。
- Icon / SVG：inline 或媒體庫，依 planner 決定。

## Accessibility policy

預設忠實複製原站。在原站發現的無障礙問題（缺 alt、對比不足、
缺 label）**在最終報告中以獨立章節回報** —— 不無聲「修好」
（會破壞保真度），也不無聲照抄而不註記。

輸出：

```json
{
  "bricks_planner": {
    "page": {},
    "sections": [],
    "components": [],
    "tokens": { "colors": {}, "typography": {}, "spacing": {} },
    "assets": [],
    "responsive": {},
    "interactions": {},
    "bricks_mapping": {},
    "fallbacks": [],
    "validation_checklist": []
  }
}
```

------------------------------------------------------------------------

# Phase 5 — Sub Agent Generator

規則（全部為硬性規則）：

- **只**根據 planner 生成
- 不猜測結構、不使用未確認的 schema 欄位、不修改 planner
- 輸出為**扁平元素陣列**，以 `id` / `parent` / `children`
  建立關聯 —— 絕不使用巢狀物件
- 優先使用原生 element settings 而非自訂 CSS。`_cssCustom` 只出現在
  planner 指派的位置，且一律以 `%root%` scope
- planner 的每個 section 必須出現在 `completed_sections` 或
  `unsupported_items` 其中之一 —— 兩份清單合起來必須完整覆蓋 planner

輸出：

```json
{
  "bricks_json": {},
  "generation_report": {
    "completed_sections": [],
    "warnings": [],
    "unsupported_items": []
  }
}
```

------------------------------------------------------------------------

# Phase 6 — 評估、渲染、對比、修正

**渲染依賴**：渲染 Bricks JSON 需要一個真實的 WordPress + Bricks
環境（本機 Docker，依 `bricks-wp-testing`）。渲染就是真實頁面的
真實截圖 —— 絕不允許在腦中「想像」渲染結果。

步驟：

1. 驗證 JSON：schema、parent-child 完整性、必填欄位、版本相容性
2. 推送到本機 WP 環境
3. 以相同的 3 個 viewport 對 clone 截圖，並套用與 Phase 1
   完全相同的動態凍結處理
4. 對比（見下方）

## 評分機制 —— 不允許憑空捏造的百分比

相似度**不是**單一像素指標，也絕不是模型自己編出來的數字。
分數來自結構化的 checklist，逐 section、逐 viewport 評估：

**硬性可量測檢查**（pass/fail 或 px 差值）：

- 每個 section 相對原站的 bounding-box 差值
  （容差 ±4px，除非 planner 另有規定）
- 關鍵元素的 computed-style diff：font-family / size / weight /
  line-height、顏色、border-radius、shadow
- Section 數量與順序符合 planner
- 斷點行為符合規劃（收合 / 換行 / 隱藏）

**判斷型檢查**（截圖並排、逐 section）：
視覺符合度 = `yes` / `minor` / `major`。

**Section 通過的條件**：所有硬性檢查在容差內，且視覺符合度為
`yes` 或 `minor`。**頁面分數** = 通過 section 的加權百分比
（header 與 hero 的權重高於頁尾深處的 section）。

Pixel diff 只是*煙霧警報*：出現大面積無法解釋的差異區域時觸發
調查，但原始像素數字本身永遠不作為關卡。

## 門檻與升級處理

| 頁面分數 | 動作 |
|---|---|
| ≥ 95% 且所有硬性關卡通過 | Export |
| 90 – 95% | 修正指令 → Sub Agent（style 層級修正） |
| 80 – 90% | 退回 Planner（重新分析結構） |
| < 80% | 重跑 Phase 1（很可能是擷取本身就錯了） |

## 迭代上限

盲目迴圈只會燒時間和 token 而不收斂：

- 連續 Sub Agent style 修正最多 **3 輪**。3 輪後仍未收斂 →
  問題出在結構 —— 無論分數如何，一律升級到 Planner。
- 總迭代最多 **5 輪**。超過 5 輪即**停止**，並產出詳細問題報告
  供人工審查。

## Export 關卡（全部必須通過）

- JSON Validation = PASS
- 三個 viewport 的頁面 checklist 分數均 ≥ 95%
- Responsive 檢查 = PASS
- 沒有未結案的 critical issue
- 生成報告已審閱：每個 fallback 與 unsupported 項目都在最終報告中
  被明確確認 —— 不允許任何東西無聲消失

------------------------------------------------------------------------

# Anti-Bug 規則（Bricks 原生導向）

- 優先使用原生 element settings 而非自訂 CSS。`_cssCustom` 是例外，
  且一律以 `%root%` scope。
- 絕不使用未 scope 的廣域全域選擇器（`div`、`section`、`a`、`p`）。
- 每個 section 都明確儲存 width、max-width、padding、margin、gap、
  display、overflow、z-index 與 position —— 全部是實測值，不是預設值。
- 重複的值必須變成 global tokens（colors / classes / theme styles），
  絕不 inline 複製。
- 絕不基於未確認的 schema 生成。絕不在未經渲染 + 對比前匯出。

------------------------------------------------------------------------

# 與既有 Skills 的整合

| Phase | Skill | 角色 |
|---|---|---|
| 1–2 | `claude-in-chrome` / CDP 工具 | 擷取、截圖、computed CSS |
| 3, 5 | `bricks-native-json` | 1.12.x element settings 的唯一真相來源 |
| 5 | `h2b` | 轉換機制（扁平陣列、ID 關聯）—— settings 依 `bricks-native-json` 修正 |
| 4–5 | `bricks-css-motion` | `_cssCustom`、`%root%`、動畫、hover / scroll 效果 |
| 6 | `bricks-wp-testing` | Docker WP 寫入路徑、渲染、截圖驗證 |

------------------------------------------------------------------------

# 設計哲學

**不要**把 HTML 直接翻譯成 JSON —— 但也不要忽視 DOM。
DOM 與 computed CSS 是你手上唯一精確的量測來源。

```text
Website
 ↓
CDP Analysis            （精確量測）
 ↓
Bricks Grounding        （確認 schema 能表達什麼）
 ↓
Bricks Planner          （重構為 Bricks 的慣用結構）
 ↓
Sub Agent Generator     （只生成被規劃的內容）
 ↓
Render + Compare        （沒渲染過的一律不信）
 ↓
Fix / Escalate
 ↓
High-Fidelity Clone
```

精確量測。聰明重構。只從已確認的計畫生成。
沒渲染、沒對比過的東西，一律不信。

**Main Agent 負責看懂、規劃、評估；Sub Agent 只負責按照計畫生成。**
