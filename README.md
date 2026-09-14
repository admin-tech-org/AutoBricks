# AutoBricks

將參考網頁重建成可匯入、可編輯的 WordPress Bricks JSON，供設計師接手修改。

先看網站，再依當站選擇量測、轉換與驗證方式。可重用原站 CSS 和既有工具，保留 RWD、主要互動及可編輯內容；交付前驗證 JSON、正常匯入後的頁面與素材身分。

## 工作入口

- 共用原則：[AGENTS.md](AGENTS.md)。`CLAUDE.md` 透過 `@AGENTS.md` 載入同一份規則。
- Codex skill：[web-to-bricks](.agents/skills/web-to-bricks/SKILL.md)。
- Claude skill：[/autobricks:replica](skills/replica/SKILL.md)，與 Codex 版本內容相同，只保留原有 `replica` 指令名稱；匯入備忘也一併複製。
- 環境安裝：[/autobricks:setup](skills/setup/SKILL.md)，需要安裝時手動呼叫。

這次同步不指定模型、推理強度、工人數或固定分區流程。先前兩個綁定 Opus 4.8 的工人定義已從 plugin 移除，原文保存在 Git。

## 本機比較

在本 repo 開新的 Claude Code session，載入這份本機 plugin：

```text
claude --plugin-dir .
/autobricks:replica <參考網頁網址>
```

使用你要比較的模型，給相同網址與精度要求，分別記錄首版時間、完整驗證時間、可編輯程度和剩餘差異。不要沿用已載入舊流程的對話。這次已完成指令同步，Fable 的實際重建結果仍待測試。

此比較以本 repo 為工作目錄。Plugin 根目錄的 `CLAUDE.md` 不會自動成為其他專案的指令；若在另一個專案測，需另外帶入共用的 `AGENTS.md` 與引用它的 `CLAUDE.md`。引用方式見 [Claude Code 官方說明](https://code.claude.com/docs/en/memory#agentsmd)。

環境使用 [uv](https://docs.astral.sh/uv/)、Chrome CDP、Docker WordPress 與已授權的 Bricks theme；本機預覽網址是 `http://localhost:8080`。安裝細節見 [Docker 說明](docker/README.md) 與 [教學](doc/tutorial.md)。

## 工具與產物

- `src/validate_template.py`：`uv run python src/validate_template.py <template.json>`。
- `src/extract_bricks_schema.py`：需要時從已安裝的 Bricks theme 查欄位。
- `.codex/tools/browser.mjs`：可重用的 CDP 小工具，Node 22+；用法見 [.codex/README.md](.codex/README.md)。
- `docker/`：測試環境與推送工具；`templates/`：Chrome 啟動範本。
- `.mcp.json`：保留既有 5 組 CDP 連線能力，按需使用。
- `data/<run>/`：各次 JSON、素材、量測和截圖；`.browser/`：瀏覽器 profile。執行產物、登入資料與商業 theme 不納入 Git。

Bricks 欄位以已安裝版本與實際渲染為準。版本相關經驗按需查 [匯入備忘](skills/replica/references/bricks-import.md)，不要直接外推至其他版本。

## 實驗紀錄與還原點

- [Cyberpunk 重建](doc/codex-cyberpunk-experiment.md)
- [牛耳心境莊園重建](doc/codex-newer-art-experiment.md)
- [既有流程效能分析](doc/performance-review-20260914.md)
- `d68bd9b`：同步前完整現況，包含舊 Claude skill、工人定義與 Codex 實驗成果。
- [舊流程設計理由](doc/replica-rationale.md) 僅供查歷史，不是現行執行規則。

## Marketplace 安裝

```text
/plugin marketplace add <帳號>/<repo>
/plugin install autobricks@autobricks
```

本次為本機策略比較，未發佈新版 marketplace。需要測這次的修改時，使用上方本機 plugin 指令。

## 使用範圍

用於使用者自有網站、已授權的客戶網站、內部重建或學習用途。
