# Cyberpunk 實作實驗 · 2026-09-14

參考頁：https://www.designprompts.dev/cyberpunk

成品：[WordPress Page 201](http://localhost:8080/?page_id=201) · [原站／成品對照](http://localhost:8080/wp-content/uploads/codex-cyberpunk-20260914/review/gallery.html) · [JSON](../data/codex-cyberpunk-20260914/template.json) · [JSON 與素材包](../data/codex-cyberpunk-20260914/cyberpunk-bricks.zip)

這次不沿用 Claude 的分工、帳冊與逐項像素門檻。先看實際頁面，保留來源可用的設計 CSS，把內容與排版容器轉成 Bricks 元素，再用本機 WordPress 的實際渲染修正整合問題。

時間以 `data/codex-cyberpunk-20260914/run.json` 的時間戳為準。18:13:26 首次來源擷取，18:22:49 首次完整寫入 WP（9 分 23 秒）；這一版仍有背景問題。18:24:25 修好背景並壓縮結構。18:40:51 完成主要視覺修改；18:46 左右完成素材打包，後續再驗 Bricks 正式匯入。整次約 40 分鐘等級，含工具、skill、量測、修正、驗證與交付整理；不是純轉換腳本執行時間。

準備工作與轉換有重疊：AGENTS／config 在 18:12 建立，CDP 工具在 18:13 建立並於實作中修改，因此沒有假裝能精確切出一個獨立的工具建置秒數。沒有取得本次實際 token／費用，也不推算費用節省比例。這是單一頁面實驗，且選擇沿用 CSS，不能直接當作所有網站或完全原生重建的速度保證。

| 檢查 | 結果 |
|---|---|
| 輸出 | 428 個 Bricks 元素；12 個 section、35 個 heading、9 張原生圖片 |
| 內容 | 1440／768／390 三個寬度，頁面根節點文字正規化後一致，9 張圖片皆載入 |
| 桌機、平板 | 14 個區域的位置與大小、35 個標題的位置／大小，在本次量測的 1px 門檻內一致；不是全像素評分 |
| 手機 | 無頁面水平捲動；原站被裁切的長標題及段落改為可讀換行，成品整頁多 208px |
| FAQ | 桌機實際點擊可同時開兩題；手機實際點擊可開關第一題；箭頭旋轉正常 |
| 動態外觀 | 主 CTA 的 hover 文字色、背景、霓虹陰影與來源一致；glitch、blink、pulse CSS 動畫正在執行 |
| 原生修改 | 另建 Page 203，改 heading 文字及 `_typography.font-size`；前台得到 `Native edit verified`／52px |
| 模板匯入 | 使用 Bricks 後台同一個 `bricks_import_template` 上傳端點，建立模板 204；428 元素，類型 content，ID 與 CSS scope 一起更新 |
| 實際前台 | Page 201 最後使用模板 204 匯入後的資料，檢查 ID 重建後的渲染 |
| JSON 驗證 | valid=true、0 errors；保留 213 則欄位辨識警告及 1 則結構深度警告 |

保留了一份約 102 KB 的自訂 CSS，用於原站的 utility 排版、響應式、霓虹、裝飾與 hover。可編輯文字、圖片，以及已轉成 Bricks 原生設定的字級／間距等；進階設計仍需改根元素 Custom CSS。原始擷取的 683 個 DOM 節點，全部有對應元素、合併內容或省略 wrapper 的記錄；428 個元素與最深 9 層仍有整理空間。

HUD、SVG 裝飾與靜態程式碼展示有合併 HTML。FAQ 改用原生 details/summary，沒有載入原站 React。沒有重建 Framer 首次進場動態。原站展示用的登入、試用、影片、付款與訂閱按鈕沒有接入服務；本次也沒有新增後端功能。瀏覽器驗證使用 Chrome 152，未做其他瀏覽器的相容性測試。

素材 URL 指向這個 Docker 的 uploads 子目錄；搬站請看素材包 README，先搬素材再換 URL。ZIP 是交付包，請解壓後匯入其中的 JSON。

驗證器的欄位警告主要是繼承 controls 的 tag／customTag 未被靜態 schema 掃描辨識；這次已由實際 HTML 與正式匯入驗證。深度警告是成立的，沒有把它消音，也沒有因此無限壓平結構。

實驗當時新增的 [AGENTS.md](../AGENTS.md) 只有 12 行；[skill](../.agents/skills/web-to-bricks/SKILL.md) 只有 23 行；CDP 小工具當時放在 `.codex/`，目前共用工具位於 [src/browser.mjs](../src/browser.mjs)，專案設定不覆蓋使用者模型與權限。詳細擷取、build.py、push.py、source-map、量測與截圖放在 git 忽略的 `data/codex-cyberpunk-20260914/`。

這次支持的判斷是：先取得可看的整頁，再依實際差異處理 Bricks 相容性，可以明顯減少前置流程。若下一步要求更乾淨的編輯樹與更少 CSS，應把那項工作另外量測，避免把視覺接近和完全原生化混成同一個無止境的目標。

2026-09-14 使用者回報後補修：正式匯入時漏帶 `importImages=true`，Bricks 1.12.5 把贊助商的 SVG 換成 `placeholder-svg.svg`。先前「9 張圖片皆載入」只驗到載入成功，沒有驗到素材身分；佔位圖同樣會成功載入，因此初次驗收不足。上述首次交付時間不包含這次補修。

已將原 SVG 登記成媒體素材 205，修正 Page 201 與模板 204 的該張圖片；僅為本機測試管理員新增 `bricks_upload_svg` capability，未更改其他使用者或角色的權限。匯入腳本已帶入圖片選項，新的正式匯入 handler 測試產生模板 208，9 張圖片的 URL 全部保持正確。補驗目前前台 9 張圖片的 URL 與下載檔案 SHA-256，全部符合保存的來源素材，並目視桌機與手機的贊助商圖。新版 JSON／ZIP／匯入說明均已更新。證據在 `svg-verification.json`、`verify-images.py` 與 `svg-fixed-browser/`。
