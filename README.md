# AutoBricks

AutoBricks 提供共用的網頁重建規則與工具，供 Agent 產品將使用者指定的參考網頁重建成可匯入、可編輯的 WordPress Bricks JSON。

「Agent 產品」指 Claude Code、Codex 等可使用工具執行任務的 AI 助理軟體；「使用者」指提出需求、指定參考網頁並接收成品的人。

Agent 產品先在瀏覽器檢視原站的內容、版型、RWD、互動與動畫，再依網站特性選擇重建方法：

- **量測原站**：取得元素尺寸、位置、字型、間距，以及不同螢幕寬度和互動狀態下的變化，作為重建依據。
- **轉換內容與版型**：將原站文字、圖片及容器結構轉為 Bricks 元素與設定，產生模板 JSON；原站 CSS 和專案既有工具可按需重用，例如 `browser.mjs` 的 CDP 截圖與量測功能、`validate_template.py` 的 JSON 驗證功能。
- **驗證成品**：檢查 JSON 元素欄位、ID 與父子引用；將模板正常匯入 Bricks 後，在相同螢幕寬度下比對 WP 預覽與原站的內容、排版、RWD、互動與動畫，並核對圖片實際使用的素材。

Agent 產品交付可供使用者在 Bricks 修改文字、圖片與排版的成品。

- Agent 產品將額外的 CSS、JS 與必要程式庫交由 Code Snippets 管理，並提供免費版可用的 PHP 片段，方便使用者與接手的設計師在 WP 後台維護。
- 圖片、影片、字型與文件等素材依內容清楚命名，首次部署時透過 File Manager、SSH／SFTP 等方式上傳至 `wp-content/uploads/`。
- 自製 WordPress 外掛及新增後端服務需另行規劃，不屬於預設的網頁重建範圍。

## 使用 Claude Code

### 開發階段：直接載入本機 plugin 測試

使用者在 AutoBricks 專案根目錄的終端機執行：

```powershell
claude --plugin-dir .
```

`--plugin-dir .` 要求 Claude Code 直接載入目前目錄的 plugin，供使用者測試尚未發佈的修改。Claude Code 讀取 `.claude-plugin/plugin.json` 識別 AutoBricks，並從 `skills/` 取得技能。使用者不必先透過 marketplace 安裝。官方說明見 [code.claude.com/docs/en/plugins](https://code.claude.com/docs/en/plugins#test-your-plugins-locally)。

Claude Code 啟動後，使用者在 **Claude Code 對話框**指定要測試的技能與目標網頁：

```text
請讀取目前專案的 skills/web-page-to-bricks/SKILL.md，依該技能重建 <參考網頁網址>，保留 RWD。
```

使用者也可在 **Claude Code 對話框**直接輸入技能指令：

| 使用者要執行的工作 | 對話指令 | Claude Code 讀取的說明 |
|---|---|---|
| 重建指定網頁 | `/autobricks:web-page-to-bricks <參考網頁網址>` | [skills/web-page-to-bricks/SKILL.md](skills/web-page-to-bricks/SKILL.md) |
| 檢查交付包版本與結構 | `/autobricks:check-schema-version <交付目錄或 ZIP>` | [skills/check-schema-version/SKILL.md](skills/check-schema-version/SKILL.md) |
| 檢查或安裝本機測試環境 | `/autobricks:setup` | [skills/setup/SKILL.md](skills/setup/SKILL.md) |

### 發行階段：將技能與工具提供為可安裝的 plugin

維護者將技能、工具與 plugin 定義提交並推送至 GitHub 後，使用者可在 **Claude Code 對話框**依序執行以下指令，安裝已發佈的版本：

```text
/plugin marketplace add admin-tech-org/AutoBricks
/plugin install autobricks@autobricks
```

安裝完成後，使用者仍以上表的對話指令呼叫技能。Claude Code 此時讀取的是安裝副本。

## 使用 Codex

### 開發階段：直接載入本機 skill 測試

使用者在 AutoBricks 專案根目錄的終端機執行：

```powershell
codex -C .
```

`-C .` 將目前目錄設為工作目錄，供使用者測試尚未發佈的修改。Codex 從專案的 `.agents/skills/` 取得技能。使用者不必先透過 marketplace 安裝。官方說明見 [learn.chatgpt.com/docs/build-skills](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)。

Codex 啟動後，使用者在 **Codex 對話框**指定要測試的技能與目標網頁：

```text
請讀取目前專案的 .agents/skills/web-page-to-bricks/SKILL.md，依該技能重建 <參考網頁網址>，保留 RWD。
```

使用者也可在 **Codex 對話框**直接輸入技能指令：

| 使用者要執行的工作 | 對話指令 | Codex 讀取的說明 |
|---|---|---|
| 重建指定網頁 | `$autobricks:web-page-to-bricks <參考網頁網址>` | [.agents/skills/web-page-to-bricks/SKILL.md](.agents/skills/web-page-to-bricks/SKILL.md) |
| 檢查交付包版本與結構 | `$autobricks:check-schema-version <交付目錄或 ZIP>` | [.agents/skills/check-schema-version/SKILL.md](.agents/skills/check-schema-version/SKILL.md) |
| 檢查或安裝本機測試環境 | `$autobricks:setup` | [.agents/skills/setup/SKILL.md](.agents/skills/setup/SKILL.md) |

> [!TIP]
> Codex 的專案 skill 放在 `.agents/skills/`；`.codex/` 主要存放設定。本專案透過 `.gitignore` 排除個人的 `.codex/config.toml`，詳細分工見 [doc/codex-plugin.md](doc/codex-plugin.md#本機設定與-git) 的「本機設定與 Git」段落。

### 發行階段：將技能與工具提供為可安裝的 plugin

維護者將技能、工具與 plugin 定義提交並推送至 GitHub 後，使用者可在 **終端機**依序執行以下指令，安裝已發佈的版本：

```powershell
codex plugin marketplace add admin-tech-org/AutoBricks
codex plugin add autobricks@autobricks
```

安裝並啟用後，使用者重新啟動 Codex，再以上表的對話指令呼叫技能。Codex 此時讀取的是安裝副本。

> [!TIP]
> `.codex-plugin/plugin.json` 指定 plugin 的技能目錄。安裝版本使用快取副本；修改原始碼後需更新安裝內容。指定分支、專案啟用與更新步驟見 [doc/codex-plugin.md](doc/codex-plugin.md)。

## 共用規則與模型比較

在本專案工作時，各 Agent 產品依下列方式讀取共用規則：

- **Codex**：讀取 [AGENTS.md](AGENTS.md) 作為專案規則。
- **Claude Code**：讀取 [CLAUDE.md](CLAUDE.md)，再透過其中的 `@AGENTS.md` 引用同一份規則。

兩種 Agent 產品使用同名、同內容的技能：

- **`web-page-to-bricks`**：負責單一網頁的重建與驗收。
- **`check-schema-version`**：檢查交付包的版本與結構，在使用者要求升級時依既有 migration 轉換副本。目前只支援 `output_schema`。
- **`setup`**：在使用者明確要求時檢查或安裝環境。

維護者在 `skills/` 與 `.agents/skills/` 各保留一份，修改後同步技能與參考文件。

Agent 產品從載入的 `SKILL.md` 位置向上辨識 AutoBricks 根目錄，再尋找共用工具。技能不依賴 Agent 產品專用的環境變數，也不修改 Agent 產品的工具權限設定。Agent 產品可執行共用 Node 工具直接連線 Chrome CDP，並使用所用產品的圖片檢視工具查看截圖。

使用者選擇模型與推理強度；Agent 產品依原站的內容、版型與動態行為決定量測方法、重建步驟，以及是否需要分工。AutoBricks 的共用規則不綁定特定模型或固定分工流程。

環境使用 uv（[docs.astral.sh/uv/](https://docs.astral.sh/uv/)）、Node 22+、Chrome CDP、Docker WordPress、已授權的 Bricks theme 與 Code Snippets（免費版即可）。本機預覽網址是 `http://localhost:8080`。安裝細節見 [docker/README.md](docker/README.md) 與 [doc/tutorial.md](doc/tutorial.md)。

## 工具與產物

- `src/validate_template.py`：Agent 產品執行 `uv run python src/validate_template.py <template.json>`，檢查模板元素欄位與引用關係。
- `src/extract_bricks_schema.py`：需要時從已安裝的 Bricks theme 查欄位。
- `src/browser.mjs`：各 Agent 產品共用的 CDP 小工具，Node 22+；用法見 [skills/web-page-to-bricks/references/browser.md](skills/web-page-to-bricks/references/browser.md)。
- `docker/`：測試環境範本與推送工具。
- `.autobricks/docker/`：工作專案的 Docker 設定與 WordPress 檔案，開發與安裝 plugin 時皆使用此位置。
- `templates/`：Chrome 啟動範本。
- `data/YYYYMMDD-HHMMSS-agent_product-task_name/`：各次任務資料，分為 `tmp/` 與 `output/`。
- `.browser/`：Chrome 啟動腳本、獨立 profile，以及啟動腳本與 CDP 工具共用的 `cdp.env` 連線設定。

任務目錄以開始時的本機日期與時分秒命名。產品名與英文任務名使用小寫，多字以底線連接，例如 `20260916-223015-codex-new_art_clone_web`、`20260916-223015-claude_code-new_art_clone_web`。續修沿用當次目錄，新任務不覆蓋既有目錄。

```text
data/20260916-223015-codex-new_art_clone_web/
├── tmp/              # 分析工具、腳本、下載素材、量測、截圖與草稿等所有中間檔案
└── output/
    ├── output_schema_version    # 交付結構版本與目錄說明
    ├── template.json
    ├── code-snippets.json
    ├── assets/new-art/           # 上傳至 uploads/ 的非程式碼素材
    ├── snippets/                 # PHP 包裝與 CSS／JS 可讀副本
    ├── replace-domain.py
    ├── rename-assets-folder.py
    ├── report.md                 # 匯入教學、維護位置、耗時與驗收結果
    ├── comparison.html           # 原站與成品的實際驗收對照
    ├── screenshots/
    └── 20260916-231240-new-art-bricks.zip
```

Agent 產品只交付一個 `YYYYMMDD-HHMMSS-<page-name>-bricks.zip`，包含上述交付檔案，ZIP 時間採打包時的本機時間。使用者先解壓，依 `report.md` 執行 `uv run` 部署腳本、上傳素材，再分別匯入 Code Snippets 與 Bricks。`comparison.html` 可離線查看實際截圖及驗收結果。整包 ZIP 不是直接匯入 Bricks 的模板 ZIP。

專案根目錄的 [output_schema_version](output_schema_version) 第一行是版本號，後面列出交付結構與用途。Agent 產品將該檔原樣放入交付目錄與 ZIP。結構改版時才升版。

Bricks 頁面的 Body classes 與所屬 Code Snippets 的 tag 使用相同識別碼。這個對應保存在 WP，讓後續工作可從指定頁面找到所屬片段，即使本機 `data/` 為空也不影響辨認。使用者修改內容或搬站時保留識別標記。

版本紀錄見 [skills/check-schema-version/references/output-schema.md](skills/check-schema-version/references/output-schema.md)：`v1` 列出初版結構，後續 migration 只列變更，再附目標版本結構。目前尚未提供正式站 push、fetch 或 merge 技能。

執行產物、登入資料與商業 theme 不納入 Git。

Agent 產品依目標環境已安裝的 Bricks 版本與實際渲染確認元素設定，將已驗證的版本與環境細節記錄在使用者工作專案根目錄的 `bricks-import.md`。此檔案由各工作專案建立及維護，不納入 Git，也不隨 plugin 發行。

## 重建方法

`web-page-to-bricks` 技能正文包含網站觀察、CDP 操作、元素量測、截圖分析、RWD、動畫、Bricks 轉換、正常匯入及可編輯性驗收的方法，並列明執行產物的存放位置。Agent 產品依當站問題選擇合適方法，依原站內容與行為驗收成果。

- Claude Code：[skills/web-page-to-bricks/SKILL.md](skills/web-page-to-bricks/SKILL.md)
- Codex：[.agents/skills/web-page-to-bricks/SKILL.md](.agents/skills/web-page-to-bricks/SKILL.md)

## 使用範圍

用於使用者自有網站、已授權的客戶網站、內部重建或學習用途。
