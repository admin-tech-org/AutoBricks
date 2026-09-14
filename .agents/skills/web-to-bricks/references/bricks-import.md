# Bricks 匯入備忘

以下在本機 Bricks 1.12.5 實測；其他版本有疑問時查已安裝 theme 的 `includes/templates.php`，不要直接外推。

- 正式匯入會重新產生元素 ID；確認自訂 CSS 的 ID 引用也有更新。`docker/push-template.php` 直接寫入頁面，適合開發預覽；交付另驗正常匯入流程。
- `importImages` 未設為字串 `true` 時，匯入器會將辨識出的圖片換成佔位圖；外部 SVG 也會被辨識，不可只看 HTTP 成功、圖片數或 `naturalWidth`。
- SVG 匯入還取決於目前使用者的 Bricks SVG 權限。先檢查實際狀態，在任務授權範圍內處理；不要一律擴大角色或全站權限。
- 原生媒體圖片保留真實的 `id`、`url`、`full`、`size`。跨站需確保素材 URL 可由目標 WP 取得；本機 localhost URL 要隨素材一起處理。
- 模板庫以 `templateType` 判斷類型；本專案同時保留 `type`。`tags`、`bundles` 無內容時可給空陣列。
- 現有靜態 schema 掃描可能漏掉繼承的 `tag`／`customTag` controls；有警告時核對 theme 與實際輸出，再判斷是否需修改。
