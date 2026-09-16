# 共用瀏覽器工具

`<PLUGIN_ROOT>/src/browser.mjs` 是直接連線 Chrome CDP 的 Node 工具，供 Claude Code、Codex 等 Agent 產品共用。需要 Node 22+，不需安裝 npm 套件、Playwright 或 MCP。

`<PLUGIN_ROOT>`、`<PROJECT_ROOT>` 與 `<RUN_DIR>` 沿用當次技能確認的工具、專案與任務目錄。`<RUN_DIR>` 使用 `<PROJECT_ROOT>/data/YYYYMMDD-HHMMSS-agent_product-task_name/`，瀏覽器工具的腳本及輸出放入其中的 `tmp/`。

## 連線與執行

Agent 產品先以 `<PROJECT_ROOT>/.browser/` 下的獨立 profile 啟動 Chrome remote debugging，再使用工具連線。Chrome 啟動範本位於 `<PLUGIN_ROOT>/templates/launch-chrome-cdp.bat`（Windows）與 `<PLUGIN_ROOT>/templates/launch-chrome-cdp.sh`（macOS／Linux）。`open` 只會在已執行的 Chrome 建立分頁，不會啟動 Chrome 程式。

Chrome 啟動腳本與工具共用 `<PROJECT_ROOT>/.browser/cdp.env`，例如：

```ini
CDP_PORT=9333
```

啟動腳本讀取同層的 `cdp.env`；工具從目前工作目錄向上尋找最近的 `.browser/cdp.env`，找到設定或到達 Git 專案根目錄即停止，不依工具的安裝位置尋找。工具以 `http://127.0.0.1:<CDP_PORT>` 連線；沒有設定時，兩端皆使用 9222。無效的埠設定會讓工具報錯。Agent 產品改埠後，需重新啟動對應 Chrome，使設定生效。

以下 PowerShell 範例從工作專案執行，Agent 產品需將路徑佔位符替換為實際絕對路徑：

```powershell
Set-Location "<PROJECT_ROOT>"
node "<PLUGIN_ROOT>/src/browser.mjs" list
node "<PLUGIN_ROOT>/src/browser.mjs" open https://example.com "<RUN_DIR>/tmp/screenshots/source"
```

臨時連接其他 CDP 位址時，Agent 產品可設定 `AUTOBRICKS_CDP`，其優先於 `cdp.env`；取消該變數後恢復讀取設定檔。啟動腳本的埠參數也是臨時覆寫，不會回寫設定檔；使用該參數時，Agent 產品需讓工具連到相同位址。一般使用只需維護 `cdp.env`。

使用 plugin 安裝副本時，Agent 產品以 `<PLUGIN_ROOT>/src/browser.mjs` 的絕對路徑執行工具，將輸出指向 `<RUN_DIR>/tmp/`，不能將執行產物寫入 plugin 快取。`<PLUGIN_ROOT>` 依當次載入的 skill 位置辨識，不依賴 Agent 產品專用的環境變數。

## 指令

| 參數 | 用途 |
|---|---|
| `list` | 列出 Chrome 的 CDP targets，包含分頁 ID |
| `open URL OUTPUT_DIR` | 建立分頁、載入網址，保存 `browser.json` 與 `first.png` |
| `eval TARGET FILE [OUTPUT]` | 在分頁執行 JavaScript 檔案，輸出回傳值或保存為 JSON |
| `wait TARGET FILE [TIMEOUT_MS]` | 重複檢查 JavaScript 檔案的條件，回傳 `true` 才完成，預設上限 15000ms，逾時以失敗結束 |
| `shot TARGET PNG [Y] [WIDTH]` | 捲動至 Y、指定視窗寬度，保存視窗截圖 |
| `click TARGET SELECTOR` | 將符合 CSS 選擇器的元素捲入畫面，再點擊中心位置 |
| `hover TARGET SELECTOR` | 將符合 CSS 選擇器的元素捲入畫面，再將滑鼠移至中心位置 |
| `survey TARGET OUTPUT_DIR [1440,768,390]` | 依指定寬度量測區段並截圖，保存 `survey.json` |
| `cdp TARGET REQUESTS.json` | 依序送出 JSON 陣列中的 CDP 請求，每筆包含 `method` 與可選的 `params` |

`TARGET` 使用 `list` 回傳的分頁 ID，或 `open` 保存於 `browser.json` 的 `target`。方括號表示可省略的參數。`open` 與指定寬度的 `shot` 使用 1000px 視窗高度；其他尺寸可透過 `cdp` 指定。

`survey` 依賴原站的 `header`、`section`、`footer` 結構，並含特定頁型的狀態處理。Agent 產品需先確認當站適用；不適用時使用 `eval`、`shot` 或 `cdp` 取得所需資料。

同一分頁的載入、改寬、捲動、操作與截圖需依序進行。Agent 產品取得 PNG 後，仍需以圖片檢視工具開啟並檢查畫面；工具執行成功不等於頁面驗收通過。

## 確認操作完成

- `open` 等待新文件的載入事件與字型載入結束，逾時會報錯。這不代表動態內容、圖片素材或應用程式已驗證正確。
- `click`、`hover` 回報輸入事件已送出。Agent 產品依當站操作選擇完成條件，例如選單已展開、匯入結果已出現、編輯器已顯示修改後的內容，再執行量測或截圖。
- `wait` 的檔案只檢查狀態，須能重複執行，不在其中點擊、送出表單或匯入。工具支援 Promise，遇到導頁造成的執行環境失效會重試，其他程式錯誤直接回報。逾時表示尚未確認完成，Agent 產品需檢查條件與頁面狀態。

例如將以下內容存成 `<RUN_DIR>/tmp/scripts/menu-ready.js`，選擇器與預期狀態依當站替換：

```javascript
document.querySelector('button[aria-controls="menu"]')?.getAttribute('aria-expanded') === 'true'
```

```text
node "<PLUGIN_ROOT>/src/browser.mjs" wait "<TARGET>" "<RUN_DIR>/tmp/scripts/menu-ready.js" 10000
```

工具會將操作中的分頁帶到前景。Agent 產品檢查動畫或依賴計時器的行為時，避免同時操作其他分頁，以免背景節流影響觀察。

`cdp` 接受檔案路徑。需要其他 CDP 方法時，將請求存成 JSON 陣列，再執行 `cdp TARGET REQUESTS.json`，例如設定視窗尺寸：

```json
[{"method":"Emulation.setDeviceMetricsOverride","params":{"width":390,"height":844,"deviceScaleFactor":1,"mobile":false}}]
```
