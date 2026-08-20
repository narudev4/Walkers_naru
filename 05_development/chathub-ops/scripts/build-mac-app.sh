#!/usr/bin/env bash
# Mac 用デスクトップアプリをビルドする。
#
# main.cjs は接続先を process.env.CHATHUB_PRIMARY_URL から読むが、electron-builder で
# パッケージした .app には環境変数が渡らず既定値の 127.0.0.1:8009 を掴んでしまう。
# そのためビルド時だけ既定値を naru のサーバーへ差し替え、作業ツリーは元に戻す。
set -euo pipefail

UI="/Users/naru/Walkers_naru/05_development/chathub-distribution/ui"
BASE="https://winnaru.tailac157e.ts.net"
BACKUP="/tmp/chathub-main.cjs.orig"

cd "$UI"
cp electron/main.cjs "$BACKUP"
trap 'cp "$BACKUP" "$UI/electron/main.cjs"' EXIT

sed -i '' "s#|| \"http://127.0.0.1:8009/\"#|| \"$BASE/\"#g" electron/main.cjs
echo "== patched default URL"
grep -n 'PRIMARY_URL =\|FALLBACK_URL =' electron/main.cjs

export VITE_MATRIX_BASE_URL="$BASE"
export VITE_GMAIL_PROXY_URL="$BASE/gmail"
npm run app:dir

# 未署名のままだと Gatekeeper に止められるので ad-hoc 署名する。
codesign --force --deep --sign - "release/mac-arm64/Chathub.app"
codesign --verify --verbose=1 "release/mac-arm64/Chathub.app" 2>&1 | tail -2

echo "APP_BUILT $UI/release/mac-arm64/Chathub.app"
