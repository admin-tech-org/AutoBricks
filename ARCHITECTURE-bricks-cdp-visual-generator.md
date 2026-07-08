# 架構 — Bricks CDP Visual Generator

## 1. 系統總覽

本系統的設計目標是透過結合來自 browser 的視覺資料與技術資料，將一個已實際 render 的 website 轉換成 Bricks Builder template JSON。

整體流程：

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

## 2. 三個主要層級

```text
1. Capture Layer
   使用 CDP/Playwright 開啟 website、擷取螢幕截圖、取得 DOM、CSS、box model。

2. Intelligence Layer
   分析 screenshot + DOM + CSS 以理解 layout、theme、section、component。

3. Generation Layer
   將分析結果轉換成 Bricks Builder .json / .zip。
```

## 3. 系統元件

```text
bricks-cdp-visual-generator
│
├── API Server
│   ├── 接收 URL
│   ├── 建立 job
│   ├── 回傳 job 狀態
│   └── 回傳 .json / .zip 檔案
│
├── Queue
│   └── 以 worker 處理繁重的 job
│
├── Browser Worker
│   ├── 以 CDP 開啟 Chrome
│   ├── 設定 viewport
│   ├── 捲動 page
│   ├── 擷取 screenshot
│   └── 擷取 DOM/CSS/layout
│
├── Analyzer Worker
│   ├── 分析 screenshot
│   ├── 偵測 section
│   ├── 偵測 theme
│   ├── 偵測 layout
│   ├── 分類 component
│   └── 與 DOM 合併
│
├── Bricks Generator
│   ├── 建立 element tree
│   ├── 扁平化成 Bricks content array
│   ├── 將 style 映射成 Bricks settings
│   └── 匯出 JSON/ZIP
│
├── Validator
│   ├── 檢查 JSON
│   ├── 檢查 parent/children
│   ├── 檢查 element name
│   ├── 檢查缺少的 asset
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
    ├── 檢視原始 screenshot
    ├── 檢視偵測到的 sections
    ├── 調整 mapping
    ├── 預覽 Bricks structure
    └── 下載 template
```

## 4. API Server

API Server 接收來自 user 的 generate 請求並建立 job。

建議的 endpoint：

```text
POST /jobs
GET  /jobs/:id
GET  /jobs/:id/report
GET  /jobs/:id/download-json
GET  /jobs/:id/download-zip
```

Request 範例：

```json
{
  "url": "https://example.com",
  "mode": "landing-page",
  "viewports": ["desktop", "tablet", "mobile"],
  "output": "bricks-json"
}
```

Response 範例：

```json
{
  "jobId": "job_123",
  "status": "queued"
}
```

## 5. Queue 設計

不在 request 中直接處理，因為 capture browser、影像分析與 generate template 可能相當耗時。

Queue 流程：

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

建議的技術堆疊：

```text
- Node.js / TypeScript
- Playwright 或 Puppeteer CDP
- BullMQ + Redis
- PostgreSQL
- S3-compatible storage 或 local filesystem
- 用於 preview validation 的 WordPress staging site
```

## 6. Capture Layer

Capture Layer 使用真實的 browser 開啟 website，以取得 browser render 完成後的資料。

### 輸入

```text
- URL
- Viewport config
- Capture options
- Wait strategy
- Scroll strategy
```

### 輸出

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

### 需要擷取的資料

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

## 7. Browser 擷取流程

```text
1. 啟動 Chromium
2. 建立 browser context
3. 設定 viewport
4. 開啟 URL
5. 等待 network idle / DOM loaded
6. 盡可能關閉常見的 cookie/modal overlay
7. 捲動 page 以觸發 assets 的 lazy-load
8. 擷取 viewport screenshot
9. 擷取 full-page screenshot
10. 擷取 DOM tree
11. 擷取 computed styles
12. 擷取 bounding boxes
13. 擷取 assets
14. 儲存 snapshots
```

## 8. Vision Analyzer

Vision Analyzer 使用 screenshot 來理解介面，而非用來取得主要 text。

Screenshot 用於確認：

```text
- Website 屬於哪一種類型？
- 哪個 section 是 hero？
- 哪個 section 是 feature？
- 哪個 section 是 pricing/testimonial/footer？
- Layout 是單欄、雙欄、grid 還是 card？
- 主色調是什麼？
- 主要 button 位於哪裡？
- Card count 是否正確？
- Header/footer 是否存在？
- Mobile layout 是否會 stack？
```

輸出範例：

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

DOM Analyzer 從 DOM 取得真實資料。

DOM 用於：

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

輸出範例：

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

Layout Merger 是決定 output 品質的關鍵部分。

它會整合：

```text
Screenshot analysis
+
DOM nodes
+
Computed CSS
+
Bounding boxes
```

成為 **Page IR**。

不會直接從 HTML 產生 Bricks JSON。

## 11. Page IR schema

Page IR 是一種可 debug 的中間格式。

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

## 12. Page IR 範例

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

Bricks Planner 將 Page IR 轉換成乾淨、易於編輯的 Bricks 結構。

Page IR 範例：

```text
Hero section, two columns, heading, text, button, image
```

Bricks 結構：

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

Planner 不得複製垃圾 DOM。它必須 normalize 成合理的 component structure。

## 14. Bricks JSON Generator

Bricks JSON Generator 將 Bricks plan 轉換成扁平的 content array。

Bricks element 型別：

```ts
type BricksElement = {
  id: string;
  name: string;
  parent: string | 0;
  children: string[];
  settings: Record<string, any>;
};
```

輸出範例：

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

Style Mapper 不應複製整份 CSS。它需要將 CSS normalize 成適合 Bricks 的 settings。

優先映射重要的 style：

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

normalize 範例：

```text
原始 CSS:
font-size: 63.734px;
line-height: 71.982px;
margin-top: 17px;

Normalize:
font-size: 64px;
line-height: 1.12;
margin-top: 16px;
```

## 16. Asset Pipeline

圖片與 background 需要獨立處理。

建議的 pipeline：

```text
1. 從 DOM/CSS 擷取 image src/background-image
2. 下載 asset
3. 上傳至 WordPress Media Library
4. 取得 attachment ID
5. 將 attachment ID 寫入 Bricks JSON
```

MVP 可以使用 remote URL，但 production 版本應上傳至 WordPress Media Library。

## 17. Validator

### JSON Validator

檢查項目：

```text
- JSON 可正常 parse
- 存在 content key
- content 為 array
- 所有 id 皆 unique
- 所有 parent 皆存在，parent = 0 除外
- 所有 children 皆存在
- 不存在 parent-child 迴圈
- element name 位於 whitelist 之中
- settings 不包含 undefined
```

MVP 的 whitelist：

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

流程：

```text
原始 website screenshot
↓
產生 Bricks JSON
↓
在 WordPress/Bricks staging 中 import/render 產生的 page
↓
擷取產生的 screenshot
↓
比較原始版本與產生版本
↓
若 layout/顏色/spacing 偏差過大 → 回報 warnings 或微調 JSON
```

比較項目：

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

## 18. 資料庫設計

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

## 19. Repo 結構

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

## 20. Worker 職責

### Capture Worker

```text
- 接收 job URL
- 開啟 browser
- 設定 viewport
- 擷取 screenshot
- 擷取 DOM/CSS/layout
- 儲存 snapshots
```

### Analyze Worker

```text
- 讀取 screenshot
- 偵測 theme
- 偵測 sections
- 偵測 layout
- 分類 components
- 與 DOM/CSS/box 合併
- 建立 Page IR
```

### Generate Worker

```text
- 讀取 Page IR
- 建立 Bricks plan
- 映射 Bricks elements
- 映射 style settings
- 產生 JSON
- 寫入 JSON/ZIP
```

### Validate Worker

```text
- 驗證 JSON
- 若有 WordPress staging 則 import/render preview
- screenshot diff
- 建立 validation report
```

## 21. 規則引擎

一些基本的 rule：

```text
若 block 為 full-width 且高度 > 250px
→ section

若 block 置中且 max-width 介於 1000px 到 1400px
→ container

若多個 child 具有相同尺寸且水平排列
→ grid 或 flex row

若 text 是 viewport 中最大且靠近 top
→ hero heading

若 a/button 具有 padding、background 或 border
→ button

若 img/picture/svg 很大且佔據相當可觀的 visual area
→ image

若有多個相同的 card
→ card grid
```

## 22. 來源優先順序矩陣

| 情境 | 優先來源 |
|---|---|
| 文字內容 | DOM |
| 連結 URL | DOM |
| 圖片來源 | DOM/CSS |
| Layout section | Screenshot + bounding box |
| Grid/card 數量 | Screenshot + DOM |
| 字型大小 | Computed CSS |
| 顏色 | Computed CSS + screenshot |
| Theme 樣式 | Screenshot |
| 響應式行為 | Multi-viewport screenshot |
| 間距 | Bounding box + screenshot |
| Component 語意 | Screenshot + DOM role/tag |

## 23. MVP 藍圖

### MVP 1

```text
URL → screenshot + DOM + CSS → Page IR → Bricks JSON
```

支援：

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

## 24. 早期版本的非目標

初版不應立即實作：

```text
- Clone 整個多頁面的 website
- WooCommerce dynamic template
- 複雜的 Query Loop
- Mega menu
- Slider animation
- 進階 Form
- 100% visual-perfect reconstruction
```

## 25. 安全與法律考量

本系統具備分析與重建介面的能力，因此需要將使用限制在合法範圍內。

適合用於：

```text
- 使用者自己的 website
- 已獲授權的客戶 website
- 內部重建 / 遷移
- 原型 / 測試
- 教育用途
```

不應用於未經授權的複製：

```text
- Branding
- Copywriting
- 有版權的圖片
- 商業 template
- 未經授權的第三方 website
```

## 26. 一句話架構總結

```text
本系統使用 CDP 在 browser 中 render 真實的 website、擷取螢幕截圖並提取 DOM/CSS/layout。Screenshot 用於確認介面結構與主題，DOM 提供內容，CSS/layout 提供 style 與位置。所有資料會被 merge 成 Page IR，接著 Page IR 會被轉換成乾淨、可 import 且易於編輯的 Bricks Builder JSON。
```
