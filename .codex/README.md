# 共用瀏覽器工具與 Codex 設定

Codex 在本專案讀取 [AGENTS.md](../AGENTS.md) 作為工作規則，並從 [.agents/skills/web-to-bricks/SKILL.md](../.agents/skills/web-to-bricks/SKILL.md) 取得網頁重建說明。使用者可直接測試專案內的 skill，操作方式見 [README](../README.md#使用-codex)。

[config.toml](config.toml) 是 Codex 專案設定檔，沿用使用者選擇的模型、推理強度與權限。目前本專案停用已安裝的 `autobricks@autobricks` plugin，保留快照，開發時直接使用專案內的 `.agents/skills/`。使用者需要測試安裝版本時，可依 [Codex 安裝說明](../doc/codex-plugin.md) 啟用；Codex 屆時會依 [.codex-plugin/plugin.json](../.codex-plugin/plugin.json) 找到安裝副本中的 skill。

`tools/browser.mjs` 是輕量 Chrome CDP 工具（Node 22+，無 npm 依賴）；能執行本機 Node 指令的 Agent 產品均可使用。
Agent 產品先以 `.browser/` 下的獨立 profile 啟動 Chrome remote debugging，再連線觀察原站或 WP 預覽。工具的預設 endpoint 是 `http://127.0.0.1:9444`；Agent 產品可設定 `AUTOBRICKS_CDP` 以連接不同埠。
支援 `open`、`eval`、`shot`、`click`、`hover`、`survey`、`cdp`、`list`。
例如 `node .codex/tools/browser.mjs open https://example.com data/example/source`。
`survey TARGET OUTPUT_DIR [1440,768,390]` 會按 header/section/footer 分區截圖並記錄版面數據；Agent 產品應確認目標頁型適用，不能把工具執行成功當成整頁驗收通過。

來源 repo 的 `doc/codex-cyberpunk-experiment.md` 保存 Cyberpunk 實驗紀錄；當次 capture、build.py、JSON、截圖與比對工具位於 `data/codex-cyberpunk-20260914/`。安裝來源應排除當次執行產物。
