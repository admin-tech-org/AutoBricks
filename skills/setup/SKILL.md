---
name: setup
description: 在使用者明確要求時，檢查、安裝或修復 AutoBricks 執行環境：uv 與 Node、Python 相依套件、Chrome CDP 連線，以及用於匯入和檢查 Bricks 成品的 Docker WordPress。
---

# setup

「Agent 產品」指 Claude Code、Codex 等可使用工具執行任務的 AI 助理軟體；「使用者」指提出需求並操作本機環境的人。

- **使用時機**：使用者明確要求檢查、安裝或修復環境時，Agent 產品才使用本技能。
- **準備目標**：Agent 產品準備觀察原站、生成 Bricks JSON 與檢查 WP 成品所需的環境。
- **環境檢查**：Agent 產品先檢查現有環境與使用者授權，僅補齊缺少的項目。
- **安裝授權**：需要安裝軟體且尚未取得授權時，Agent 產品才向使用者說明變更並取得同意。
- **指令語法**：以下指令以 Bash 語法示範。Agent 產品依執行環境選擇 shell，在本專案的 Windows 環境使用 PowerShell，必要時轉寫指令或呼叫 Bash 腳本。
- **執行權限**：權限行為以當前 Agent 產品的設定為準。

## 步驟

### 1. 取得 plugin 根目錄
- `<PLUGIN_ROOT>`：Agent 產品從目前載入的 skill 絕對路徑向上尋找，同時包含 `pyproject.toml` 與 `docker/push-template.php` 的 AutoBricks 根目錄，供取得工具與範本。
- `<PROJECT_ROOT>`：使用者指定的工作專案根目錄，未另行指定時使用當前對話的工作專案，不以 skill 所在目錄推定。
- 瀏覽器啟動腳本、`cdp.env` 與 profile 存在 `<PROJECT_ROOT>/.browser/`，Python 虛擬環境存在 `<PROJECT_ROOT>/.autobricks/venv/`。
- `<WP_DIR>`：WordPress 測試環境目錄，預設為 `<PROJECT_ROOT>/.autobricks/docker/`，開發 AutoBricks 與安裝 plugin 時皆相同。Docker 設定存在此目錄，WordPress 檔案存在其中的 `wp/`，MariaDB 資料由 Docker 的 `db_data` named volume 保存。
- `<RUN_DIR>`：當次任務的 `<PROJECT_ROOT>/data/YYYYMMDD-agent_product-task_name/`。日期採任務開始時的本機日期，產品名與英文任務名使用小寫，多字以底線連接，例如 `20260914-codex-new_art_clone_web`、`20260914-claude_code-new_art_clone_web`。續修沿用當次目錄，新任務不覆蓋既有目錄。
- Agent 產品建立 `<RUN_DIR>/tmp/` 與 `<RUN_DIR>/output/`。當次分析工具、腳本、下載素材、量測、截圖與其他中間檔案全部放入 `tmp/`，可匯入的 Bricks 匯入包及交付所需素材放入 `output/`，最終交付報告寫入 `output/report.md`。
- 版本筆記存在 `<PROJECT_ROOT>/bricks-import.md`。環境與執行產物不得寫入 plugin 安裝快取。

Agent 產品以載入檔案的位置辨識 plugin 根目錄，不依賴 Agent 產品專用的環境變數。直接使用專案 skill 或使用安裝副本時，均採用此方式。

### 2. 確認作業系統
Agent 產品依環境資訊選擇 Windows、macOS 或 Linux 指令；資訊不足時才向使用者確認作業系統。

### 3. 檢查 uv 與 Node
Agent 產品先檢查版本；現有工具符合需求時跳過安裝：

- **uv**：`uv --version` 有 → 跳過；沒有 → macOS `brew install uv`／Windows `scoop install uv`
  （Linux：`curl -LsSf https://astral.sh/uv/install.sh | sh`）。套件管理器本身缺的話：
  macOS 裝 Homebrew（需要互動輸入密碼時，由使用者在終端機執行官方安裝指令）、
  Windows 用 PowerShell 裝 Scoop：`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force; iwr -useb get.scoop.sh | iex`。
- **Node（≥22）**：供共用的 `src/browser.mjs` 使用。
  Agent 產品確認 `node --version` 符合需求；所用工具透過 `npx` 啟動時，也確認 `npx --version` 可執行。符合時跳過，不符合時才安裝（以下 nvm 範例使用 Node 24）：
  - Windows：`scoop install nvm` → `nvm install 24` → `nvm use 24`
  - macOS：`brew install nvm; mkdir -p ~/.nvm` → `export NVM_DIR="$HOME/.nvm"; . "$(brew --prefix nvm)/nvm.sh"; nvm install 24 && nvm use 24`
    （環境載入與安裝指令需在同一個 Bash session；Agent 產品提醒使用者將 `NVM_DIR` 設定與 nvm 載入指令加入 `~/.zshrc`。）
  - Linux：官方 nvm 安裝器後同上。

### 4. 安裝專案相依（venv + 驗證工具）
Agent 產品執行以下指令，建立或更新專案虛擬環境，供 Python 工具檢查模板 JSON：

```bash
UV_PROJECT_ENVIRONMENT="<PROJECT_ROOT>/.autobricks/venv" uv sync --project "<PLUGIN_ROOT>"
```

### 5. 準備 Chrome CDP 連線
Agent 產品透過 Chrome CDP 觀察原站或 WP 預覽的內容、排版與互動，可使用現有的 CDP 工具或共用的 `<PLUGIN_ROOT>/src/browser.mjs`。共用工具的連線方式見 [../web-to-bricks/references/browser.md](../web-to-bricks/references/browser.md)。啟動腳本的預設埠為 9222，Agent 產品需確認瀏覽器與所用工具設定的埠一致。

1. **Agent 產品將啟動腳本放進使用者專案的 `.browser/`**，讓瀏覽器 profile 與登入資料留在該專案：
   ```bash
   mkdir -p "<PROJECT_ROOT>/.browser"
   cp "<PLUGIN_ROOT>/templates/launch-chrome-cdp.bat" "<PROJECT_ROOT>/.browser/"   # Windows
   cp "<PLUGIN_ROOT>/templates/launch-chrome-cdp.sh"  "<PROJECT_ROOT>/.browser/"   # macOS / Linux
   ```
   Agent 產品確認該專案的 `.gitignore` 排除 `.browser/`。
2. **Agent 產品優先沿用可用的 CDP 埠設定**；首次設定時使用空閒的 9222，或依使用者需求選擇其他埠，並將 `CDP_PORT=<port>` 寫入 `.browser/cdp.env`。
   啟動腳本讀取該檔；非 9222 時使用 `.chrome_cdp-<port>` profile。同一 profile 只能供一個 Chrome 實例使用。
   Agent 產品依所用工具的介面指定相同的 CDP 連線位址，只啟動當次工作需要的瀏覽器，並確認所用埠未被其他服務占用。
3. **Agent 產品啟動設定好的 Chrome**：
   - Windows：`cmd //c "<PROJECT_ROOT>/.browser/launch-chrome-cdp.bat"`
   - macOS／Linux：`bash "<PROJECT_ROOT>/.browser/launch-chrome-cdp.sh"`
   Agent 產品以 `curl -s http://127.0.0.1:<port>/json/version` 確認 Chrome 已提供 CDP 連線。
4. 目標網站需要登入時，由使用者在剛啟動的 Chrome 視窗完成登入；瀏覽器 profile 保存登入狀態。後續重建時，Agent 產品先檢查 CDP 連線，必要時再啟動瀏覽器。
5. Agent 產品呼叫所用瀏覽器工具，確認工具能開啟頁面、讀取 DOM 及擷取截圖，再用所用產品的圖片檢視工具開啟截圖；CDP 埠有回應不代表完整的觀察流程已可用。

### 6. Docker WordPress + Bricks 驗證環境（必備）
Agent 產品需要本機 WordPress + Bricks 實際渲染重建頁面，檢查模板匯入、外觀、RWD、互動與素材。使用者提供已授權的 Bricks theme。

1. **Agent 產品確認 Docker Desktop 已啟動**（`docker version` 有 Server 段）。Docker 尚未可用時，Agent 產品依使用者授權協助啟動或安裝；需要使用者操作時，明確說明缺少的步驟，不能回報 WP 環境已就緒。
2. Agent 產品先確認 `<WP_DIR>`。首次建置時，將 `<PLUGIN_ROOT>/docker/` 中的 `docker-compose.yml` 與 `init-wp.sh` 複製至 `<WP_DIR>`。`<PLUGIN_ROOT>/docker/` 只提供範本與工具，不能直接在其中初始化 WP，也不能將 WP 資料寫入 plugin 快取。

   - 啟動前，Agent 產品以 `docker compose -f "<WP_DIR>/docker-compose.yml" config` 確認 WordPress 掛載來源為 `<WP_DIR>/wp/`。同名容器或 Compose 專案已存在時，需核對其實際掛載與資料庫 volume，不能接管其他工作專案的環境。
   - 沿用既有環境時，Agent 產品確認環境屬於使用者指定的專案，不以範本覆蓋現有設定。需要搬遷時，先停止 WP 寫入並備份，再複製檔案、保留資料庫 volume，確認新掛載與既有頁面正常後才整理舊副本。

   初始化指令為：
   ```bash
   bash "<WP_DIR>/init-wp.sh"
   ```
3. 使用者提供已授權的 Bricks theme 後，Agent 產品將 theme 解壓至 `<WP_DIR>/wp/wp-content/themes/bricks/`，再執行 `<WP_DIR>/init-wp.sh` 啟用。Agent 產品確認工作目錄的 Git 忽略 `.autobricks/`、`.browser/` 與執行產物，不將商業 theme 納入版控。
   預設站台為 http://localhost:8080，後台帳號／密碼為 admin/admin，僅供本機測試。細節見 `<PLUGIN_ROOT>/docker/README.md`。

### 7. 回報
Agent 產品向使用者回報 uv 與 Node 版本、Python 虛擬環境、CDP 連線位址、WP 預覽網址、Bricks 是否啟用，以及實際安裝或調整的環境項目。尚未完成的項目需分別列出。

環境就緒後，使用者可呼叫 `web-to-bricks` 技能並提供參考網址。Agent 產品依該技能觀察原站、轉換內容與版型，再檢查 Bricks 成品。
