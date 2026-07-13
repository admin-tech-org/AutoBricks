---
name: setup
description: 安裝/設定 AutoBricks（網頁→Bricks 模板複刻）的執行環境，一次把「分析＋生成＋實測」需要的都備好：經套件管理器（macOS Homebrew / Windows Scoop）確認 uv 與 Node（Playwright MCP 需要 npx）→ uv sync → 備 CDP 瀏覽器（複製啟動腳本到 .browser/）→ 預核准常用工具權限（免每次跳框）→（選配）Docker WordPress + Bricks 驗證環境。觸發詞（含口語與失敗情境）：「幫我設定環境 / 安裝 / 裝環境 / 初始化 / 環境準備 / 第一次使用要準備什麼 / 我要開始用 / 怎麼開始 / 怎麼跑起來 / setup / install」；以及遇到「缺 uv / 缺 Node 或 npx / MCP 連不到瀏覽器 / clone 說 9222 連不上或 docker 沒起來」等狀況時，也觸發本 skill。
disable-model-invocation: true
---

# setup

把 AutoBricks 的執行環境一次備好。**會安裝軟體**，每個安裝動作前先簡短告知使用者、徵得同意再跑。
所有 shell 動作一律走 **Bash 工具**（權限規則依工具分，用 PowerShell 會全部跳框）。

## 步驟

### 1. 取得 plugin 根目錄
系統會在開頭給 Claude「**Base directory for this skill**」（即 `<plugin>/skills/setup`）。
**plugin 根 = 該 base 的上兩層**（`<skill base>/../..`），解析成絕對路徑，後續以 `<PLUGIN_DIR>` 代稱。
不靠 cwd 或 `$CLAUDE_PLUGIN_ROOT`（後者在 skill bash 不可靠）。

### 2. 問使用者的作業系統
Claude 直接問使用者：「作業系統是 **Windows / macOS / Linux** 哪一個？」依回答走對應分支。

### 3. 工具鏈：uv ＋ Node（都走套件管理器；有就跳過、絕不重裝）
團隊標配是 uv，多半已有——先驗再說：

- **uv**：`uv --version` 有 → 跳過；沒有 → macOS `brew install uv`／Windows `scoop install uv`
  （Linux：`curl -LsSf https://astral.sh/uv/install.sh | sh`）。套件管理器本身缺的話：
  macOS 裝 Homebrew（互動要密碼，請使用者用 `!` 前綴自己跑官方安裝指令）、
  Windows 用 PowerShell 裝 Scoop：`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force; iwr -useb get.scoop.sh | iex`。
- **Node（≥20，建議 24 LTS）**——**Playwright MCP 要跑 `npx`，Node 是必備不是選配**。
  `node --version` 與 `npx --version` 都有且 ≥20 → 跳過；沒有才裝（nvm）：
  - Windows：`scoop install nvm` → `nvm install 24` → `nvm use 24`
  - macOS：`brew install nvm; mkdir -p ~/.nvm` → `export NVM_DIR="$HOME/.nvm"; . "$(brew --prefix nvm)/nvm.sh"; nvm install 24 && nvm use 24`
    （source 與 install 必須同一條 bash；提醒使用者把那兩行加進 `~/.zshrc`。）
  - Linux：官方 nvm 安裝器後同上。

### 4. 安裝專案相依（venv + 驗證工具）
```bash
uv sync --project "<PLUGIN_DIR>"
```

### 5. 備 CDP 瀏覽器（分析環境的核心）
`clone` 靠 plugin **內建的 Playwright MCP**（`.mcp.json` 隨安裝自動註冊）接管一台
「帶 9222 除錯埠的**真 Chrome**」——真 profile、無自動化指紋，防爬蟲較嚴的網站也能正常渲染。

1. **把啟動腳本放進「使用者專案」的 `.browser/`**（profile／登入態是使用者資產、不放 plugin 內）：
   ```bash
   mkdir -p "$(pwd)/.browser"
   cp "<PLUGIN_DIR>/templates/launch-chrome-cdp.bat" "$(pwd)/.browser/"   # Windows
   cp "<PLUGIN_DIR>/templates/launch-chrome-cdp.sh"  "$(pwd)/.browser/"   # macOS / Linux
   ```
   提醒使用者把 `.browser/` 加進自己專案的 `.gitignore`。
2. **由 Claude 啟動那台 Chrome**（不必使用者手動雙擊）：
   - Windows：`cmd //c "$(pwd)/.browser/launch-chrome-cdp.bat"`
   - macOS／Linux：`bash "$(pwd)/.browser/launch-chrome-cdp.sh"`
   等 ~2 秒後 `curl -s http://127.0.0.1:9222/json/version` 確認埠起來了。
3. 一般公開網站**不需要登入**即可分析；目標網站若需要會員/登入，請使用者在那個視窗登一次
   （profile 會記住）。之後跑 `clone` 時 Claude 會自己探埠、沒開就自己啟動。
4. MCP 是用到瀏覽器工具的當下才連 CDP（lazy），Chrome 後開也接得上、**不必重啟 Claude Code**。
   換 port 就設環境變數 `PLAYWRIGHT_CDP_URL`。

### 6.（選配）Docker WordPress + Bricks 驗證環境
`clone` 的實測階段需要本機有一套 WordPress + Bricks（使用者自備已授權 theme）。**問使用者要不要現在建**（只做到 template.json 可跳過）：

1. 需求：Docker Desktop 已啟動。
2. 一鍵建置：
   ```bash
   bash "<PLUGIN_DIR>/docker/init-wp.sh"
   ```
3. 請使用者把**已授權的 Bricks theme 解壓**到 `<PLUGIN_DIR>/docker/wp/wp-content/themes/bricks/`
   （wp 是 bind mount、直接丟即可；商業軟體已 gitignore、絕不進版控），再重跑 init-wp.sh 即啟用。
   完成後：站台 http://localhost:8080、後台 admin/admin。細節見 `<PLUGIN_DIR>/docker/README.md`。

### 7. 預核准常用工具（免每次跳權限框）
`clone` 會頻繁用到內建 playwright MCP 工具與少數 Bash 指令，預設每個動作都問一次。
**徵得使用者同意後**，合併寫入使用者專案的 `.claude/settings.local.json`（本機級、不進版控；只 append、不覆蓋別人的設定）：

```bash
uv run --project "<PLUGIN_DIR>" python - <<'PY'
import json, os
d = os.path.join(os.getcwd(), ".claude"); os.makedirs(d, exist_ok=True)
p = os.path.join(d, "settings.local.json")
cfg = {}
if os.path.isfile(p):
    try: cfg = json.load(open(p, encoding="utf-8"))
    except Exception: cfg = {}
perms = cfg.setdefault("permissions", {})
allow = perms.setdefault("allow", []); ask = perms.setdefault("ask", [])
for x in ["mcp__plugin_autobricks_playwright",
          "Bash(uv run:*)", "Bash(uv sync:*)", "Bash(curl:*)", "Bash(mkdir:*)", "Bash(ls:*)", "Bash(date:*)", "Bash(cmd:*)",
          "Write(data/**)", "Edit(data/**)", "Read(data/**)"]:
    if x not in allow: allow.append(x)
for x in ["mcp__plugin_autobricks_playwright__browser_run_code_unsafe"]:
    if x not in ask: ask.append(x)
tmp = p + ".tmp"; json.dump(cfg, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=2); os.replace(tmp, p)
print("[ok] merged permissions into", p)
PY
```
- allow 整個 `mcp__plugin_autobricks_playwright` server；`browser_run_code_unsafe` 留在 ask（ask 蓋 allow）。
- **破壞性的 `rm`／`taskkill`／`docker` 刻意不預核准**，每次問過再做。
- 設定在**新 session 才生效**（本 session 還會問屬正常，重啟或 `/reload-plugins` 後即免）。

### 8. 回報
環境就緒後回報各項狀態（uv、Node、venv、CDP 瀏覽器、WP 環境有無、權限），並列出可用指令：
- `/autobricks:clone` —— 給一個網址，一條龍：分析 → plan → 生成模板（驗證 gate）→ 推本機 WP 實測對照
