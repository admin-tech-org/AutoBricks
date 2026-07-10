# docker/ — 本機 Bricks 驗證環境

`push` skill 的靶場：WordPress + MariaDB + Bricks 1.12.5，跑在 http://localhost:8080。

**掛載策略**：WordPress 檔案 bind mount 在 `docker/wp/`（看得到、theme 直接丟）；
資料庫用 named volume（MariaDB 在 Windows bind mount 有鎖檔/損毀地雷，且 db 檔不會手動讀）。

## 一鍵建置

1. 啟動 Docker Desktop。
2. ```bash
   bash docker/init-wp.sh
   ```
3. 把**已授權的 Bricks theme 解壓**到 `docker/wp/wp-content/themes/bricks/`
   （商業軟體——`docker/wp/` 已 gitignore，**絕不 commit**），再跑一次 `init-wp.sh` 即啟用。

完成後：站台 http://localhost:8080、後台 `admin` / `admin`。冪等、可重跑。

> Bricks 授權金鑰：本機測試不啟用也能用 builder；要收更新/內建模板庫再到後台
> Bricks → License 啟用。

## 常用操作

```bash
docker compose -f docker/docker-compose.yml ps            # 狀態
docker compose -f docker/docker-compose.yml logs -f wordpress
docker compose -f docker/docker-compose.yml down          # 停（wp 檔案在 ./wp、db 在 volume，都留著）
docker compose -f docker/docker-compose.yml down -v       # 停＋清 db（./wp 要重來就手動刪）
docker compose -f docker/docker-compose.yml run --rm wpcli <wp 指令>   # wp-cli
```

## 推模板（push skill 的底層流程）

```bash
MSYS_NO_PATHCONV=1 docker cp data/templates/<id>/template.json autobricks-wp:/tmp/template.json
MSYS_NO_PATHCONV=1 docker cp docker/push-template.php autobricks-wp:/tmp/
MSYS_NO_PATHCONV=1 docker exec -e TEMPLATE=/tmp/template.json -e TITLE="測試頁" \
  autobricks-wp php /tmp/push-template.php
# → 印出 PAGE_ID 與 permalink；加 -e PAGE_ID=<n> 才會覆寫既有頁
```

## 地雷

- **Windows（Git Bash）跑 `docker exec`／`docker cp` 一律加 `MSYS_NO_PATHCONV=1`**，
  否則 `/tmp/...` 會被改寫成 Windows 路徑。
- 寫入走 `wp_set_current_user(admin)` + `wp_slash()`（否則 WP 靜默丟棄／剝引號）——
  **絕不用瀏覽器登入後台代替**。
- Bricks 會快取產出的 CSS：重複推同一頁樣式沒更新時，後台重存該頁一次，或把
  Bricks 設定的 CSS loading 改 inline（本機環境建議 inline）。
- admin/admin 只適用本機測試環境，**不要對外開放 8080**。
- Windows bind mount 較慢屬正常（檔案分享層）；資料庫刻意不 bind mount，別改。
