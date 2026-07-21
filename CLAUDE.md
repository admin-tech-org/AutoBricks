# CLAUDE.md

## 這是什麼

**AutoBricks**：Claude Code plugin（本 repo 同時是 plugin 與自己的 marketplace），
把網頁複刻成 Bricks Builder 模板。兩個 skills（在 `skills/<name>/SKILL.md`）：

- **replica**——唯一的複刻 skill，一條龍：CDP 接管真 Chrome 把原站量成資料 →
  一區一個乾淨 context 的工人直接生成 Bricks JSON、推本機 WP 渲染、與原站對照收斂 →
  RWD 併入各區工人。**預設標準精度**（盒與可見樣式對齊即收帳），使用者點名「pixel 級」
  才開 0-diff 精修。**零內建分析程式**——量測工具由 Claude 臨場寫在使用者專案的
  `tmp/toolkit/`（一站寫一套、工人共用）；四本帳驗收；預設 5 個併行工人＋接棒制。
  工人的 subagent 定義在 **`agents/replica-band.md`**（plugin 元件，隨安裝發佈；
  host 派工時依區的難易指定模型）。選型參考 `skills/replica/element-map.md`。
- **setup**——環境安裝，使用者手動觸發。

驗證 gate＝`src/validate_template.py`（模板推送前 error 不清零就不放行）。
**結構極簡鐵律：好編輯 > 還原 DOM 層次。**

- **內建 MCP**：根目錄 `.mcp.json` 宣告 **5 組** Playwright MCP（`playwright`＋`playwright2..5`，
  replica 併行的分身瀏覽器隊；工具前綴 `mcp__playwrightN__*`），各以 `--cdp-endpoint` 接管真
  Chrome。埠取環境變數 `PLAYWRIGHT_CDP_URL`／`PLAYWRIGHT_CDP_URL_2..5`（沒設＝9222..9226；
  `setup` 選自訂埠時會寫進使用者專案的 `settings.local.json`，分身埠＝基準 +1..+4，
  並把 5 組放行進 `enabledMcpjsonServers`）。平時只開基準台，跑併行才逐台啟動分身
  （同一支腳本、埠當參數）。**全部不自啟瀏覽器、無自動化指紋——這是能分析防爬蟲網站的關鍵，
  勿改成 launch。**
- **CDP 啟動腳本範本**在 `templates/`，由 `setup` 複製到**使用者專案**的 `.browser/`
  （profile 與登入態是使用者資產，不隨 plugin 發佈）。
- **plugin 路徑**：skill 要定位包內檔案時，用 skill 開頭系統給的「Base directory」往上推兩層
  （`<skill base>/../..`）當 plugin 根。**不用** `$CLAUDE_PLUGIN_ROOT`（在 skill 的 bash 裡不可靠），
  也不靠 cwd。
- **路徑鐵律**：plugin 目錄全程唯讀；產物寫使用者專案的 `data/`。暫存分兩類：
  瀏覽器中間產物（截圖、量測 JSON）→ `.browser/tmp/`；分析過程紀錄（筆記、dump、草稿）→
  專案 `tmp/`。兩者用完即刪，**收尾清空、專案根不留垃圾**
  （MCP 工具給 `filename` 時務必帶資料夾前綴，裸檔名會落到專案根）。

## 環境與指令（uv）

團隊統一用 **uv**（勿用 pip）。`uv.lock` 進版控。相依：無（驗證器純 stdlib；ruff 在 dev 群組）。

```bash
uv sync                                            # venv + dev 工具
uv run python src/validate_template.py <template.json> [--strict] [--json]   # 驗證 gate
uv run ruff format . && uv run ruff check --fix .  # lint/format（手動跑）
```

- 改動驗證器後，用 scratchpad 的樣本實跑驗證（valid 要 PASS、broken 要全數抓到），別只 import。
- Windows 主控台輸出亂碼＝忘了 stdout UTF-8 reconfigure（`validate_template.py` 開頭有，勿移除）。

## Plugin 開發／測試／發版

- 開發：`claude --plugin-dir .`（skills 變 `/autobricks:*`）。
- 真安裝驗證：`/plugin marketplace add <本機路徑或 repo>` → `/plugin install autobricks@autobricks`。
- **發版**：bump `.claude-plugin/plugin.json` 的 `version`，**合進預設分支 `master`** 並 push
  （只推個人分支不會被 marketplace 抓到；`marketplace.json` 的 version 是純標籤）。

## Bricks 鐵律（skills 已內建，改 skill 時勿違反）

- **plugin 不鎖定 Bricks 版本、不內建版本經驗**。真相來源順序：使用者專案的
  `bricks-gotchas.local.md`（實證經驗，隨專案成長；gitignored、不隨 plugin 發佈）→
  live schema（`src/extract_bricks_schema.py` 從使用者裝的 theme 原始碼現抽，
  欄位存在性的最高權威）→ `bricks-schema/`（官方 v2.3、對應 2.x，fallback）。
  **版本經驗絕不寫進 plugin 目錄**（marketplace 更新會整包覆蓋，也污染通用性）。
- **`%root%` 在 `_cssCustom` 不會被替換**，會原樣輸出成無效 selector——
  一律用真實 `#brxe-<id>`，且在元素 id 定案後才寫。
- 元素 id：6 碼 `[a-z0-9]` 且含數字；一個 kit zip 恰好一個 `.json`。
- 圖片釘 `_width` ＋ id-scoped `aspect-ratio`，絕不固定 `_height`；間距用實測值、不吸附整數。
- **行為（動態／互動）不是加分項**，走五層階梯：原生元素 → `_interactions` → CSS →
  自訂 JS（`code` 元素：`javascriptCode`＋`executeCode`；vanilla、自包含、鎖 `#brxe-<id>`）→
  unsupported（只准是真後端功能）。code 元素前台執行受 Bricks 權限／簽章管制（版本相關）——
  實測沒跑就查 theme 原始碼定案，不猜。
- **WordPress 寫入**走 `docker exec … php`（`wp_set_current_user(admin)` + `wp_slash()`），
  Git Bash 一律加 `MSYS_NO_PATHCONV=1` 前綴；**絕不用瀏覽器登入 WP 後台**。

## 操作慣例（Claude 必讀）

- shell 一律走 **Bash 工具**（權限規則依工具分；PowerShell 會全部跳權限框）；
  指令別用 `cd xxx &&` 開頭。
- 破壞性指令（`rm`、`taskkill`、`docker compose down -v`、覆寫既有 WP 頁）不預核准，
  問過使用者再做。
- 暫存檔規矩見上面路徑鐵律——收工前檢查專案根乾淨再回報。

## 程式風格與 Git

- Python 4 空格、無 type hints 也可；zh-TW 註解 OK；檔案一律 **LF**（`.gitattributes` 強制）。
- 個人分支 `<name>_dev` 開發，PR 進 `master`；**勿直接 push master**。
- Commit：**gitmoji ＋ 繁體中文描述**（例：`🐛 fix: 修正驗證器誤判`），
  結尾加 `Co-Authored-By` trailer。
