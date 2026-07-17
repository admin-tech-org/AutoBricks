---
name: replica
description: 高保真把任一網頁複刻成 Bricks Builder 頁面。方法：CDP 接管真 Chrome 把原站「量」成資料（每個元素的全部屬性都記，不挑；狀態用 CSS.forcePseudoState 逼出來量；動畫用 getAnimations 列冊），一區交給一個乾淨 context 的 subagent 做決定、直接生成 Bricks JSON、推本機 WP 渲染，再拿「渲染出來的值 − 量到的值」逐屬性相減＋視覺把關，修到一致；行為獨立成冊逐筆實測（原站沒有的效果絕不補）。分析程式零內建、全部臨場寫在 tmp/——skill 只給方法與要點。觸發詞：「高保真複刻 / 精確複刻 / 要很像 / pixel 級複刻 / 用 replica 做這個網站」，或使用者嫌 clone 的結果「差很多、要更像」時。
---

# replica — 把網頁高保真複刻成 Bricks 頁面

**一句話**：把原站**量成資料**，一區一區決定怎麼蓋，**直接產出 Bricks JSON**，推到本機 WordPress
看結果，拿「渲染出來的值」對「量到的值」逐一相減，差多少修多少，修到一致。
**中間不做任何中繼版本**（不先做一版 HTML、不先寫一份規格表）——多一層轉手就多一次失真，
也多一個轉述出錯的機會。

> **名詞（全文用到）**
> - **原站**：目標網頁。開著它的分頁＝原站分頁。
> - **渲染頁**：生成的 Bricks 頁，跑在本機 WordPress（`http://localhost:8080/?page_id=<編號>`）。
> - **dump**：把原站某一區「每個元素 × 每個屬性」全部量下來存成的檔案。
>   **幾百個屬性全記、不挑**——挑幾十個「看起來重要的」就是在賭你猜中了，漏掉的那個之後查不到。
>   dump 是唯一的真相來源：**Bricks JSON 裡每個數字都要能在 dump 裡找到出處。**
> - **建**＝改 `tmp/build_template.py` 產 `data/<id>/template.json`；**推**＝docker 送進 WP；
>   **收斂**＝修到差異清空（照噪音規則與門檻）。

## 為什麼零內建分析程式（最重要的一條）

網站千變萬化，**預先寫死的分析程式永遠會遇到沒料到的情況**：挑 50 個屬性記，下一站就用到第 51 個。
而 plugin 在使用者端是唯讀的、更新會整包覆蓋——**工具寫死在包裡＝永遠改不了**。

所以這份 skill **只給方法和要點，不給程式**。所有分析工具都在使用者專案的 `tmp/` 現場寫、
照當站的狀況改、用完即棄。本資料夾除了這份文件**沒有任何程式**。
自我檢查：**這份 skill 要在「plugin 一行都不能改」的前提下跑完任何網站；做不到就是 skill 壞了，
不是缺一支工具。**

## 四本帳（核心方法：四本都結清，一區才算完成）

| 帳 | 管什麼 | 怎麼保證不漏 |
|---|---|---|
| **① 處置帳** | 結構——原站每個節點的去向 | 走訪整棵樹列成清單，每筆給一個決定；`走訪＋略過 == 節點總數` 由機器驗，未處置必須＝0 |
| **② 行為清冊** | 動態——每個會動的效果 | 三軸列冊（見下）＋逐筆實測；每筆不是 `verified`（附證據）就是 `excluded`（附理由），還有 todo 就不准收帳 |
| **③ 數值 diff** | 精確度——每個元素的每個屬性 | **渲染頁量到的值 − dump 記的值**，逐屬性相減、修到清空 |
| **④ 視覺把關** | 整區長相——程式抽不到的東西 | 先把原站截圖**用文字逐項描述成清單**，再拿清單去核渲染截圖；像素比對用**門檻**、不用 0 |

- ③ 比的對象是 dump——不是印象、不是 CSS 原始碼。
- ④ 為什麼用門檻不用 0：**0 分不出「做錯了」和「環境不一樣」**。真的錯（位移、少東西、顏色錯）
  差距都很大，門檻照樣抓到；只差 1、2 階的幾乎都是瀏覽器內部細節（文字邊緣的處理方式、小數捨入），
  人眼看不見也修不動——去追它，時間就燒在 Chrome 身上而不是網頁身上。
  **門檻由 host 設一次（預設：色版差 ≤8 不算差異），band 拿到的仍是「過／不過」；
  超過門檻的一律查到原因，不准把門檻調高來遮。**

## 鐵律

1. **plugin 目錄唯讀**；分析工具、build 腳本住 `tmp/`；產物寫 `data/<id>/`；瀏覽器暫存 `.browser/tmp/`。
   收尾清空、專案根不留垃圾。
2. **不准猜數字。** 所有數值來自實測；Bricks JSON 裡每個值都要能在 dump 裡找到（機器可驗）。
   **但——「量到的值」不等於「設計值」。** `getComputedStyle` 給的是**這個元素在此刻的用值**；
   照抄用值會把「關係」寫死成「數字」，而**這種錯不會報錯、只會靜靜壞掉**：
   - **可繼承又跟自身相關的屬性**：`line-height` 若是 unitless（如 `1.5`），computed 在每一層都回報
     「該層字級 × 1.5」的**px 數**。照抄那個 px → 子孫的字級一變，行高就不跟著變了
     （72px 的標題行高會停在 24px）。`em`／`rem`／`%`／`currentColor` 同理。
   - **會被裝置柵格吸附的屬性**：`border-width` 這類會被吸附到整數裝置像素
     （`used = floor(authored × dpr) / dpr`）→ 量到 `0.666667px` 的，authored 其實是 `1px`。
     **注意 `devicePixelRatio` 在有裝置模擬時會騙人**（回報 1.0 但實體是 1.5），要用探針反推。

   **驗法：改輸入，看輸出跟不跟。** 塞一個字級不同的子孫進去量（行高會跟著變＝unitless）、
   用幾個不同的 authored 值反推吸附公式。**分不出來就先探，不要照抄。**
3. **照「看到的」複刻，不照「程式碼寫的」複刻。** class 或 JS 裡宣告的效果，要在原站**實測看到**才做；
   沒發生的就是死碼，記 excluded＋理由。也**絕不憑印象補「這種元件通常會有」的效果**
   （跑馬燈「通常」滑鼠移上去會停、手風琴「通常」箭頭會轉——原站沒有就不做）。
   **死碼有四種長相**（原始碼裡都「看起來會動」，只有實測分得出來）：
   - **被祖先廢掉**：`position:sticky` 是跟著「最近的可捲動容器」黏的——只要某個祖先的 `overflow`
     不是 `visible`，它就成了那個容器；而它自己捲不動，sticky 就完全失效。
     **驗法是量位置、不是看樣式**：捲到幾個位置，看元素的 `getBoundingClientRect().top`
     有沒有停住。「捲動前後樣式沒變」不能當證據——那是量錯東西。
   - **被變數中和**：規則存在，但它吃的 `var(--x)` 被 inline 設成一個等於沒作用的值。
   - **綁錯層級**：`group-*`／`peer-*`／`has-*` 這類「看別人臉色」的 class，錨點掛錯了元素，
     規則永遠不會觸發。
   - **class 沒生成規則**（字體最常見）：class 掛在那裡，但編譯器根本沒產出對應的 CSS。
     字體的決定性驗法：**把宣告的字體真的載進來，看頁面動不動**——載入成功、頁面紋絲不動＝死碼。
     另外用**字寬探針**（同一段字換字族量寬度）確認實際生效的字體：stack 裡 `ui-*` 這類關鍵字
     瀏覽器不一定認得、會靜靜跳到下一個，computed 卻照樣回報你寫的那串——只有量字寬拆得穿。
4. **先捲再點。** 動手前先判斷這區的互動模型（static｜click｜scroll｜time，可複合）：
   先不要點，慢慢捲過去，看有沒有東西**自己**在變。判錯＝整區重做，不是改幾個數值能救的。
5. **量一次不算數。** 截圖、量測都做兩次、結果一致才能用。單張截圖可能是還沒畫完的畫面——
   拿它下結論，會得到一個「看起來很合理但根本不存在」的現象，然後花幾小時去解釋它。
6. **好編輯 > 還原 DOM。** Bricks 元素樹是給設計部編輯的：純包裝層塌掉、重複的做成一個元件＋資料、
   每層給中文 label。像不像由 ③④ 把關，不靠照抄 DOM 層次。

## 三軸量測：怎麼保證沒漏

| 軸 | 方法 | 完整性 |
|---|---|---|
| **結構＋樣式** | 走訪每個元素＋`getComputedStyle` **全部屬性** | `走訪＋略過 == 節點總數`（機器驗） |
| **狀態** | CDP `CSS.forcePseudoState` 一個一個逼出來再量，只記跟基準不同的 | 狀態就固定七種：hover/focus/active/focus-within/focus-visible/visited/target |
| **動畫** | `getAnimations()` | 一次列冊（名稱/時長/easing/keyframes/目標） |
| **互動** | **只能探**：`cursor:pointer` 的元素、原生互動元素（a/button/summary/details/input）、動畫的目標 | ❌ 沒有窮舉法——React 這類框架把監聽器全掛在根節點，問個別元素問不到。**探完記下「探了哪些」，別假裝完整** |

- `getComputedStyle` 給的是瀏覽器**算完的最終值**（層疊、媒體查詢、繼承全套用完了）
  → **完全不用讀 CSS 檔**，也沒有跨網域讀不到的問題。
- **走訪的死角要另外處理**：文字節點（只走元素會漏掉字！）、偽元素（`getComputedStyle(el,'::before')`，
  先看 `content` 是不是 `'none'`）、SVG（是圖形內容，整段抽 markup）、shadow DOM／iframe（要明確鑽進去）、
  點了才長出來的 DOM（靠互動探測補）。
- **設計 token 不一定在 `:root`**——可能是 inline style 寫在某個根 div 上；`:root` 撈到的一大串
  很可能全是框架預設值。以「實際被引用的變數」為準。

## 執行模式：host 調度、subagent 幹活

> host 自己也會漂移——context 越長，越容易忽略規則、憑印象做事。
> **所以 host 要少做事、多驗事**：能寫進 brief 的一律派出去，自己只留「非得看過全部才做得了」的。

host 有四項職責，**驗收是其中最重的一項**。

### 一、派工

判準一句話：**這一步需要的背景，寫得進派工說明（brief）嗎？**

| | 誰做 |
|---|---|
| 寫得進去（量測、走訪、資產下載、單一區的處置＋建置） | **subagent**——全新乾淨 context，規則對它是滿強度 |
| 寫不進去，因為要跟「前面全部」比（驗收、優化、一致性、整合） | **host** |

- **一個工作單元＝一個全新 subagent，單元要小**——一次塞五件事，等於又造出一個會漂移的長 context。
  **不可用 fork**（會繼承 host 的長 context，等於白做）。只能一個接一個跑
  （瀏覽器只有一個、推送都蓋同一頁）。
- **brief 必含**：①先讀本 SKILL.md 全文＋`plan.json`；②這個單元的輸入與產出位置；
  ③分頁規矩（**自己 `browser_tabs list` 確認哪個分頁是誰，不信前一手**）；④怎樣才算做完；
  ⑤**★這次執行一路踩到的坑——host 要一路累積、每次注入，這是 brief 裡最值錢的部分**。
- **給資料要給檔案路徑，不要憑記憶轉述**——轉述必然摻錯。

### 二、驗收（每區一次，四個面向都要 host 自己動手）

**口頭回報不算數，落檔的工件才算。** subagent 說「過了」不是證據，那只是「請你來驗」的通知。
每項都是**抽驗**（挑一顆代表、跑一次），不是把它的工作重做一遍：

| 面向 | host 怎麼做 | 在看什麼 |
|---|---|---|
| **① 看 code** | 讀它寫的 `build_<band>()` | 數值有沒有出處（找得到 dump 裡對應的值嗎）／有沒有憑空生出來的數字／人讀得懂嗎／有沒有動到別人的區或骨架 |
| **② 看視覺** | `Read` 原站與渲染的截圖，**自己看** | 東西都在嗎、位置對嗎、顏色對嗎——它的視覺清單有沒有漏項 |
| **③ 驗動態** | **自己用真滑鼠／捲動跑一次**（hover 一顆、點一下、捲過去） | 清冊上寫 `verified` 的真的會動嗎；寫 `excluded` 的真的不動嗎 |
| **④ 查結構** | 讀 `template.json` 的元素樹（name／label／巢狀／settings） | 設計部打開編得動嗎；label 是不是中文；有沒有一路 div 包 div；重複的有沒有元件化 |

外加**機器檢查**：未處置=0／清冊無 todo／**重跑一條 diff**／**量一個關鍵盒尺寸**。
不過關 → `SendMessage` 叫**同一個** subagent 補（它的 context 還乾淨）。

### 三、優化（跨區的事，只有 host 做得了）

subagent 只看得到自己那一區，各自優化＝各寫各的。**跨區一致性是 host 的責任**：
- 同一件事全站只准一種寫法（icon 怎麼放、按鈕怎麼做、間距怎麼引用 token）
- 重複結構要不要抽成共用元件／global class
- 命名一致（label 用語、id 規則）
- `_cssCustom` 比例跨區彙總——看哪些其實可以改用 native 欄位

**優化完必須重驗**：照上面那四個面向，對**被改到的每一區**再走一次。
**改了不驗，等於把驗過的東西變回沒驗過的。**

**重驗既有區塊時，截圖一律另存新檔、不要覆蓋前一手的工件**——覆蓋掉就再也無法直接證明
「改之前 vs 改之後」，只能靠事後 A/B 回推。工件是證據，證據不覆蓋。

### 四、全局

只有 host 看得到全部：**區與區的銜接**（整頁截圖才看得到）、跨區的重複、一路累積的坑。
**每學到一個坑就寫進下一個 brief**——這是 host 產出裡最值錢的東西。
**subagent 抓到 host 的錯要直說，host 照單全收**——host 的 context 最長，犯的錯往往比 subagent 多。

## Phase 0 — 環境

1. **CDP Chrome**：
   ```bash
   PORT=$(grep -s '^CDP_PORT=' .browser/cdp.env | head -1 | cut -d= -f2 | tr -d ' \r'); PORT=${PORT:-9222}
   curl -s "${PLAYWRIGHT_CDP_URL:-http://127.0.0.1:$PORT}/json/version"
   ```
   連不上就跑 `.browser/` 的啟動腳本。
2. **WordPress 靶場**：`docker ps` 找 `autobricks-wp`；沒起就
   `docker compose -f "<PLUGIN_DIR>/docker/docker-compose.yml" up -d`；Docker 本身沒開→停下請使用者開。
3. **⚠️ 分頁健康檢查（每個分頁都做、每次導航後重做）**：
   ```js
   const c = await page.context().newCDPSession(page);
   await c.send('Page.setWebLifecycleState', { state: 'active' });        // 不做：背景分頁的 rAF 永遠不觸發，evaluate 會掛死到逾時
   await c.send('Emulation.setFocusEmulationEnabled', { enabled: true }); // 不做：:active 點不出來、Tab 移不動
   ```
   驗證：`document.hidden===false` 且 `document.hasFocus()===true`。
   再驗**兩個分頁的 `document.documentElement.getBoundingClientRect().width` 相同**——
   分頁可能殘留「裝置模擬」狀態（捲軸變成浮在內容上的那種 → 內容區憑空寬出一條捲軸），
   外觀完全看不出來、也不報錯，但兩邊量出來的所有寬度從此不可比。
   **量寬一律用 `getBoundingClientRect()`：`clientWidth` 會四捨五入，把小數藏掉。**
   對不上＝分頁髒了，**開新分頁，不要將就**。
4. **evaluate 裡的等待一律包 `Promise.race`＋`setTimeout` 逾時**，絕不裸等 rAF 或事件。
5. **⚠️ fullPage 截圖會永久弄髒分頁**（截完捲軸被藏起來、內容區寬度改變，而且救不回來）。
   要截 fullPage：**等這個分頁的量測全部做完再截，截完這個分頁就報廢換新。**
6. **校準**：resize 1440 後必驗 `window.innerWidth`；每次導航後重驗。
7. **批次編號** `<年月日-時分秒-站名>`，產物 `data/<id>/`。

## Phase 1 — 全站基礎（拆成小單元派工；host 只驗收）

1. 導航 → 一屏一屏捲到底（把延遲載入的內容騙出來）→ 回頂。基準截圖 1440／768／375（守 fullPage 規矩）。
2. **頁級三軸列冊**：`getAnimations()` 全頁一次；查 smooth-scroll 庫（`.lenis`／`.locomotive-scroll`）、
   `scroll-snap`、視差；**sticky／fixed 全列出來、逐一用「量位置法」驗真假**。
   每筆歸屬到區，寫進 `page_behaviors`。
3. **資產下載（不下載＝沒複刻完）**：掃全 DOM＋`performance.getEntriesByType('resource')`
   （後者連 DOM 裡看不到的請求都有、不受跨網域限制），真的下載到 `data/<id>/assets/`：
   - `img.currentSrc`（**不是** `src`——要的是「實際載入的那張」）＋ `srcset` 各候選；
     `<video>` 的 src／poster。
   - computed `background-image` 裡的網址。**兩個必踩坑**：`url(#…)` 是文件內部引用、不是檔案；
     `data:` 開頭的內容**裡面還會有 url(…)**，抓網址的 regex 會鑽進去、把它拼成「網頁自己」的網址
     → 下載到一份 HTML 當圖片。**先把 `data:` 整段挖掉再找、跳過 `#` 開頭。**
   - 網頁字體：Google Fonts 的 CSS 要**帶真 Chrome 的 UA** 去抓，否則拿到的是舊格式。
   - **inline `<svg>`：照 path 內容去重**（不是照整段 markup——同形狀不同 class 會被當成兩個），
     存成有意義名字的檔。檔案常帶 `fill="none"`、實心是 CSS class 給的
     → **icon 檔的用途是「提供正確形狀」**，Bricks 端用 data-URI 或 inline，顏色尺寸由設定給。
   - **下載完驗檔案開頭的魔術位元組**：副檔名會說謊（`.jpg` 裡面可能是 AVIF——瀏覽器自己會嗅出來
     照播，看不出異狀，但推 WP 時上傳檢查會擋，錯誤訊息還跟圖片八竿子打不著）。
   - 進 WP 的方式現場驗證（媒體庫匯入或外連佔位）；用外連就在收尾回報**圖片替換清單**。
4. **tokens**：色票、內容區寬、字體（**字寬探針**驗實際生效字族——見鐵律 3 第四型）。
5. **切區**：頂層子樹＝一區。走訪工具 `tmp/` 現寫；自檢 `走訪＋略過 == 節點總數`。
   重複判定用**完整 class＋連續兄弟**（只比 class 開頭幾個字會把不同區誤判成重複）。
6. **⚠️ 祖先鏈也要處置，且寧可保留層次、不要合併**：區之上的 `body → wrapper → main`
   常帶頁級背景與裁切，會透過透明的區塊透出來。
   **背景圖是從「它自己的框」開始鋪的**——把帶圖案的那層往上併，圖案就整個錯位；
   `overflow` 搬到別層會改變捲軸模式跟「什麼東西被裁掉」。
   **這種錯會潛伏**：實心底色的區一路過，第一個透明底的區才一次爆出來。
   逐層查 `background-*`／`overflow`／`position` 再決定。Bricks 端做成頁級背景時，
   **圖案的起鋪位置要對齊原站放它的那一層**。
7. 寫 `data/<id>/plan.json`：區清單＋狀態、page_behaviors、tokens、資產清單、
   **環境數字（健檢結果——後面每個 band 動手前要對照）**、踩過的坑（給後面的 brief 用）。
8. **建 build 骨架＋第一次推**：`tmp/build_template.py`（tokens／helpers／`main()` 依序掛各區的函式）＋
   `tmp/push.sh`（build → validate → 推同一頁）。第一次推拿到 **PAGE_ID 馬上寫回 plan.json**。
   開渲染分頁、校準、**移除 `#wpadminbar`**（它把整頁往下推 32px，量什麼都歪；
   reload 後會長回來，每次都要重拔）。

## Phase 2 — 一區一區做（一區＝一個 subagent；四本帳結清才收帳）

**① 先判互動模型**（鐵律 4）→ 必填進 plan.json。

**② 量三軸**（工具 `tmp/` 現寫）：
- 本區子樹走訪＋computed **全量 dump** 落檔。**dump 不要讀進 context**——寫腳本處理、只讀摘要。
- 狀態軸：`forcePseudoState` 逐態量、只記差異。有狀態的元件（tab／輪播）**逐個真點擊**，
  記清楚「哪個內容屬於哪個狀態」。
- 動畫軸：本區 `getAnimations()` 細目。

**③ 處置決定**：逐節點 build／collapse／repeat／skip＋理由，寫進 plan.json 該區。
- **塌任何一層之前，查它有沒有視覺**：背景（含 background-image）、邊框、間距、overflow、
  疊層效果（position/z-index/opacity/transform）、`flex-shrink`、`min-width:auto`。塌錯了 ③④ 會現形。
- 重複 → 1 個元件＋資料列表；未處置必須＝0。

**④ 建（直接堆 Bricks）**：在 `tmp/build_template.py` **只新增**自己的 `build_<band>()` 掛進 `main()`，
不動別人的函式。數值全部取自 dump。
- **元素／欄位存不存在，查了才算**：live schema（`data/bricks-schema-live.json`；沒有就跑
  `uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/src/extract_bricks_schema.py"` 現抽）
  → `<PLUGIN_DIR>/bricks-schema/`（備用）。**查無＝沒有，絕不發明。**
  選型可參考 `<PLUGIN_DIR>/skills/clone/element-map.md`。
- **Bricks 硬規則**：id 6 碼 `[a-z0-9]` 且含數字；**`%root%` 在 `_cssCustom` 不會被替換**，
  一律寫真實 `#brxe-<id>`（id 定案後才寫）；圖片釘 `_width`＋id-scoped `aspect-ratio`、
  絕不固定 `_height`；頂層 `globalClasses`＋`global_classes` 兩個鍵都給＋`title`＋`type:"content"`；
  間距用實測值、不吸附整數。
- **行為五層階梯**（由上往下試，能上層就不下層）：原生元素 → `_interactions` → CSS →
  code 元素 JS（vanilla、自包含、鎖 `#brxe-<id>`；前台執不執行受 Bricks 權限管制，
  實測沒跑就查 theme 原始碼定案）→ 放棄（只准是真後端功能）。
- **native 欄位優先、`_cssCustom` 是最後手段**：能用 Bricks 的設定欄位表達的就用欄位，
  設計部才編得動（鐵律 6）。塞進 `_cssCustom` 的東西在 Bricks 介面上是一段程式碼，等於不能編。
  **每區統計「走 `_cssCustom` 的宣告數／總宣告數」回報 host**——這個比例＝交付物有多少比例不能編。
  host 跨區彙總，比例高就在收尾如實告訴使用者哪些部分只能改程式碼。

**⑤ 驗＋推**：`uv run --project "<PLUGIN_DIR>" python "<PLUGIN_DIR>/src/validate_template.py" "data/<id>/template.json"`
error 清零 → `bash tmp/push.sh`（Windows 的 docker 指令一律加 `MSYS_NO_PATHCONV=1`；
**絕不用瀏覽器登入 WP 後台**）。

**⑥ 對照（權威在這裡）**：
- **③ 機器 diff**：本區每個 build 出來的元素（至少每種類型一顆代表），渲染頁 computed − dump，
  逐屬性相減。**盒尺寸 w×h 也要比**。噪音規則（起點，臨場擴充）：
  兩邊 border-width 都是 0 → border 的 style/color 差異沒有意義；box-shadow 先剔掉全透明的疊層；
  `0px`≡`0`；max-width 的 `none`≡`100%`。渲染端對不上時，先查是哪條規則蓋的
  （主題或 Bricks 預設的干預），修法以實測為準。
- **④ 視覺把關**：原站該區截圖 → **用文字逐項列清單**（底色/圖案/疊層/裝飾/每個元件）→
  渲染截圖逐項核。像素比對用門檻。會動的先把兩邊停在同一時間點
  （`getAnimations()` 全部 pause＋設同一個 `currentTime`）。
- **② 行為實測**：清冊逐筆用真滑鼠驗（hover 前後量、等輪播動、點了看展開），過的標 verified。

**⑦ 收帳四條件**：未處置=0（含祖先鏈）／清冊無 todo／③ 差異清空（或明列「Bricks 表達不了」＋理由——
那是**可歸因的失真**，不是失敗）／④ 清單逐項核到。都過才在 plan.json 標 done。
同一個問題修兩次沒改善 → 標 `manual` 待人工，先做下一區。

**區的順序＝頁面由上到下。** 渲染頁是往下長的，跳著做會讓每一區的 y 座標對不上、diff 沒得比。

## Phase 3 — 平板／手機（桌機全部 done 才開始）

先 768 整輪、再 375 整輪；兩個分頁都 resize＋重新健檢。量原站在該寬度的變化，寫成**斷點後綴設定**
（Bricks 是桌機優先——後綴＝該寬以下才生效，方向跟 Tailwind 相反）。**只加後綴、不動桌機的基準值。**
一樣走 ⑥ 對照到收斂＋確認沒有水平捲軸。

## Phase 4 — 收尾（host）

1. 三個寬度整頁總檢（區跟區的銜接只有整頁看得到）＋與原站並排對照；成品截圖存 `data/<id>/`。
2. 清 `tmp/`、`.browser/tmp/`、關本次分頁、專案根不留垃圾。
3. **回報**：四本帳總結（處置統計／清冊逐筆／diff 收斂／視覺清單）、`_cssCustom` 比例、
   **Bricks 表達不了的項目＋理由**、圖片替換清單（若用外連）、待人工清單、PAGE_ID 與網址。
4. 提醒使用者：也可在 WP 後台 Bricks → Templates → Import 匯入 `template.json`。
