# Bricks 1.12.5 — 已驗證的 JSON 形狀與地雷（單一真相來源）

以下形狀**全部對照 Bricks 1.12.5 theme 原始碼驗證過**，且已知與 html2bricks（h2b）2.x
文件**不同**——1.12.x 一律信這份，不信 h2b。官方 bricks-schema（v2.3）對應 Bricks 2.x，
涵蓋面廣可查「欄位存在性」；**形狀衝突時以本檔為準**。

## 信封與存放

- 每個 element 扁平存放：`{id, name, parent, children, settings, label?}`；根元素 `parent: 0`；
  順序由 `children[]` 決定。
- **空的 `settings` 在 Bricks 存出來是 `[]`**（PHP 空陣列的 JSON 化），不是 `{}`——讀取
  Bricks 產生的 JSON 時要容忍；自己生成時一律用 `{}`（實機驗證於 1.12.5）。
- 頁面內容存 postmeta `_bricks_page_content_2`（header/footer 各為
  `_bricks_page_header_2`/`_bricks_page_footer_2`）；頁面設定 `_bricks_page_settings`；
  編輯模式 `_bricks_editor_mode` = `"bricks"`。
- 響應/狀態後綴用冒號：`_typography:tablet_portrait`、`_boxShadow:hover`。

## 設定形狀（會咬人的那幾個）

### 漸層 — 獨立的 `_gradient` key（不是塞進 `_background`）
```json
"_gradient": {
  "applyTo": "background",
  "gradientType": "linear",
  "angle": "135",
  "colors": [
    { "color": { "hex": "#ff5a1f" }, "stop": "0" },
    { "color": { "hex": "#7a2f8a" }, "stop": "40" }
  ]
}
```
theme 會自動補 stop 的 `%` 與 angle 的 `deg`。**不要**把 `linear-gradient(...)` 字串塞進 `_background`。

### 陰影 — `_boxShadow` 是 OBJECT（h2b 寫成陣列是錯的）
```json
"_boxShadow": {
  "values": { "offsetX": "0", "offsetY": "14", "blur": "44", "spread": "0" },
  "color": { "rgb": "rgba(0, 0, 0, 0.42)" },
  "inset": false
}
```
hover 變體：key 用 `"_boxShadow:hover"`，形狀相同。

### 邊框 — width/radius 是逐邊 object
```json
"_border": {
  "width": { "top": "1", "right": "1", "bottom": "1", "left": "1" },
  "style": "solid",
  "color": { "rgb": "rgba(255, 255, 255, 0.09)" },
  "radius": { "top": "18", "right": "18", "bottom": "18", "left": "18" }
}
```

### 背景圖 — `image` object＋同層 size/position/repeat
```json
"_background": {
  "image": { "url": "https://…/x.png", "external": true },
  "size": "cover", "position": "center center", "repeat": "no-repeat"
}
```

### 字體 — family 與 fallback 必須拆開（最常見的無聲 bug）
Bricks 會把整個 font-family 值當「一個字型名」加引號：`"font-family":"Noto Sans TC, sans-serif"`
會變成瀏覽器找不到的字型 → 掉回 serif。generic 關鍵字要拆到 `fallback`：
```json
"_typography": { "font-family": "Noto Sans TC", "fallback": "sans-serif" }
```
generic 清單：`serif / sans-serif / monospace / cursive / fantasy / system-ui / ui-*`。

### 顏色 — alpha < 1 要保留 `{rgb}`
不透明 → `{ "hex": "#rrggbb" }`；半透明 → `{ "rgb": "rgba(...)" }`（轉 hex 會丟 alpha，
柔和陰影會變成死黑）。alpha ≤ 0 → 整個 key 省略。

## 精準尺寸

- **間距用實測原值**，不吸附 4px 網格（吸附就是間距漂移的來源）。
- **圖片**：釘 `_width = "<實測寬>px"`，**絕不同時固定 `_height`**（容器變窄時
  `max-width:100%` 壓寬、固定高會變形）。改用 id-scoped CSS 鎖原始比例：
  `#brxe-<id>{aspect-ratio:<w>/<h>;height:auto}` → 寬縮高跟著縮、不變形。

## id 與匯入安全

- **id：6 碼 `[a-z0-9]` 且至少含 1 個數字。** Bricks Templates 匯入會對整份模板做
  **全域字串替換**來重編 id——「可讀」id（如 `hero01` 裡的 `ico`）會被撞壞，
  匯入後報「元件 X 不存在」。
- **一個 kit zip 恰好包一個 `.json`**（Bricks 把每個 json 當一個 template）。

## `%root%` 不會被替換（鐵律）

`_cssCustom` 是**原封不動輸出**的——Bricks 1.12.5 **不會**把 `%root%` 換成元素 selector，
`%root%{…}` 會以無效 selector 原樣送到前端、完全沒作用。**一律用真實 `#brxe-<元素id>`**，
且因為 id 在生成/複製後才定案，**id-scoped 的 `_cssCustom` 必須在元素 id 全部定案之後才寫**
（有 clone 元素時，clone 後要各自補自己的 id 規則）。`_cssCustom` 會隨模板 import 一起帶入、
不需任何外掛或 gate。

## 原則

native 設定能表達的一律走 native（builder UI 可編輯）；`_cssCustom` 只留給 native 表達
不了的（keyframe 迴圈、`::before`、mask、marquee 這類）。

## 絕不生成 Code 元素

Bricks 1.9.7 起「程式碼執行」預設禁用、且每段碼需管理員簽名才會跑——生成 `code`
元素等於產出死物。fallback 一律走 id-scoped `_cssCustom`（純 CSS 不受此管制）；
連 CSS 都表達不了的效果就明列 unsupported 回報，不要用 Code 元素硬湊。

## 動態效果的四層階梯（由上往下找，落在越上層越好）

1. **自帶 JS 的原生元素**：輪播 `carousel`/`slider-nested`、手風琴 `accordion`、頁籤
   `tabs`、數字滾動 `counter`、打字機 `animated-typing`…——元素的 JS 是 Bricks theme
   自己的前端碼，不受程式碼執行管制、永遠會跑。原站的輪播/FAQ/數據動畫優先對應到
   這些元素（存在與欄位查 bricks-schema/elements/）。
2. **原生互動設定 `_interactions`**：觸發器（捲入視野/點擊/hover…）＋動作（進場動畫/
   顯示隱藏/切換 class…），純設定、builder 可編輯。捲動進場、點擊展開走這層
   （欄位形狀查 bricks-schema 的 element 共通 meta-settings）。
3. **CSS 模擬（id-scoped `_cssCustom`）**：跑馬燈 keyframes、視差、發光邊框等
   視覺動態。
4. **都做不到 → 明列 unsupported 回報**，不硬湊。
