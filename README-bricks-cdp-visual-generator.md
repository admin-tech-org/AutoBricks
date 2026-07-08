# Bricks CDP Visual Generator

## Mục tiêu

Dự án này nhằm tạo một hệ thống có thể đọc một website đã render thực tế trong browser, chụp màn hình bằng CDP/Playwright, phân tích giao diện bằng hình ảnh, DOM, CSS và layout metrics, sau đó sinh ra file **Bricks Builder JSON** có thể import vào WordPress Bricks Builder.

Điểm quan trọng: hệ thống **không chỉ đọc HTML** và cũng **không chỉ dùng AI nhìn ảnh để đoán toàn bộ**.

Hướng đúng là:

```text
Screenshot + DOM + Computed CSS + Bounding Box
↓
Page Intermediate Representation (Page IR)
↓
Bricks Builder JSON
```

## Nguyên tắc thiết kế

```text
DOM là source of truth cho content.
Screenshot là source of truth cho visual structure.
Computed CSS là source of truth cho style.
Bounding box là source of truth cho position và spacing.
Page IR là source of truth trước khi sinh Bricks JSON.
```

Nói cách khác:

```text
HTML tells WHAT exists.
Screenshot tells HOW it looks.
CSS/layout metrics tell WHERE and HOW BIG it is.
```

## Vì sao không convert HTML trực tiếp sang Bricks JSON?

HTML của website thật thường rất rối:

```text
div
└── div
    └── div
        └── div
            └── h1
```

Nếu convert trực tiếp, output Bricks sẽ khó chỉnh sửa và không giống cách người dùng xây dựng layout trong Bricks.

Mục tiêu của hệ thống là tạo cấu trúc Bricks sạch:

```text
Section
└── Container
    └── Heading
```

Hoặc với hero 2 cột:

```text
Section
└── Container
    └── Container: row
        ├── Container: left column
        │   ├── Heading
        │   ├── Text Basic
        │   └── Button
        └── Container: right column
            └── Image
```

## Tổng quan pipeline

```text
User nhập URL
↓
API Server tạo generate job
↓
Browser Worker mở website bằng CDP/Playwright
↓
Capture:
  - Desktop screenshot
  - Tablet screenshot
  - Mobile screenshot
  - Full-page screenshot
  - DOM tree
  - Computed CSS
  - Bounding box
  - Asset list
↓
Vision Analyzer phân tích ảnh
↓
DOM Analyzer phân tích nội dung
↓
Layout Merger gộp screenshot + DOM + CSS + box model
↓
Page IR
↓
Bricks Planner
↓
Bricks JSON Generator
↓
Validator
↓
Export .json / .zip
↓
Preview + screenshot diff
↓
User tải file để import vào Bricks Builder
```

## Input

Input cơ bản:

```json
{
  "url": "https://example.com",
  "mode": "landing-page",
  "viewports": ["desktop", "tablet", "mobile"],
  "output": "bricks-json"
}
```

Viewport đề xuất:

```text
desktop: 1440x900
tablet:  768x1024
mobile:  390x844
```

## Output

Output chính:

```text
output/
├── screenshots/
│   ├── desktop.png
│   ├── tablet.png
│   ├── mobile.png
│   └── full-page.png
│
├── snapshots/
│   ├── dom.json
│   ├── css.json
│   ├── layout.json
│   └── assets.json
│
├── ir/
│   └── page-ir.json
│
├── bricks-json/
│   └── template.json
│
├── kits/
│   └── template-kit.zip
│
└── reports/
    └── analysis-report.json
```

## Bricks JSON output

Bricks Builder template JSON nên được sinh theo dạng flat array:

```json
{
  "content": [
    {
      "id": "sec_hero",
      "name": "section",
      "parent": 0,
      "children": ["con_hero"],
      "settings": {}
    },
    {
      "id": "con_hero",
      "name": "container",
      "parent": "sec_hero",
      "children": ["heading_hero", "text_hero", "button_hero"],
      "settings": {}
    },
    {
      "id": "heading_hero",
      "name": "heading",
      "parent": "con_hero",
      "children": [],
      "settings": {
        "text": "Build faster websites"
      }
    }
  ],
  "source": "cdpVisualGenerated"
}
```

Generator phải đảm bảo:

```text
- ID unique
- Parent tồn tại
- Children tồn tại
- Không có parent-child loop
- Element name hợp lệ
- Settings không chứa undefined/null lỗi
- JSON có thể import được vào Bricks Builder
```

## Element hỗ trợ trong MVP

MVP nên bắt đầu với các element phổ biến nhất:

```text
- section
- container
- block
- heading
- text-basic
- text
- button
- image
- icon
- divider
```

Layout hỗ trợ trong MVP:

```text
- one-column section
- centered hero
- two-column hero
- three-card grid
- simple feature section
- simple CTA section
- simple footer
```

Chưa nên hỗ trợ trong MVP:

```text
- slider phức tạp
- animation
- query loop
- WooCommerce
- mega menu
- form nâng cao
- dynamic data
```

## Page IR

Không nên sinh Bricks JSON trực tiếp từ HTML. Cần tạo một lớp trung gian gọi là **Page IR**.

Ví dụ:

```json
{
  "url": "https://example.com",
  "pageType": "landing-page",
  "theme": {
    "style": "modern SaaS",
    "mode": "light",
    "primaryColor": "#635BFF",
    "backgroundColor": "#FFFFFF",
    "textColor": "#111827",
    "fontFamily": "Inter",
    "radius": "16px",
    "sectionPaddingY": "96px",
    "containerMaxWidth": "1200px"
  },
  "sections": [
    {
      "type": "hero",
      "layout": "two-column",
      "visualRole": "main-intro",
      "children": [
        {
          "type": "heading",
          "level": "h1",
          "text": "Build faster websites",
          "styleRole": "hero-title"
        },
        {
          "type": "text",
          "text": "Create beautiful websites visually.",
          "styleRole": "hero-subtitle"
        },
        {
          "type": "button",
          "text": "Get started",
          "href": "/signup",
          "styleRole": "primary-cta"
        },
        {
          "type": "image",
          "src": "https://example.com/hero.png",
          "styleRole": "hero-image"
        }
      ]
    }
  ]
}
```

## Quy tắc ưu tiên dữ liệu

| Dữ liệu cần quyết định | Nguồn ưu tiên |
|---|---|
| Text content | DOM |
| Link URL | DOM |
| Image source | DOM/CSS |
| Section layout | Screenshot + bounding box |
| Grid/card count | Screenshot + DOM |
| Font size | Computed CSS |
| Color | Computed CSS + screenshot |
| Theme style | Screenshot |
| Responsive behavior | Multi-viewport screenshot |
| Spacing | Bounding box + screenshot |
| Component semantic | Screenshot + DOM role/tag |

## Validation

Có 2 lớp validation.

### 1. JSON validation

```text
- content phải là array
- mỗi element có id
- mỗi element có name
- mỗi element có parent
- mỗi element có children
- mọi parent ID phải tồn tại, trừ parent = 0
- mọi children ID phải tồn tại
- không có duplicate ID
- không có vòng lặp parent-child
- element name nằm trong whitelist
```

### 2. Visual validation

Sau khi sinh Bricks JSON:

```text
Original website screenshot
↓
Generated Bricks preview screenshot
↓
Screenshot diff
↓
Score + warnings
```

So sánh:

```text
- section count
- heading hierarchy
- heading position
- button position
- image placement
- color similarity
- spacing similarity
- grid/card layout
- mobile stacking
```

Report ví dụ:

```json
{
  "score": 0.82,
  "layoutScore": 0.86,
  "colorScore": 0.91,
  "spacingScore": 0.74,
  "contentScore": 0.98,
  "warnings": [
    "Hero image ratio approximated",
    "Mobile menu not generated",
    "Background gradient simplified"
  ]
}
```

## Phase phát triển

### Phase 1 — Basic generator

```text
URL → screenshot + DOM + CSS → Page IR → Bricks JSON
```

Hỗ trợ:

```text
- section
- container
- heading
- text-basic
- button
- image
- background color
- basic spacing
```

### Phase 2 — Theme and responsive

```text
- detect color system
- detect font scale
- detect spacing scale
- detect card style
- detect border radius
- detect background image/gradient
- detect mobile stacking
```

### Phase 3 — Preview and screenshot diff

```text
- render generated Bricks page trong WordPress staging
- capture generated screenshot
- compare với original screenshot
- generate validation score
- tự động tinh chỉnh spacing/style nếu cần
```

### Phase 4 — Bricks-native optimization

```text
- global classes
- CSS variables
- theme styles
- reusable sections
- header/footer template
- clean editable structure
```

## Cảnh báo pháp lý và đạo đức

Hệ thống này nên dùng cho:

```text
- Website của chính bạn
- Website khách hàng đã cho phép
- Internal design migration
- Rebuild layout hợp pháp
- Prototype / testing / educational use
```

Không nên dùng để sao chép trái phép website, thương hiệu, hình ảnh, text hoặc thiết kế có bản quyền.

## Cách mô tả dự án ngắn gọn

```text
Bricks CDP Visual Generator là hệ thống dùng CDP/Playwright để render website thật trong browser, chụp màn hình, trích xuất DOM/CSS/layout metrics, phân tích visual structure và theme, sau đó merge dữ liệu thành Page IR rồi sinh Bricks Builder JSON sạch, import được và dễ chỉnh sửa.
```
