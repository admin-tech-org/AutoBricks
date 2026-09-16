---
name: web-page-to-bricks
description: 將使用者指定的單一參考網頁內容與版型轉為可匯入、可編輯的 WordPress Bricks JSON，並在本機 Docker WordPress 比對外觀、RWD、互動與素材。用於單一網頁重建實作，不用於純程式審查。
---

# web-page-to-bricks

- **Agent 產品**：Claude Code、Codex 等可使用工具執行任務的 AI 助理軟體。
- **使用者**：提出需求、指定參考網頁並接收成品的人。

Agent 產品將使用者指定的單一參考網頁重建成可匯入 WordPress Bricks 的 JSON，讓使用者能在 Bricks 修改文字、圖片與排版。原站的內容、外觀、RWD、互動與動畫都是重建及驗收依據，不能因靜態首版已接近原站就視為完成。

本技能預設不設計或開發自製 WordPress 外掛，也不新增表單收件等後端服務，這些需求需另行規劃。Agent 產品保留頁面前端互動，並在未串接服務時清楚呈現不可用狀態，不顯示虛假的送出成功訊息。頁面程式碼交由 Code Snippets 外掛管理。

下列方法用來支持觀察、轉換與驗收的判斷。Agent 產品依當站問題選擇資料來源與工具，可在觀察、實作和驗證之間往返，不預設並行任務數、固定分區或全屬性掃描。網站結構不同時，Agent 產品重新選擇適合當站的方法。

## 工作位置與資料存放

- `<PLUGIN_ROOT>`：Agent 產品從當次 skill 的絕對路徑向上尋找同時含 `pyproject.toml` 與 `docker/push-template.php` 的 AutoBricks 根目錄。共用工具與範本從此目錄取得，不依賴 Agent 產品專用的環境變數。
- `<PROJECT_ROOT>`：使用者指定的工作專案根目錄，未另行指定時使用當前對話的工作專案。Agent 產品不以 skill 所在目錄推定此位置。開發 AutoBricks 時，兩個根目錄可以相同。
- `<RUN_DIR>`：當次任務的 `<PROJECT_ROOT>/data/YYYYMMDD-HHMMSS-agent_product-task_name/`。日期與時分秒採任務開始時的本機時間，產品名與英文任務名使用小寫，多字以底線連接，例如 `20260916-223015-codex-new_art_clone_web`、`20260916-223015-claude_code-new_art_clone_web`。續修沿用當次目錄，新任務不覆蓋既有目錄。
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

Agent 產品建立 `tmp/` 與 `output/`，所有當次中間檔案放入 `tmp/`，其中的子目錄依任務需要安排。交付匯入包所需的素材須一併整理至 `output/`，即使素材已部署到測試站也不能省略。成品不能依賴 `tmp/` 內的檔案才能顯示。

Agent 產品確保工作專案的 Git 忽略執行產物、瀏覽器登入資料、本機環境與版本筆記，包含 `.autobricks/` 及既有 WP 的實際資料目錄。Agent 產品不得將上述資料寫入 plugin 安裝快取。使用者明確要求建立環境後，Agent 產品使用同來源的 `setup` 技能，將 `docker-compose.yml` 與 `init-wp.sh` 範本複製到 `<WP_DIR>`，不覆蓋既有環境。

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
- Chrome 啟動腳本與工具共用 `<PROJECT_ROOT>/.browser/cdp.env` 的 `CDP_PORT`，未設定時皆使用 9222。Agent 產品從工作專案執行工具，沿用可用埠，並檢查該位址的 `/json/version`；連線設定細節見 [references/browser.md](references/browser.md)。
- Agent 產品確認工具能開啟頁面、讀取 DOM、擷取截圖，並以圖片檢視工具實際開啟 PNG。成功輸出圖片路徑不代表 Agent 產品已查看畫面。

以下指令中的路徑與 target 需替換為當次實際值，shell 語法依執行環境調整：

```text
node "<PLUGIN_ROOT>/src/browser.mjs" open "<參考網址>" "<RUN_DIR>/tmp/screenshots/source"
node "<PLUGIN_ROOT>/src/browser.mjs" shot "<SOURCE_TARGET>" "<RUN_DIR>/tmp/screenshots/source/mobile.png" 0 390
```

`open` 回傳分頁 `target`，並保存 `browser.json` 與 `first.png`。Agent 產品從回傳資料取得 `<SOURCE_TARGET>`，後續指定同一分頁操作，另記錄 WP 分頁的 target。`shot` 最後兩個參數是捲動位置與視窗寬度，指定寬度時，`shot` 固定將視窗高度設為 1000px。其他尺寸或特殊操作可透過 `cdp` 傳入請求。

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
- Agent 產品產生唯一的六碼小寫英數字元素 ID，至少含一個數字，並保持 `parent`／`children` 雙向一致。自訂 CSS／JS 優先使用有意義且不依賴元素 ID 的自訂 class。Bricks 匯入可能重編 ID，外部 Snippets 的選擇器也需在正常匯入後確認。
- Agent 產品輸出包含 `title`、`type`、`templateType`、`content` 的模板，使用 global classes 時一併提供定義，避免 ID 或名稱覆蓋既有樣式。

### 素材命名與程式碼維護

- Agent 產品產生模板與片段前，讀取 [../check-schema-version/references/output-schema.md](../check-schema-version/references/output-schema.md) 的當前版本定義，建立 `page-manifest.json`，將穩定的頁面／片段識別與 schema 版本標記放入可正常匯出的頁面設定及程式碼。搬站、改網址與續修保留識別，讓後續工作能對應設計師在後台修改過的內容。
- Agent 產品查看圖片、閱讀文件，並用截圖工具抽樣影片畫面，依內容與用途命名。原站已有清楚名稱時沿用，其餘使用英文小寫與連字號，例如 `hero-resort-aerial-video.mp4`，必要時加區段、順序或 RWD 變體。
- 字型依字體、字重及分片辨識。Agent 產品保留來源與新名稱的對照於 `tmp/`，更名時維持素材內容與字型字元範圍對應，並同步更新模板及程式碼中的引用。
- Agent 產品將圖片、SVG、影片、字型及文件等非程式碼素材放在 `output/assets/<asset-folder>/`，交付模板與 Snippets 的素材引用需對應包內檔案，不能只依賴測試站專有的附件網址或 ID。使用者首次部署時，透過 File Manager、SSH／SFTP 等方式將 `<asset-folder>` 整個上傳至 `wp-content/uploads/`。素材資料夾使用清楚、穩定的名稱，不需跟著交付 ZIP 的時間戳變更。
- Agent 產品將原生內容與樣式保留在 Bricks 元素設定，將額外的自訂 CSS、JS 及必要程式庫存入 Code Snippets，依用途命名與拆分。使用者與接手的設計師可在 WP 後台維護程式碼，也能將程式碼交由 Agent 產品協助調整。程式碼不放入 uploads，也不以 Snippet 再引入 uploads 裡的程式檔。
- Agent 產品為每份 CSS／JS 提供 PHP 包裝版本，讓 Code Snippets 免費版亦可載入。預設交付的 `code-snippets.json` 包含 PHP 片段，`snippets/` 保留對應 PHP 與可讀的 CSS／JS 副本。額外提供 Pro 原生格式時，Agent 產品標示為替代選項，不能同時啟用兩套。
- Agent 產品先確認測試站已安裝並啟用 Code Snippets（免費版即可），缺少時依使用者已授權的環境變更範圍補齊，操作見 `<PLUGIN_ROOT>/docker/README.md`。
- Agent 產品依實際安裝的 Code Snippets 版本確認匯入格式，以隨模板攜帶的頁面標記限制片段作用範圍，處理依賴與初始化順序，並驗證前台及 Bricks 編輯器預覽。Agent 產品在可用的免費版環境實測 PHP 包裝片段，未測的片段格式或外掛版本如實記錄，不把格式相容推定為實測通過。

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

驗證器另有基於 Bricks 1.12.x 的固定規則，不會隨 live schema 切換。Agent 產品需結合目標版本的原始碼與實測判讀版本相關訊息。

Agent 產品可用 `<PLUGIN_ROOT>/docker/push-template.php` 直接寫入測試頁，操作見 `<PLUGIN_ROOT>/docker/README.md`。未傳入 `PAGE_ID` 時腳本建立新頁，Agent 產品記錄回傳頁號與網址，續修時只指定該次頁號。當次模板與容器暫存檔使用獨立名稱，避免覆蓋其他工作。使用 global classes 前，Agent 產品確認定義不會覆蓋既有全站樣式。

## 驗收以正常匯入後的頁面為準

直接寫入測試頁可供首版與修正預覽。交付前，Agent 產品從目標版本的 Bricks 後台模板管理入口正常匯入模板，再將模板與頁面設定套用到當次 WP 測試頁。驗收對象是套用後的實際頁面與編輯器，僅匯入模板庫或查看模板預覽不算完成。Agent 產品依原站觀察項目完成下列驗證，分別記錄通過、未通過及未測項目：

- **格式與匯入**：檢查 JSON 驗證結果，確認正常匯入後的元素、CSS 選擇器、素材與腳本仍有效。直接推送成功不等於正常匯入通過。
- **內容與外觀**：比對整頁內容、代表截圖與有差異的元素尺寸，核對圖片的實際素材，避免漏區、錯圖或佔位圖。
- **RWD**：比對原站與成品的相同寬度，確認斷點切換、中間寬度、內容排列、圖片裁切、導覽與橫向溢出。
- **互動與動畫**：重新載入正常頁面，實際觸發觀察到的互動及動畫，核對時間、狀態切換、內容與窄螢幕行為。靜態尺寸一致不能代替動態驗收。
- **可編輯性**：在 Bricks 編輯器實際選取並試改代表性的文字、圖片與容器，確認欄位、媒體控制及預覽有效，測試後恢復交付內容。公開頁正常不代表編輯器正常。
- **程式碼維護**：正常匯入並啟用 PHP 片段，確認 CSS／JS 不依賴 uploads 中的程式檔、只作用於指定頁面且沒有重複執行。Agent 產品在 Code Snippets 後台試改代表性樣式或互動，確認頁面更新後恢復交付內容。
- **交付結構與識別**：依 [../check-schema-version/SKILL.md](../check-schema-version/SKILL.md) 檢查包內版本、檔案及對應關係。正常匯入後重新取得頁面設定與片段，確認頁面／片段識別及 schema 標記仍在，不單憑本機 JSON 判斷。
- **部署副本**：從最終 ZIP 解壓後測試兩支 Python 腳本各自及接續執行的結果，檢查模板、Snippets、程式碼副本、manifest 與實際素材路徑一致，版本檔及穩定識別保留，且原始包保留。正常匯入與瀏覽器驗收需對應包內的同一份模板及片段。

Agent 產品對照原站的觀察紀錄檢查是否有遺漏。修正後重驗受影響的版型或互動，同一問題持續調整仍無改善時查明原因，必要時說明限制或缺少的條件，不把未通過改稱已完成，也不無限重複相同修正。

## 交付與總結

Agent 產品將交付檔案整理到 `<RUN_DIR>/output/`，只提供一個完整 ZIP：`YYYYMMDD-HHMMSS-<page-name>-bricks.zip`。時間採打包時的本機日期與時分秒，頁面名使用英文小寫與連字號，例如 `20260916-231240-newer-art-resort-bricks.zip`。重新交付時使用新的打包時間，舊版備份留在 `tmp/`，不再另包模板 ZIP 或外掛 ZIP。

ZIP 包含以下檔案，解壓後分別使用各自的匯入入口，不能把整個交付 ZIP 直接當作 Bricks 模板匯入：

```text
output_schema_version         # 交付結構版本與目錄說明
page-manifest.json            # 穩定的頁面、片段與素材資料夾對應
template.json                 # Bricks 模板與頁面設定
code-snippets.json            # Code Snippets PHP 片段匯入檔
assets/<asset-folder>/        # 上傳至 uploads/ 的非程式碼素材
snippets/                     # PHP 包裝與 CSS／JS 可讀副本，不上傳至 uploads/
replace-domain.py             # 更換部署網址
rename-assets-folder.py       # 更換上傳用的素材資料夾名稱
report.md                     # 匯入教學、維護位置與驗收結果
comparison.html               # 原站與成品的驗收對照
screenshots/                  # 比較頁使用的代表截圖，必要時附動態證據
```

Agent 產品以 `<PLUGIN_ROOT>/output_schema_version` 為當次交付結構的版本依據，核對完成後原樣複製到 `output/`。該版本管理交付結構與識別欄位，不代表 Bricks 版本或驗收通過。續修舊包時先檢查原版本，不只替換版本檔就視為升級。

Agent 產品提供能在解壓目錄以 `uv run` 執行的兩支 Python 腳本，將實際指令寫入 `report.md`。腳本不依賴 AutoBricks 原始碼或 `tmp/`，可接續執行並產生部署副本，保留原始交付檔案，不直接修改遠端 WP：

- `replace-domain.py` 接受目標站網址，將包內目前部署站的網址換成目標站網址，包含協定、網域、連接埠與站台子路徑，同步更新模板、Snippets 匯入檔與程式碼副本。腳本保留不屬於本包部署的外部連結。
- `rename-assets-folder.py` 接受新的素材資料夾名稱，重新命名部署副本的 `assets/<asset-folder>/`，並同步更新上述檔案中的素材路徑及 manifest 的 `asset_folder`。名稱不得造成目錄越界或覆蓋既有素材。

兩支腳本均將版本檔及 manifest 帶入部署副本，保留 `page_key` 與 `snippet_key`。部署副本的用途與內容需在報告說明，不以省略驗收證據的部署副本取代完整交付包。

Agent 產品製作可離線開啟的 `comparison.html`，以相對路徑引用包內原站與成品的截圖，標示頁面網址、測試時間、視窗尺寸、區段與互動狀態。比較頁涵蓋桌機、手機及重要斷點，整理實際執行的互動與動畫驗收，必要時附連續畫面或錄影，並區分通過、未通過及未測項目。產生 HTML 本身不等於已完成驗證，內容必須對應實測紀錄與交付版本。

Agent 產品將以下資訊寫入 `report.md`，在回覆中提供完整 ZIP、報告、比較頁及 WP 預覽網址：

- 參考網址、模板 JSON、可開啟的 WP 預覽網址，以及素材搬移所需檔案。
- 交付 schema 版本、`page_key` 與片段識別的用途。使用者修改內容或程式碼時保留識別 class、tag 及註解，供後續對應。
- 解壓、執行腳本、上傳素材、匯入並啟用 Snippets、匯入 Bricks 及套用頁面設定的步驟，指出各檔案的用途與片段作用條件。已啟用的同一套片段不重複匯入啟用。
- `comparison.html` 與代表截圖的位置，及各驗收項目的證據。
- 格式、正常匯入、外觀、RWD、互動、動畫及可編輯性的驗證結果，明列剩餘差異與未測項目。
- 可直接在 Bricks 編輯的部分、Code Snippets 中對應的樣式與互動，以及素材替換位置。說明後台修改不會自動回寫包內的程式碼副本，使用者可重新匯出片段保存。
- 未串接的後端功能與當前畫面行為，不能將前端完成描述為收件或其他服務已可用。
- 首版與完整驗證的實際耗時，另記錄工具建置、網頁轉換及修正驗證的時間，無法拆分的時間註明原因。
