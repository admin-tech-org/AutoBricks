#!/usr/bin/env bash
# 一鍵把本機 Bricks 驗證環境跑起來：WordPress + MariaDB + Bricks theme。
# 需求：Docker Desktop 已啟動。
# Bricks theme：由使用者解壓進 docker/wp/wp-content/themes/bricks/（bind mount，直接丟即可；
#               商業軟體已 gitignore、絕不進版控），再重跑本腳本即會啟用。
# 冪等：重跑安全，已裝好的步驟自動跳過。
set -euo pipefail
cd "$(dirname "$0")"
export MSYS_NO_PATHCONV=1 # Git Bash 必要：防容器內路徑被改寫成 Windows 路徑

docker compose up -d

echo "[..] 等 WordPress 回應 http://localhost:8080 ..."
ok=""
for _ in $(seq 1 60); do
  # 注意：這裡不能用 curl -o /dev/null——MSYS_NO_PATHCONV=1 會讓 /dev/null 不被轉換成 NUL
  if curl -fsS http://localhost:8080 >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || { echo "[x] WordPress 未在時限內起來（docker compose logs wordpress 查原因）"; exit 1; }

wpcli() { docker compose run --rm wpcli "$@"; }

if ! wpcli core is-installed >/dev/null 2>&1; then
  wpcli core install --url=http://localhost:8080 --title="AutoBricks Dev" \
    --admin_user=admin --admin_password=admin --admin_email=admin@example.com --skip-email
  echo "[ok] WordPress 安裝完成（admin / admin）"
else
  echo "[ok] WordPress 已安裝"
fi

if [ -d wp/wp-content/themes/bricks ]; then
  wpcli theme activate bricks
  echo "[ok] Bricks theme 已啟用"
  echo "[i] 提醒：要讓頁面能用 Bricks 編輯器，需手動開放（Bricks → 設定 → 一般 → 文章類型，勾「頁面」）"
else
  echo "[!] 還沒有 Bricks theme——把它解壓到 docker/wp/wp-content/themes/bricks/ 後重跑本腳本即可啟用"
fi

echo
echo "== 環境就緒 =="
echo "  站台   : http://localhost:8080"
echo "  後台   : http://localhost:8080/wp-admin   (admin / admin)"
echo "  推模板 : /autobricks:push（或見 docker/README.md 手動流程）"
