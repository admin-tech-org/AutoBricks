# Codex 設定

Codex 在本專案讀取 [AGENTS.md](../AGENTS.md) 作為工作規則，並從 [.agents/skills/web-to-bricks/SKILL.md](../.agents/skills/web-to-bricks/SKILL.md) 取得網頁重建說明。使用者可直接測試專案內的 skill，操作方式見 [README](../README.md#使用-codex)。

`.codex/config.toml` 是 Codex 專案設定檔。AutoBricks 將這個檔案留作使用者的本機設定，由 `.gitignore` 排除，不隨 Git 發行；共用規則、技能與 `src/` 工具仍納入版本控制。需要調整已安裝 plugin 的專案啟用狀態時，使用者可依 [Codex 安裝說明](../doc/codex-plugin.md#只在指定專案啟用) 編輯本機設定。

各 Agent 產品共用的 Chrome CDP 工具位於 [src/browser.mjs](../src/browser.mjs)，連線與指令用法見 [瀏覽器工具說明](../doc/browser.md)。
