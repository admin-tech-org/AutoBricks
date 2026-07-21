# AutoBricks

**Claude Code plugin：把任一網頁複刻成可匯入的 Bricks Builder 模板。**
給設計部「先 copy 一版、再動手改」用——取代照著參考網站手拉 Bricks 的苦工。

```text
/autobricks:replica   給一個網址，一條龍：CDP 真 Chrome 全局分析（數字全實測）→
                      逐區「生成 Bricks JSON → 推本機 WP 渲染 → 與原站並排對照 → 收斂」→
                      RWD 逐斷點（驗證 gate 全程把關）。
                      預設標準精度；使用者點名「pixel 級」才逐屬性收斂到 0-diff。
/autobricks:setup     環境一鍵備好（uv、Node、CDP 瀏覽器、WP 驗證環境、權限預核准）
```

分析與生成由 **Claude 在 session 內完成**（skill 只給方法與要點）：

- **零內建分析程式**：網站千變萬化，預先寫死的工具總會遇到沒料到的情況——量測工具由
  Claude 依當站現場寫在使用者專案的 `tmp/toolkit/`（一站寫一套，併行工人共用）。
- **併行施工**：預設 5 個工人分區同時做（每工人一台 CDP Chrome＋一個獨立渲染頁），
  工人的 subagent 定義在 `agents/`。
- **四本帳驗收**：
  - 處置帳（原站每個節點的去向）
  - 行為清冊（每個會動的效果逐筆實測）
  - 數值 diff（渲染值 − 量測值）
  - 視覺把關（截圖逐項核對）。
- **驗證 gate** `src/validate_template.py`——模板推送前 error 不清零就不放行。

動態（互動／動畫）走五層階梯實作：原生元素 → `_interactions` → CSS → 自訂 JS（`code` 元素）→
unsupported（只准是真後端功能）。行為與外觀一樣要驗收，不是加分項。

## 安裝（marketplace）

```text
/plugin marketplace add <帳號>/<repo>     # 或本機路徑
/plugin install autobricks@autobricks
```

安裝完成後，使用者在**自己的專案**跑 `/autobricks:setup`。之後使用者專案只會多三樣東西：
- `.claude/settings.local.json`（權限與埠設定）
- `.browser/`（CDP Chrome 啟動腳本＋profile，
請自行 gitignore）
- `data/`（每次複刻一個資料夾：plan、模板、截圖、資產）。

plugin 目錄全程唯讀。

## 需求

- Google Chrome（真瀏覽器＝無自動化指紋，防爬蟲嚴的網站也能分析）
- Node ≥ 20（Playwright MCP 走 `npx`）與 [uv](https://docs.astral.sh/uv/)——`setup` 會為使用者安裝
- Docker Desktop ＋ 已授權的 Bricks theme（解壓進 `docker/wp/wp-content/themes/bricks/`）——
  **必備**：逐區渲染對照靠這套環境，見 [docker/README.md](docker/README.md)

## 結構

```text
.claude-plugin/   plugin.json + marketplace.json（發版：bump version、合進預設分支 master）
.mcp.json         內建 Playwright MCP ×5 組（接管 CDP Chrome；埠取 PLAYWRIGHT_CDP_URL[_N]，
                  預設 9222..9226；不自啟瀏覽器）
skills/           replica（複刻主力，含 element-map.md 選型參考）· setup（環境）
agents/           replica-band.md —— replica 併行工人的 subagent 定義
src/              validate_template.py（驗證 gate）· extract_bricks_schema.py
                  （從使用者裝的 theme 原始碼現抽 schema，驗證與生成共用）
templates/        launch-chrome-cdp.{bat,sh} —— setup 複製到使用者專案 .browser/
docker/           WP+Bricks 驗證環境（compose / init-wp.sh / push-template.php）
doc/              tutorial.md —— 從 Docker 到第一個 Bricks 頁面的完整教學
```

## Bricks 版本與經驗知識

plugin **不鎖定 Bricks 版本**：元素／欄位存在性由 `src/extract_bricks_schema.py` 直接從
使用者裝的 theme 原始碼現抽（`data/bricks-schema-live.json`，版本自動對齊）；沒有 live schema
就以渲染實測為準。使用經驗（設定值形狀、渲染地雷）**不隨 plugin 發佈**——
累積在使用者專案的 `bricks-gotchas.local.md`，skill 讀取時以它為最優先依據、新教訓也回寫它。

## 法律注意事項

僅可用於使用者自有網站／已授權的客戶網站／內部重建／學習用途。
