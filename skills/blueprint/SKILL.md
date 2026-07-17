---
name: blueprint
description: 把任一網頁萃取成一份「規格表」（IR，中間表示），再由規格表機械生成 Bricks Builder 模板。CDP 接管真 Chrome 三軸實測（結構+樣式走 DFS+getComputedStyle、完全不用讀 CSS 檔／狀態走 CSS.forcePseudoState 逐一逼出／行為走 getAnimations+探測），資產真的下載到本機。規格表是純資料，不用瀏覽器就能驗完整性，所以驗證快；生成是機械的，所以手工只做一遍。分析工具一律臨場寫在 tmp/，plugin 只給方法不給程式。觸發詞：「用 blueprint / 萃取成規格表 / IR / 先做規格表再轉 bricks / 把網站抽成資料再生成」，或使用者想複刻網頁但嫌逐區對像素太慢時。
---

# blueprint — 先萃取成「規格表」，再機械生成

**一句話**：**量一次原站，存成一份規格表（純資料），再由規格表機械生成 Bricks。
手工只做一遍，而且做在最有價值的地方——決定結構要多乾淨。**

> **規格表（IR）是什麼**
> 你不會拿 Photoshop 檔丟給工程師，你會給一份清單：「這個標題 96px、粗體、黑色、離上面 40px」。
> 那份清單就是 IR。它不是網頁、不是 Bricks 檔，就是資料。

## 為什麼要有它（這決定了整份 skill 的形狀）

**能不能寫成程式，取決於輸入有沒有邊界。** IR 就是那條界線：

| 段 | 輸入 | 結論 |
|---|---|---|
| 原站 → IR | **任意網站**（無界） | 變數無窮 → **只能臨場分析**，任何預先寫死的分析程式都補不完 |
| IR → Bricks | **我們自己定的格式**（有界） | **可以機械生成**，因為輸入輸出都在我們手上 |

**沒有 IR 的話，手工翻譯會做兩遍**：先看著原站手工做一版中間產物，再看著中間產物手工翻成 Bricks。
而且那份中間產物若是「網頁」，就**只能靠 render 才能驗**——所有的痛苦都從這裡來
（反鋸齒模式、小數捨入、瀏覽器模式差異：全都不是複刻問題，卻會吃掉大半時間）。

**規格表是資料，不是網頁。** 中間不需要任何「看得到的東西」。

**規格表是純資料，不用瀏覽器就能驗。** 瀏覽器只在兩個地方需要：**量原站**（一次）、**看成品**（一次）。
中間全都不用。

## 鐵律

1. **plugin 目錄唯讀。分析工具一律 `tmp/` 現寫。**
   分析的輸入是任意網站＝無界，預先寫死的分析程式注定補不完；而**發行出去的 plugin 是改不了的**
   （唯讀＋marketplace 更新會整包蒸發）。**這份 skill 必須在「plugin 一行都不能改」的前提下跑完任何網站**
   ——做不到就是 skill 壞了，不是工具缺一個屬性。
   本檔給的每段程式都是**起點框架**，不是成品：複製到 `tmp/`、照當前網站臨場改。
2. **不准猜數字。** 所有數值來自實測（`getComputedStyle` / `getBoundingClientRect` / `getAnimations`）。
   「看起來像 18px」是錯的。**IR 裡出現的每個值都必須能在原始量測 dump 裡找到**（這條可以機器驗，見驗收）。
3. **照觀察複刻，不照原始碼意圖複刻。** class／JS 裡看到的效果必須**實測**確認真的發生。
   實測沒發生的是死碼，記 `excluded` ＋理由。**也絕不憑印象補「這種元件通常會有」的效果**
   （跑馬燈「通常」hover 會停、手風琴「通常」箭頭會轉——原站不做，我們就不做）。
   > 死碼的常見長相（都是很難用看的看出來的）：
   > - **宣告被祖先廢掉**：`position:sticky` 的參考對象是最近的捲動容器；某個祖先只要有非 `visible` 的
   >   `overflow`，就會變成那個容器——若它自己永不捲動，sticky 就完全失效。
   > - **規則被自訂屬性中和**：CSS 規則存在，但它吃的 `var(--x)` 被 inline 設成 no-op 值。
   > - **變體綁錯層級**：`group-*`／`peer-*`／`has-*` 這類修飾詞的錨點掛在錯的元素上 → 規則永遠不觸發。
   >
   > **這三種在原始碼裡都「看起來會動」。只有實測分得出來。**
4. **先捲再點。** 動手前先判互動模型（見 Phase 2）。判錯＝整區重做，不是改數值能救的。
5. **單一取樣的結論一律無效。** 截圖／量測一律拍兩次、一致才算數。
   合成與截圖的時機不保證穩定，單張可能是還沒畫完的 frame——**拿它下結論，會得到一個自洽但不存在的現象，
   然後花好幾小時去解釋它。**「不准猜數字」的下一句就是「也不准用單次取樣下結論」。

## 三軸：怎麼保證沒漏

**DFS 只走了一軸。** 三軸各有各的窮舉法，**2.5 軸可以機械證明完整**：

| 軸 | 方法 | 完整性怎麼證 |
|---|---|---|
| **結構＋樣式** | DFS 走 DOM ＋ 每個元素 `getComputedStyle` | `走訪數 + 略過數 == DOM 總數`，未處置必須 = 0 |
| **狀態** | CDP `CSS.forcePseudoState` 逐一逼出來再量 | 狀態集合固定：hover／focus／active／focus-within／focus-visible／visited／target |
| **動畫** | `getAnimations()` | 一次列冊，含名稱／時長／目標 |
| **互動** | **只能探測** | ❌ **這半軸沒有機械解法** |

**關於樣式**：`getComputedStyle` 給的是**算完的最終值**——cascade、媒體查詢、繼承、selector 全部套用過了。
**所以完全不用讀 CSS 檔**，也沒有跨網域 CORS 問題。

**關於互動那半軸（要知道自己在賭什麼）**：React 這類框架用**事件委派**——監聽器全掛在根節點，
個別元素上是 0。所以「哪些元素可以點」**問不出來**。只能用代理指標探：
`cursor:pointer` 的節點、原生互動元素（`<a>`／`<button>`／`<summary>`／`<details>`／`<input>`）、
`getAnimations()` 的目標。**探完要記錄「我探了什麼」，別假裝這是完整的。**

**DFS 的死角（明確處理，別假裝樹是全部）**：
文字節點（**走元素會漏掉內容**）、偽元素（`getComputedStyle(el, '::before')`，先看 `content !== 'none'`）、
SVG 內容（是 markup 不是樣式）、shadow DOM／iframe（要明確 pierce）、點了才長出來的 DOM。

## 規格表的形狀（IR schema）

**這是契約，不是程式。** 照這個形狀寫，`IR → Bricks` 才會是機械的
——**Bricks 的資料模型本來就是「扁平元素陣列 ＋ 每個元素自己的 settings」**，IR 對齊它。

```jsonc
{
  "meta":   { "url", "viewport": 1440, "batch", "dom_total": <整數> },
  "tokens": { "colors": {…}, "fonts": {…} },        // 跨區共用的值
  "assets": { "fonts": […], "images": […], "icons": […] },  // 已落地的本機路徑

  "nodes": [                                        // 扁平陣列，用 parent 串樹
    {
      "id":     "<區>-<角色>",       // 人看得懂即可，全頁唯一
      "role":   "heading",          // ★語意角色，不是 Bricks 元素名。生成時才對應
                                    //  （IR 不准內建 Bricks 版本知識——元素/欄位隨版本變，
                                    //    IR 要能撐過 Bricks 改版）
      "parent": "<上層節點 id>",
      "source": [<原站節點編號>, …], // ★處置帳：這個 IR 節點吃掉了原站哪幾個節點
      "text":   "<實際文字，逐字照抄>",
      "styles": { "<屬性>": "<實測值>", … },   // 已解析的最終值（基準寬度下）
      "states": { "hover": { "<屬性>": "<實測值>" } },   // 只記「跟基準不同」的
      "breakpoints": { "768": { "<屬性>": "<實測值>" } }, // 同上
      "behaviors": ["<behaviors 表的 id>"]
    }
  ],

  "behaviors": [
    { "id": "<id>", "trigger": "time|click|scroll|hover",
      "spec": "<實測到的規格>",
      "evidence": "<量測方法與數字——沒有證據就不准寫 verified>",
      "status": "verified|excluded", "reason": "<excluded 時必填>" }
  ],

  "disposition": { "dom_total": <整數>, "accounted": <整數>, "unaccounted": 0 }
}
```

- **`source` 是處置帳。** 每個原站節點都要出現在某個 IR 節點的 `source` 裡，或出現在 `skipped` 清單裡（＋理由）。
- **`role` 不是標籤。** IR 記「這是什麼」，不記「用什麼做」。生成器才決定 Bricks 用 `heading` 還是 `text-basic`。
- **一個 IR 節點可以吃掉多個原站節點**（塌掉純包裝層）——**這就是「乾淨」發生的地方，也是唯一需要判斷的地方。**
  塌之前先確認那層沒有視覺：背景（含 `background-image`）、邊框、間距、**overflow**、stacking context、
  `flex-shrink`、`min-width:auto`。
- **重複的做成一個節點＋資料列表**（94 張卡＝1 個節點 + 94 筆資料），別展開 94 份。

## 驗收：兩層，各驗各的

**第一層：IR（不用瀏覽器，秒回）**
1. `disposition.unaccounted == 0` —— 每個原站節點都有下落
2. **IR 裡的每個樣式值都能在原始量測 dump 裡找到** —— 找不到＝有人在猜。這條可以機器跑。
3. 每個 `behaviors` 都有 `evidence`，且沒有 `todo`（全是 verified 或 excluded＋理由）
4. 每個 `assets` 路徑都存在於本機

**第二層：成品（推 WP 之後，整頁一次）**
- 整頁 pixel diff，**門檻：通道差 ≤8 才算差異**。
  > **為什麼是門檻不是 0**：**0 分不出「我們做錯了」和「環境不一樣」。**
  > 真 bug 的差異是**大級數**的（位移、缺件、顏色錯 → 數十至 255 級），門檻照樣大聲抓到；
  > 而 **1–2 級**的差異幾乎都是瀏覽器內部細節——文字反鋸齒模式（灰階 vs 次像素）、
  > 小數寬度的邊緣捨入、合成時機。那些**人眼看不見，也不是複刻問題**。
  > 追它們＝把「關於網頁的問題」換成「關於 Chrome 的問題」，會燒掉大量時間而不改善成品。
  > **門檻是 host 設一次的常數，不是每個區各自判斷**——band 拿到的仍是二元 pass/fail。
  > 超過門檻的差異一律要查到根因，不准調高門檻來蓋。
- **不做逐區的 pixel 逼近。** 那是把「關於網頁的問題」換成「關於 Chrome 的問題」。

## 執行模式：host 派工、subagent 幹活

> **為什麼**：同一條 context 從頭做到尾，開頭載入的規則會被越來越長的對話稀釋——
> 前面幾步最嚴謹，越往後越漏，甚至發明原站沒有的效果。**host 自己也會漂移，不是只有 subagent 會。**

### 派工判準：**這一步需要的歷史，能不能寫下來？**

**brief 就是壓縮過的記憶。** 注入足夠資訊含量的 prompt，本身就是「把前面的歷史帶過去」的一種方法。
所以要問的不是「這步需不需要歷史」，而是「**它需要的歷史，寫得出來嗎**」：

| | 判斷 | 誰做 |
|---|---|---|
| 需要的上下文**寫得出來**（量測、走訪、下載、生成、單區的處置決定） | 寫進 brief 就夠 | **subagent**（乾淨 context、規則滿強度） |
| 需要**跨步驟、跨區的比較**（整合／修正／微調／驗證） | 比對對象塞不進 brief——那是「我一路看過來的全部」 | **host** |

**host 只留寫不下來的那些**：整合、修正、微調、驗證、跨區一致性（乾淨度）、
以及「要不要推翻先前的決定」。**其餘一律派出去——host 自己去做可以寫下來的事，
等於把本來能注入的東西改用燒 context 的方式做，而且會在最需要判斷力的時候沒有判斷力。**

### 規矩

- **一個工作單元＝一個全新 subagent**。**不可用 fork**（會繼承長 context，等於白做）。
- **依序執行**：CDP 瀏覽器只有一個。
- **派工必須注入**：① 先讀本 SKILL.md 全文＋`plan.json`；② 這一步的資訊與產出位置；③ IR schema；
  ④ **分頁慣例：自己 `browser_tabs list` 確認角色，不信任前一手留下的狀態**；⑤ 收帳定義；
  ⑥ **★前面幾步用血換來的坑**——這是 brief 最有價值的部分，host 要一路累積、逐次注入。
- **host 驗收**：跑第一層的四條機器檢查＋抽驗一個數字。不過關 → `SendMessage` 叫**同一個** subagent 補。
  **回報文字不算數，落檔的工件才算。**
- **subagent 抓到 host 的錯要直說**，host 要照單全收——實測 host 犯的錯往往比 subagent 多，
  因為 host 的 context 最長。

**乾淨度是 host 的職責，不是 band 的。** 乾淨是**跨區**的性質——band 只看得到自己那一區，
15 個 band 各自優化＝15 種寫法。host 用數字驗（不是印象）：重複率、`role` 命名是否一致、
同一件事是否只有一種表達、IR 節點數 vs 原站節點數。

## Phase 0 — 環境

1. **CDP Chrome**：
   ```bash
   PORT=$(grep -s '^CDP_PORT=' .browser/cdp.env | head -1 | cut -d= -f2 | tr -d ' \r'); PORT=${PORT:-9222}
   curl -s "${PLAYWRIGHT_CDP_URL:-http://127.0.0.1:$PORT}/json/version"
   ```
2. **批次編號** `<年月日-時分秒-站名>`；產物 `data/<id>/`。
3. **⚠️ 分頁健康檢查（血的教訓，別跳）**——分頁會被前一手污染成不可比的狀態：
   ```js
   const c = await page.context().newCDPSession(page);
   await c.send('Page.setWebLifecycleState', { state: 'active' });        // 否則背景分頁 rAF 永不觸發、evaluate 掛死 30 分鐘
   await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); // 否則 :active 不 match
   ```
   **每個分頁各做、每次導航後重做。** 驗：`document.hidden===false && document.hasFocus()===true`。
   **並確認沒有裝置模擬殘留**——`Emulation.setDeviceMetricsOverride{mobile:true}` 會把捲軸換成 overlay，
   內容區因此**多出整個捲軸的寬度**；而 `maxTouchPoints`／`pointer:fine` 依然是桌機的值，**看不出來**。
   一旦兩個分頁的模式不同，**它們量出來的一切都不可比，而且不會報錯**。
   > 驗法：兩個分頁的 `document.documentElement.getBoundingClientRect().width` **必須相同**
   > （注意用 `getBoundingClientRect`，不是 `clientWidth`——後者會取整，把小數差藏起來）。
   > 不同就先解決。**有疑慮就開新分頁，不要沿用前一手留下的。**
4. **evaluate 裡的等待一律包 `Promise.race` + `setTimeout` 逾時**，絕不裸等 rAF 或事件。
5. **校準**：resize 1440 後**必驗 `window.innerWidth`**；每次導航後重驗。

## Phase 1 — 全站基礎（host 做，序列）

1. 導航 → 逐屏捲到底（觸發延遲載入）→ 回頂。
2. 基準截圖 1440／768／375。
3. **🎬 頁級行為列冊**：`getAnimations()` 全頁一次；查 smooth-scroll 庫指紋（`.lenis`／`.locomotive-scroll`）、
   `scroll-snap`、視差、進場動畫。逐筆歸屬到區。
4. **⭐ 資產下載（不下載就等於沒復刻）**：掃全 DOM ＋ `performance.getEntriesByType('resource')`
   （後者抓得到 DOM 看不到的東西，且不受 CORS 限制），**真的下載**到 `data/<id>/assets/`：
   - `img.currentSrc`（**不是** `src`——要「實際載入的那張」）、`srcset` 每個候選
   - `<video>` 的 src／poster
   - computed `background-image` 裡的 URL。**兩個必踩的坑**：
     `url(#…)` 是**文件內部引用**（SVG filter／mask／gradient），不是檔案；
     `data:` URI 內部**還會有 url(…)**（例如 SVG 濾鏡定義），天真的 regex 會鑽進去把它當外部網址撈出來
     → 相對路徑會被 absolutize 成「網頁自己」，於是你下載到一份 HTML 當圖片。
     **先把 `data:` 整段挖掉再找，且跳過 `#` 開頭的。**
   - favicon、webfont（Google Fonts 的 CSS 要**帶真 Chrome 的 UA** 抓，否則拿到的不是 woff2）
   - **inline `<svg>`**：抽出、**照 path 內容去重**（不是照 markup——同形狀不同 class 會被當成兩個）、
     存成具名檔。**注意**：檔案本身常帶 `fill="none"`，實心是靠 CSS class 給的
     → **icon 一律 inline 或 `<symbol>`+`<use>`，不能用 `<img src=…svg>`**（CSS 勝過 presentation attribute）。
     用 `<symbol>` 時**不要把 fill/stroke 搬進 symbol**，否則繼承會在 shadow tree 斷掉。
   - **引用全部改本機相對路徑**；收尾要能**斷網完整渲染**。
5. **tokens**：字體、色票、內容區寬。
   **字體要量「實際生效的字族」，不是 stack 的第一個**——stack 裡的泛型關鍵字（`ui-*` 系列等）
   瀏覽器不一定解析，會靜靜落到下一順位，字寬因此差好幾個百分比，而 computed 仍照實回報你寫的那串。
   **驗證方式：同一支字寬探針在原站與成品各跑一次，數字必須相同。** 這比讀 CSS 可靠。
6. **切區**：頂層子樹＝一區。走訪工具 `tmp/` 現寫。
7. **⚠️ 祖先鏈也要處置，而且寧可照原站保留層次、不要塌。**
   `body → wrapper → main` 這條在區之上的鏈也是節點，且常帶**頁級背景與裁切**，會透過透明的區塊透出來。
   > **為什麼寧可不塌**（把兩層併成一層，看似無害，實際會壞掉）：
   > - **背景圖的 tile 原點是「它自己的 padding box」**。把帶背景圖的那層往上併，圖案的相位就整個位移
   >   ——差幾 px 而已，但那是**大級數**的像素差，且只有透明的區塊才看得到（實心底色的區完全正常）。
   > - **`overflow` 決定捲軸模式與裁切邊界**。搬到不同層級會改變內容區寬、也會改變哪些溢出的裝飾被裁掉。
   > - 這類錯**會潛伏**：前幾區若都是實心底色，一路 PASS；**第一個透明底的區才會一次爆出來。**
   >
   > 每一層都逐一查 `background-color`／`background-image`／`overflow`／`position`／stacking context 再決定。
8. 寫 `data/<id>/plan.json`（區清單、頁級行為、tokens、資產、環境註記）。

## Phase 2 — 一區一區量進 IR（band subagent）

**① 先判互動模型，才准動手**
1. **先不要點。** 慢慢捲過這一區，看有沒有東西**自己**變。
2. 有＝scroll-driven：查明機制（IntersectionObserver／scroll-snap／sticky／animation-timeline／scroll listener）。
3. 捲動都沒反應，才輪到 click／hover 掃（**用真滑鼠**）。
4. 結果**必填**進 IR：`互動模型: static|click|scroll|time`（可複合）。

**② 走訪＋量三軸**（工具 `tmp/` 現寫）
- 結構＋樣式：DFS，每個元素 `getComputedStyle` **全量 dump**（不要精選屬性——精選就是在賭你猜中了重要的）
- 狀態：`CSS.forcePseudoState` 逐一逼出來再量，**只記「跟基準不同的屬性」**
- 動畫：`getAnimations()`，記 name／duration／easing／keyframes／target
- **有狀態的元件要抽全部狀態**：tab／輪播**逐個真點擊**，記清楚「哪個內容屬於哪個狀態」

**③ 做處置決定，寫進 IR**
- 逐節點決定：吃進某個 IR 節點（`source`）／塌掉（併進上層的 `source`）／重複（1 節點＋資料列表）／
  skip（＋理由）。
- **塌之前先確認那層沒有視覺**（背景含 `background-image`、邊框、間距、overflow、stacking context、
  `flex-shrink`、`min-width:auto`）。
- **未處置必須 = 0。**

**④ 收帳（三條，缺一不可）**
- `unaccounted == 0`（含祖先鏈）
- 每個樣式值都能在原始 dump 裡找到（不准有憑空的值）
- 行為清冊無 `todo`（全是 verified 或 excluded＋理由）

## Phase 3 — 生成（host，機械）

- 寫 `tmp/emit_bricks.py`：讀 IR → 吐 `data/<id>/template.json`。
  **它的輸入是我們自己的 IR＝有界，所以可以是程式**；但它仍住 `tmp/`，因為 Bricks 的 schema 隨版本變。
- **Bricks 欄位存在性**：查使用者專案的 live schema（`src/extract_bricks_schema.py` 從 theme 原始碼現抽）
  → `bricks-schema/`（fallback）。**查無＝沒有，絕不發明。**
- id 6 碼 `[a-z0-9]` 含數字；**`%root%` 在 `_cssCustom` 不會被替換**，一律真實 `#brxe-<id>`；
  圖片釘 `_width` ＋ id-scoped `aspect-ratio`，不要固定 `_height`；
  頂層要有 `globalClasses` ＋ `global_classes` ＋ `title` ＋ `type:"content"`。
- 驗語法：`uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/src/validate_template.py" "<template.json>"` → error 清零。
- 推：`docker exec … php`（Windows 加 `MSYS_NO_PATHCONV=1`），覆寫同一個 PAGE_ID。**絕不用瀏覽器登入後台。**

## Phase 4 — 對照與收尾（host）

1. **整頁 pixel diff**，1440／768／375 各一次，**門檻 ≤8**。超過門檻的一律查到根因。
2. **失真歸因（差異只有兩種來源，一句話就能分開）**：
   把成品那顆元素的 computed 值，跟 IR 記的值比——
   - **對不上** → 是**生成器**沒表達出來，或 **Bricks 表達不了**（後者要明列＋理由，那是可接受的失真）
   - **對得上、但還是不像原站** → 是 **IR 量錯了**，回 Phase 2 重量該區
   > 不需要生任何中間網頁來對照。IR 記的就是原站的真值，直接拿它當基準。
3. 行為逐筆用**真滑鼠**實測。
4. 三個寬度確認無水平捲軸；成品截圖落檔。
5. 清 `tmp/`、關本次分頁、專案根不留垃圾。
6. **回報**：IR 的四條機器檢查結果、pixel diff 三個寬度的數字、行為清冊逐筆、資產清單、
   **Bricks 表達不出來的項目＋理由**（這是可歸因的失真，不是失敗）、待人工清單、PAGE_ID 和網址。
