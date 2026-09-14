# Bricks 匯入備忘

以下為本專案在 Bricks 1.12.5 的實測結果。Agent 產品處理其他版本時，應查閱目標環境已安裝 theme 的 `includes/templates.php` 確認行為，不能直接套用版本結論。

- Bricks 匯入器會重新產生元素 ID；Agent 產品應確認自訂 CSS 的 ID 引用也已更新。`docker/push-template.php` 直接寫入 WP 頁面，可用於開發預覽；交付前仍需驗證正常匯入模板後的頁面。
- `importImages` 未設為字串 `true` 時，Bricks 匯入器會將辨識出的圖片換成佔位圖，外部 SVG 也可能被替換。Agent 產品應核對實際素材，不能只依 HTTP 成功、圖片數或 `naturalWidth` 判定圖片正確。
- SVG 匯入取決於執行匯入的 WordPress 帳號是否具有 Bricks SVG 權限。Agent 產品應先檢查該帳號權限，再依使用者授權處理；不要一律擴大角色或全站權限。
- Agent 產品設定原生圖片元素時，應保留媒體資料中的實際 `id`、`url`、`full`、`size`。跨站搬遷時，Agent 產品需部署素材、將 localhost 資源網址改為目標站可存取的網址，並確認目標 WordPress 能取得檔案。
- Bricks 模板庫以 `templateType` 判斷類型；Agent 產品輸出本專案模板時同時保留 `type`。`tags`、`bundles` 無內容時可設為空陣列。
- 現有靜態 schema 掃描可能漏掉元素繼承的 `tag`／`customTag` controls。Agent 產品遇到相關警告時，應核對已安裝 theme 與實際 HTML 輸出，再決定是否修改元素設定。
