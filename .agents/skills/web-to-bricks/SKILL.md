---
name: web-to-bricks
description: 將使用者指定的參考網頁內容與版型轉為可匯入、可編輯的 WordPress Bricks JSON，並在本機 Docker WordPress 比對外觀、RWD、互動與素材。用於網頁重建實作，不用於純程式審查。
---

# web-to-bricks

- **Agent 產品**：Claude Code、Codex 等可使用工具執行任務的 AI 助理軟體。
- **使用者**：提出需求、指定參考網頁並接收成品的人。

Agent 產品將使用者指定的參考網頁重建成可匯入 WordPress Bricks 的 JSON，讓使用者能在 Bricks 修改文字、圖片與排版。原站的內容、外觀、RWD、互動與動畫都是重建及驗收依據，不能因靜態首版已接近原站就視為完成。

下列方法用來支持觀察、轉換與驗收的判斷。Agent 產品依當站問題選擇資料來源與工具，可在觀察、實作和驗證之間往返，不預設並行任務數、固定分區或全屬性掃描。網站結構不同時，Agent 產品重新選擇適合當站的方法。

## 工作位置與資料存放

- `<PLUGIN_ROOT>`：Agent 產品從當次 skill 的絕對路徑向上尋找，同時含 `pyproject.toml` 與 `docker/push-template.php` 的 AutoBricks 根目錄。共用工具與範本從此目錄取得，不依賴 Agent 產品專用的環境變數。
- `<PROJECT_ROOT>`：使用者指定的工作專案根目錄，未另行指定時使用當前對話的工作專案。Agent 產品不以 skill 所在目錄推定此位置。開發 AutoBricks 時，兩個根目錄可以相同。
- `<RUN_DIR>`：當次任務的 `<PROJECT_ROOT>/data/YYYYMMDD-agent_product-task_name/`。日期採任務開始時的本機日期，產品名與英文任務名使用小寫，多字以底線連接，例如 `20260914-codex-new_art_clone_web`、`20260914-claude_code-new_art_clone_web`。續修沿用當次目錄，新任務不覆蓋既有目錄。
- `<WP_DIR>`：WordPress 測試環境目錄，預設為 `<PROJECT_ROOT>/.autobricks/docker/`，開發 AutoBricks 與安裝 plugin 時皆相同。`<PLUGIN_ROOT>/docker/` 只提供範本與工具，不能作為 WP 執行目錄。沿用其他既有環境前，Agent 產品需確認 Compose 設定與容器實際掛載確實屬於使用者指定的環境。

| 資料 | 存放位置 |
| --- | --- |
| 可匯入的 Bricks 匯入包與交付所需素材 | `<RUN_DIR>/output/`，例如 `template.json` 與必要的 `assets/` |
| 最終交付報告 | `<RUN_DIR>/output/report.md` |
| 原站資料、下載素材、模板草稿 | `<RUN_DIR>/tmp/`，例如 `source/`、`assets/`、`template.json` |
| 元素量測、當次 Bricks schema、原站與 WP 截圖 | `<RUN_DIR>/tmp/`，例如 `measurements/`、`screenshots/source/`、`screenshots/wp/` |
| 臨時分析工具、下載／生成／驗證腳本、過程筆記與其他中間檔案 | `<RUN_DIR>/tmp/`，例如 `scripts/`、`notes.md` |
| Chrome 啟動腳本、`cdp.env` 與瀏覽器 profile | `<PROJECT_ROOT>/.browser/`，profile 位於其中的 `.chrome_cdp*` 子目錄 |
| Python 虛擬環境 | `<PROJECT_ROOT>/.autobricks/venv/` |
| Docker 設定與 WordPress 檔案 | `<WP_DIR>/docker-compose.yml`、`<WP_DIR>/wp/`，theme 與上傳素材位於 `wp/wp-content/` |
| MariaDB 資料 | Docker Compose 的 `db_data` named volume，由 Docker 保存，不是專案內的檔案目錄 |
| 當前 Bricks 版本與匯入經驗 | `<PROJECT_ROOT>/bricks-import.md` |

Agent 產品建立 `tmp/` 與 `output/`，所有當次中間檔案放入 `tmp/`，其中的子目錄依任務需要安排。交付匯入包所需的素材須一併整理至 `output/` 或部署到 WordPress，成品不能依賴 `tmp/` 內的檔案才能顯示。

Agent 產品確保工作專案的 Git 忽略執行產物、瀏覽器登入資料、本機環境與版本筆記，包含 `.autobricks/` 及既有 WP 的實際資料目錄。Agent 產品不得將上述資料寫入 plugin 安裝快取。需要建立環境時，由使用者明確要求後使用同來源的 `setup` 技能，將 `docker-compose.yml` 與 `init-wp.sh` 範本複製到 `<WP_DIR>`，不覆蓋既有環境。

## 先建立對網站的理解

Agent 產品先在瀏覽器載入原站，查看首屏、逐段捲動到頁尾，再於窄螢幕檢視整頁，操作選單、內容切換與可操作元素。Agent 產品辨識頁面有哪些內容、哪些部分隨寬度改變，以及哪些畫面需要操作或等待才會出現。

Agent 產品在 `<RUN_DIR>/tmp/notes.md` 留下簡短觀察，例如「桌面導覽捲動後固定，手機改為收合選單；主視覺交替換圖並緩慢放大；消息可拖曳」。觀察到的內容、互動與動畫同時成為轉換依據及驗收項目。

| 需要判斷的問題 | 取得的資料 | 資料如何影響做法 |
| --- | --- | --- |
| 區塊比例、構圖、文字換行是否相符 | 瀏覽器截圖 | 找出漏內容、錯圖與排版差異，再定位需要量測的元素 |
| 元素為何偏移或尺寸不同 | DOM、`getBoundingClientRect()`、`getComputedStyle()` | 比較尺寸、位置、字型、間距與父容器，找出生效的 CSS |
| 手機版是否換圖、換順序或換互動 | 不同寬度的畫面、media query、可見元素與事件狀態 | 決定共用內容的排列規則及需要切換的素材或操作方式 |
| 動畫由什麼觸發、如何變化 | 操作前、中、後的畫面、CSS、元件初始化設定 | 決定沿用原站程式或重建必要邏輯，並取得時間與狀態的驗收依據 |
| 圖片、圖示與字型從何而來 | `src`、`srcset`、背景圖片、SVG、字型宣告及必要的網路請求 | 取得原始素材，保留比例、裁切與字型，不將整頁截圖當成可編輯內容 |

Agent 產品取得元素的尺寸、位置、字型與間距，並比較不同寬度及互動狀態下的變化。原始 HTML 用來取得內容與初始結構，執行後的 DOM 用來確認 lazy load、切換狀態及動態內容。Agent 產品辨認輪播複製的投影片、固定導覽插入的佔位容器等執行時產物，避免把複本全部轉成可編輯內容。

## 用 CDP 操作瀏覽器與取得畫面

Agent 產品可用 Node 22+ 執行 `<PLUGIN_ROOT>/src/browser.mjs`，直接連線 Chrome CDP。此工具不需要 Playwright 或 MCP。Agent 產品需要查詢連線設定、指令或參數時，讀取 [references/browser.md](references/browser.md)。

- Agent 產品先確認 Chrome 已提供 CDP 連線。`open` 只會在既有 Chrome 建立分頁，不會啟動 Chrome 程式。
- 需要啟動 Chrome 時，Agent 產品可使用 `<PLUGIN_ROOT>/templates/` 的啟動範本，將腳本與 profile 放在 `<PROJECT_ROOT>/.browser/`。需要使用者登入或觀看操作時使用有視窗的 Chrome，背景觀察可使用 headless Chrome。
- 啟動範本預設埠為 9222，工具預設埠為 9444。Agent 產品沿用可用埠，透過 `AUTOBRICKS_CDP` 指定相同的工具連線位址，並檢查 `/json/version`。此變數屬於 AutoBricks 工具，不依賴特定 Agent 產品。
- Agent 產品確認工具能開啟頁面、讀取 DOM、擷取截圖，並以圖片檢視工具實際開啟 PNG。成功輸出圖片路徑不代表 Agent 產品已查看畫面。

以下指令中的路徑與 target 需替換為當次實際值，shell 語法依執行環境調整：

```text
node "<PLUGIN_ROOT>/src/browser.mjs" open "<參考網址>" "<RUN_DIR>/tmp/screenshots/source"
node "<PLUGIN_ROOT>/src/browser.mjs" shot "<SOURCE_TARGET>" "<RUN_DIR>/tmp/screenshots/source/mobile.png" 0 390
```

`open` 回傳分頁 `target`，並保存 `browser.json` 與 `first.png`。Agent 產品從回傳資料取得 `<SOURCE_TARGET>`，後續指定同一分頁操作，另記錄 WP 分頁的 target。`shot` 最後兩個參數是捲動位置與視窗寬度，指定寬度時使用 1000px 高度。其他尺寸或特殊操作可透過 `cdp` 傳入請求。

| 動作 | CDP 方法 | Agent 產品取得的結果 |
| --- | --- | --- |
| 載入網址 | `Page.navigate` | 真實瀏覽器執行網頁後的內容與狀態 |
| 讀取 DOM／樣式、捲動或量測 | `Runtime.evaluate` | JavaScript 回傳的文字、結構或尺寸 |
| 改變視窗尺寸 | `Emulation.setDeviceMetricsOverride` | 該尺寸下生效的版型 |
| 擷取畫面 | `Page.captureScreenshot` | 可存成 PNG 的圖片資料 |
| 點擊、移入、拖曳 | `Input.dispatchMouseEvent` | 操作引發的事件與狀態變化 |

例如 Agent 產品可將以下量測存成 `<RUN_DIR>/tmp/scripts/measure.js`，並以當站要檢查的選擇器替換 `main`：

```javascript
(() => {
  const element = document.querySelector('main');
  if (!element) throw new Error('找不到量測目標，需確認當站選擇器');
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return {
    x: rect.x, y: rect.y + scrollY, width: rect.width, height: rect.height,
    display: style.display, font: style.font, gap: style.gap,
    padding: style.padding, margin: style.margin
  };
})()
```

```text
node "<PLUGIN_ROOT>/src/browser.mjs" eval "<SOURCE_TARGET>" "<RUN_DIR>/tmp/scripts/measure.js" "<RUN_DIR>/tmp/measurements/main.json"
```

同一分頁的載入、改寬、捲動、操作與截圖需依序進行，避免量測時頁面狀態被其他操作改變。`survey` 含特定 DOM 結構與狀態處理假設，Agent 產品先確認當站適用，不適用時改用 `eval`、`shot` 或 `cdp`。Agent 產品可在 `<RUN_DIR>/tmp/scripts/` 撰寫下載、量測或生成工具，重用已取得且仍適用的資料，只補查缺少或已變動的部分。

## 截圖分析與差異修正

Agent 產品先等待目標頁面載入，確認字型、圖片及需要捲動才出現的內容已就緒。載入事件本身不保證動態內容完成，Agent 產品可檢查元素是否出現、圖片尺寸及版型是否穩定。

Agent 產品使用有重疊的分段截圖觀察整頁，保留能辨認文字、邊界與接縫的解析度。原站與成品使用相同視窗寬高、捲動位置及內容狀態，記錄會影響畫面的滑鼠位置、輪播投影片與展開項目。

Agent 產品用截圖找差異，用尺寸與樣式查原因。例如消息卡片較寬時，先比較外層寬度、左右 padding、卡片間距和顯示張數。所有後續區塊一起偏移時，先找前方第一個高度不同的區塊，檢查字型、段落 margin、圖片比例或重複初始化，不直接以局部位移掩蓋原因。

文字外觀有差異時，Agent 產品確認瀏覽器實際使用的字型（font face）與字重，不能只比對 CSS 的字型宣告。

Agent 產品優先修正漏內容、錯圖及明顯跑版，再修正其餘已確認的外觀、互動與動畫差異，修改後重驗受影響部分。圖片驗證包含實際素材身分與顯示效果，不能將成功載入的佔位圖算作正確素材。

## RWD：還原不同寬度下的規則

Agent 產品先比較寬、窄畫面，再查原站斷點附近的變化。1440、768、390px 可作為初次觀察點，實際寬度依當站版型選擇。例如選單在 1024px 切換，就需檢查該斷點前後，不能只用三張截圖代表所有寬度。

Agent 產品觀察容器的流動伸縮與最大寬度、欄數、gap、換行、排列順序、圖片替換與裁切，以及導覽、頁籤和固定按鈕的改變。Agent 產品依這些行為選擇 Flex、Grid、相對尺寸、media query 或必要的互動邏輯。原站 CSS 可用時，可篩選後沿用並限制作用範圍。

Agent 產品在 Bricks 確認字型基準、`rem`、`box-sizing`、元素預設 margin 與圖片顯示方式。相同 CSS 在不同的基礎樣式下仍可能有不同結果。

驗收涵蓋原站斷點、代表寬度與容易擠壓的中間寬度。Agent 產品確認文字不被截斷、圖片不變形、頁面沒有意外橫向溢出、固定導覽不遮住錨點或操作區。縮小視窗驗證的是響應式排列，觸控模擬、實體裝置與其他瀏覽器的測試結果需分別記錄。

## 動畫與互動：確認時間及狀態

Agent 產品確認原站動態效果的觸發條件、初始狀態、變化中的畫面、結束狀態，以及延遲、持續時間、緩動、重播或反向行為。單張結束畫面無法證明動畫已還原。

| 原站行為 | 可採用的實作方式 | 驗收重點 |
| --- | --- | --- |
| 按鈕移入、圖片縮放、顏色淡變 | CSS transition／keyframes | 進入、離開、鍵盤焦點的狀態及手機的對應行為 |
| 進入視窗時淡入或位移 | CSS 動畫配合進入視窗的觸發邏輯，或沿用適合的原站程式 | 觸發位置、播放次數、初始隱藏是否解除 |
| 主視覺輪播、Ken Burns 緩慢縮放 | 分別處理換圖與 transform，或沿用適合的輪播元件 | 每張圖的停留時間、淡化交接、縮放起終點與重置方式 |
| 頁籤、收合、選單、彈窗 | 狀態切換、CSS 與必要事件程式 | 開關、返回、捲動位置、焦點及窄螢幕行為 |
| 視差、隨捲動推進的畫面、複雜時間軸 | 依原站機制重建，必要時沿用動畫程式庫 | 相同捲動進度、反向捲動、改寬及重新進入時的行為 |

Agent 產品確認動畫程式庫的初始化設定、目標選擇器與生命週期，避免重複初始化。只下載 CSS／JavaScript 不代表效果會自動出現。原站框架不適合在 Bricks 執行時，Agent 產品重建同等行為所需的部分。

為比較靜態尺寸，Agent 產品可暫停輪播、固定投影片或暫停 transform，但需記錄並恢復測試狀態。動畫驗收時，Agent 產品重新載入正常頁面，以連續畫面、適用的錄影工具或帶時間的狀態量測確認效果發生。Agent 產品檢查首次載入及再次進入的行為，避免內容首次一直隱藏、操作後才顯示。原站提供減少動態效果設定時，Agent 產品區分一般與減少動態兩種狀態。靜態量測期間暫停動畫，不改變成品需要重建動畫的要求。

## 依當站結構轉成 Bricks

Agent 產品綜合觀察與量測選擇轉換方式。原站 HTML／CSS 清楚時，可保留有用的類別與樣式，將文字、圖片、標題、連結及容器轉成 Bricks 原生元素與設定。動態應用可能需依執行後的內容與狀態重組結構。Canvas、WebGL、iframe 或複雜元件需個別判斷可取得的資料與可編輯方式。

- Agent 產品合併不影響排版、選擇器與互動的多餘容器，為主要區段及可編輯內容命名。
- Agent 產品將原站 CSS 限定在重建頁面內，保留圖片、SVG、字型與必要腳本的來源對照。圖片保留原始比例，需要裁切時重建原站的裁切方式。
- Agent 產品檢查來源 DOM 屬性與 Bricks 編輯器是否衝突，從實際元素選取、欄位與媒體控制確認可編輯性，不單憑公開頁判斷。
- Agent 產品產生唯一的六碼小寫英數字元素 ID，至少含一個數字，並保持 `parent`／`children` 雙向一致。自訂 CSS 引用實際 `#brxe-<id>`，匯入後再確認 ID 與選擇器對應。
- Agent 產品輸出包含 `title`、`type`、`templateType`、`content` 的模板，使用 global classes 時一併提供定義，避免 ID 或名稱覆蓋既有樣式。

### 依本機 Bricks 版本確認設定

- Agent 產品處理元素設定、JSON 匯入或 SVG 素材前，檢查 `<PROJECT_ROOT>/bricks-import.md`，核對筆記記錄的版本與環境條件，再使用適用的內容。
- 檔案不存在或記錄不適用時，Agent 產品查閱當前已安裝 Bricks 的 schema／原始碼並實測，再建立或更新筆記，記錄版本、相關設定、驗證結果與證據位置。
- 筆記保存在使用者工作專案根目錄並由 Git 忽略，不放入 skill 的 `references/`，也不隨 plugin 發行或寫入 plugin 快取。

Agent 產品可使用 `<PLUGIN_ROOT>/src/extract_bricks_schema.py`，以 `--theme-dir` 指定實際 theme 目錄，以 `--out` 指定 `<RUN_DIR>/tmp/measurements/bricks-schema.json`，取得當前版本的元素及欄位資料。元素設定以已安裝版本與實際渲染為準，不將其他版本的筆記當成通用 schema。

### 產生 JSON 與建立測試頁

Agent 產品使用 `uv run` 執行 Python。模板草稿放在 `tmp/`，產生後執行格式檢查。有當次 schema 時，以 `--live-schema "<RUN_DIR>/tmp/measurements/bricks-schema.json"` 指定：

```text
uv run --no-project python "<PLUGIN_ROOT>/src/validate_template.py" "<RUN_DIR>/tmp/template.json"
```

格式檢查包含元素欄位、ID 與父子引用。驗證器未載入 live schema 時會略過元素名稱與設定欄位的相關檢查，Agent 產品需區分結構檢查與版本欄位檢查的結果。

Agent 產品可用 `<PLUGIN_ROOT>/docker/push-template.php` 直接寫入測試頁，操作見 `<PLUGIN_ROOT>/docker/README.md`。未傳入 `PAGE_ID` 時腳本建立新頁，Agent 產品記錄回傳頁號與網址，續修時只指定該次頁號。當次模板與容器暫存檔使用獨立名稱，避免覆蓋其他工作。使用 global classes 前，Agent 產品確認定義不會覆蓋既有全站樣式。

## 驗收以正常匯入後的頁面為準

直接寫入測試頁可供首版與修正預覽，交付前仍需透過目標 Bricks 的正常匯入流程驗證模板，檢查匯入後的頁面。Agent 產品依原站觀察項目完成下列驗證，分別記錄通過、未通過及未測項目：

- **格式與匯入**：檢查 JSON 驗證結果，確認正常匯入後的元素、CSS 選擇器、素材與腳本仍有效。直接推送成功不等於正常匯入通過。
- **內容與外觀**：比對整頁內容、代表截圖與有差異的元素尺寸，核對圖片的實際素材，避免漏區、錯圖或佔位圖。
- **RWD**：比對原站與成品的相同寬度，確認斷點切換、中間寬度、內容排列、圖片裁切、導覽與橫向溢出。
- **互動與動畫**：重新載入正常頁面，實際觸發觀察到的互動及動畫，核對時間、狀態切換、內容與窄螢幕行為。靜態尺寸一致不能代替動態驗收。
- **可編輯性**：在 Bricks 編輯器實際選取並試改代表性的文字、圖片與容器，確認欄位、媒體控制及預覽有效，測試後恢復交付內容。公開頁正常不代表編輯器正常。

Agent 產品對照原站的觀察紀錄檢查是否有遺漏。修正後重驗受影響的版型或互動，同一問題持續調整仍無改善時查明原因，必要時說明限制或缺少的條件，不把未通過改稱已完成，也不無限重複相同修正。

## 交付與總結

Agent 產品將交付的匯入包與必要素材整理到 `<RUN_DIR>/output/`，確認驗證結果對應交付版本，並將以下交付資訊寫入 `<RUN_DIR>/output/report.md`，在回覆中提供匯入包與報告的位置：

- 參考網址、模板 JSON、可開啟的 WP 預覽網址，以及素材搬移所需檔案。
- 原站與成品的代表截圖，標示視窗尺寸及相關互動狀態。
- 格式、正常匯入、外觀、RWD、互動、動畫及可編輯性的驗證結果，明列剩餘差異與未測項目。
- 可直接在 Bricks 編輯的部分，以及仍由自訂 CSS 或程式碼控制的排版、樣式或互動，指出對應修改位置。
- 首版與完整驗證的實際耗時，另記錄工具建置、網頁轉換及修正驗證的時間，無法拆分的時間註明原因。
