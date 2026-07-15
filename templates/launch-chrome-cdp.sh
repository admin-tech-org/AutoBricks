#!/usr/bin/env bash
# ===================================================================
#  啟動一台「帶 CDP 遠端除錯埠」的真 Chrome / Chromium，供 Playwright MCP 接管。
#  真 Chrome + 真 profile = 沒有自動化指紋。需要登入的網站在該視窗登一次即可。
#
#  設定（都可省略，參數優先於設定檔）：
#    1) 同層 cdp.env 檔，KEY=VALUE：
#         CDP_PORT=9333
#         PROFILE_DIR=.chrome_cdp-myplugin   （相對本檔資料夾，或絕對路徑）
#         CHROME_PATH=/path/to/chrome
#    2) 第一個參數＝port：bash launch-chrome-cdp.sh 9333
#  換 port 會自動換 profile 資料夾——同一個 profile 只能跑一個 Chrome 實例，
#  跨 port 共用 profile 會靜默忽略新 port。
#  ── 這是範本（macOS / Linux 用）：setup 會把它複製到「使用者專案」的 .browser/。
# ===================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PORT=9222
PROFILE_DIR=""
CHROME_PATH=""
ENVF="$DIR/cdp.env"
if [ -f "$ENVF" ]; then
  while IFS='=' read -r k v; do
    case "$k" in
      CDP_PORT)    PORT="$v" ;;
      PROFILE_DIR) PROFILE_DIR="$v" ;;
      CHROME_PATH) CHROME_PATH="$v" ;;
    esac
  done < <(grep -E '^[A-Z_]+=' "$ENVF")
fi
[ -n "${1:-}" ] && PORT="$1"

if [ -z "$PROFILE_DIR" ]; then
  if [ "$PORT" = "9222" ]; then PROFILE_DIR=".chrome_cdp"; else PROFILE_DIR=".chrome_cdp-$PORT"; fi
fi
case "$PROFILE_DIR" in
  /*) PROFILE="$PROFILE_DIR" ;;
  *)  PROFILE="$DIR/$PROFILE_DIR" ;;
esac
mkdir -p "$DIR/out"

# 依序找常見的 Chrome / Chromium 路徑（macOS 與 Linux）
CANDIDATES=(
  "$CHROME_PATH"
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "$(command -v google-chrome || true)"
  "$(command -v google-chrome-stable || true)"
  "$(command -v chromium || true)"
  "$(command -v chromium-browser || true)"
)
CHROME=""
for c in "${CANDIDATES[@]}"; do
  if [ -n "$c" ] && [ -x "$c" ]; then CHROME="$c"; break; fi
done
if [ -z "$CHROME" ]; then
  echo "[x] 找不到 Chrome/Chromium，請在 cdp.env 設 CHROME_PATH 或編輯本檔。"
  exit 1
fi

"$CHROME" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" >/dev/null 2>&1 &
echo "[ok] Chrome launched with CDP debug port $PORT"
echo "     profile: $PROFILE"
echo
echo " Next: 保持這台 Chrome 開著即可——Playwright MCP 用到時會自動接管。"
echo "       port 非 9222 時記得指過去（AutoBricks：PLAYWRIGHT_CDP_URL=http://127.0.0.1:$PORT）。"
