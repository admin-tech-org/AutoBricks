# AutoBricks 操作教學：從測試環境到 Bricks 頁面

本文協助使用者準備測試環境、開啟重建成品，以及理解模板 JSON、WordPress 頁面與 Bricks 編輯器的關係。

- **Agent 產品**：Claude Code、Codex 等可使用工具執行任務的 AI 助理軟體。
- **使用者**：指定參考網頁、操作工作專案並接收成品的人。

## 1. 選擇技能入口

使用者先依 [README.md](../README.md) 啟動所用的 Agent 產品，再提供工作專案與任務。

| 工作 | Claude Code | Codex |
| --- | --- | --- |
| 檢查、安裝或修復環境 | [skills/setup/SKILL.md](../skills/setup/SKILL.md) | [.agents/skills/setup/SKILL.md](../.agents/skills/setup/SKILL.md) |
| 觀察參考網站、重建及驗收 | [skills/web-page-to-bricks/SKILL.md](../skills/web-page-to-bricks/SKILL.md) | [.agents/skills/web-page-to-bricks/SKILL.md](../.agents/skills/web-page-to-bricks/SKILL.md) |

兩套技能的內容相同。使用者明確要求環境檢查或安裝時，Agent 產品才使用 `setup`。網站觀察、CDP 操作、RWD、動畫及驗收的方法由 `web-page-to-bricks` 說明，共用工作規則見 [AGENTS.md](../AGENTS.md)。

## 2. 確認工具與資料位置

- `<PLUGIN_ROOT>` 是當次載入的 AutoBricks 安裝包或原始碼目錄，提供 `src/` 工具及 `docker/`、`templates/` 範本。
- `<PROJECT_ROOT>` 是使用者的工作專案根目錄，保存重建成果與本機環境。
- `<RUN_DIR>` 是當次任務的 `<PROJECT_ROOT>/data/YYYYMMDD-agent_product-task_name/`。日期採任務開始時的本機日期，產品名與英文任務名使用小寫，多字以底線連接，例如 `20260914-codex-new_art_clone_web`、`20260914-claude_code-new_art_clone_web`。續修沿用當次目錄，新任務不覆蓋既有目錄。
- `<WP_DIR>` 是 WordPress 測試環境目錄，預設使用 `<PROJECT_ROOT>/.autobricks/docker/`，開發 AutoBricks 與安裝 plugin 時皆相同。`<PLUGIN_ROOT>/docker/` 只提供範本與工具。其他既有環境需先確認 Compose 設定與實際掛載再沿用。

| 資料 | 存放位置 |
| --- | --- |
| 可匯入的 Bricks 匯入包與交付所需素材 | `<RUN_DIR>/output/`，例如 `template.json` 與必要的 `assets/` |
| 最終交付報告：頁號、預覽網址、耗時、驗收結果與剩餘差異 | `<RUN_DIR>/output/report.md` |
| 來源資料、下載素材、量測、截圖、當次腳本、草稿與其他中間檔案 | `<RUN_DIR>/tmp/`，子目錄依任務需要安排 |
| 瀏覽器啟動設定與 profile | `<PROJECT_ROOT>/.browser/` |
| Python 虛擬環境 | `<PROJECT_ROOT>/.autobricks/venv/` |
| Docker 設定與 WordPress 檔案 | `<WP_DIR>/docker-compose.yml`、`<WP_DIR>/wp/` |
| 資料庫 | Compose 的 `db_data` named volume，由 Docker 保存 |
| 當前 Bricks 版本的實測筆記 | `<PROJECT_ROOT>/bricks-import.md` |

Agent 產品將執行產物、登入資料、WordPress 資料及商業 theme 排除於 Git，並確保資料不寫入 plugin 安裝快取。`bricks-import.md` 由各工作專案依實際版本建立，不隨 AutoBricks 發行。

## 3. 準備與啟動測試環境

重建需要 uv、Node 22+、可提供 CDP 連線的 Chrome、Docker，以及使用者提供的已授權 Bricks theme。Agent 產品依 `setup` 檢查現有環境，沿用可用的工具與 WordPress。

首次建置時，Agent 產品依 `setup` 將 `docker-compose.yml` 與 `init-wp.sh` 範本複製至 `<WP_DIR>`，確認 Compose 的 WordPress 掛載來源為 `<WP_DIR>/wp/`，再執行其中的 `init-wp.sh`。既有環境不需要重新複製範本。腳本使用 Bash，使用者或 Agent 產品需依當前 shell 選擇合適的呼叫方式。

Bricks theme 解壓位置為 `<WP_DIR>/wp/wp-content/themes/bricks/`，`style.css` 應直接位於此目錄。Agent 產品執行初始化腳本後，需確認 WordPress 已啟動、theme 已啟用，以及編輯器可開啟。詳細操作見 [docker/README.md](../docker/README.md)。

| 項目 | 本專案預設值 |
| --- | --- |
| 站台 | `http://localhost:8080` |
| WordPress 後台 | `http://localhost:8080/wp-admin/` |
| WordPress 容器 | `autobricks-wp` |
| 首次初始化的本機測試帳號／密碼 | `admin`／`admin` |

上述帳密只適用本機測試。既有站台沿用實際帳密，使用者不需為了符合教學重設帳號。

電腦重開後，使用者先啟動 Docker，再以實際路徑替換 `<WP_DIR>` 執行：

```text
docker compose -f "<WP_DIR>/docker-compose.yml" up -d
docker compose -f "<WP_DIR>/docker-compose.yml" ps
```

Chrome CDP 的連線方式與指令見 [skills/web-page-to-bricks/references/browser.md](../skills/web-page-to-bricks/references/browser.md)。瀏覽器與工具的連線埠需一致，Agent 產品取得截圖後仍需實際開啟圖片檢查。

## 4. 在 Bricks 開啟與編輯頁面

1. 使用者登入 WordPress 後台，確認目前啟用的 theme 是 Bricks。
2. 使用者新增練習頁，或開啟 Agent 產品交付的當次測試頁，選擇使用 Bricks 編輯。
3. 編輯器無法開啟時，使用者依畫面提示檢查目標文章類型是否允許使用 Bricks、登入帳號的權限，以及當前版本的授權狀態。授權相關設定依目標版本與介面提示處理。
4. 使用者在結構面板選取元素，透過內容欄位修改文字或圖片，透過樣式欄位調整排版，再儲存並開啟前台預覽。

需要開放「頁面」使用 Bricks 時，使用者在目前版本的 Bricks 設定介面調整對應項目。Agent 產品若協助修改設定，應保留其他現有設定，不能以只含單一欄位的物件覆寫整份全站設定。

選中元素後，使用者應能辨認元素名稱、所在容器及可修改欄位。自訂 CSS 或程式碼控制的部分，由 Agent 產品在交付總結標示修改位置。

## 5. 模板 JSON 如何成為頁面

Bricks 模板 JSON 描述元素、父子關係、內容與設定。Bricks 讀取這些資料後呈現可編輯的結構，並產生前台的 HTML、CSS 與必要程式。JSON 是匯入與交換格式，不代表 WordPress 的所有資料都直接以 JSON 字串存放。

| 模板中的資訊 | 使用者看到的結果 |
| --- | --- |
| 元素型別與內容設定 | 標題、文字、圖片、連結等內容 |
| 元素 ID 與父子引用 | 結構面板中的元素與容器關係 |
| 元素名稱或標籤 | 方便辨認及修改的區段名稱 |
| 元素設定、共用樣式與自訂 CSS | 排版、字型、顏色及不同寬度的外觀 |
| 互動設定或頁面程式 | 選單、輪播、頁籤及動畫等行為 |

具體欄位與資料形狀以目標環境的 Bricks 版本為準。Agent 產品從已安裝 theme 的原始碼、該版本匯出的模板與實際渲染確認設定，將已驗證的細節記入 `<PROJECT_ROOT>/bricks-import.md`。

## 6. 開發預覽與正常匯入

- **開發預覽**：Agent 產品使用 `docker/push-template.php` 將模板內容寫入當次 WP 頁面，快速檢查及修正畫面。腳本未指定 `PAGE_ID` 時建立新頁，續修時只更新回傳的當次頁號。操作見 [docker/README.md](../docker/README.md)。
- **正常匯入**：使用者或 Agent 產品透過目標 Bricks 的模板匯入介面載入 JSON，再將模板插入當次頁面並儲存。匯入模板庫不等於已建立可供訪客查看的頁面，仍需確認模板已套用到預期頁面。

直接推送未經過 Bricks 匯入器，不能代替正常匯入驗證。Agent 產品交付前需檢查匯入後的內容、素材、CSS 選擇器、互動及編輯器。圖片是否正確需核對實際素材，不能只確認網址有回應。

## 7. 使用工具檢查模板

Agent 產品可從實際安裝的 theme 擷取元素與欄位清單，再指定給驗證器。以下路徑需替換為當次實際值：

```text
uv run --no-project python "<PLUGIN_ROOT>/src/extract_bricks_schema.py" --theme-dir "<WP_DIR>/wp/wp-content/themes/bricks" --out "<RUN_DIR>/tmp/measurements/bricks-schema.json"
uv run --no-project python "<PLUGIN_ROOT>/src/validate_template.py" "<RUN_DIR>/output/template.json" --live-schema "<RUN_DIR>/tmp/measurements/bricks-schema.json"
```

驗證器檢查元素 ID、父子引用及部分設定。未載入 live schema 時，元素名稱與設定欄位的相關檢查會略過。原始碼掃描會合併可辨識的父類別欄位，但不執行 PHP，動態組裝、條件與覆寫的結果仍需配合 theme 原始碼與實測判讀。

驗證器另有基於 Bricks 1.12.x 經驗的固定檢查，這些檢查不會因傳入其他版本的 schema 就自動改變。跨版本使用時，Agent 產品需核對相關訊息的適用性。格式檢查通過也不代表正常匯入、外觀、動畫或可編輯性已通過。

## 8. 檢查交付成果

使用者可依 Agent 產品提供的 `<RUN_DIR>/output/report.md` 及預覽網址檢查：

- 原站與成品是否有相同內容與素材，代表截圖是否使用相同視窗尺寸及互動狀態。
- 桌面、手機、斷點附近與中間寬度的排列是否吻合，是否出現文字截斷或意外橫向溢出。
- 選單、頁籤、輪播及動畫是否實際運作，包括首次載入及再次操作的行為。
- Bricks 編輯器能否選取並修改文字、圖片與容器，儲存後的預覽是否正常。
- Agent 產品是否列明未測項目、剩餘差異、程式碼修改位置及實際耗時。

停止測試環境可執行 `docker compose -f "<WP_DIR>/docker-compose.yml" down`，此指令不刪除 WordPress 掛載目錄與資料庫 volume。需要排查啟動問題時，先查看同一份 Compose 的 `ps` 與 `logs wordpress` 結果，再依實際原因處理。
