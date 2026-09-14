# AutoBricks · 共用工作規則

「Agent 產品」指 Claude Code、Codex 等可使用工具執行任務的 AI 助理軟體；「使用者」指提出需求、指定參考網頁並接收成品的人。

目標：Agent 產品將使用者指定的參考網頁重建成外觀接近、結構清楚、可在 WordPress Bricks 編輯的 JSON。
Agent 產品先檢視原站的內容、版型與互動，再依使用者的精度要求選擇做法；未指定時不追求像素零差異。

- 本檔是各 Agent 產品共用的工作規則；Claude Code 透過 `CLAUDE.md` 引用本檔。
- `skills/` 與 `.agents/skills/` 各提供同名、同內容的 `web-to-bricks` 與 `setup` 技能；維護者同步兩邊的技能與參考文件。Agent 產品執行網頁重建時載入當次來源的 `web-to-bricks`，使用者明確要求環境檢查或安裝時才載入 `setup`。
- Agent 產品可重用現有工具，並查閱已安裝的 Bricks 原始碼確認元素設定；不必沿用舊批次的分工、帳冊或生成腳本。
- Agent 產品執行 Python 時使用 `uv run`；本機 Windows 指令使用 PowerShell。Agent 產品將模板、素材與量測資料存入使用者工作目錄的 `data/<run>/`，將瀏覽器 profile 存入該工作目錄的 `.browser/`。安裝包提供工具與範本；WordPress 資料及其他執行產物不得寫入 plugin 快取。
- 本機 WP 測試環境的容器為 `autobricks-wp`，網址為 `http://localhost:8080`。Agent 產品每次重建先建立新頁，續修時只更新該次頁面。
- Agent 產品保留使用者原有的未提交修改；商業 Bricks theme、瀏覽器登入資料與執行產物不納入 Git。
- Agent 產品交付 JSON、WP 預覽網址、原站與成品的代表截圖、實際耗時、已驗項目及剩餘差異，供使用者檢查外觀、互動與可編輯程度。
