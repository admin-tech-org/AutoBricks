# Bricks CDP Visual Generator

Render a real website with CDP/Playwright, capture **screenshot + DOM + computed
CSS + layout boxes**, merge into a **Page IR**, and generate clean, importable
**Bricks Builder JSON** (WordPress).

```text
URL → CDP/Playwright capture → heuristic Analyzer → (optional AI Vision) → Page IR
    → Bricks Planner → flat Bricks JSON → Validator → Export (.json / kit .zip)
```

> DOM = what exists · Screenshot = how it looks · Computed CSS + bounding boxes =
> where and how big. The Page IR is the single source of truth before emitting
> Bricks JSON.

## Yêu cầu

- **Node.js ≥ 18** (dự án Node/TypeScript, npm workspaces — **không dùng Python**)
- Chromium cho Playwright (cài 1 lần bằng lệnh dưới)

## Cài đặt

```bash
npm install
npm run browsers        # playwright install chromium (1 lần)
npm run build           # tsc -b + build dashboard
```

## Dùng nhanh (CLI)

```bash
# capture + generate từ URL thật:
npm run generate -- --url https://example.com

# test bằng fixture local:
npm run generate -- --url "file:///<path>/test-fixtures/landing.html"

# chế độ AI Vision (pixel-fidelity, fan-out subagent claude -p song song):
npm run generate -- --url https://example.com --vision ai

# phân tích lại 1 job đã capture (không mở browser lại):
npm run generate -- --job <jobId> --vision ai
```

Output nằm trong `storage/` (đã gitignore): `screenshots/`, `snapshots/`, `ir/`,
`templates/{template.json, template-kit.zip}`, `reports/`.

## API + Dashboard

```bash
npm run api             # http://localhost:4000
```

## Cấu trúc

```text
packages/   ir · capture · analyzer · bricks · export · validation   (contract types ở packages/ir/src/types.ts)
apps/       api · dashboard
workers/    job pipeline stages
```

## Tài liệu

- [GETTING-STARTED.md](./GETTING-STARTED.md) — hướng dẫn dùng chi tiết, options, chế độ vision, design/animation.
- [ARCHITECTURE-bricks-cdp-visual-generator.md](./ARCHITECTURE-bricks-cdp-visual-generator.md) — kiến trúc đầy đủ.
- [README-bricks-cdp-visual-generator.md](./README-bricks-cdp-visual-generator.md) — triết lý thiết kế (vì sao Page IR).

## Import vào Bricks

WordPress → Bricks → Templates → **Import Templates** → chọn `template.json`.
Mỗi `.json` = 1 template; kit `.zip` được thiết kế chỉ chứa đúng 1 `.json`.

## Cấu hình (tuỳ chọn)

Sao chép `.env.example` → `.env`. Tất cả biến đều optional (`PORT`,
`WORKER_CONCURRENCY`, `STORAGE_DIR`) — app chạy được với mặc định.

## Lưu ý pháp lý

Chỉ dùng cho website của bạn / khách hàng đã cho phép / rebuild nội bộ / mục đích
học tập.
