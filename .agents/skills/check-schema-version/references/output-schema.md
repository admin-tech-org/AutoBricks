# output_schema

本文件定義 AutoBricks 單頁交付包的結構與識別方式，供 Agent 產品產出、檢查與升級交付包。Bricks 與 Code Snippets 的原生 JSON 格式仍以目標環境版本為準。

## 版本 1

版本 1 是初始版本，沒有前版 migration。根目錄 `output_schema_version` 是目前技能使用的版本檔，Agent 產品完成結構與識別檢查後，將該檔原樣複製至 `output/` 並納入 ZIP。

```text
data/YYYYMMDD-HHMMSS-agent_product-task_name/
├── tmp/
└── output/
    ├── output_schema_version
    ├── page-manifest.json
    ├── template.json
    ├── code-snippets.json
    ├── assets/<asset-folder>/
    ├── snippets/
    ├── replace-domain.py
    ├── rename-assets-folder.py
    ├── report.md
    ├── comparison.html
    ├── screenshots/
    └── YYYYMMDD-HHMMSS-<page-name>-bricks.zip
```

ZIP 解壓後直接得到 `template.json` 等交付檔案，不多包一層任務目錄，不含 ZIP 自身或 `tmp/`。沒有額外程式碼時，`code-snippets.json` 使用目標外掛可接受的空片段清單，`snippets/` 為空；沒有素材時，素材目錄可為空。Agent 產品不為填滿結構產生無用程式碼。

### 頁面與片段識別

Agent 產品建立 `page-manifest.json`，記錄可跨站保留的對應。例如：

```json
{
  "page_key": "ab-page-20260917-012445-codex-newer_art",
  "asset_folder": "newer-art",
  "snippets": [
    {
      "snippet_key": "layout",
      "php_file": "snippets/layout.php",
      "source_file": "snippets/layout.css"
    },
    {
      "snippet_key": "site",
      "php_file": "snippets/site.php",
      "source_file": "snippets/site.js"
    }
  ]
}
```

| 欄位 | 約定 |
| --- | --- |
| `page_key` | 首次重建時使用 `ab-page-` 加當次任務資料夾名稱，建立後固定。搬站、改網址、改素材資料夾或續修不更換。 |
| `asset_folder` | `assets/` 下的單層資料夾名稱，同時對應 `uploads/` 下的部署資料夾。不能包含路徑分隔符或 `..`。 |
| `snippets` | 該頁交付的片段對應清單。沒有片段時為空陣列。 |
| `snippet_key` | 依用途命名的英文小寫識別，可含數字與連字號，例如 `layout`、`site`。同一頁內唯一，改顯示名稱或排列順序不更換。 |
| `php_file`、`source_file` | 相對於交付根目錄的檔案路徑，分別指向 PHP 包裝與 CSS／JS 副本。檔案必須位於 `snippets/` 內，與匯入片段的程式內容一致。 |

- Agent 產品在模板的頁面 Body classes 保留 `page_key` 與 `ab-output-schema-1` 兩個 class，並保留其他原有 class。頁面標記需隨頁面設定正常匯入與匯出，不使用可能被匯入器丟棄的自創模板頂層欄位。
- Agent 產品以 `[page_key/snippet_key] 用途名稱` 命名 Code Snippets 片段，並以 `page_key` 作為 tag，讓使用者可在後台辨認與篩選。Agent 產品在 PHP、CSS／JS 副本及匯入片段的程式碼保留下列註解，供後續重新匯出時識別：

  ```text
  /* AutoBricks: output_schema=1; page_key=ab-page-20260917-012445-codex-newer_art; snippet_key=layout */
  ```

- Agent 產品以 `page_key` 限定片段作用頁面，並確認前台與 Bricks 預覽皆適用。WordPress 頁號、Bricks 元素 ID、Snippet 數字 ID、頁面標題與網址都不能代替穩定識別。
- 使用者與設計師可修改頁面內容、片段顯示名稱與程式碼，但需保留識別 class、tag 及註解。Agent 產品重新取得資料時，使用 `page_key` 與 `snippet_key` 配對，不單憑名稱猜測。識別缺漏、衝突或重複時，先釐清歸屬，不覆蓋其他頁面。另做一份獨立頁面時才建立新識別及對應片段。

### 部署與檢查

- Agent 產品檢查 manifest、頁面 class、片段註解與包內版本一致，且每份片段都有對應檔案。Snippets 的 PHP 包裝與 CSS／JS 副本必須對應同一份內容，不能以舊副本覆蓋後台新修改。
- 部署腳本保留 `output_schema_version`、`page-manifest.json` 與穩定識別。更名素材資料夾時，腳本同步更新 `asset_folder` 及全部素材引用。部署副本只含部署所需檔案時，Agent 產品需在報告標示「部署副本」，不能當成含驗收證據的完整交付包。
- `report.md` 列出 schema 版本、`page_key`、片段維護位置與識別標記的用途。版本檢查與網站外觀、互動驗收是不同結果，Agent 產品分別回報。

### 從 WP 後台取得資料的界線

使用者授權操作目標站，且提供可用登入方式後，Agent 產品可透過 CDP 使用 Bricks 與 Code Snippets 的原生匯出功能。連線與操作工具見 [../../web-page-to-bricks/references/browser.md](../../web-page-to-bricks/references/browser.md)。

Agent 產品確認取得的是指定頁面目前已儲存的內容與頁面設定，不以模板庫中的舊模板代替。若目標 Bricks 版本需先另存模板才能匯出，Agent 產品區分「讀取」與「新增模板」的影響，依當次授權處理。Code Snippets 匯出需保留該頁的片段識別與完整程式碼。

原生匯出不足時，Agent 產品可依該版本的資料結構，透過 CDP 讀取新開啟編輯器中的頁面資料，另存 JSON 後核對內容及頁面設定。Agent 產品需區分原生匯出與自行組成 JSON 的結果，不能只保存畫面 HTML 就視為取得 Bricks 模板。

原生匯出不會自動組成 AutoBricks 交付包，也不保證包含素材實體檔、部署腳本或驗收證據。Agent 產品核對實際匯出內容及缺漏，不把原生匯出檔直接標示成完整版本 1 交付包。WP 後台未儲存的編輯、其他外掛或全站設定也不能推定已被匯出。

## Migration 紀錄

目前只有初始版本 1，沒有 `1 → 2` 或其他升級路徑。未標版舊包需要先比對內容與識別，再另外規劃轉換，不能直接補版本號。

未來新增 migration 時，維護者在此追加「來源版本 → 目標版本」，記錄欄位與目錄的新增、改名、刪除、合併及資料保留方式，列出目標版本完整結構與驗證重點，保留既有版本紀錄。
