# Getting Started — Bricks CDP Visual Generator

Hệ thống render website thật bằng CDP/Playwright, chụp screenshot + trích xuất DOM/CSS/layout, merge thành **Page IR**, rồi sinh **Bricks Builder JSON** import được.

## Cài đặt

```bash
npm install
npx playwright install chromium   # tải browser (1 lần)
npm run build                     # build toàn bộ workspace (tsc -b + esbuild dashboard)
```

## Cách 1 — CLI (chạy pipeline trực tiếp)

```bash
npm run generate -- --url https://example.com
# hoặc test bằng fixture local:
npm run generate -- --url "file:///C:/Users/User/Desktop/CDP_AutoBricks/test-fixtures/landing.html"
```

Options:

```text
--url <url>              http(s):// hoặc file:// (bắt buộc khi capture)
--job <jobId>            phân tích lại 1 job đã capture (không mở browser lại)
--mode landing-page      (mặc định)
--viewports desktop,tablet,mobile
--storage <dir>          (mặc định ./storage)
--id-style readable|bricks
--vision heuristic|ai    (mặc định heuristic)
--vision-model <model>   model cho AI vision (mặc định sonnet)
--vision-concurrency <n> số subagent vision chạy song song (mặc định 4)
```

Output nằm trong `storage/`:

```text
storage/
├── screenshots/<jobId>/{desktop,tablet,mobile,full-page}.png
├── snapshots/<jobId>/{dom,css,layout,assets}.json
├── ir/<jobId>/page-ir.json
├── templates/<jobId>/{template.json, template-kit.zip}
└── reports/<jobId>/{analysis-report.json, validation-report.json, preview.html, preview.png, diff.png}
```

## Chế độ AI Vision (pixel-fidelity)

Analyzer mặc định là heuristic thuần (rule engine + lấy mẫu pixel). Bật `--vision ai`
để đạt độ trung thực cao hơn: analyzer **fan-out nhiều subagent `claude -p` chạy
song song** — mỗi section một subagent + một subagent global — đọc ảnh crop của từng
section rồi sửa lại **màu nền / gradient / typography / layout / màu nút** theo đúng
pixel render thật (§8, §22: Color/Theme style lấy từ screenshot).

```bash
# capture + phân tích bằng AI vision:
npm run generate -- --url https://example.com --vision ai

# phân tích LẠI 1 job đã capture (không mở browser lại) bằng AI vision:
npm run generate -- --job job_xxxxxxxx --vision ai
```

Yêu cầu: Claude CLI đã đăng nhập trên máy (kiểm tra bằng `claude --version`). Mỗi
subagent gọi ~5–15s, chạy song song (mặc định 4 luồng, chỉnh bằng `--vision-concurrency`).
Kết quả vision lưu ở `storage/reports/<jobId>/vision-ai-report.json`, ảnh crop ở
`storage/vision/<jobId>/`. Mọi lỗi của 1 subagent đều fallback êm về kết quả heuristic
của section đó — pipeline không bao giờ hỏng vì vision.

API: thêm `"vision": "ai"` (và tùy chọn `"visionModel": "sonnet"`) vào body `POST /jobs`.

## Design system + hiệu ứng động (NATIVE Bricks settings)

Design và motion được áp bằng **setting NATIVE của Bricks** (không phải blob `_cssCustom`),
nên **chỉnh sửa được ngay trong builder UI** và đi kèm template khi import như mọi element khác.
Pass `applyNativeDesign` trong `packages/bricks/src/generate-json.ts` (fragment ở
`packages/bricks/src/design-native.ts`) duyệt content sau khi flatten và gắn:

- **Thẻ (card)**: mặt thẻ `_background` + `_border` (bo góc + hairline) + `_boxShadow` (đổ bóng
  chiều sâu) + `_padding`; hover nhấc thẻ bằng `_transform:hover` / `_boxShadow:hover` /
  `_border:hover` + `_cssTransition` (biến thể pseudo-class, sửa được trong UI).
- **Nút (button)**: hover nhấc nhẹ + quầng sáng theo màu primary (`_boxShadow:hover` tint theo
  `theme.primaryColor`).
- **Ảnh sản phẩm (media)**: bo góc + đổ bóng; **logo** (ảnh trong logo-row hoặc trong thẻ chỉ-ảnh)
  bị làm mờ `_opacity: 0.55` rồi sáng lên khi hover.
- **Animation vào-màn-hình khi cuộn**: hệ thống **Interactions native** (`_interactions`:
  trigger `enterView` + action `startAnimation` + animate.css `fadeInUp`, `runOnce`). Đây là
  cách KHÔNG deprecated (control `_animation` entry-animation đã deprecated từ Bricks 1.6).

Planner (`map-section.ts`) vẫn gắn class ngữ nghĩa `.cdp-*` (cdp-card, cdp-hero-title, cdp-btn,
cdp-primary-cta, cdp-media, cdp-logo-row...) lên element — pass native dùng các class này để
quyết định element nào nhận gì (thẻ nội dung ≠ logo tile ≠ cột footer).

**Không cần bật code-execution**: Bricks xuất các setting này thành CSS scope theo id
(`#brxe-xxx {...}`, `#brxe-xxx:hover {...}`) + `data-interactions`, và tự enqueue
`animate.min.css` + `bricks.min.js` (engine interactions). Nếu tắt JS, element entrance vẫn
hiển thị bình thường (Bricks chỉ ẩn tạm bằng attribute do JS thêm — degrade an toàn).

**Dải logo = marquee chạy vô hạn (跑馬燈)** (`packages/bricks/src/logo-marquee.ts`): một
container mà TẤT CẢ con đều là logo card (≥4) được dựng lại thành viewport `overflow:hidden`
chứa một track `flex nowrap` với bộ logo **nhân đôi** → cuộn ngang liên tục bằng
`@keyframes translateX(0 → -50%)` (2 bản khớp nhau nên loop liền mạch), fade 2 mép bằng
`mask-image`, hover thì dừng, `prefers-reduced-motion` thì về lưới tĩnh. Đây là hiệu ứng DUY
NHẤT phải dùng `@keyframes` (setting native của Bricks không biểu diễn được vòng lặp vô hạn),
nên riêng khối này mang một đoạn CSS nhỏ trong `_cssCustom` của viewport — vẫn đi kèm template
khi import, không cần gate.

**Feature-card glow** (`packages/bricks/src/feature-card.ts`): khối split nổi bật (heading + media,
KHÔNG phải hero) được dựng thành **card frosted có viền gradient phát sáng** giống các block
"feature" của web hiện đại: nền trong mờ + `backdrop-blur`, viền hairline, bo góc, padding rộng
(native, sửa được trong builder) + một `::before` mask gradient-border xoay bằng
`@property`/`@keyframes` (glow luôn động, đậm hơn khi hover) trong `_cssCustom` scope theo id.
Chỉ áp cho split ngoài hero để không "glow nhầm" các bố cục 2 cột thường.

## Cách 2 — API Server + Dashboard

```bash
npm run api
# → http://localhost:4000  (dashboard)
```

Endpoints (theo ARCHITECTURE §4):

```text
POST /jobs                        { "url": "...", "mode": "landing-page", "viewports": [...], "output": "bricks-json" }
GET  /jobs/:id                    trạng thái job + artifact paths
GET  /jobs/:id/report             analysis report + validation report
GET  /jobs/:id/download-json      template.json
GET  /jobs/:id/download-zip       template-kit.zip
GET  /jobs                        danh sách job (dashboard)
GET  /jobs/:id/ir                 Page IR
POST /jobs/:id/regenerate         sửa IR → sinh lại Bricks JSON (chỉnh mapping)
```

Dashboard cho phép: xem screenshot gốc, xem detected sections (overlay box), xem cây Bricks structure, sửa Page IR rồi regenerate, xem điểm validation, download JSON/ZIP.

## Import vào Bricks Builder

1. WordPress → Bricks → Templates → **Import Templates** → chọn `template.json` (hoặc cả `template-kit.zip` — zip đã được thiết kế chỉ chứa đúng 1 file .json nên chỉ tạo **1 template**).
2. Template xuất hiện trong **My Templates** với tên dạng `example.com (CDP generated)`.
3. Import **không tự tạo trang**: tạo Page mới → **Edit with Bricks** → mở template library → insert template vừa import → Save.

> ⚠️ Bricks coi mỗi file `.json` trong zip là 1 template riêng. Vì vậy các file trung gian trong kit (`page-ir`, `analysis-report`, `validation-report`) được đổi đuôi thành `.json.txt` và nằm trong thư mục `meta/` — muốn dùng lại thì bỏ đuôi `.txt`.

## Ghi chú MVP so với kiến trúc production

| Thành phần | MVP hiện tại | Production (theo ARCHITECTURE) |
|---|---|---|
| Queue | In-memory queue (concurrency qua `WORKER_CONCURRENCY`) | BullMQ + Redis |
| Database | `storage/db.json` (đủ 5 bảng theo §18) | PostgreSQL |
| Preview validation | Render HTML xấp xỉ từ Bricks JSON + screenshot diff | WordPress staging render (MVP 3) |
| Assets | Giữ remote URL (status `remote`) | Upload WordPress Media Library (MVP 4) |
| Vision analyzer | Heuristic (pixel sampling + box model + rule engine §21) | Có thể thay bằng vision model |

## Lưu ý pháp lý

Chỉ dùng cho website của bạn / khách hàng đã cho phép / rebuild nội bộ / mục đích học tập (xem ARCHITECTURE §25).
