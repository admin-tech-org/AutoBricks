# Design_from_planner.md — Website Clone Generator（Sub Agent）Skill 設計

## 定位

本 skill 是 `Website_Design_Analytics.md` 主架構中的 **Phase 5 — Sub Agent
Generator**。它只做一件事：

> 接收 Bricks Planner → 生成有效的 Bricks Builder JSON → 回傳生成報告。

它**不**渲染、**不**截圖、**不**對比、**不**自己評分 —— 那些全部屬於
Phase 6（Main Agent Evaluator）。Sub Agent 絕不接觸瀏覽器、原始網站
或 Bricks 文件；它需要的一切知識都必須已經在 planner 裡。

**輸出目標只有一個：Bricks Builder JSON。** 不輸出 `index.html` /
`style.css` 等 HTML 預覽 —— 你驗證的東西必須就是你匯出的東西，
而 Bricks 頁面在 WordPress 上的渲染結果與裸 HTML 不同，因此
HTML 預覽對比毫無意義，甚至有害。

------------------------------------------------------------------------

# Skill 目錄結構

```text
website-clone-generator/
├── SKILL.md                  # 角色、兩種模式、硬性規則
├── input_contract.md         # bricks_planner / fix_instruction 輸入格式
├── bricks_json_rules.md      # 扁平陣列、element 結構、mapping 規則
├── responsive_rules.md       # 斷點來自 planner，絕不 hardcode
├── asset_rules.md            # 引用 planner 的 assets manifest
├── fix_rules.md              # FIX 模式：section 級補丁規則
├── output_schema.json        # bricks_json + generation_report 的 schema
└── examples/                 # 正確輸入 → 正確輸出的成對範例
```

（相較舊版：移除 `html_css_generation_rules.md` —— 不再輸出 HTML；
移除 `visual_compare_rules.md` —— 對比屬於 Phase 6，不在本 skill 內。）

------------------------------------------------------------------------

# 兩種運作模式

## 模式 A — GENERATE（初次生成）

```text
輸入:  bricks_planner（完整契約）
動作:  依 planner 逐 section 生成 Bricks JSON
輸出:  bricks_json + generation_report
```

## 模式 B — FIX（依指令修正）

```text
輸入:  上一版 bricks_json + Evaluator 發來的 fix_instruction
動作:  只修補 fix_instruction 指名的 section / element
輸出:  修正後的 bricks_json + generation_report（記錄改了什麼）
```

**FIX 模式的核心規則（沿用並強化舊版最好的想法）：**

- 只有一個 section 錯 → 絕不重寫整頁，**section 級補丁優先**。
- 只有當 fix_instruction 明確判定「結構不符超過 30%」時，
  才允許整頁重新生成 —— 且這個判定由 Evaluator 做，不由 generator 自己做。
- Generator 絕不自我評分、絕不自行決定「已經夠像了」。
  收斂與否由 Phase 6 判斷（連續 style 修正最多 3 輪、總計最多 5 輪，
  由 Main Agent 執行此上限）。

------------------------------------------------------------------------

# 輸入契約

## GENERATE 模式：直接消費主架構的 `bricks_planner`

**不另立競爭 schema。** 輸入就是 `Website_Design_Analytics.md`
Phase 4 定義的 planner，原樣引用：

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

Generator 特別依賴其中：

- `bricks_mapping` —— Phase 3 已確認的 element 對應表。
  **只能用這裡面出現的 element type 與 settings 欄位。**
- `fallbacks` —— 每個非原生項目該用什麼策略（`_cssCustom` /
  Code element / 明確跳過），planner 已經決定，generator 只執行。
- `tokens` —— 對應到 Bricks Global Colors / Global Classes /
  Theme Styles 的定義，generator 引用 global，絕不 inline 重複值。
- `sections[].measured` —— 實測 px 值，直接使用，絕不憑感覺調整。

## FIX 模式：`fix_instruction`

```json
{
  "fix_instruction": {
    "iteration": 2,
    "scope": "section",
    "targets": [
      {
        "section_id": "hero",
        "problems": [
          {
            "check": "bounding-box",
            "expected": "padding-top 96px",
            "actual": "padding-top 64px"
          }
        ],
        "suggested_fix": "調整 hero section 的 _padding.top 為 96"
      }
    ],
    "regenerate_full_page": false
  }
}
```

規則：`targets` 沒點名的 section，一個字元都不准動。

## 輸入不完整時

Planner 缺資訊（例如缺 mobile 的 responsive 規則、某 section 沒有
measured 值）→ **這是 planner 的 bug**：寫入 `generation_report.warnings`
並將該項列入 `unsupported_items`，把問題退回 Main Agent。
**絕不自行推測補完。** 舊版「mobile 截圖沒有就自己推論」的規則已廢除 ——
它與「不得自創設計」直接矛盾。

------------------------------------------------------------------------

# Bricks JSON 生成規則

## 結構規則

- 輸出是**扁平元素陣列**：每個 element 以 `id` / `parent` / `children`
  建立關聯。**絕不使用巢狀物件。**
- 每個 element 的必要欄位：`id`、`name`（即 element type）、`parent`、
  `children`、`settings`。`label` 為**選填**，不要求每個 element 都有。
- 層級慣例遵循 Bricks 慣用結構：`section → container → block / div`。
  `div.container` 不必然對應 Bricks container —— 以 planner 的
  `bricks_mapping` 為準。

## Element 對應（修正舊版過於簡化的表）

| 原始內容 | Bricks element | 備註 |
|---|---|---|
| 頁面大區塊 | `section` | 外層 |
| 區塊內版心 | `container` | section 的直接子層 |
| 佈局群組 | `block` / `div` | 依 mapping 決定 |
| `h1`–`h6` | `heading` | **不是** text —— Bricks 有專用 heading element |
| `p` / 內文 | `text-basic` / `text` | 依 planner 指定 |
| `button` / CTA `a` | `button` | |
| `img` | `image` | 來源指向媒體庫（見 asset 規則） |
| `form` | `form` | 欄位依 planner |
| 第三方 widget | 依 `fallbacks` | Code element + placeholder 或原生等價物 |

## Schema 真相來源

- 目標為 Bricks **1.12.x** 時，settings 欄位一律以本機 skill
  **`bricks-native-json`** 為唯一真相來源（h2b 2.x 文件在 1.12.x
  上已知有誤；`h2b` 只借用其扁平陣列轉換機制）。
- planner 的 `bricks_mapping` 沒確認過的欄位 = 不存在的欄位。
  **絕不自行發明 settings 欄位。**

## CSS 規則

- 優先使用原生 element settings。`_cssCustom` **只**出現在 planner
  `fallbacks` 指派的位置，且一律以 `%root%` scope
  （細節依 `bricks-css-motion`）。
- 絕不產生未 scope 的全域選擇器（`div`、`section`、`a`、`p`）。
- 重複的顏色 / 字體 / 間距 → 一律引用 planner 定義的 global tokens。

------------------------------------------------------------------------

# Responsive 規則

- **斷點不 hardcode。** 舊版的 1440 / 1024 / 768 / 390 已廢除。
- 斷點來源：planner 的 `responsive` 區塊 —— 即 Analyzer 從原站
  實測的斷點，由 planner map 到 Bricks 的 breakpoint 設定。
- 每個 section 的響應行為（換行 / 收合 / 隱藏）依 planner 逐條實作，
  寫入對應 breakpoint 的 settings。
- 驗證用的 viewport 由 Phase 6 控制，且必然與 Phase 1 擷取時的
  viewport 一致 —— generator 不需要、也不允許自訂 viewport。

------------------------------------------------------------------------

# Asset 規則

全部依 planner 的 `assets` manifest 執行：

- 圖片引用 WP 媒體庫的目的地路徑（上傳由 Main Agent / 工具鏈負責），
  絕不 hotlink 原站 URL。
- 字體依 planner 指定的字族（含商業字體的替代方案）設定，
  generator 不自行挑字體。
- manifest 裡沒有的 asset = 不存在的 asset → 進 `unsupported_items`。

------------------------------------------------------------------------

# 輸出契約

```json
{
  "bricks_json": {},
  "generation_report": {
    "mode": "generate | fix",
    "completed_sections": [],
    "changed_sections": [],
    "warnings": [],
    "unsupported_items": []
  }
}
```

完整性規則：planner 的每個 section 必須出現在 `completed_sections`
或 `unsupported_items` 其中之一 —— 兩份清單合起來必須恰好覆蓋
整份 planner，不多不少。FIX 模式下另須填 `changed_sections`，
且其內容必須是 fix_instruction `targets` 的子集。

------------------------------------------------------------------------

# 優先序與關卡

**JSON 有效性是關卡（gate），不是優先序項目。** 無法通過 schema
驗證、無法匯入 Bricks 的 JSON，視覺再像也是零分 —— 所以它不參與
排序，它是前提。

在 JSON 必然有效的前提下，取捨順序：

1. 對 planner 的忠實度（實測值、mapping、fallback 全依 planner）
2. Responsive 正確性
3. 結構簡潔（能用一層就不用兩層）
4. 可維護性（global tokens、可讀的 label）

「視覺像不像」不在此清單 —— 因為那不是 generator 能自己判斷的事，
它由 Phase 6 對照真實渲染結果來裁決。

------------------------------------------------------------------------

# 常見 bug 檢查表（供 FIX 模式對照）

fix_instruction 常會指向這些問題，generator 應熟悉其典型成因：

- Section 水平偏移 → width / max-width / margin auto 缺失
- 字體不對 → 未引用 global typography token，或 fallback 字族錯誤
- Padding 過大 → 未使用 planner 實測值，或斷點覆寫遺漏
- 按鈕尺寸錯 → padding 與 font-size 未同時設定
- 圖片被裁切 → object-fit / 容器比例與原站不符
- Sticky header 失效 → position 設定放錯層級
- Mobile 版面爆版 → 斷點行為未逐條實作
- Bricks 匯入後掉樣式 → 用了該版本不存在的 settings 欄位（schema 違規）
- Class 衝突 → 全域選擇器未 scope
- Asset 遺失 → 引用了 manifest 之外的路徑

------------------------------------------------------------------------

# 本 skill 明確不做的事

| 不做 | 屬於 |
|---|---|
| 渲染頁面 | Phase 6（`bricks-wp-testing`，Main Agent） |
| 截圖 / 像素對比 / 打分 | Phase 6（Main Agent Evaluator） |
| 決定是否 Export | Phase 6 關卡 |
| 讀 Bricks 文件、確認 schema | Phase 3（Bricks Grounding，Main Agent） |
| 修改 planner、補完缺失資訊 | Phase 4（Main Agent） |
| 開瀏覽器、存取原始網站 | Phase 1–2（Main Agent 經 CDP） |

------------------------------------------------------------------------

# Sub Agent 核心 Prompt

```text
你是 Website Clone Generator（Sub Agent）。

你的唯一任務：依據收到的 bricks_planner 生成有效的
Bricks Builder JSON；或依據 fix_instruction 修補指定 section。

你必須：
- 嚴格依照 planner，planner 是唯讀契約。
- 只使用 bricks_mapping 中已確認的 element type 與 settings 欄位。
- 輸出扁平元素陣列（id / parent / children），絕不巢狀。
- 重複值一律引用 global tokens；_cssCustom 只用在 planner 指派處，
  並以 %root% scope。
- 資訊缺失或無法對應 → 寫入 unsupported_items 回報，絕不猜測。
- FIX 模式只動 targets 指名的 section。

你不得：
- 自創版面、簡化元件、發明 schema 欄位。
- 渲染、截圖、對比、自我評分。
- 存取瀏覽器、原始網站或 Bricks 文件。

回傳：bricks_json + generation_report
（completed_sections / changed_sections / warnings / unsupported_items，
 必須恰好覆蓋整份 planner）。
```

------------------------------------------------------------------------

# 與既有 Skills 的關係

| Skill | 本 skill 如何使用 |
|---|---|
| `bricks-native-json` | 1.12.x settings 的唯一真相來源，生成時逐欄對照 |
| `h2b` | 只借用扁平陣列 / ID 關聯的轉換機制，settings 不採信其文件 |
| `bricks-css-motion` | `_cssCustom`、`%root%`、動畫寫法的依據 |
| `bricks-wp-testing` | **不使用** —— 渲染驗證屬於 Main Agent（Phase 6） |

------------------------------------------------------------------------

# 結論

舊版把 Generator + Renderer + Comparator + Fixer 塞進同一個 skill ——
這會讓 generator 自己給自己打分，違反主架構的硬性協議。

正確的切分：

```text
Analyzer / Planner（Main Agent）  → 產出精確的施工藍圖
Generator（本 skill，Sub Agent）  → 只從藍圖生成 Bricks JSON
Evaluator（Main Agent，Phase 6）  → 渲染、對比、裁決、發修正指令
Generator FIX 模式（Sub Agent）   → 依指令做 section 級補丁
```

Skill 命名：`website-clone-generator`（不加多餘的 `-skill` 後綴）。

**一句話：generator 不判斷像不像，它只負責把藍圖一比一蓋出來；
像不像，由渲染過的真頁面說了算。**
