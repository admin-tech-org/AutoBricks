# Architecture — Bricks CDP Visual Generator

## 1. Tổng quan hệ thống

Hệ thống được thiết kế để chuyển một website đã render thực tế thành Bricks Builder template JSON bằng cách kết hợp dữ liệu thị giác và dữ liệu kỹ thuật từ browser.

Luồng tổng quát:

```text
Input URL
↓
Job API
↓
Queue
↓
Browser Capture Worker
↓
Visual Analyzer
↓
DOM/CSS Analyzer
↓
Layout Merger
↓
Page IR
↓
Bricks Planner
↓
Bricks JSON Generator
↓
Validator
↓
Exporter
↓
Preview + Screenshot Diff
```

## 2. Ba lớp chính

```text
1. Capture Layer
   Dùng CDP/Playwright để mở website, chụp màn hình, lấy DOM, CSS, box model.

2. Intelligence Layer
   Phân tích screenshot + DOM + CSS để hiểu layout, theme, section, component.

3. Generation Layer
   Chuyển kết quả phân tích thành Bricks Builder .json / .zip.
```

## 3. System components

```text
bricks-cdp-visual-generator
│
├── API Server
│   ├── nhận URL
│   ├── tạo job
│   ├── trả trạng thái job
│   └── trả file .json / .zip
│
├── Queue
│   └── xử lý job nặng bằng worker
│
├── Browser Worker
│   ├── mở Chrome bằng CDP
│   ├── set viewport
│   ├── scroll page
│   ├── chụp screenshot
│   └── extract DOM/CSS/layout
│
├── Analyzer Worker
│   ├── phân tích screenshot
│   ├── detect section
│   ├── detect theme
│   ├── detect layout
│   ├── classify component
│   └── merge với DOM
│
├── Bricks Generator
│   ├── tạo element tree
│   ├── flatten thành Bricks content array
│   ├── map style sang Bricks settings
│   └── export JSON/ZIP
│
├── Validator
│   ├── check JSON
│   ├── check parent/children
│   ├── check element name
│   ├── check missing asset
│   └── screenshot diff
│
├── Storage
│   ├── screenshots
│   ├── snapshots
│   ├── Page IR
│   ├── generated JSON
│   └── reports
│
└── Dashboard
    ├── xem screenshot gốc
    ├── xem detected sections
    ├── chỉnh mapping
    ├── preview Bricks structure
    └── download template
```

## 4. API Server

API Server nhận yêu cầu generate từ user và tạo job.

Endpoint đề xuất:

```text
POST /jobs
GET  /jobs/:id
GET  /jobs/:id/report
GET  /jobs/:id/download-json
GET  /jobs/:id/download-zip
```

Request ví dụ:

```json
{
  "url": "https://example.com",
  "mode": "landing-page",
  "viewports": ["desktop", "tablet", "mobile"],
  "output": "bricks-json"
}
```

Response ví dụ:

```json
{
  "jobId": "job_123",
  "status": "queued"
}
```

## 5. Queue design

Không xử lý trực tiếp trong request vì capture browser, phân tích ảnh và generate template có thể tốn thời gian.

Luồng queue:

```text
API Server
↓
Queue
↓
Capture Worker
↓
Analyze Worker
↓
Generate Worker
↓
Validate Worker
↓
Export Worker
```

Stack đề xuất:

```text
- Node.js / TypeScript
- Playwright hoặc Puppeteer CDP
- BullMQ + Redis
- PostgreSQL
- S3-compatible storage hoặc local filesystem
- WordPress staging site cho preview validation
```

## 6. Capture Layer

Capture Layer mở website bằng browser thật để lấy dữ liệu sau khi browser đã render.

### Input

```text
- URL
- Viewport config
- Capture options
- Wait strategy
- Scroll strategy
```

### Output

```text
screenshots/
├── desktop.png
├── tablet.png
├── mobile.png
└── full-page.png

snapshots/
├── dom.json
├── css.json
├── layout.json
└── assets.json
```

### Dữ liệu cần capture

```text
1. Screenshot
   - viewport screenshot
   - full-page screenshot

2. DOM
   - tag name
   - text
   - href
   - src
   - aria-label
   - role
   - class
   - id

3. Computed CSS
   - display
   - position
   - width
   - height
   - margin
   - padding
   - gap
   - color
   - background
   - font
   - border
   - box-shadow
   - border-radius

4. Layout box
   - x
   - y
   - width
   - height

5. Asset
   - image src
   - background-image
   - svg
   - font
```

## 7. Browser capture flow

```text
1. Launch Chromium
2. Create browser context
3. Set viewport
4. Open URL
5. Wait for network idle / DOM loaded
6. Dismiss common cookie/modal overlays nếu có thể
7. Scroll page để lazy-load assets
8. Capture viewport screenshot
9. Capture full-page screenshot
10. Extract DOM tree
11. Extract computed styles
12. Extract bounding boxes
13. Extract assets
14. Save snapshots
```

## 8. Vision Analyzer

Vision Analyzer dùng screenshot để hiểu giao diện, không dùng để lấy text chính.

Screenshot dùng để xác nhận:

```text
- Website thuộc kiểu gì?
- Section nào là hero?
- Section nào là feature?
- Section nào là pricing/testimonial/footer?
- Layout là 1 cột, 2 cột, grid hay card?
- Màu chủ đạo là gì?
- Button chính nằm ở đâu?
- Card count có đúng không?
- Header/footer có tồn tại không?
- Mobile layout có stack không?
```

Output ví dụ:

```json
{
  "pageType": "saas-landing-page",
  "theme": {
    "style": "modern minimal",
    "mode": "light",
    "primaryColor": "#635BFF",
    "backgroundColor": "#FFFFFF",
    "textColor": "#111827",
    "borderRadius": "16px",
    "fontStyle": "modern sans-serif"
  },
  "sections": [
    {
      "id": "visual_sec_hero",
      "type": "hero",
      "layout": "two-column",
      "box": {
        "x": 0,
        "y": 80,
        "width": 1440,
        "height": 680
      },
      "confidence": 0.91
    },
    {
      "id": "visual_sec_features",
      "type": "features",
      "layout": "three-card-grid",
      "confidence": 0.87
    }
  ]
}
```

## 9. DOM Analyzer

DOM Analyzer lấy dữ liệu thật từ DOM.

Dùng DOM cho:

```text
- Heading text
- Paragraph text
- Button text
- Link URL
- Image URL
- Alt text
- Form fields
- Navigation items
- Semantic tags
```

Output ví dụ:

```json
{
  "nodes": [
    {
      "id": "dom_101",
      "tag": "h1",
      "text": "Build faster websites",
      "box": {
        "x": 160,
        "y": 230,
        "width": 620,
        "height": 86
      },
      "style": {
        "fontSize": "64px",
        "fontWeight": "700",
        "color": "#111827"
      }
    },
    {
      "id": "dom_102",
      "tag": "a",
      "text": "Get started",
      "href": "/signup",
      "box": {
        "x": 160,
        "y": 460,
        "width": 140,
        "height": 48
      }
    }
  ]
}
```

## 10. Layout Merger

Layout Merger là phần quyết định chất lượng output.

Nó gộp:

```text
Screenshot analysis
+
DOM nodes
+
Computed CSS
+
Bounding boxes
```

thành **Page IR**.

Không sinh Bricks JSON trực tiếp từ HTML.

## 11. Page IR schema

Page IR là format trung gian có thể debug được.

```ts
type PageIR = {
  url: string;
  pageType: string;
  theme: ThemeIR;
  sections: SectionIR[];
};

type ThemeIR = {
  style?: string;
  mode?: "light" | "dark";
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  fontFamily?: string;
  radius?: string;
  sectionPaddingY?: string;
  containerMaxWidth?: string;
};

type SectionIR = {
  id: string;
  type: string;
  layout: string;
  visualRole?: string;
  box?: Box;
  children: ComponentIR[];
  confidence?: number;
};

type ComponentIR = {
  id: string;
  type: string;
  text?: string;
  href?: string;
  src?: string;
  level?: "h1" | "h2" | "h3" | "h4";
  styleRole?: string;
  box?: Box;
  style?: Record<string, string>;
};

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};
```

## 12. Example Page IR

```json
{
  "url": "https://example.com",
  "pageType": "landing-page",
  "theme": {
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
      "id": "hero",
      "type": "hero",
      "layout": "two-column",
      "children": [
        {
          "id": "hero_title",
          "type": "heading",
          "level": "h1",
          "text": "Build faster websites",
          "styleRole": "hero-title"
        },
        {
          "id": "hero_text",
          "type": "text",
          "text": "Create beautiful websites visually.",
          "styleRole": "hero-subtitle"
        },
        {
          "id": "hero_cta",
          "type": "button",
          "text": "Get started",
          "href": "/signup",
          "styleRole": "primary-cta"
        },
        {
          "id": "hero_image",
          "type": "image",
          "src": "https://example.com/hero.png",
          "styleRole": "hero-image"
        }
      ]
    }
  ]
}
```

## 13. Bricks Planner

Bricks Planner chuyển Page IR thành cấu trúc Bricks sạch, dễ chỉnh sửa.

Ví dụ Page IR:

```text
Hero section, two columns, heading, text, button, image
```

Bricks structure:

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

Planner không được copy DOM rác. Nó phải normalize thành component structure hợp lý.

## 14. Bricks JSON Generator

Bricks JSON Generator biến Bricks plan thành flat content array.

Bricks element type:

```ts
type BricksElement = {
  id: string;
  name: string;
  parent: string | 0;
  children: string[];
  settings: Record<string, any>;
};
```

Output example:

```json
{
  "content": [
    {
      "id": "sec_hero",
      "name": "section",
      "parent": 0,
      "children": ["con_hero"]
    },
    {
      "id": "con_hero",
      "name": "container",
      "parent": "sec_hero",
      "children": ["row_hero"]
    },
    {
      "id": "row_hero",
      "name": "container",
      "parent": "con_hero",
      "children": ["col_left", "col_right"],
      "settings": {
        "direction": "row"
      }
    }
  ],
  "source": "cdpVisualGenerated"
}
```

## 15. Style Mapper

Style Mapper không nên copy toàn bộ CSS. Nó cần normalize CSS thành Bricks-friendly settings.

Map trước các style quan trọng:

```text
Typography:
- font-family
- font-size
- font-weight
- line-height
- letter-spacing
- color

Layout:
- display
- flex-direction
- justify-content
- align-items
- gap
- width
- max-width
- padding
- margin

Visual:
- background-color
- background-image
- border-radius
- border
- box-shadow
```

Ví dụ normalize:

```text
CSS gốc:
font-size: 63.734px;
line-height: 71.982px;
margin-top: 17px;

Normalize:
font-size: 64px;
line-height: 1.12;
margin-top: 16px;
```

## 16. Asset Pipeline

Ảnh và background cần xử lý riêng.

Pipeline đề xuất:

```text
1. Extract image src/background-image từ DOM/CSS
2. Download asset
3. Upload vào WordPress Media Library
4. Lấy attachment ID
5. Ghi attachment ID vào Bricks JSON
```

MVP có thể dùng remote URL, nhưng bản production nên upload vào WordPress Media Library.

## 17. Validator

### JSON Validator

Kiểm tra:

```text
- JSON parse được
- Có key content
- content là array
- mọi id unique
- mọi parent tồn tại, trừ parent = 0
- mọi children tồn tại
- không có vòng lặp parent-child
- element name nằm trong whitelist
- settings không chứa undefined
```

Whitelist MVP:

```ts
const ALLOWED_ELEMENTS = [
  "section",
  "container",
  "block",
  "heading",
  "text-basic",
  "text",
  "button",
  "image",
  "icon",
  "divider"
];
```

### Visual Validator

Luồng:

```text
Original website screenshot
↓
Generate Bricks JSON
↓
Import/render generated page trong WordPress/Bricks staging
↓
Capture generated screenshot
↓
Compare original vs generated
↓
Nếu lệch layout/màu/spacing quá nhiều → report warnings hoặc tinh chỉnh JSON
```

So sánh:

```text
- Section count
- Hero layout
- Heading hierarchy
- Button position
- Image placement
- Color similarity
- Spacing similarity
- Mobile stacking
- Card/grid count
```

## 18. Database design

### jobs

```text
id
url
status
mode
created_at
updated_at
error_message
```

### captures

```text
id
job_id
viewport
screenshot_path
dom_snapshot_path
css_snapshot_path
layout_snapshot_path
created_at
```

### analysis_reports

```text
id
job_id
page_type
theme_json
sections_json
confidence_json
created_at
```

### generated_templates

```text
id
job_id
json_path
zip_path
bricks_json
validation_score
created_at
```

### assets

```text
id
job_id
original_url
local_path
wordpress_attachment_id
type
status
```

## 19. Repo structure

```text
bricks-cdp-visual-generator/
│
├── apps/
│   ├── api/
│   │   ├── routes/
│   │   ├── controllers/
│   │   └── server.ts
│   │
│   └── dashboard/
│       ├── pages/
│       ├── components/
│       └── app.tsx
│
├── packages/
│   ├── capture/
│   │   ├── browser.ts
│   │   ├── capture-url.ts
│   │   ├── screenshot.ts
│   │   ├── dom.ts
│   │   ├── css.ts
│   │   └── layout.ts
│   │
│   ├── analyzer/
│   │   ├── analyze-screenshot.ts
│   │   ├── detect-theme.ts
│   │   ├── detect-sections.ts
│   │   ├── detect-layout.ts
│   │   └── classify-components.ts
│   │
│   ├── ir/
│   │   ├── types.ts
│   │   ├── create-page-ir.ts
│   │   ├── merge-dom-vision.ts
│   │   └── normalize-ir.ts
│   │
│   ├── bricks/
│   │   ├── types.ts
│   │   ├── create-element.ts
│   │   ├── map-section.ts
│   │   ├── map-style.ts
│   │   ├── generate-json.ts
│   │   └── validate-json.ts
│   │
│   ├── export/
│   │   ├── write-json.ts
│   │   └── write-zip.ts
│   │
│   └── validation/
│       ├── render-preview.ts
│       ├── screenshot-diff.ts
│       └── score.ts
│
├── workers/
│   ├── capture-worker.ts
│   ├── analyze-worker.ts
│   └── generate-worker.ts
│
├── storage/
│   ├── screenshots/
│   ├── snapshots/
│   ├── ir/
│   ├── templates/
│   └── reports/
│
├── package.json
└── README.md
```

## 20. Worker responsibilities

### Capture Worker

```text
- nhận job URL
- mở browser
- set viewport
- chụp screenshot
- extract DOM/CSS/layout
- lưu snapshots
```

### Analyze Worker

```text
- đọc screenshot
- detect theme
- detect sections
- detect layout
- classify components
- merge với DOM/CSS/box
- tạo Page IR
```

### Generate Worker

```text
- đọc Page IR
- tạo Bricks plan
- map Bricks elements
- map style settings
- generate JSON
- write JSON/ZIP
```

### Validate Worker

```text
- validate JSON
- import/render preview nếu có WordPress staging
- screenshot diff
- tạo validation report
```

## 21. Rule engine

Một số rule cơ bản:

```text
Nếu block full-width và cao > 250px
→ section

Nếu block nằm giữa và max-width từ 1000px đến 1400px
→ container

Nếu nhiều child có cùng kích thước và nằm ngang
→ grid hoặc flex row

Nếu text lớn nhất viewport và nằm gần top
→ hero heading

Nếu a/button có padding, background hoặc border
→ button

Nếu img/picture/svg lớn và chiếm visual area đáng kể
→ image

Nếu nhiều card giống nhau
→ card grid
```

## 22. Source priority matrix

| Trường hợp | Nguồn ưu tiên |
|---|---|
| Text content | DOM |
| Link URL | DOM |
| Image source | DOM/CSS |
| Layout section | Screenshot + bounding box |
| Grid/card count | Screenshot + DOM |
| Font size | Computed CSS |
| Color | Computed CSS + screenshot |
| Theme style | Screenshot |
| Responsive behavior | Multi-viewport screenshot |
| Spacing | Bounding box + screenshot |
| Component semantic | Screenshot + DOM role/tag |

## 23. MVP roadmap

### MVP 1

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

### MVP 2

```text
- theme detector
- responsive mobile detector
- card/grid detector
- color scale
- font scale
- spacing scale
```

### MVP 3

```text
- WordPress staging render
- screenshot diff
- validation score
- warning report
```

### MVP 4

```text
- global classes
- CSS variables
- Bricks theme styles
- reusable header/footer
- asset upload to WordPress Media Library
```

## 24. Non-goals for early version

Không nên làm ngay ở bản đầu:

```text
- Clone toàn bộ website nhiều trang
- WooCommerce dynamic template
- Query Loop phức tạp
- Mega menu
- Slider animation
- Form nâng cao
- 100% visual-perfect reconstruction
```

## 25. Security and legal considerations

Hệ thống có khả năng phân tích và tái tạo giao diện, nên cần giới hạn usage hợp pháp.

Nên dùng cho:

```text
- Website của chính người dùng
- Website khách hàng đã cho phép
- Internal rebuild/migration
- Prototype/testing
- Educational use
```

Không nên dùng để sao chép trái phép:

```text
- Branding
- Copywriting
- Hình ảnh có bản quyền
- Template thương mại
- Website của bên thứ ba khi chưa được phép
```

## 26. One-sentence architecture summary

```text
Hệ thống dùng CDP để render website thật trong browser, chụp màn hình và trích xuất DOM/CSS/layout. Screenshot xác nhận cấu trúc giao diện và chủ đề, DOM cung cấp nội dung, CSS/layout cung cấp style và vị trí. Tất cả được merge thành Page IR, sau đó Page IR được convert thành Bricks Builder JSON sạch, import được và dễ chỉnh sửa.
```
