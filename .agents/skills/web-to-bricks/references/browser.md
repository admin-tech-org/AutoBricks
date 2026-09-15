# 共用瀏覽器工具

`<PLUGIN_ROOT>/src/browser.mjs` 是直接連線 Chrome CDP 的 Node 工具，供 Claude Code、Codex 等 Agent 產品共用。需要 Node 22+，不需安裝 npm 套件、Playwright 或 MCP。

`<PLUGIN_ROOT>`、`<PROJECT_ROOT>` 與 `<RUN_DIR>` 沿用當次技能確認的工具、專案與任務目錄。`<RUN_DIR>` 使用 `<PROJECT_ROOT>/data/YYYYMMDD-agent_product-task_name/`，瀏覽器工具的腳本及輸出放入其中的 `tmp/`。

## 連線與執行

Agent 產品先以 `<PROJECT_ROOT>/.browser/` 下的獨立 profile 啟動 Chrome remote debugging，再使用工具連線。Chrome 啟動範本位於 `<PLUGIN_ROOT>/templates/launch-chrome-cdp.bat`（Windows）與 `<PLUGIN_ROOT>/templates/launch-chrome-cdp.sh`（macOS／Linux）。`open` 只會在已執行的 Chrome 建立分頁，不會啟動 Chrome 程式。

工具預設連線 `http://127.0.0.1:9444`；啟動範本預設使用 9222 埠。Agent 產品需確認兩端一致，可用 `AUTOBRICKS_CDP` 指定工具的連線位址。

以下 PowerShell 範例假設 Chrome 已在 9222 埠提供 CDP，Agent 產品需將路徑佔位符替換為實際絕對路徑：

```powershell
$env:AUTOBRICKS_CDP = 'http://127.0.0.1:9222'
node "<PLUGIN_ROOT>/src/browser.mjs" list
node "<PLUGIN_ROOT>/src/browser.mjs" open https://example.com "<RUN_DIR>/tmp/screenshots/source"
```

使用 plugin 安裝副本時，Agent 產品以 `<PLUGIN_ROOT>/src/browser.mjs` 的絕對路徑執行工具，將輸出指向 `<RUN_DIR>/tmp/`，不能將執行產物寫入 plugin 快取。`<PLUGIN_ROOT>` 依當次載入的 skill 位置辨識，不依賴 Agent 產品專用的環境變數。

## 指令

| 參數 | 用途 |
|---|---|
| `list` | 列出 Chrome 的 CDP targets，包含分頁 ID |
| `open URL OUTPUT_DIR` | 建立分頁、載入網址，保存 `browser.json` 與 `first.png` |
| `eval TARGET FILE [OUTPUT]` | 在分頁執行 JavaScript 檔案，輸出回傳值或保存為 JSON |
| `shot TARGET PNG [Y] [WIDTH]` | 捲動至 Y、指定視窗寬度，保存視窗截圖 |
| `click TARGET SELECTOR` | 將符合 CSS 選擇器的元素捲入畫面，再點擊中心位置 |
| `hover TARGET SELECTOR` | 將符合 CSS 選擇器的元素捲入畫面，再將滑鼠移至中心位置 |
| `survey TARGET OUTPUT_DIR [1440,768,390]` | 依指定寬度量測區段並截圖，保存 `survey.json` |
| `cdp TARGET REQUESTS.json` | 依序送出 JSON 陣列中的 CDP 請求，每筆包含 `method` 與可選的 `params` |

`TARGET` 使用 `list` 回傳的分頁 ID，或 `open` 保存於 `browser.json` 的 `target`。方括號表示可省略的參數。`open` 與指定寬度的 `shot` 使用 1000px 視窗高度；其他尺寸可透過 `cdp` 指定。

`survey` 依賴原站的 `header`、`section`、`footer` 結構，並含特定頁型的狀態處理。Agent 產品需先確認當站適用；不適用時使用 `eval`、`shot` 或 `cdp` 取得所需資料。

同一分頁的載入、改寬、捲動、操作與截圖需依序進行。Agent 產品取得 PNG 後，仍需以圖片檢視工具開啟並檢查畫面；工具執行成功不等於頁面驗收通過。
