# docker/ — 本機 Bricks 驗證環境

Agent 產品使用本機 WordPress + MariaDB + Bricks 渲染重建頁面，檢查模板匯入、外觀、RWD、互動與素材。使用者提供已授權的 Bricks theme，預設站台為 http://localhost:8080。

**掛載策略**：WordPress 檔案以 bind mount 放在 `docker/wp/`，供使用者或 Agent 產品存取 theme 與素材；MariaDB 資料使用 named volume，避免透過 Windows 檔案分享層存取資料庫檔案。

## 一鍵建置

1. 使用者或已取得啟動授權的 Agent 產品啟動 Docker Desktop。
2. Agent 產品在 repo 根目錄執行：
   ```bash
   bash docker/init-wp.sh
   ```
3. 使用者提供 theme 後，Agent 產品將**已授權的 Bricks theme 解壓**到 `docker/wp/wp-content/themes/bricks/`，再執行 `init-wp.sh` 啟用。`docker/wp/` 已由 Git 忽略，商業 theme 不納入版控。

完成後：站台 http://localhost:8080、後台 `admin` / `admin`。冪等、可重跑。

> 使用者依目標 Bricks 版本與後台提示確認授權狀態。Agent 產品需實際確認編輯器可開啟，不能只以 theme 已啟用判定環境就緒。

## 常用操作

```bash
docker compose -f docker/docker-compose.yml ps            # 狀態
docker compose -f docker/docker-compose.yml logs -f wordpress
docker compose -f docker/docker-compose.yml down          # 停（wp 檔案在 ./wp、db 在 volume，都留著）
docker compose -f docker/docker-compose.yml down -v       # 停＋清 db（./wp 要重來就手動刪）
docker compose -f docker/docker-compose.yml run --rm wpcli <wp 指令>   # wp-cli
```

## 將模板寫入測試頁

Agent 產品可透過 `push-template.php` 直接將 JSON 寫入 WP 頁面，以便檢查瀏覽器畫面。以下為 Bash 指令範例；Agent 產品需替換當次檔案路徑，並記錄腳本回傳的 PAGE_ID。後續修改只指定該次頁號。

```bash
MSYS_NO_PATHCONV=1 docker cp data/<id>/template.json autobricks-wp:/tmp/template.json
MSYS_NO_PATHCONV=1 docker cp docker/push-template.php autobricks-wp:/tmp/
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
