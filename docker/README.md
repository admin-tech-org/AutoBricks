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

完成後：站台 http://localhost:8080、後台 `admin` / `admin`。冪等、可重跑。

> 使用者依目標 Bricks 版本與後台提示確認授權狀態。Agent 產品需實際確認編輯器可開啟，不能只以 theme 已啟用判定環境就緒。

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
MSYS_NO_PATHCONV=1 docker cp "<RUN_DIR>/output/template.json" autobricks-wp:/tmp/template.json
MSYS_NO_PATHCONV=1 docker cp "<PLUGIN_ROOT>/docker/push-template.php" autobricks-wp:/tmp/
MSYS_NO_PATHCONV=1 docker exec -e TEMPLATE=/tmp/template.json -e TITLE="測試頁" \
  autobricks-wp php /tmp/push-template.php
# → 印出 PAGE_ID 與 permalink；加 -e PAGE_ID=<n> 才會覆寫既有頁
```

直接寫入頁面可供開發預覽。交付前，Agent 產品仍需確認模板經 Bricks 匯入器匯入後的內容、樣式與素材，並查閱使用者工作專案根目錄的 `bricks-import.md` 核對版本與環境細節。檔案不存在或版本不符時，Agent 產品依當前已安裝的 Bricks 原始碼與實測建立或更新筆記。

## 操作注意

- **Windows（Git Bash）跑 `docker exec`／`docker cp` 一律加 `MSYS_NO_PATHCONV=1`**，
  否則 `/tmp/...` 會被改寫成 Windows 路徑。
- 推送腳本透過 `wp_set_current_user(admin)` 設定執行帳號，並以 `wp_slash()` 處理寫入資料；瀏覽器的後台登入狀態不會授權容器中的 PHP 行程。
- Bricks 會快取產出的 CSS。Agent 產品重複推送同一頁後若未看到樣式更新，可在後台重存該頁，或依使用者授權將 Bricks 的 CSS loading 改為 inline。
- admin/admin 只適用本機測試環境，**不要對外開放 8080**。
- Agent 產品調查 Windows 檔案存取效能時，需區分 WordPress 的 bind mount 與資料庫的 named volume，不能將兩者視為相同的儲存方式。
