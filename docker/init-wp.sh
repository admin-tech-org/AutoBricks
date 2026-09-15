#!/usr/bin/env bash
# 一鍵把本機 Bricks 驗證環境跑起來：WordPress + MariaDB + Bricks theme。
# 需求：Docker Desktop 已啟動。
# 先將本腳本與 docker-compose.yml 複製至工作專案的 .autobricks/docker/。
# Bricks theme：由使用者解壓進該目錄的 wp/wp-content/themes/bricks/（bind mount；
#               商業軟體已 gitignore、絕不進版控），再重跑本腳本即會啟用。
# 冪等：重跑安全，已裝好的步驟自動跳過。
set -euo pipefail
cd "$(dirname "$0")"
if [ -f ../pyproject.toml ] && [ -f push-template.php ]; then
  echo "[x] 此處是 AutoBricks 範本目錄。請先將 docker-compose.yml 與 init-wp.sh 複製至工作專案的 .autobricks/docker/，再執行複製後的腳本。" >&2
  exit 1
fi
export MSYS_NO_PATHCONV=1 # Git Bash 必要：防容器內路徑被改寫成 Windows 路徑

docker compose -f docker-compose.yml up -d

echo "[..] 等 WordPress 回應 http://localhost:8080 ..."
ok=""
for _ in $(seq 1 60); do
  # 注意：這裡不能用 curl -o /dev/null——MSYS_NO_PATHCONV=1 會讓 /dev/null 不被轉換成 NUL
  if curl -fsS http://localhost:8080 >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || { echo "[x] WordPress 未在時限內起來（docker compose logs wordpress 查原因）"; exit 1; }

wpcli() { docker compose -f docker-compose.yml run --rm wpcli "$@"; }

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
  echo "[!] 還沒有 Bricks theme——把它解壓到本腳本旁的 wp/wp-content/themes/bricks/ 後重跑本腳本即可啟用"
fi

echo
echo "== 環境就緒 =="
echo "  站台   : http://localhost:8080"
echo "  後台   : http://localhost:8080/wp-admin   (admin / admin)"
echo "  重建頁面 : 使用 web-to-bricks 技能；手動推送流程見 docker/README.md"
