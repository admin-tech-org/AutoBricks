# Bricks CDP Visual Generator

以 CDP/Playwright 渲染真實網站，擷取**螢幕截圖 + DOM + 計算後的
CSS + 版面配置框**，合併為 **Page IR**，再產生乾淨、可匯入的
**Bricks Builder JSON**（WordPress）。

```text
URL → CDP/Playwright capture → heuristic Analyzer → (optional AI Vision) → Page IR
    → Bricks Planner → flat Bricks JSON → Validator → Export (.json / kit .zip)
```

> DOM = 存在什麼 · 螢幕截圖 = 看起來如何 · 計算後的 CSS + 邊界框 =
> 位置與大小。Page IR 是產生 Bricks JSON
> 前的唯一真實來源。

## 需求

- **Node.js ≥ 18**（Node/TypeScript 專案，npm workspaces — **不使用 Python**）
- 供 Playwright 使用的 Chromium（用下方指令安裝一次即可）

## 安裝

```bash
npm install
npm run browsers        # playwright 安裝 chromium（一次即可）
npm run build           # tsc -b + 建置 dashboard
```

## 快速使用（CLI）

```bash
# 從真實 URL 擷取 + 產生：
npm run generate -- --url https://example.com

# 使用本地 fixture 測試：
npm run generate -- --url "file:///<path>/test-fixtures/landing.html"

# AI Vision 模式（pixel-fidelity，平行 fan-out subagent claude -p）：
npm run generate -- --url https://example.com --vision ai

# 重新分析 1 個已擷取的 job（不重新開啟 browser）：
npm run generate -- --job <jobId> --vision ai
```

輸出位於 `storage/`（已列入 gitignore）：`screenshots/`、`snapshots/`、`ir/`、
`templates/{template.json, template-kit.zip}`、`reports/`。

## API + Dashboard

```bash
npm run api             # http://localhost:4000
```

## 結構

```text
packages/   ir · capture · analyzer · bricks · export · validation   (契約型別位於 packages/ir/src/types.ts)
apps/       api · dashboard
workers/    job 管線階段
```

## 文件

- [GETTING-STARTED.md](./GETTING-STARTED.md) — 詳細使用指南、選項、vision 模式、design/animation。
- [ARCHITECTURE-bricks-cdp-visual-generator.md](./ARCHITECTURE-bricks-cdp-visual-generator.md) — 完整架構。
- [README-bricks-cdp-visual-generator.md](./README-bricks-cdp-visual-generator.md) — 設計理念（為何採用 Page IR）。

## 匯入 Bricks

WordPress → Bricks → Templates → **Import Templates** → 選擇 `template.json`。
每個 `.json` = 1 個 template；kit `.zip` 刻意設計成只包含剛好 1 個 `.json`。

## 設定（選用）

複製 `.env.example` → `.env`。所有變數皆為選用（`PORT`、
`WORKER_CONCURRENCY`、`STORAGE_DIR`）— app 以預設值即可執行。

## 法律注意事項

僅可用於你的網站 / 已授權的客戶 / 內部重建 /
學習用途。
