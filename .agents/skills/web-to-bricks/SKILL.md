---
name: web-to-bricks
description: 將使用者指定的參考網頁內容與版型轉為可匯入、可編輯的 WordPress Bricks JSON，並在本機 Docker WordPress 比對外觀、RWD、互動與素材。用於網頁重建實作，不用於純程式審查。
---

「Agent 產品」指 Claude Code、Codex 等可使用工具執行任務的 AI 助理軟體；「使用者」指提出需求、指定參考網頁並接收成品的人。

Agent 產品從當次 skill 的絕對路徑向上尋找同時含 `pyproject.toml` 與 `docker/push-template.php` 的 AutoBricks 根目錄，以 `<PLUGIN_ROOT>` 代稱，並讀取該目錄的 `AGENTS.md`。工具路徑相對於 `<PLUGIN_ROOT>`；成果、瀏覽器 profile 與 WordPress 測試資料存於使用者工作目錄，不能存入 plugin 安裝快取。既有 WP 環境可直接沿用；首次建置依環境設定 skill 將 Docker 範本複製至工作目錄後執行。

Agent 產品先在瀏覽器檢視原站的整頁內容、窄螢幕版型與主要互動，再選擇重建方法，交付使用者能在 Bricks 修改文字、圖片與排版的成品。不預設並行任務數、分區流程或全屬性掃描。

**Agent 產品依原站情況選擇方法，並負責以下工作與結果：**

- **觀察與量測**：Agent 產品取得原站元素的尺寸、位置、字型、間距，以及不同螢幕寬度和互動狀態下的變化，作為重建與比對依據。截圖、DOM、computed style、原始 HTML／CSS 各取其用；來源資料與量測結果保留供後續查詢。
- **轉換與編輯**：Agent 產品將原站文字、圖片與版型容器轉為 Bricks 原生元素／設定，合併不影響外觀或互動的多餘容器。原站 CSS 可按需沿用；Agent 產品依使用者的編輯需求決定原生設定的涵蓋程度。
- **工具與資料**：Agent 產品可為素材下載、元素建立、JSON 生成或畫面比對等重複工作撰寫工具；工具服務當次問題，不必先建通用框架。Agent 產品重用已取得且適用的來源資料與工具，只補查缺少或已變動的部分。
- **格式與匯入**：Agent 產品產出 JSON 後，執行 `uv run --no-project python "<PLUGIN_ROOT>/src/validate_template.py" "<JSON絕對路徑>"` 檢查元素欄位、ID 與父子引用；交付前再驗證經 Bricks 正常匯入後的 WP 頁面。元素設定有疑問時，Agent 產品查閱 live schema 或已安裝的 Bricks theme 原始碼。
- **外觀與互動**：Agent 產品在相同螢幕寬度下對照原站與 WP 預覽，檢查內容、排版與 RWD，並實際操作主要互動。Agent 產品核對成品圖片的實際素材是否與原站相符，避免將成功載入的佔位圖誤判為正確圖片；優先修正漏內容、錯圖與明顯跑版，再修正其餘已確認的外觀與互動差異，修改後重驗受影響部分。
- **結果回報**：Agent 產品分別回報 JSON 格式檢查、正式匯入、外觀及互動的驗證結果，明列未驗項目。若同一問題持續調整仍無改善，Agent 產品查明原因或向使用者說明限制，避免無限重複修正。

**本機 Bricks 寫入注意**

Agent 產品可使用 `docker/push-template.php` 寫入測試頁；未傳入 PAGE_ID 時，推送腳本會建立新頁。Agent 產品為當次模板與容器暫存檔使用獨立名稱，記錄推送腳本回傳的頁號，續修時只指定該頁號，避免覆蓋其他頁面或全站設定。

Bricks 元素 id 使用唯一的六碼小寫英數字，至少含一個數字；parent／children 雙向一致。自訂 CSS 使用實際 `#brxe-<id>`，圖片保留原始比例。Agent 產品輸出模板時包含 title、type、templateType、content；使用 global classes 時也包含定義。

Agent 產品處理 JSON 匯入或 SVG 素材時，按需查閱 [Bricks 匯入備忘](references/bricks-import.md)。新增經驗先確認適用的 Bricks 版本與網站條件，再記入備忘或當次紀錄。

Agent 產品向使用者交付模板 JSON、可開啟的 WP 預覽、代表截圖與簡短測試紀錄。Agent 產品在交付總結中說明可直接在 Bricks 編輯的部分，以及仍由自訂 CSS 或程式碼控制的排版、樣式或互動，並指出對應的修改位置。工具建置、網頁轉換及修正驗證的耗時分別記錄，供使用者比較速度與交付品質；無法拆分的時間應註明。
