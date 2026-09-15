# AutoBricks · 共用工作規則

- **Agent 產品**：Claude Code、Codex 等可使用工具執行任務的 AI 助理軟體。
- **使用者**：提出需求、指定參考網頁並接收成品的人。

目標：Agent 產品將使用者指定的參考網頁重建成外觀接近、結構清楚、可在 WordPress Bricks 編輯的 JSON。
Agent 產品以原站的內容、版型、RWD、互動與動畫作為重建及驗收依據，依網站特性選擇做法。

## 規則與技能

- 本檔是各 Agent 產品共用的工作規則。Claude Code 透過 `CLAUDE.md` 引用本檔。
- `skills/` 與 `.agents/skills/` 各提供同名、同內容的 `web-to-bricks` 與 `setup` 技能。維護者同步兩邊的技能與參考文件。
- Agent 產品執行網頁重建時，載入當次來源的 `web-to-bricks`。
- 使用者明確要求環境檢查或安裝時，Agent 產品才載入 `setup`。

## 工具與執行產物

- Agent 產品可重用現有工具，並查閱已安裝的 Bricks 原始碼確認元素設定。
- Agent 產品執行 Python 時使用 `uv run`。
- Agent 產品依執行環境選擇合適的 shell 與指令語法。
- Agent 產品將當次任務資料存入使用者工作目錄的 `data/YYYYMMDD-agent_product-task_name/`。日期採任務開始時的本機日期，產品名與英文任務名使用小寫，多字以底線連接，例如 `20260914-codex-new_art_clone_web`、`20260914-claude_code-new_art_clone_web`。續修沿用當次目錄，新任務不覆蓋既有目錄。
- Agent 產品在當次任務目錄建立 `tmp/` 與 `output/`。分析工具、腳本、下載素材、量測、截圖、草稿與其他中間檔案全部放入 `tmp/`，子目錄依任務需要安排。
- Agent 產品將可匯入的 Bricks 匯入包與交付所需素材放入 `output/`，並將最終交付報告寫入 `output/report.md`。
- Agent 產品將瀏覽器 profile 存入使用者工作目錄的 `.browser/`。
- Agent 產品預設將本機 WordPress 環境放在使用者工作目錄的 `.autobricks/docker/`，開發 AutoBricks 時亦同。AutoBricks 的 `docker/` 只提供範本與工具。
- Agent 產品尚未熟悉 AutoBricks 的 Docker 環境時，操作前需先完整閱讀 [docker/README.md](docker/README.md)，了解操作方式與注意事項。
- 安裝包提供工具與範本。Agent 產品不得將 WordPress 資料及其他執行產物寫入 plugin 快取。

## 測試與交付

- 本機 WP 測試環境的容器為 `autobricks-wp`，網址為 `http://localhost:8080`。
- Agent 產品每次重建先建立新頁，續修時只更新該次頁面。
- Agent 產品保留使用者原有的未提交修改。
- Agent 產品不將商業 Bricks theme、瀏覽器登入資料與執行產物納入 Git。
- Agent 產品提交 Git commit 時，沿用既有的「gitmoji + 類型: 中文摘要」格式，例如 `📝 docs: 更新使用說明`。
- Agent 產品交付 JSON、WP 預覽網址、原站與成品的代表截圖、實際耗時、已驗項目及剩餘差異，供使用者檢查外觀、互動與可編輯程度。
