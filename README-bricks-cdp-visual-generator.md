# Bricks CDP Visual Generator

## 目標

本專案旨在建立一套系統，能夠讀取在瀏覽器中實際渲染的網站，透過 CDP/Playwright 擷取螢幕截圖，並運用影像、DOM、CSS 與 layout metrics 分析介面，接著產生可匯入 WordPress Bricks Builder 的 **Bricks Builder JSON** 檔案。

重點在於：這套系統 **不只是讀取 HTML**，也 **不只是用 AI 看圖來猜測整個頁面**。

正確的方向是：

```text
Screenshot + DOM + Computed CSS + Bounding Box
↓
Page Intermediate Representation (Page IR)
↓
Bricks Builder JSON
```

## 設計原則

```text
DOM 是內容的真實來源。
Screenshot 是視覺結構的真實來源。
Computed CSS 是樣式的真實來源。
Bounding box 是位置與間距的真實來源。
Page IR 是產生 Bricks JSON 之前的真實來源。
```

換句話說：

```text
HTML 說明「有什麼」。
Screenshot 說明「看起來如何」。
CSS/layout metrics 說明「在哪裡」以及「有多大」。
```

## 為什麼不直接把 HTML 轉換成 Bricks JSON？

真實網站的 HTML 通常非常雜亂：

```text
div
└── div
    └── div
        └── div
            └── h1
```

如果直接轉換，產生的 Bricks output 會難以編輯，也不符合使用者在 Bricks 中建構 layout 的方式。

這套系統的目標是產生乾淨的 Bricks 結構：

```text
Section
└── Container
    └── Heading
```

或是雙欄的 hero：

```text
Section
└── Container
    └── Container：橫列
        ├── Container：左欄
        │   ├── Heading
        │   ├── Text Basic
        │   └── Button
        └── Container：右欄
            └── Image
```

## Pipeline 總覽

```text
使用者輸入 URL
↓
API Server 建立 generate job
↓
Browser Worker 使用 CDP/Playwright 開啟網站
↓
擷取：
  - Desktop 截圖
  - Tablet 截圖
  - Mobile 截圖
  - 全頁截圖
  - DOM tree
  - Computed CSS
  - Bounding box
  - Asset 清單
↓
Vision Analyzer 分析影像
↓
DOM Analyzer 分析內容
↓
Layout Merger 合併 screenshot + DOM + CSS + box model
↓
Page IR
↓
Bricks Planner
↓
Bricks JSON Generator
↓
Validator
↓
匯出 .json / .zip
↓
預覽 + 截圖差異比對
↓
使用者下載檔案以匯入 Bricks Builder
```

## 輸入

基本輸入：

```json
{
  "url": "https://example.com",
  "mode": "landing-page",
  "viewports": ["desktop", "tablet", "mobile"],
  "output": "bricks-json"
}
```

建議的 Viewport：

```text
desktop: 1440x900
tablet:  768x1024
mobile:  390x844
```

## 輸出

主要輸出：

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

## Bricks JSON 輸出

Bricks Builder template JSON 應以 flat array 的形式產生：

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

Generator 必須確保：

```text
- ID 唯一
- Parent 存在
- Children 存在
- 沒有 parent-child 迴圈
- Element name 合法
- Settings 不包含錯誤的 undefined/null 值
- JSON 可以匯入 Bricks Builder
```

## MVP 支援的 Element

MVP 應從最常見的 element 開始：

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

MVP 支援的 Layout：

```text
- 單欄 section
- 置中 hero
- 雙欄 hero
- 三卡片 grid
- 簡易 feature section
- 簡易 CTA section
- 簡易 footer
```

MVP 中尚不應支援：

```text
- 複雜 slider
- animation
- query loop
- WooCommerce
- mega menu
- 進階 form
- dynamic data
```

## Page IR

不應直接從 HTML 產生 Bricks JSON。需要建立一個稱為 **Page IR** 的中間層。

範例：

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

## 資料優先順序規則

| 需要決定的資料 | 優先來源 |
|---|---|
| 文字內容 | DOM |
| 連結 URL | DOM |
| 圖片來源 | DOM/CSS |
| Section 版面配置 | Screenshot + bounding box |
| Grid/card 數量 | Screenshot + DOM |
| 字型大小 | Computed CSS |
| 顏色 | Computed CSS + screenshot |
| 主題樣式 | Screenshot |
| 響應式行為 | Multi-viewport screenshot |
| 間距 | Bounding box + screenshot |
| 元件語意 | Screenshot + DOM role/tag |

## 驗證

共有兩層驗證。

### 1. JSON 驗證

```text
- content 必須是 array
- 每個 element 都有 id
- 每個 element 都有 name
- 每個 element 都有 parent
- 每個 element 都有 children
- 每個 parent ID 都必須存在，parent = 0 除外
- 每個 children ID 都必須存在
- 沒有重複的 ID
- 沒有 parent-child 迴圈
- element name 必須在 whitelist 之內
```

### 2. 視覺驗證

產生 Bricks JSON 之後：

```text
原始網站截圖
↓
產生的 Bricks 預覽截圖
↓
截圖差異比對
↓
分數 + 警告
```

比較：

```text
- section 數量
- heading 階層
- heading 位置
- button 位置
- image 位置
- 顏色相似度
- 間距相似度
- grid/card 版面配置
- mobile 堆疊
```

報告範例：

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

## 開發階段

### Phase 1 — 基礎產生器

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
- 背景顏色
- 基本間距
```

### Phase 2 — 主題與響應式

```text
- 偵測 color system
- 偵測 font scale
- 偵測 spacing scale
- 偵測 card style
- 偵測 border radius
- 偵測 background image/gradient
- 偵測 mobile stacking
```

### Phase 3 — 預覽與截圖差異比對

```text
- 在 WordPress staging 中渲染產生的 Bricks 頁面
- 擷取產生的截圖
- 與原始截圖比較
- 產生驗證分數
- 必要時自動微調間距/樣式
```

### Phase 4 — Bricks 原生最佳化

```text
- global classes
- CSS variables
- theme styles
- 可重複使用的 section
- header/footer 範本
- 乾淨、可編輯的結構
```

## 法律與道德警告

這套系統適合用於：

```text
- 你自己的網站
- 客戶已授權的網站
- 內部設計遷移
- 合法的版面重建
- 原型 / 測試 / 教育用途
```

不應將其用於非法複製受著作權保護的網站、品牌、圖片、文字或設計。

## 專案簡短描述

```text
Bricks CDP Visual Generator 是一套使用 CDP/Playwright 在瀏覽器中渲染真實網站、擷取螢幕截圖、抽取 DOM/CSS/layout metrics、分析視覺結構與主題，接著將資料合併為 Page IR，再產生乾淨、可匯入且易於編輯的 Bricks Builder JSON 的系統。
```
