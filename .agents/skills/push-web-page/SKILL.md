---
name: push-web-page
description: 使用可見 Chrome 與 CDP，將既有 AutoBricks 交付包透過 WP File Manager、Code Snippets 與 Bricks 後台部署至使用者指定的 WordPress，並驗收頁面。需要使用者登入時暫停等待，不用於重新製作網頁或合併遠端修改。
---

# push-web-page

Agent 產品將使用者指定的交付 ZIP 或交付目錄部署至目標 WordPress。使用者提供目標站網址，並在需要時直接於可見瀏覽器登入。Agent 產品依目標站的實際介面與版本選擇操作方式，保留交付包的內容、RWD、互動與頁面識別標記。

## 先由使用者指定推送網址

Agent 產品開始推送前，先詢問使用者要部署到哪個 WordPress 網址，等使用者明確指定後才開始。當次需求已提供目標網址時直接採用，不重複詢問。Agent 產品不從交付包內的網址、瀏覽器目前開啟的網站或本機測試環境推定部署目標。

## 工具與資料位置

- `<PLUGIN_ROOT>`：Agent 產品從當次技能的絕對路徑向上尋找同時含 `pyproject.toml` 與 `docker/push-template.php` 的 AutoBricks 根目錄，從此目錄取得共用工具。
- `<PROJECT_ROOT>`：使用者指定的工作專案，未指定時使用當前對話的工作專案，不以 plugin 安裝目錄推定。
- `<RUN_DIR>`：`<PROJECT_ROOT>/data/YYYYMMDD-HHMMSS-agent_product-task_name/`。採任務開始時的本機時間，產品名與英文任務名使用小寫，多字以底線連接，例如 `20260917-180000-codex-push_newer_art_resort`。續作沿用同次目錄。
- Agent 產品將解壓副本、部署腳本的輸出、上傳用暫存檔及中間紀錄放入 `<RUN_DIR>/tmp/`，部署報告寫入 `<RUN_DIR>/output/report.md`，報告引用的驗收截圖放入 `output/screenshots/`。原始交付包保留不改，產物不寫入 plugin 快取。
- Agent 產品使用 Node 22+ 執行 `<PLUGIN_ROOT>/src/browser.mjs` 控制瀏覽器，Python 使用 `uv run`。連線、截圖與檔案上傳方法見 [../web-page-to-bricks/references/browser.md](../web-page-to-bricks/references/browser.md)。推送既有交付包不需要啟動本機 Docker WordPress。

## 先確認交付包與部署範圍

- Agent 產品依 [../check-schema-version/SKILL.md](../check-schema-version/SKILL.md) 檢查來源包的版本及實際結構，再讀取包內 `report.md`，了解匯入方式、素材目錄、PHP 片段及已知限制。缺少必要檔案或版本不支援時，先說明問題，不猜測部署方式。
- Agent 產品在 `tmp/` 內準備部署副本，依使用者提供的資料或登入後的後台確認目標站的 WordPress 位址、網站位址及 uploads 公開路徑。同站素材使用根相對網址，只有網域改變且素材路徑相同時不需改寫；uploads 路徑不同或舊包仍寫死來源站網址時，先同步調整副本的模板、Snippets 匯入檔與 PHP 副本，保留外站連結。需要更改素材資料夾名稱時，以 `uv run --no-project python` 執行包內 `rename-assets-folder.py`，核對實際輸出與素材落點。
- 未指定既有頁面時，Agent 產品建立新頁。未要求發佈時先儲存為草稿，已有明確發佈授權時直接依授權完成。替換既有頁面需由使用者指定，Agent 產品先保留該頁及所屬片段的可還原副本，不自行更換首頁或全站設定。
- Agent 產品用 Bricks Body classes 中的 `ab-page-…` 與 Code Snippets 的同名 tag 辨認頁面歸屬，搬站時保留標記。目標站已有同標記頁面、片段或同名素材目錄時，先確認內容與本次任務的關係。相同內容可沿用，未獲授權的差異先交由使用者決定，不自行合併或覆蓋設計師的修改。

## 使用可見 Chrome，讓使用者完成登入

- Agent 產品全程使用有視窗的 Chrome，不使用 headless。Chrome 啟動腳本與 CDP 工具共用 `<PROJECT_ROOT>/.browser/cdp.env`，登入狀態保存在同目錄下的獨立 profile。若目前 CDP 連到 headless Chrome，Agent 產品先依瀏覽器參考文件改用可見視窗，不能只在 headless 程序新增分頁。
- Agent 產品開啟目標站的管理後台，確認目前網址與實際登入狀態。遇到登入頁、驗證碼或登入逾期時，Agent 產品停止後台操作，將可見視窗留給使用者輸入帳密及完成驗證。Agent 產品不要求使用者把密碼貼到對話，也不將帳密或 Cookie 寫入報告。
- **Agent 產品必須等使用者明確回覆登入完成，再重新確認後台可用，才能繼續。** 等待時間經過不代表登入成功。後續若再次失去登入狀態，採相同做法。
- 若無法進入後台是連線失敗、權限不足或存取阻擋，Agent 產品說明實際原因並等待使用者處理，不把所有錯誤都當成帳密問題。既有 profile 已登入且後台可用時，直接沿用，不重複要求登入。

## 確認必要外掛與主題

Agent 產品在目標站的外掛及佈景主題介面確認下列產品的身分、版本與啟用狀態，不只依側邊選單名稱判定。

| 產品 | 辨識方式 | 可繼續的條件 |
| --- | --- | --- |
| [WP File Manager](https://wordpress.org/plugins/wp-file-manager/) | 外掛目錄 `wp-file-manager`，作者 `mndpsingh287`。使用者安裝同開發者的 Pro 版時，核對來源後可沿用 | 已啟用，且目前帳號可操作檔案管理介面及 `wp-content/uploads/` |
| [Code Snippets](https://wordpress.org/plugins/code-snippets/) | 外掛目錄 `code-snippets`，作者顯示為 `Code Snippets Pro`，不是其他名稱相近的片段外掛 | 已啟用且可匯入 PHP 片段。免費版與 Pro 版皆可 |
| Bricks | 佈景主題 Bricks，或以 Bricks 為父主題的已啟用子主題 | Bricks 已生效，且目前帳號可使用模板匯入與頁面編輯器 |

- 未安裝時，Agent 產品告知使用者缺少的產品與用途，等待使用者安裝完成後重新檢查，才進行部署。
- 外掛已安裝但未啟用時，Agent 產品啟用外掛並確認介面可用。若需切換目前的佈景主題才能使用 Bricks，而使用者尚未授權更換全站主題，Agent 產品先說明影響並等待使用者決定。
- 已安裝、已啟用且介面可用的項目直接沿用，不再詢問。遇到權限不足或啟用失敗時，Agent 產品回報阻礙，等待處理後重新確認。

## 依後台介面部署

Agent 產品透過可見瀏覽器的實際介面完成遠端寫入。本機工具用於準備檔案及操作 CDP，不以 SSH、WP-CLI、直接呼叫後台 API 或資料庫寫入替代本技能的介面流程。介面無法完成時，Agent 產品先說明阻礙，由使用者決定是否改用其他方式。

1. **素材先上傳。** Agent 產品透過 WP File Manager 進入目標站實際的 uploads 目錄（通常為 `wp-content/uploads/`），將部署副本的 `assets/<asset-folder>/` 整個子資料夾放入，保留內部結構與檔名，並核對其公開網址與包內素材路徑相符。需要批次上傳時，可在 `tmp/` 建立只含素材資料夾的暫存 ZIP，透過介面上傳及解壓，確認後移除伺服器上的暫存 ZIP。Agent 產品不將整份交付包、PHP 片段、部署腳本或驗收資料上傳至 uploads，也不改走媒體庫另建年月目錄。Agent 產品核對實際落點、檔案完整性及代表素材能否載入，再繼續匯入。
2. **匯入並啟用 PHP 片段。** Agent 產品在 Code Snippets 介面匯入部署副本的 `code-snippets.json`，核對片段數量、同名 tag、僅作用於所屬頁面的條件與載入順序，再啟用本次需要的片段。免費版及 Pro 版均使用 PHP。Agent 產品不重複啟用同一份程式碼，不修改其他頁面或全站片段。若包內片段清單為空，略過匯入。
3. **匯入模板並套用頁面。** Agent 產品透過 Bricks 正常匯入 `template.json`，將模板及頁面設定套用至本次頁面並儲存。整包交付 ZIP 不是 Bricks 模板匯入檔，模板出現在模板庫也不代表頁面已完成。Agent 產品依實際版本確認 Body classes、頁首頁尾設定及素材引用均已生效，保留頁面與片段相同的識別標記。圖片下載、SVG 等匯入選項以目標版本實測為準，不直接套用其他環境的經驗。

Agent 產品在每次上傳、匯入、啟用及儲存後檢查結果，再進行下一項。中斷或逾時後先查看後台現況，沿用已完成項目，不盲目重送。若匯入會覆蓋既有全域樣式或其他頁面的資料，Agent 產品先保留現況並釐清影響，不為完成單頁部署改動無關頁面。

## 驗收與回報

- Agent 產品重新開啟目標頁面及 Bricks 編輯器，確認儲存後的內容、頁面識別標記與 PHP 片段確實作用。檢查代表文字、圖片及容器可編輯，部署沒有依賴來源測試站的網址或僅在登入狀態下可用的素材。
- Agent 產品依交付包的 `report.md`、`comparison.html` 及代表截圖，比對部署後的外觀、桌面與手機版型、關鍵斷點、主要互動與動畫。Agent 產品實際檢視截圖及素材內容，不能只以匯入成功或 HTTP 200 當作通過。已授權發佈的頁面另確認未登入的訪客可正常使用。
- Agent 產品的驗收結論須註明觀察狀態，區分實測結果與原因推論，不將單一狀態的結果推廣至所有情況。
- Agent 產品保留原包已註明的功能限制。未串接後端的表單不因部署就視為可收件，驗收不向真實收件者送出測試資料，除非使用者已授權。
- Agent 產品在 `output/report.md` 記錄來源包與版本、目標頁面網址與 ID、草稿或發佈狀態、素材目錄、Snippet 名稱與 ID、共同識別標記，以及實際上傳或沿用的項目、驗收結果、未測項目與剩餘差異。失敗或等待使用者處理時，寫明已完成部分與停留位置，不能回報全部完成。

Agent 產品交回瀏覽器前，還原測試時改動的顯示設定（例如模擬尺寸），並確認頁面已恢復正常視窗顯示。

Agent 產品回覆目標頁面網址與部署報告，保留可見瀏覽器供使用者檢查。本技能交付部署紀錄，使用輸入包的 output schema 進行檢查，不另定 schema，也不將只有部署報告的目錄宣稱為完整重建交付包。
