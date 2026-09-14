# AutoBricks · Codex

目標：從參考網頁做出外觀接近、結構清楚、可在 Bricks 編輯的 JSON。
使用者重視速度與臨場判斷；先看網頁，再選合適方法。預設不追逐像素零差異。

- 網頁重建使用 `.agents/skills/web-to-bricks/SKILL.md`。其他工作直接處理，不必載入複刻流程。
- Codex 的這條實驗流程以本檔為入口；`CLAUDE.md` 與 `skills/replica/` 是既有 Claude 工作流，按需參考。
- 可重用現有驗證器、Docker 與已安裝 Bricks 原始碼；不必沿用舊批次的工人、帳冊或生成腳本。
- Python 用 `uv run`；Windows 使用目前的 PowerShell。產物與量測資料放 `data/<run>/`，瀏覽器 profile 放 `.browser/`。
- 本機 WP 是測試環境，容器 `autobricks-wp`、網址 `http://localhost:8080`。每次實驗新建頁，續修只更新該次頁面。
- 保留使用者原有未提交修改；授權 theme、個人 profile 與執行產物不納入 git。
- 用可檢查的成品說明結果：JSON、預覽網址、代表截圖、實際耗時、已驗項目與剩餘差異。
