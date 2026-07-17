# AutoBricks

**Claude Code plugin：把任一網頁複刻成可匯入的 Bricks Builder 模板。**
給設計部「先 copy 一版、再動手改」用——取代照著參考網站手拉 Bricks 的苦工。

```text
/autobricks:clone    網址 → 一條龍：CDP 真 Chrome 全局分析（數字全實測）→ 逐區塊
                     「實作 → 推本機 WP 渲染 → 與原站並排對照 → 微調」一區收斂才下一區
                     → RWD 逐斷點把同一套迴圈再走一遍（驗證 gate 全程把關）
/autobricks:setup    環境一鍵備好（uv、Node、CDP 瀏覽器、WP 驗證環境、權限預核准）
```

分析與生成由 **Claude 在 session 內完成**（skills）；程式碼只有四塊確定性工具：
量測器（`skills/clone/measure.js`，量外觀）、行為普查器（`skills/clone/behavior.js`＋
載入前注入的 `spy.js` 執行期記帳，量動畫與互動——普查結果逐項變成測試合約，
行為與外觀一樣要驗收）、離線 CSS 普查器
（`skills/clone/parse_css.py`，解析落檔 stylesheet 全文，補 CSSOM 讀不到跨網域 CSS
的 CORS 盲區）與驗證 gate（`src/validate_template.py`）。動態實作走五層階梯（原生元素 → `_interactions` → CSS →
自訂 JS（`code` 元素）→ unsupported），原生表達不了的行為由 JS 補齊、不再只是複刻外觀。

## 安裝（marketplace）

```text
/plugin marketplace add <帳號>/<repo>     # 或本機路徑
/plugin install autobricks@autobricks
```

安裝完成後，使用者在**自己的專案**跑 `/autobricks:setup`。之後使用者專案只會多三樣東西：
`.claude/settings.local.json`（權限）、`.browser/`（CDP Chrome 腳本＋profile，使用者需自行 gitignore）、
`data/`（每次複刻一個資料夾：plan、模板、前後截圖、原站 HTML/CSS 快照）。plugin 目錄全程唯讀。

## 需求

- Google Chrome（真瀏覽器＝無自動化指紋，防爬蟲嚴的網站也能分析）
- Node ≥ 20（Playwright MCP 走 `npx`）與 [uv](https://docs.astral.sh/uv/)——`setup` 會為使用者安裝
- Docker Desktop ＋ 已授權的 Bricks theme（解壓進 `docker/wp/wp-content/themes/bricks/`）——
  **必備**：clone 的逐區渲染對照靠這套環境，見 [docker/README.md](docker/README.md)

## 結構

```text
.claude-plugin/   plugin.json + marketplace.json（發版 bump version、合進預設分支 master）
.mcp.json         內建 Playwright MCP（接管 CDP Chrome，埠取 PLAYWRIGHT_CDP_URL、預設 9222；不自啟瀏覽器）
skills/           clone（一條龍，含 measure.js 量外觀、behavior.js＋spy.js＋parse_css.py 普查行為）· setup
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
