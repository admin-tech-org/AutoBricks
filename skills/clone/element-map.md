# element-map — Bricks element 選型對照表

Phase 2 第 2 步（區塊 plan 初稿）做「DOM → Bricks」重組時**必查本表**。
選型的依據是**證據**（第 1 步的量測＋行為普查），不是 HTML tag 名、不是「看起來像」。
本表只回答「選哪個」；欄位鍵名與存在性一律以 live schema 為準（查無＝使用者版本沒有，
走 fallback，絕不發明）。

## 決策漏斗（每個內容元素都走一遍）

```
1. 認角色：這東西對訪客「做什麼」？（導覽？重複卡片？表單？媒體？純文字？）
2. 行為型 native 有對應？ → 用它（自帶 JS，重造成本最高——這是階梯第 1 層）
3. 沒有 → 基本元素拼裝（heading / text-basic / text / button / image / icon ＋ div / block）
4. 候選定案前查 live schema 確認 element 存在 → 才准寫進 plan 的 `bricks`
```

兩難裁決：兩個候選都成立時，**選設計部在 builder 裡改得動的那個**
（行為型 native > 基本元素拼裝 > code 元素）。

## 兩類 native，待遇不同

- **行為型**（accordion / tabs / slider / counter / countdown / animated-typing / form /
  nav-nested / offcanvas / dropdown / toggle）：**優先採用**——JS 行為自帶，
  自己重造既費工又難維護。
- **視覺型複合**（icon-box / pricing-tables / team-members / testimonials / alert /
  rating / pie-chart）：markup 與樣式是**固定意見**——原站版型吻合才用；
  差得多就用基本元素拼裝，更忠實也更好編輯。別為了「有現成的」硬套。

## 簽章對照表

### 文字與連結

| 觀察證據 | 首選 | 備註 |
|---|---|---|
| `h1–h6`，或短文字＋大字級當視覺標題 | `heading` | tag 由 settings 指定，照原站語意層級 |
| 單段純文字 | `text-basic` | |
| 多段落／夾雜 inline 標記（粗體、行內連結、清單混排） | `text`（Rich Text） | 別拆成一堆 text-basic |
| 有 padding／底色／邊框的連結（看起來是按鈕） | `button` | |
| 行內文字連結 | `text-link` | |
| `<ul>`/`<ol>` 純文字清單 | `list` | 每項帶 icon 見下方 icon-list |

### 媒體

| 觀察證據 | 首選 | 備註 |
|---|---|---|
| 單張 `<img>` | `image` | 釘 `_width`＋aspect-ratio（鐵律） |
| 同群多圖網格、常帶 lightbox | `image-gallery` | |
| `<video>`／YouTube／Vimeo iframe | `video` | |
| inline SVG 需要改色/描邊 | `svg` | 純展示的 SVG 圖檔用 `image` 即可 |
| icon font 或小型裝飾 SVG | `icon` | |
| `<audio>`／podcast 播放器 | `audio` | |
| 站 logo | `image` | **不用 `logo`**——那是抓 WP 站台 logo 的動態元素 |

### 導覽與互動（行為普查必須佐證）

| 觀察證據 | 首選 | 備註 |
|---|---|---|
| header 導覽 `ul>li>a`，mobile 收合漢堡 | `nav-nested` | **不用 `nav-menu`**（吃 WP 選單資料） |
| 點擊開閉的側欄/抽屜 | `offcanvas`（＋`toggle` 觸發） | |
| hover/點擊下拉面板 | `dropdown` | |
| 點問題展開答案（FAQ） | `accordion-nested` | 內容可自由組裝，優於舊版 `accordion` |
| 點 tab 換 panel | `tabs-nested` | 同上，優於舊版 `tabs` |
| 橫向滑動軌道、dots/arrows、Swiper/Slick/Splide 指紋 | `slider-nested` | 每張 slide 是自由組裝內容 |
| 純媒體/單型內容輪播（只有圖或只有卡） | `carousel` | 內容單一時比 slider-nested 省 |
| 回到頂部浮鈕 | `back-to-top` | |
| 明暗模式切換鈕 | `toggle-mode` | |

### 動態展示（behavior.js 有命中才選；沒動就是靜態元素）

| 觀察證據 | 首選 | 備註 |
|---|---|---|
| 捲入視口數字滾動遞增 | `counter` | |
| 倒數計時 | `countdown` | |
| 打字機輪替文字 | `animated-typing` | |
| 進度條動畫 | `progress-bar` | |
| 圓餅/圓環百分比 | `pie-chart` | 視覺差太多就 SVG＋基本元素拼 |

### 表單與複合區

| 觀察證據 | 首選 | 備註 |
|---|---|---|
| `<form>` 帶真實 input | `form` | 欄位照抄；**送出後端**＝階梯第 5 層，UI 模擬或明列 unsupported |
| 站內搜尋框 | `search` | 連的是 WP 搜尋；純裝飾搜尋框用 `form`/拼裝 |
| icon＋標題＋描述的重複群組 | `icon-box` | 版型不合就 `block`＋icon＋heading＋text 拼 |
| `<ul>` 每項帶 icon | `icon-list` | |
| 引言＋頭像＋姓名（常輪播） | `testimonials` | 視覺型複合——版型不合就拼裝 |
| 多欄價目表＋CTA | `pricing-tables` | 同上 |
| 團隊成員卡格 | `team-members` | 同上 |
| 星級評分 | `rating` | |
| 提示/警告色塊 | `alert` | |
| 社群 icon 列 | `social-icons` | |
| 內嵌地圖 iframe | `map` | |
| `<hr>`／獨立分隔線 | `divider` | 是某個盒子的邊緣就直接上 `_border`，別多一顆元素 |

### 版面（鐵律已定，這裡只記角色）

`section`（頁面級橫帶）→ `container`（釘 content_width 的置中欄）→
`block`（要分欄或帶 surface 的群組）→ `div`（無語意的最小包裝，能塌則塌）。

## 換型別（remap）鐵則

既有元素換型別＝重寫 settings，這一步最容易翻車：

1. **版面鍵不許憑空消失**：舊元素（或其父層）的 `_direction`／`_display`／寬高／
   間距鍵要逐一交代去向。block/div 預設 `flex-direction: column`——
   橫排群組必須**明寫** `_direction:"row"`，漏了整條變直排。
2. **樣式繼承要重查**：HTML 字串裡的 inline style（顏色、字級）不會自動跟到
   新元素——深色底上的 text-link 沒帶 `_typography` 就是黑字，換完逐項補。
3. **換完必重跑該區視覺對照**（SKILL Phase 2 第 4 步鐵則）——功能測試
   抓不到版面回歸。

## 反選錯三律（違反任何一條＝選型不合格）

1. **靜態複刻禁用 QUERY／WORDPRESS／SINGLE／WooCommerce 類元素**——
   `posts`、`pagination`、`query-results-summary`、`nav-menu`、`sidebar`、`shortcode`、
   `post-title`/`post-content`/`post-meta` 等全是從 WP 資料庫拉資料的動態元素。
   原站的新聞卡格、文章列表一律 `block`/`div`＋逐字靜態內容重現；
   **使用者明說要接動態資料才准用**，並在 plan 註記。名字像 ≠ 用途對——
   這是最常見的選錯。
2. **「長得像」不算證據，行為普查才算。** 三張並排靜止的卡是 `block` 不是
   `carousel`；反過來，普查抓到的 marquee/自動輪播/計數不准降級成靜態元素——
   行為缺了就是沒做完。
3. **live schema 一票否決。** 本表列的是官方 v2.3 全集；使用者版本查無該 element
   ＝不存在，走基本元素拼裝＋階梯（`_interactions`→CSS→code），絕不發明元素名。
