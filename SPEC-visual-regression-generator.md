# Visual-Regression Driven Generator (VRDG) — 架構規格

> 本文是 [ARCHITECTURE](./ARCHITECTURE-bricks-cdp-visual-generator.md) 的**前瞻設計規格**，
> 描述如何把目前「一次性 URL → Bricks JSON」的 generator，演進為
> **以視覺回歸驅動、會自我修復的 generator**：generate → render(真實) →
> 量測比對 → 修復 → 重複，直到收斂到對原始 URL 的可定義還原度。
>
> 本文修正了「Visual Self-Repair Agent」初版策略中的 4 個結構性問題
> （見 §3、§5）。**先讀 §3**——它是整份規格的核心判斷。

---

## 1. 目標與範圍

**北極星**：對任一 landing page URL，產出的 Bricks 頁面在 desktop 上與原始頁
**視覺上難以區分**，且**內容 100% 正確**、**版面結構正確**、**可在 builder 中編輯**。

**明確不追求**：100% pixel-identical。這在 Bricks 上**不可達也不該追求**——
不同 render engine、不同系統字型、sub-pixel text rendering、動態內容（marquee、
counter、輪播）都會造成永遠存在的像素差。把目標訂成一個**有遮罩、有定義的度量**
（見 §8），loop 才知道何時該停。

**兩種輸出模式**（見 §7）：
- **Level A — 可編輯優先（native-first）**：以 Bricks native 設定為主，達到「像」；
  適合交付給人接手編修。
- **Level B — 像素還原（pixel-fidelity）**：允許更多 id-scoped `_cssCustom`，
  把 native 表達不了的細節補到量測值；適合「盡量一比一」的複刻。

---

## 2. 現況盤點（已經有的積木）

VRDG **不是打掉重練**，而是在既有 pipeline 上補三塊。先釐清現況：

| 能力 | 現況 | 檔案 |
|---|---|---|
| Capture（截圖 + DOM + 計算後 CSS + box） | ✅ 已有，含 desktop/mobile layout | `packages/capture/*`、`LayoutSnapshot`、`CssSnapshot` |
| **來源 box/style 已在 IR 內** | ✅ `ComponentIR.box` 與 `ComponentIR.style` 就是原始頁的量測值 | `packages/ir/src/types.ts` |
| Vision（一次性色彩/gradient/typography 校正） | ✅ 已有，fan-out `claude -p` subagent | `packages/analyzer/*`、`VisionAIReport` |
| Bricks 生成（native + 少量 `_cssCustom`） | ✅ 已有 marquee / exact-aspect / glow pass | `packages/bricks/src/generate-json.ts` |
| 視覺驗證分數 | ⚠️ 有，但比對的是**近似 preview**，非真實 Bricks | `packages/validation/*` |
| 真實 render（docker php 寫 postmeta） | ⚠️ 手動做過，**尚未接進 pipeline** | 見 `bricks-wp-testing` skill |
| 修復迴圈 | ❌ 不存在 | — |

現況三個關鍵限制，決定了 VRDG 該補什麼：

1. **`renderPreview` 是近似，不是真相**（`packages/validation/src/render-preview.ts`
   自述為 MVP stand-in）：它用一段獨立 HTML 模擬 Bricks，**不會**載入
   `frontend.min.css`、不跑 `_cssCustom`、不跑 interactions。拿它算分＝拿贗品當基準。
2. **`screenshotDiff` 是最原始的 pixelmatch**（`threshold:0.15, includeAA:false`，
   nearest-neighbor 縮到 720px）：對 anti-alias、動畫、字型差極度敏感，給的是
   **一個純量**，不告訴你「哪個 element、差多少」。
3. **`detectSectionLayout` 只輸出一個 label**（`"two-column"`/`"three-card-grid"`…），
   **不重建巢狀結構**，且原始 card container 的 border/bg/radius 在分析時被
   flatten 掉。這就是「FOR DEVELOPERS 區塊被排成 9 張直向堆疊」的根因。

---

## 3. 核心洞察：修復訊號的層級（最重要）

> 初版策略最大的錯誤：**把 pixel-diff 當成主要修復訊號**。

pixel-diff 回答的是「像不像」（純量 + diff 影像），**回答不了「改什麼、改多少」**。
初版報告範例（「Hero title 低了 18px」「gap 應為 32px」）——**pixel-diff 生不出這些句子**。

**正確的訊號層級**：

```
第 1 訊號（主）  元素級 Δ：來源 box/computed-style  vs  render box/computed-style
                → 每個 element 的精確差（Δx, Δfont-size, Δpadding, ΔE 色差…）
                → 直接 patch 這個數字。這是「改什麼、改多少」的唯一可靠來源。

第 2 訊號（門）  SSIM / 遮罩後 pixel-match：驗收門檻 + 抓第 1 訊號抓不到的
                （z-order、overflow、視覺 artifact、字型 hinting 差）。

第 3 訊號（一次） AI Vision：一次性建立 ground-truth 色彩/gradient/typography，
                寫進 IR。絕不放進 loop（見 §6.5）。
```

**為什麼元素級 Δ 可行且便宜**：來源側的量測**早就在 IR 裡**——`ComponentIR.box`
是原始頁的 `getBoundingClientRect`，`ComponentIR.style` 是原始頁的
`getComputedStyle`。我們**唯一缺的**是 render 側的對應量測——而那只要在真實
render 後，對每個 `#brxe-<id>` 跑一次 `getBoundingClientRect()` + `getComputedStyle()`
就有了（§4、§5.4）。兩邊對齊 → 相減 → 得到精確、可直接執行的修復指令。

**pixel-diff 降為「門」**，不再是「舵」。這一個調整，決定 loop 能不能真的收斂。

---

## 4. 架構總覽（修正後的迴圈）

```
                         ┌─────────────────────────────────────────────┐
Capture (screenshot +    │                                             │
 DOM + computed CSS +    │   一次性，非 loop 內：                        │
 box, 多 viewport)  ─────┤   AI Vision → 定 color/gradient/typography    │
                         │   → 寫入 PageIR.theme / section.style         │
                         └──────────────────┬──────────────────────────┘
                                            │
      ┌─────────────── 前置條件（loop 之前，§5）───────────────┐
      │  P1 版面重建：box → 巢狀 ComponentIR（row/col/card）      │
      │  P2 Container 寬度釘定 = 來源內容寬                        │
      └───────────────────────┬─────────────────────────────────┘
                              │
                 ┌────────────▼─────────────┐
                 │  generateBricksJson(ir)   │  ← 既有；additionally 產出
                 │  + 產出 provenance map    │     irId ↔ brxeId 對照表
                 └────────────┬─────────────┘
                              │
          ┌───────────────────▼────────────────────┐
          │  真實 render harness（§5.3）：            │   ┌──────── loop ────────┐
          │  docker php 寫 postmeta → Playwright      │   │                       │
          │  截圖 + 逐 #brxe-id 量 box/style          │◄──┤  套用 RepairPatch      │
          └───────────────────┬────────────────────┘   │  （tier by tier）      │
                              │                          │                       │
          ┌───────────────────▼────────────────────┐   │                       │
          │  Correspondence + Δ（§5.4，第 1 訊號）    │   │                       │
          │  來源 IR box/style ↔ render box/style     │   │                       │
          └───────────────────┬────────────────────┘   │                       │
                              │                          │                       │
          ┌───────────────────▼────────────────────┐   │                       │
          │  Robust diff（§6.4，第 2 訊號 = 門）      │   │                       │
          │  anim off + 遮罩動態區 + SSIM             │   │                       │
          └───────────────────┬────────────────────┘   │                       │
                              │                          │                       │
          ┌───────────────────▼────────────────────┐   │                       │
          │  Repair planner（§6.2）→ RepairPatch      ├──►┤  只在分數↑時接受，      │
          │  收斂控制（§6.3）：接受/回滾/鎖定/plateau  │   │  否則回滾            │
          └───────────────────┬────────────────────┘   └───────────┬───────────┘
                              │ 收斂或達標                            │
                              ▼                                      │
                        匯出 template.json ◄─────────────────────────┘
```

**AI/確定性邊界**：loop 內**全部確定性**（量測→相減→patch 數字）。唯一的非確定性
（AI Vision）被抽到 loop 外、只跑一次。這是 loop 能收斂的前提。

---

## 5. 前置條件（loop 之前必須先做）

> 這四項**先於 loop**，因為它們解決的是 loop **無法便宜修復**的結構性錯誤。
> 做完這四項，還原度大概就能到 ~85–90%，**還沒進 loop**。

### 5.1 P1 — 版面重建（最高槓桿）

**問題**：`detectSectionLayout` 只回一個 label，planner 據此**猜**結構；來源 card
container 的 border/bg/radius 被 flatten。結果：巢狀版面（2 欄卡片、重疊截圖）被
排成錯的扁平堆疊。

**做法**：新增 `packages/analyzer/src/reconstruct-layout.ts`，從 section 的
`DomNode[]` + `LayoutSnapshot.boxes` **重建巢狀 `ComponentIR` 樹**，取代「只給 label」：

1. **垂直分帶（rows）**：把直接子節點依 y-overlap 分組 → 每組是一個 row。
2. **水平分欄（columns）**：row 內用既有 `clusterByX`（`detect-layout.ts` 已有）
   分欄。
3. **辨識 card container**：若某 DOM 祖先的 box **緊包**一組子節點，且它在
   `CssSnapshot` 有 `background`/`border`/`border-radius` → 物化成一個 `block`，
   **並把該 surface 帶進 `ComponentIR.style`**（別再 flatten 掉）。
4. **遞迴**上述於每個 cell。
5. 輸出巢狀 `SectionIR.children`，讓 `planSection` 直接吐出真實的 2 欄卡片，
   而不是靠 heuristic 猜。

**驗收**：以「FOR DEVELOPERS」區塊為 fixture——重建後應得到
`block[卡片] > (block[左:icon+heading+desc], block[右:重疊截圖])`，而非直向堆疊。

### 5.2 P2 — Container 寬度釘定

**問題**：來源內容寬常是 1440，Bricks 預設 container 約 1100（`applyThemeDefaults`
會套 `theme.containerMaxWidth`）。若不釘定，render 的每個 px 都**整體縮放**，
loop 追一個移動的目標，永遠對不齊。

**做法**：capture 時量出來源**內容寬**（最外層置中內容的 box 寬，非 viewport 寬），
寫入 `PageIR.theme.containerMaxWidth`；generator 以它釘定 section/container `_widthMax`。
先讓兩邊的座標系對齊，元素級 px 修復才有意義。

### 5.3 P3 — 真實 render harness（取代近似 preview）

**問題**：`renderPreview` 是贗品（§2）。要量真相，必須 render 真實 Bricks。

**做法**：新增 `packages/validation/src/render-wp.ts`（或新 package `packages/render-wp`），
把 `bricks-wp-testing` skill 的手動流程自動化：

```
1. docker cp template.json → 容器
2. docker exec php：wp-load + wp_set_current_user(admin) + wp_slash($content)
   → update_post_meta(PAGE_ID, '_bricks_page_content_2', …)
   （MSYS_NO_PATHCONV=1 必要；admin current-user 必要，否則 WP 靜默丟棄）
3. Playwright 開 ?page_id=PAGE_ID
4. 逐 #brxe-<id> 量 getBoundingClientRect() + getComputedStyle()
5. 截圖（多 viewport）
```

**已知的坑（skill 已記錄，harness 必須處理）**：
- **每次 regen 的 id 會變**（idStyle "bricks"）→ 每次都要重載頁面 + 重新對照。
- **Bricks 會快取 CSS** → 寫入後要 bust 快取 / 強制重生。
- **headless 字型可用性**與使用者機器不同 → 影響截圖（見 §6.4 遮罩/容差）。
- **不要用 Bricks Import UI**（慢、需手動）——直接寫 postmeta。
- **絕不在瀏覽器輸入帳密登入 WP**（安全規則；用 `wp_set_current_user`）。

### 5.4 P4 — 元素級比對器（第 1 訊號的產生器）

**關鍵前置：provenance map**。目前 `flattenNode`（`generate-json.ts`）產 id 時
**沒有記錄它來自哪個 `ComponentIR`**。必須讓 `generateBricksJson` **額外輸出
`irId ↔ brxeId` 對照表**（把 irId 沿 `BricksPlanNode` 帶下來，或在 element 上
埋 `settings['data-cdp-ir']`）。有了它，比對器才能把：

- **來源側**：`ComponentIR.box` / `ComponentIR.style`（已在 IR）
- **render 側**：harness 量到的 `#brxe-<id>` box / computed style

一一對齊。

**做法**：新增 `packages/validation/src/correspondence.ts`：
1. 用 provenance map 對齊 irId ↔ brxeId；對齊不到的納入
   `unmatchedSource`（結構缺漏）/ `unmatchedRendered`（多餘）。
2. 對每個配對算 `ElementDiff`（box delta + style delta；色差用 CIEDE2000 ΔE）。
3. 依加權 severity 排序，餵給 repair planner。

新增資料契約見 §9。

---

## 6. 修復迴圈

### 6.1 對應與 Δ
即 §5.4 的輸出：`CorrespondenceReport`。這是 loop 每一輪的輸入。

### 6.2 修復規劃（RepairPatch）
把 `ElementDiff[]` 轉成**確定性的** `RepairOp[]`（見 §9），絕大多數是純算術：

- `box.dy = +18px` 且該 element 是 heading → 調其容器 `_padding.top` 或
  `_margin.top` −18px（依 Δ 落在哪一段）。
- `style["font-size"]` 差 4px → 設 `_typography.font-size` = 來源值。
- `style["gap"]` 差 → 設 `_columnGap`/`_rowGap` = 來源值。
- 色差 ΔE > 門檻 → 設 `_typography.color` / `_background` = 來源值。

**只有結構性缺漏**（`unmatchedSource` 非空、或版面型別對不上）**才升級**：
先嘗試 P1 的重建規則，仍不行才交給一個 LLM op（`source:"llm"`）產生結構建議。
loop 的主體必須是便宜的確定性 op。

### 6.3 收斂控制（初版完全缺這塊）
`for attempt in 1..N` 遠遠不夠——loop 會「修 A 壞 B」或原地震盪。必備：

- **接受/回滾**：套用一個 tier 的 patch 後重量測，**只有整體分數 ↑ 才保留**，
  否則回滾該 tier。
- **鎖定已達標區域**：`ElementDiff.severity` 已在門檻內的 element 標記 locked，
  後續不再更動（避免連鎖破壞）。
- **分 tier 逐輪**：一次只修一個優先層（結構 → box → 間距 → 色彩/字型），
  修完重量測再進下一層。**結構永遠先於顏色**。
- **plateau 停止**：連續 K 輪 Δ分數 < ε 就停，不要只看 max attempt。
- **回歸套件**：每次改 generator 規則都要跑 golden fixtures（見 §12）——
  我們踩過「一個 site 變好、fixture 從 0.94 掉到 0.91」。

### 6.4 Robust diff（第 2 訊號 = 門）
`screenshotDiff` 現況（原始 pixelmatch）會**追著雜訊跑**。截圖前後必須：

- **關動畫**：注入 `prefers-reduced-motion` / freeze，避免 marquee、glow 旋轉
  造成逐幀差（我們實際踩過 marquee 每幀不同）。
- **遮罩動態區**：marquee、video、counter、輪播區域從 diff 排除。
- **等字型 + 圖片載入完成**再截（我們踩過 paint-timing 白幀——首次截圖常在 5s
  timeout 抓到未繪製幀）。
- **用 SSIM / 感知度量 + anti-alias 容差**，取代對 pixel 的絕對比較。
- 保留 `screenshotDiff` 現有的「只比重疊上緣、`uncoveredHeightRatio` 另報」邏輯。

### 6.5 AI Vision 抽離 loop
Vision ≈ 57s／次且**非確定性**（`bricks-wp-testing` skill 亦記錄）。放進 loop
會讓每輪的色彩/gradient 飄移 → **永不收斂**。**只跑一次**，把 ground-truth 寫進
`PageIR.theme` / `section.style`；loop 內只做確定性的量測—相減—patch。

### 6.6 內容鎖定
文字內容的真相是 **DOM（capture）**，不是視覺 diff。loop **絕不**依 diff「修」
文字（會汙染內容）。內容在 capture 後鎖定，loop 只修**視覺屬性**。

---

## 7. 輸出策略（修正：不要獨立 CSS 檔）

初版提議「template.json + 獨立 custom-precision.css + plugin 注入」——**這是退步**。
已驗證（`bricks-css-motion` / `bricks-wp-testing` skill、`BricksTemplate.customCss`
註解）：**element `_cssCustom` 自足，隨 `.json` import 一起帶入、無 gate、無需 plugin**。

- **輸出永遠是單一 `.json`**（或含剛好 1 個 json 的 kit `.zip`）。
- 效果性 CSS 以 **`#brxe-<id>` scope 埋在對應 element 的 `_cssCustom`**（現有
  `applyExactAspect` / marquee / glow 已是此法）。
- 可編輯的設計仍走 **native 設定**（`_padding`/`_typography`/`_border`/`_boxShadow`…）。
- **Level A**：native 為主，`_cssCustom` 僅限 native 表達不了的（keyframe loop、
  `::before`、mask）。**Level B**：允許 planner 對高 severity 殘差追加 id-scoped
  `_cssCustom` 補到量測值。

> 註：`%root%` 不會被 Bricks 替換——所有 id-scoped 規則必須用真實 `#brxe-<id>`，
> 且**在 flatten 之後**寫（clone 後的元素要各自的 id 規則）。此為既有鐵律。

---

## 8. 度量與目標（有定義才停得下來）

**內容**：`contentScore` 必須 = 1.0（文字全數落地），否則直接 fail——非分數問題而是 bug。

**Level A（可編輯優先）達標**：
- desktop SSIM ≥ 0.90（遮罩動態區後）
- box RMSE ≤ 12px、色差 ΔE ≤ 5（配對元素平均）

**Level B（像素還原）達標**：
- desktop SSIM ≥ 0.95（遮罩後靜態區）
- box RMSE ≤ 6px、文字/背景色 ΔE ≤ 3
- 主要區塊逐一 element 對齊（`unmatchedSource` = 0）

**遮罩清單**（不計入分母）：marquee/連續動畫、video、動態計數、輪播、
remote-image 尚在載入的區域。

**多 viewport 策略（控成本）**：先把 **desktop 修到收斂**，再檢查 tablet/mobile，
只對「桌機已對、行動版壞掉」的區塊做針對性修復。**不要**每輪都四個 viewport 全跑
（初版的 `1..10 × 4 viewports` 若每步都用 LLM 會非常貴）。loop 主體確定性、便宜，
LLM 只在結構歧義時介入。

---

## 9. 新增資料契約（`packages/ir/src/types.ts`）

```typescript
// —— 第 1 訊號：對應 + Δ ————————————————————————————————
export type ElementMatch = {
  irId: string;                 // ComponentIR.id（來源真相）
  renderedId: string;           // render 中的 #brxe-<id>
  role?: string;                // styleRole
  matchConfidence: number;      // 0..1
  matchedBy: "text" | "role-order" | "geometry" | "src";
};

export type BoxDelta = {
  dx: number; dy: number;                 // 左上角 px 偏移（render − source）
  dWidth: number; dHeight: number;
  dxRatio: number; dyRatio: number;       // 正規化，供門檻判斷
};

export type StyleDelta = {
  prop: string;                 // "font-size" | "padding-top" | "color" | "gap" …
  source: string;               // 原始頁量測值
  rendered: string;             // render 量測值
  deltaPx?: number;             // 兩邊皆長度時的數值差
  deltaE?: number;              // 顏色的 CIEDE2000 色差
};

export type ElementDiff = {
  match: ElementMatch;
  box?: BoxDelta;
  styles: StyleDelta[];
  severity: number;             // 加權；驅動修復排序 + locked 判斷
  locked?: boolean;             // 已達標，loop 不再更動
};

export type CorrespondenceReport = {
  jobId: string;
  viewport: ViewportName;
  matched: ElementDiff[];
  unmatchedSource: string[];    // 來源有、render 缺 → 結構缺漏
  unmatchedRendered: string[];  // render 有、來源無 → 多餘
  createdAt: string;
};

// —— 修復 patch（確定性為主）————————————————————————————
export type RepairOp = {
  targetIrId: string;           // 要 patch 的 ComponentIR / SectionIR
  channel: "structure" | "box" | "spacing" | "color-type";
  key: string;                  // "_typography.font-size" | "_columnGap" | "columns" …
  from?: string;
  to: string;
  reason: string;               // 觸發它的 delta
  source: "deterministic" | "vision" | "llm";
};

export type RepairPatch = {
  tier: 1 | 2 | 3 | 4;          // 1 結構 < 2 box < 3 間距 < 4 色彩/字型
  ops: RepairOp[];
};

// —— loop 度量與逐輪紀錄 ————————————————————————————————
export type VisualScore = {
  ssim: number;                 // 感知，主要門檻（遮罩後）
  pixelMatch: number;           // 遮罩後相符比例
  boxRmse: number;              // px，配對元素 box 誤差聚合
  colorDeltaE: number;          // 配對文字/背景平均 ΔE
  content: number;              // 必為 1.0（DOM 鎖定）
};

export type RepairIteration = {
  attempt: number;
  tier: number;
  before: VisualScore;
  after: VisualScore;
  accepted: boolean;            // after < before → 回滾
  opsApplied: number;
};

export type RepairReport = {
  jobId: string;
  iterations: RepairIteration[];
  finalScore: VisualScore;
  converged: boolean;           // 達標或 plateau
  stopReason: "target-met" | "plateau" | "max-attempts";
  createdAt: string;
};
```

生成端需擴充 `GenerateResult`，附上 provenance map：

```typescript
// generateBricksJson() 額外輸出，供 §5.4 比對器對齊
export type ProvenanceMap = { irIdToBrxeId: Record<string, string> };
```

---

## 10. 模組落點

| 新模組 | 位置 | 職責 |
|---|---|---|
| 版面重建（P1） | `packages/analyzer/src/reconstruct-layout.ts` | box → 巢狀 `SectionIR.children`；保留 card surface |
| 真實 render harness（P3） | `packages/validation/src/render-wp.ts` | docker php 寫入 + Playwright 截圖 + 逐 `#brxe-id` 量測 |
| 元素級比對器（P4） | `packages/validation/src/correspondence.ts` | 產 `CorrespondenceReport`（第 1 訊號） |
| Robust diff（§6.4） | 擴充 `packages/validation/src/screenshot-diff.ts` | anim off + 遮罩 + SSIM |
| 修復規劃 | `packages/repair/src/repair-planner.ts`（新 package） | `ElementDiff[]` → `RepairPatch` |
| 修復迴圈 | `packages/repair/src/repair-loop.ts` | render→量測→patch→重載，含收斂控制（§6.3） |
| 資料契約 | `packages/ir/src/types.ts` | §9 全部型別 |
| provenance | `packages/bricks/src/generate-json.ts` | 沿 `BricksPlanNode` 帶 irId，輸出 `ProvenanceMap` |
| 容量測擴充 | `packages/capture/src/css.ts` | 確保 computed-style 白名單涵蓋修復通道（font-size/weight/line-height/color/bg/padding/margin/radius/gap） |

**新 worker 階段**：在既有 `capturing→analyzing→generating→validating` 之後，
插入 `repairing`（loop），`exporting` 收尾。`JobStatus` 增 `"repairing"`。

---

## 11. 實作路線圖（前置在先，loop 在後）

> 每一步都**獨立可驗證**、都能單獨提升還原度，不必等到 loop 才看到成果。

- **Phase 0｜量測基礎建設**
  - provenance map（§5.4）+ computed-style 白名單擴充（§10）。
  - 真實 render harness P3（§5.3）：先能「寫入→截圖→逐 id 量測」跑通。
  - _驗收_：對現有 job，能吐出 render 側每個 `#brxe-id` 的 box/style。

- **Phase 1｜第 1 訊號**
  - 比對器 P4（§5.4）→ `CorrespondenceReport`。
  - _驗收_：對 page 88，列出每個配對 element 的 Δx/Δfont-size/ΔE，人工抽查正確。

- **Phase 2｜前置修正（不進 loop 就先跳一大截）**
  - P2 container 釘定（§5.2）+ P1 版面重建（§5.1）。
  - _驗收_：「FOR DEVELOPERS」區塊結構正確；desktop SSIM 明顯上升。

- **Phase 3｜Robust diff**
  - §6.4：anim off + 遮罩 + SSIM，取代原始 pixelmatch。
  - _驗收_：同一頁重複量測分數穩定（不再被 marquee/白幀干擾）。

- **Phase 4｜修復迴圈**
  - repair-planner + repair-loop + 收斂控制（§6.2、§6.3）。
  - _驗收_：對 3–5 個真實 URL，loop 單調上升並在 plateau/達標停止；
    golden fixtures 不回歸。

- **Phase 5｜Level B + 多 viewport**
  - 高 severity 殘差追加 id-scoped `_cssCustom`（§7）；desktop 收斂後再修
    tablet/mobile（§8）。

---

## 12. 風險與回歸防護

- **震盪 / 局部最優**：靠 §6.3 的接受—回滾 + 鎖定 + 分 tier 化解；有懷疑就**回滾**。
- **回歸**：維護 golden fixtures 套件（含 `test-fixtures/landing.html` 與若干真實頁的
  凍結分數）；**任何 generator 規則變更都不得讓 golden 分數下降**——我們踩過
  glow card 讓 fixture 0.94→0.91。
- **成本**：每輪 = regen + docker 寫 + render + 截圖 + 量測（+ 少量 LLM）。控制手段：
  desktop 先收斂、確定性 op 為主、LLM 只處理結構歧義、plateau 早停。
- **字型不一致**：Level B 要真的一比一，來源字型需在 render 環境可用；否則文字量測
  永遠有殘差——以遮罩/容差承認此極限，別讓 loop 空追。
- **過度追求像素**：守住 §8 的定義式目標；**100% 非目標**。

---

## 13. 一句話總結

> **元素級 Δ 是舵、pixel-diff 是門、Vision 只跑一次；先重建版面與釘定寬度，
> 再讓確定性、可回滾、分 tier 的迴圈收斂到一個有遮罩、有定義的還原度——
> 輸出永遠是自足的單一 `.json`。**
