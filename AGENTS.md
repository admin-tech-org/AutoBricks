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
- Agent 產品將模板、素材與量測資料存入使用者工作目錄的 `data/<run>/`。
- Agent 產品將瀏覽器 profile 存入使用者工作目錄的 `.browser/`。
- 安裝包提供工具與範本。Agent 產品不得將 WordPress 資料及其他執行產物寫入 plugin 快取。

## 測試與交付

- 本機 WP 測試環境的容器為 `autobricks-wp`，網址為 `http://localhost:8080`。
- Agent 產品每次重建先建立新頁，續修時只更新該次頁面。
- Agent 產品保留使用者原有的未提交修改。
- Agent 產品不將商業 Bricks theme、瀏覽器登入資料與執行產物納入 Git。
- Agent 產品提交 Git commit 時，沿用既有的「gitmoji + 類型: 中文摘要」格式，例如 `📝 docs: 更新使用說明`。
- Agent 產品交付 JSON、WP 預覽網址、原站與成品的代表截圖、實際耗時、已驗項目及剩餘差異，供使用者檢查外觀、互動與可編輯程度。
