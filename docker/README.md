# docker/ — 本機 Bricks 驗證環境

Agent 產品使用本機 WordPress + MariaDB + Bricks 渲染重建頁面，檢查模板匯入、外觀、RWD、互動與素材。使用者提供已授權的 Bricks theme，預設站台為 http://localhost:8080。

`<PLUGIN_ROOT>/docker/` 提供範本與推送工具。實際環境放在使用者工作專案的 `<PROJECT_ROOT>/.autobricks/docker/`，以下以 `<WP_DIR>` 代稱。開發 AutoBricks 時也使用此位置。

- WordPress 檔案以 bind mount 放在 `<WP_DIR>/wp/`，供使用者或 Agent 產品存取 theme 與素材。
- MariaDB 資料使用 named volume，與 WordPress 檔案分開保存。

## 一鍵建置

1. 使用者或已取得啟動授權的 Agent 產品啟動 Docker Desktop。
2. 首次建置時，Agent 產品複製兩份範本後，確認掛載來源為 `<WP_DIR>/wp/` 再初始化。以下為 Bash 範例，需將佔位路徑替換為實際絕對路徑：
   ```bash
   mkdir -p "<WP_DIR>"
   cp -n "<PLUGIN_ROOT>/docker/docker-compose.yml" "<PLUGIN_ROOT>/docker/init-wp.sh" "<WP_DIR>/"
   docker compose -f "<WP_DIR>/docker-compose.yml" config
   bash "<WP_DIR>/init-wp.sh"
   ```
   既有環境先核對 Compose 設定、容器掛載與資料庫 volume，不重新複製或覆蓋設定。同名環境可能屬於其他專案，不能只因容器名稱相同就直接沿用。
3. 使用者提供 theme 後，Agent 產品將**已授權的 Bricks theme 解壓**到 `<WP_DIR>/wp/wp-content/themes/bricks/`，再執行 `<WP_DIR>/init-wp.sh` 啟用。使用者工作專案的 `.gitignore` 需排除 `.autobricks/`，商業 theme 不納入版控。

首次安裝的站台為 http://localhost:8080，後台帳密為 `admin` / `admin`。重跑會保留既有帳號，以及已啟用的 Bricks 或其子主題。

> 使用者依目標 Bricks 版本與後台提示確認授權狀態。Agent 產品需實際確認編輯器可開啟，不能只以 theme 已啟用判定環境就緒。

Code Snippets 供重建頁面的 CSS／JS 載入與後台維護，免費版即可驗證交付的 PHP 片段。初始化腳本不安裝此外掛。Agent 產品先檢查已安裝版本，缺少時依使用者已授權的環境變更範圍，透過 WP 後台或以下指令補齊，保留既有版本與設定：

```text
docker compose -f "<WP_DIR>/docker-compose.yml" run --rm wpcli plugin install code-snippets --activate
```

## 常用操作

```bash
docker compose -f "<WP_DIR>/docker-compose.yml" ps            # 狀態
docker compose -f "<WP_DIR>/docker-compose.yml" logs -f wordpress
docker compose -f "<WP_DIR>/docker-compose.yml" down          # 停止環境，保留 wp 檔案與資料庫 volume
docker compose -f "<WP_DIR>/docker-compose.yml" run --rm wpcli <wp 指令>   # wp-cli
```

## 將模板寫入測試頁

Agent 產品可透過 `push-template.php` 直接將 JSON 寫入 WP 頁面，以便檢查瀏覽器畫面。以下為 Bash 指令範例，`<RUN_DIR>` 是當次任務的 `<PROJECT_ROOT>/data/YYYYMMDD-HHMMSS-agent_product-task_name/`。範例使用交付模板，開發中的草稿可改用 `<RUN_DIR>/tmp/template.json`。Agent 產品需替換當次檔案路徑，並記錄腳本回傳的 PAGE_ID。後續修改只指定該次頁號。

```bash
run_name="$(basename "<RUN_DIR>")"
MSYS_NO_PATHCONV=1 docker cp "<RUN_DIR>/output/template.json" "autobricks-wp:/tmp/${run_name}-template.json"
MSYS_NO_PATHCONV=1 docker cp "<PLUGIN_ROOT>/docker/push-template.php" "autobricks-wp:/tmp/${run_name}-push-template.php"
MSYS_NO_PATHCONV=1 docker exec -e TEMPLATE="/tmp/${run_name}-template.json" \
  autobricks-wp php "/tmp/${run_name}-push-template.php"
# → 印出 PAGE_ID 與 permalink；加 -e PAGE_ID=<n> 才會覆寫既有頁
```

`run_name` 取自當次任務目錄名稱，避免容器暫存檔與其他任務互相覆蓋。頁面標題沿用 JSON 的 `title`，避免透過 shell 環境變數傳遞中文時的編碼差異。

`push-template.php` 同時處理模板中的頁面設定：

- 提供 `pageSettings` 時，腳本整份取代該頁的 Bricks 頁面設定，包含 `bodyClasses` 頁面識別標記、頁首頁尾與自訂程式碼等設定。
- 省略 `pageSettings` 時，腳本保留既有頁面設定。
- 提供空物件 `{}` 或空陣列 `[]` 作為 `pageSettings` 時，腳本清空設定。
- 舊模板若另有非空的頂層 `customCss`，腳本會將該值寫入頁面設定，優先於 `pageSettings.customCss`。

直接寫入頁面可供開發預覽。交付前，Agent 產品仍需確認模板經 Bricks 匯入器匯入後的內容、樣式與素材，並查閱使用者工作專案根目錄的 `bricks-import.md` 核對版本與環境細節。檔案不存在或版本不符時，Agent 產品依當前已安裝的 Bricks 原始碼與實測建立或更新筆記。

## 操作注意

- **Windows（Git Bash）跑 `docker exec`／`docker cp` 一律加 `MSYS_NO_PATHCONV=1`**，
  否則 `/tmp/...` 會被改寫成 Windows 路徑。
- 推送腳本透過 `wp_set_current_user(admin)` 設定執行帳號，並以 `wp_slash()` 處理寫入資料；瀏覽器的後台登入狀態不會授權容器中的 PHP 行程。
- Bricks 會快取產出的 CSS。Agent 產品重複推送同一頁後若未看到樣式更新，可在後台重存該頁，或依使用者授權將 Bricks 的 CSS loading 改為 inline。
- admin/admin 只適用本機測試環境。Compose 範本將 8080 綁定至 `127.0.0.1`，**不要對外開放 8080**。
- Agent 產品調查 Windows 檔案存取效能時，需區分 WordPress 的 bind mount 與資料庫的 named volume，不能將兩者視為相同的儲存方式。
