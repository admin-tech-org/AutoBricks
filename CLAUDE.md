# CLAUDE.md — 專案指南

**Bricks CDP Visual Generator**：URL → CDP/Playwright 擷取（screenshot + DOM +
computed CSS + layout boxes）→ Page IR → 可匯入的 **Bricks Builder JSON**。

**技術堆疊：Node.js ≥ 18 + TypeScript（npm workspaces，`tsc -b`）。不是 Python** — 這裡
沒有 `uv`/`pyproject.toml`/`requirements.txt`，也不需要。

## 指令
```bash
npm run build                       # tsc -b + 建置 dashboard
npm run generate -- --url <url>     # CLI pipeline（加上 --vision ai 以達成像素級精準）
npm run generate -- --job <id>      # 重新分析已擷取的 job（不重新擷取）
npm run api                         # API + dashboard 於 :4000
```
Smoke test 用的 fixture：`test-fixtures/landing.html`（file:// URL）。輸出 → `storage/`（已列入 gitignore）。

## 目錄結構
```text
packages/  ir · capture · analyzer · bricks · export · validation
apps/      api · dashboard          workers/  pipeline stages
```
**Contract types 位於 `packages/ir/src/types.ts`** — 要變更跨套件的資料結構時，請先從這裡改起。

## 慣例與會踩雷的陷阱（編輯 bricks mapper 前必讀）
- **idStyle `"bricks"`**（6 字元隨機、含一個數字）為預設值 — 「可讀」的 id 會被
  Bricks 的匯入 id-remapping 破壞。一個 kit `.zip` 必須剛好只包含一個 `.json`。
- **Fast regen**：在 `packages/bricks` 變更後，只從快取的 `storage/ir/<job>/page-ir.json`
  重新產生 generate 階段 — 不要重跑 `--vision ai`
  （約 57 秒、非確定性、會覆蓋 vision 顏色）。參見 `bricks-wp-testing` skill。
- **Bricks 1.12.5 的 setting 結構與 h2b 文件不同**（已對照 theme source 驗證）：
  `_gradient` 是獨立的 key；`_boxShadow` 是一個 OBJECT；font-family 必須拆成
  `{font-family, fallback}`；alpha<1 時保留 `{rgb}`。參見 `bricks-native-json` skill。
- **`_cssCustom` 會原封不動地輸出，且不會替換 `%root%`** — 要使用真正的
  `#brxe-<id>`（只有在 flatten 之後才會知道）。它會隨 template 一起帶著走，不需任何 gate。
  參見 `bricks-css-motion` skill。
- **精準 px**：圖片會固定 `_width` + 一個 id-scoped 的 `aspect-ratio`（絕不用固定高度 —
  會造成變形）；間距是精準的（不做 4px 吸附對齊）。
- **WordPress 寫入** 透過 `docker exec … php` 搭配 `wp_set_current_user(admin)` +
  `wp_slash()` 進行 — 絕不用瀏覽器登入。docker php 前面要加上 `MSYS_NO_PATHCONV=1` 前綴。

## 參考
- 詳細且可攜的 Bricks know-how：使用者 skills `bricks-native-json`、
  `bricks-css-motion`、`bricks-wp-testing`（以 `/<name>` 呼叫）。
- 文件：`GETTING-STARTED.md`、`ARCHITECTURE-bricks-cdp-visual-generator.md`。
