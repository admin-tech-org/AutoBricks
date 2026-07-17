# CLAUDE.md

## 這是什麼

**AutoBricks**：Claude Code plugin（本 repo 同時是 plugin 與自己的 marketplace），把網頁複刻成
Bricks Builder 模板。**分析與生成由 skills 在 Claude session 內完成**（CDP 接管真 Chrome），
程式碼只有四塊確定性工具：量測器（`skills/clone/measure.js`，量「長什麼樣」）、
行為普查器（`skills/clone/behavior.js`＋載入前注入的 `spy.js` 執行期記帳，量「會做什麼」
——動畫/監聽器/計時器/框架名冊/程式庫指紋/Mutation 熱點）、
離線 CSS 普查器（`skills/clone/parse_css.py`，解析落檔 stylesheet 全文——CSSOM 讀不到
跨網域 CSS，這支補 CORS 盲區）與驗證 gate（`src/validate_template.py`）。

- 清單：`.claude-plugin/plugin.json` + `marketplace.json`；skills 在 **`skills/<name>/SKILL.md`**：
  `clone`（全局分析→逐區塊實作並即時渲染對照原站→RWD 逐斷點，一條龍；
  **結構極簡鐵律：好編輯 > 還原 DOM 層次**）、
  `setup`（環境，user-only）。
- **內建 MCP**：根目錄 `.mcp.json` 宣告 Playwright MCP，`--cdp-endpoint` 接管真 Chrome——
  埠取 `PLAYWRIGHT_CDP_URL`（沒設＝9222；`setup` 選自訂埠時會寫進使用者
  `settings.local.json` 的 env）（不自啟、無自動化指紋——這是能分析防爬蟲網站的關鍵，
  勿改成 launch）。
- **CDP 啟動腳本範本**在 `templates/`，由 `setup` 複製到**使用者專案** `.browser/`
  （profile／登入態是使用者資產，不隨 plugin 發佈）。
- **plugin 路徑**：skill 要定位包內檔案，用 skill 開頭系統給的「Base directory」推 plugin 根
  （`<skill base>/../..`）——**不用** `$CLAUDE_PLUGIN_ROOT`（skill bash 不可靠）、不靠 cwd。
- **路徑鐵律**：plugin 目錄全程唯讀；產物寫使用者專案 `data/`。暫存分兩類、各有歸處：
  **瀏覽器中間產物**（截圖 dump、量測 JSON、dataURL 等）→ `.browser/tmp/`；
  **分析過程紀錄**（中間筆記、dump、比對草稿）→ 專案 `tmp/`。兩者都是用完即刪，
  **收尾清空、專案根不留垃圾**（MCP 工具給 `filename` 時務必帶資料夾前綴，裸檔名會落到根目錄）。

## 環境與指令（uv）

團隊統一用 **uv**（勿用 pip）。`uv.lock` 進版控。相依：無（驗證器純 stdlib；ruff 在 dev 群組）。

```bash
uv sync                                            # venv + dev 工具
uv run python src/validate_template.py <template.json> [--strict] [--json]   # 驗證 gate
uv run ruff format . && uv run ruff check --fix .  # lint/format（手動跑）
```

- 驗證器改動後用 scratchpad 的樣本實跑驗證（valid 要 PASS、broken 要全數抓到），別只 import。
- Windows 主控台輸出亂碼＝忘了 stdout UTF-8 reconfigure（`validate_template.py` 開頭有，勿移除）。

## Plugin 開發／測試／發版

- 開發：`claude --plugin-dir .`（skills 變 `/autobricks:*`）。
- 真安裝驗證：`/plugin marketplace add <本機路徑或 repo>` → `/plugin install autobricks@autobricks`。
- **發版**：bump `.claude-plugin/plugin.json` 的 `version` ＋ **合進預設分支 `master`** 並 push
  （只推個人分支不會被抓；`marketplace.json` 的 version 是純標籤）。

## Bricks 鐵律（skills 已內建，改 skill 時勿違反）

- **plugin 不鎖定 Bricks 版本、不內建版本經驗**。真相來源順序：使用者專案
  `bricks-gotchas.local.md`（實證經驗，隨專案成長；gitignored、不隨 plugin 發佈）→
  live schema（`src/extract_bricks_schema.py` 從使用者 theme 原始碼現抽，
  欄位存在性最高權威）→ `bricks-schema/`（官方 v2.3、對應 2.x，fallback）。
  **版本經驗絕不寫進 plugin 目錄**（marketplace update 會整包蒸發，也污染通用性）。
- **`%root%` 在 `_cssCustom` 不會被替換**（1.12.x 實證）——會原樣輸出成無效 selector。
  一律用真實 `#brxe-<id>`，且在元素 id 定案後才寫。
- id：6 碼 `[a-z0-9]` 且含數字；一個 kit zip 恰好一個 `.json`。
- 圖片釘 `_width` ＋ id-scoped `aspect-ratio`，絕不固定 `_height`；間距用實測值不吸附。
- **行為（動態/互動）不是加分項**：clone skill 走五層階梯——原生元素 → `_interactions` →
  CSS → **自訂 JS（`code` 元素：`javascriptCode`＋`executeCode`；vanilla、自包含、
  鎖 `#brxe-<id>`）** → unsupported（只准是真後端功能）。code 元素前台執行受 Bricks
  code execution 權限／簽章管制（版本相關）——實測沒跑就查 theme 原始碼定案，不猜。
- **WordPress 寫入**走 `docker exec … php`（`wp_set_current_user(admin)` + `wp_slash()`），
  Git Bash 一律加 `MSYS_NO_PATHCONV=1` 前綴；**絕不用瀏覽器登入後台**。

## 操作慣例（Claude 必讀）

- shell 一律走 **Bash 工具**（權限規則依工具分；PowerShell 會全跳框）；指令別用 `cd xxx &&` 開頭。
- 破壞性指令（`rm`、`taskkill`、`docker compose down -v`、覆寫既有 WP 頁）不預核准，問過再做。
- 暫存檔規矩見上面路徑鐵律——收工前檢查專案根乾淨再回報。

## 程式風格與 Git

- Python 4 空格、無 type hints 也可；zh-TW 註解 OK；檔案一律 **LF**（`.gitattributes` 強制）。
- 個人分支 `<name>_dev` 開發，PR 進 `main`；**勿直接 push main**。
- Commit：**gitmoji ＋ 繁體中文描述**（例：`🐛 fix: 修正驗證器誤判`），
  結尾加 `Co-Authored-By` trailer。
