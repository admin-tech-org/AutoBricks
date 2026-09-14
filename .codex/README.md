# Codex 實驗入口

專案原則在 `../AGENTS.md`，網頁重建 skill 在 `../.agents/skills/web-to-bricks/SKILL.md`。
`config.toml` 刻意不改你的模型、推理強度或權限設定。

`tools/browser.mjs` 是本次寫的輕量 Chrome CDP 工具（Node 22+，無 npm 依賴）。
先用獨立 `.browser/` profile 啟動 Chrome remote debugging；預設 endpoint 是 `http://127.0.0.1:9444`，可用 `AUTOBRICKS_CDP` 改。
支援 `open`、`eval`、`shot`、`click`、`hover`、`survey`、`cdp`、`list`。
例如 `node .codex/tools/browser.mjs open https://example.com data/example/source`。
`survey TARGET OUTPUT_DIR [1440,768,390]` 是針對這次 header/section/footer 頁型的截圖便利功能，不是通用驗收器。

Cyberpunk 實驗記錄在 `../doc/codex-cyberpunk-experiment.md`；當次 capture、build.py、JSON、截圖與比對工具在 `../data/codex-cyberpunk-20260914/`（git 忽略的執行產物）。
