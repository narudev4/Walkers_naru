#!/usr/bin/env bash
# update-windows.ps1 の処理を Linux ネイティブに移したもの。
# UI をビルドして webui へ配り、自作バックエンドのソースを install 先へ同期する。
# 認証情報・DB・bridge の config は触らない。
set -euo pipefail

SRC="$HOME/chathub-src/chathub-distribution"
ENV_FILE="$SRC/.env"

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

INSTALL="${CHATHUB_INSTALL_DIR:-/opt/chathub}"

echo "== building web UI (VITE_MATRIX_BASE_URL=$VITE_MATRIX_BASE_URL)"
cd "$SRC/ui"
export VITE_MATRIX_BASE_URL VITE_GMAIL_PROXY_URL
npm ci --no-audit --no-fund
npm run build

tar -cf /tmp/chathub-webui.tar -C "$SRC/ui/dist" .

# ソースとテンプレートのみ。認証情報とデータは、clone 内に誤って作られていても除外する。
tar --exclude=gmail-proxy/creds.json \
    --exclude=chatwork-bridge/data \
    -cf /tmp/chathub-source.tar -C "$SRC" \
    gmail-proxy bridge-links chatwork-bridge infra

tar -xf /tmp/chathub-source.tar -C "$INSTALL"

# 実行時の Google Chat パッチは bridges/ 配下、配布用のミラーは infra/bridges/ 配下。
if [ -d "$INSTALL/infra/bridges/googlechat/patches" ]; then
  mkdir -p "$INSTALL/bridges/googlechat/patches"
  cp "$INSTALL"/infra/bridges/googlechat/patches/*.py "$INSTALL/bridges/googlechat/patches/"
fi

# push-config.json は webui の入れ替えで消えるので退避して戻す。
if [ -f "$INSTALL/webui/push-config.json" ]; then
  cp "$INSTALL/webui/push-config.json" /tmp/chathub-push-config.json
fi
find "$INSTALL/webui" -mindepth 1 -delete
tar -xf /tmp/chathub-webui.tar -C "$INSTALL/webui"
if [ -f /tmp/chathub-push-config.json ]; then
  cp /tmp/chathub-push-config.json "$INSTALL/webui/push-config.json"
fi
[ -f "$INSTALL/webui/index.html" ] || { echo "index.html missing after deploy" >&2; exit 1; }

cd "$INSTALL"
docker compose config -q
services=(webui bridge-links)
[ -f "$INSTALL/gmail-proxy/creds.json" ] && services+=(gmail-proxy)
[ -f "$INSTALL/chatwork-bridge/config.json" ] && services+=(chatwork-bridge)
docker compose up -d --force-recreate "${services[@]}"

echo "UPDATE_DONE $INSTALL"
