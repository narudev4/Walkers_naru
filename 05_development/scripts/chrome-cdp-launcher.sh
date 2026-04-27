#!/bin/bash
# Chrome CDP Launcher - Profile 4 (walker-s.co.jp) をコピーして起動
# 通常Chromeをブロックせずにヘッドレス自動化を可能にする
#
# Usage:
#   ./chrome-cdp-launcher.sh [start|stop|port]
#   start - Profile 4をコピーしてヘッドレスChrome起動 (デフォルト)
#   stop  - ヘッドレスChromeを停止・クリーンアップ
#   port  - 現在のCDPポートを表示

CDP_PORT=9222
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC_PROFILE="$HOME/Library/Application Support/Google/Chrome"
CDP_DIR="/tmp/chrome-cdp-walkers"
PID_FILE="/tmp/chrome-cdp-walkers.pid"

case "${1:-start}" in
  start)
    # 既に起動中なら何もしない
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "Already running (PID $(cat "$PID_FILE")), CDP: http://localhost:$CDP_PORT"
      exit 0
    fi

    echo "Copying Profile 4..."
    rm -rf "$CDP_DIR"
    mkdir -p "$CDP_DIR/Default"
    # 必要なファイルだけコピー（Cookies, Login Data, Local State, IndexedDB等）
    # IndexedDB は HeyGen 等の認証トークン格納に必須なので除外しない
    rsync -a --exclude='Cache' --exclude='Code Cache' \
      --exclude='GPUCache' --exclude='GrShaderCache' --exclude='ShaderCache' \
      --exclude='blob_storage' \
      "$SRC_PROFILE/Profile 4/" "$CDP_DIR/Default/"
    cp "$SRC_PROFILE/Local State" "$CDP_DIR/" 2>/dev/null

    echo "Starting Chrome on port $CDP_PORT (non-headless for HeyGen compatibility)..."
    "$CHROME" \
      --remote-debugging-port=$CDP_PORT \
      --remote-allow-origins=* \
      --user-data-dir="$CDP_DIR" \
      --profile-directory="Default" \
      --no-first-run \
      --no-default-browser-check \
      --disable-sync \
      &>/dev/null &
    echo $! > "$PID_FILE"
    sleep 2

    # 確認
    if curl -s "http://localhost:$CDP_PORT/json/version" | grep -q Browser; then
      echo "✓ CDP ready: http://localhost:$CDP_PORT"
    else
      echo "✗ Failed to start"
      exit 1
    fi
    ;;

  stop)
    if [ -f "$PID_FILE" ]; then
      kill "$(cat "$PID_FILE")" 2>/dev/null
      rm -f "$PID_FILE"
      echo "Chrome stopped"
    else
      echo "Not running"
    fi
    rm -rf "$CDP_DIR"
    echo "Cleaned up"
    ;;

  port)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo $CDP_PORT
    else
      echo "Not running"
      exit 1
    fi
    ;;

  *)
    echo "Usage: $0 [start|stop|port]"
    exit 1
    ;;
esac
