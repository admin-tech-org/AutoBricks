# AutoBricks

**Claude Code plugin：把任一網頁複刻成可匯入的 Bricks Builder 模板。**
給設計部「先 copy 一版、再動手改」用——取代照著參考網站手拉 Bricks 的苦工。

```text
/autobricks:clone    網址 → 一條龍：CDP 真 Chrome 全面分析（數字全實測）→ 施工 plan
                     → Bricks 模板 JSON（驗證 gate）→ 推本機 WP 實測、多策略對照
/autobricks:setup    環境一鍵備好（uv、Node、CDP 瀏覽器、選配 WP 環境、權限預核准）
```

分析與生成由 **Claude 在 session 內完成**（skills）；程式碼只有兩塊確定性工具：
量測器（`skills/clone/measure.js`，餵給 browser_evaluate）與驗證 gate（`src/validate_template.py`）。

## 安裝（marketplace）

```text
/plugin marketplace add <帳號>/<repo>     # 或本機路徑
/plugin install autobricks@autobricks
```

安裝完成後，使用者在**自己的專案**跑 `/autobricks:setup`。之後使用者專案只會多三樣東西：
`.claude/settings.local.json`（權限）、`.browser/`（CDP Chrome 腳本＋profile，使用者需自行 gitignore）、
`data/`（每次複刻一個資料夾：plan、模板、前後截圖）。plugin 目錄全程唯讀。

## 需求

- Google Chrome（真瀏覽器＝無自動化指紋，防爬蟲嚴的網站也能分析）
- Node ≥ 20（Playwright MCP 走 `npx`）與 [uv](https://docs.astral.sh/uv/)——`setup` 會為使用者安裝
- （選配）Docker Desktop ＋ 已授權的 Bricks theme（解壓進 `docker/wp/wp-content/themes/bricks/`）——實測階段用，見 [docker/README.md](docker/README.md)

## 結構

```text
.claude-plugin/   plugin.json + marketplace.json（發版 bump version、合進 main）
.mcp.json         內建 Playwright MCP（接管 CDP 9222，不自啟瀏覽器）
skills/           clone（一條龍，含 measure.js）· setup
src/              validate_template.py（驗證 gate）· extract_bricks_schema.py
                  （從使用者 theme 原始碼抽 schema、版本自動對齊，驗證與生成共用）
templates/        launch-chrome-cdp.{bat,sh} —— setup 複製到使用者專案 .browser/
docker/           WP+Bricks 驗證環境（compose / init-wp.sh / push-template.php）
doc/              tutorial.md —— 從 Docker 到第一個 Bricks 頁面的完整教學
bricks-schema/    官方 Bricks 資料模型 schema v2.3 本地副本（元素/設定欄位存在性的依據）
```

## Bricks 版本與經驗知識

plugin **不鎖定 Bricks 版本**：元素/欄位存在性由 `src/extract_bricks_schema.py` 直接從
使用者裝的 theme 原始碼現抽（`data/bricks-schema-live.json`，版本自動對齊）；`bricks-schema/`
（官方 v2.3，對應 2.x）只是 live 不可用時的 fallback。使用經驗（設定值形狀、渲染地雷）
**不隨 plugin 發佈**——累積在使用者專案的 `bricks-gotchas.local.md`，clone skill 讀取時
以它為最優先 ground truth、新教訓也回寫它。

## 法律注意事項

僅可用於使用者自有網站／已授權的客戶網站／內部重建／學習用途。
