#!/bin/bash
# Cockpit をビルドして /Applications に入れる。
#
# ad-hoc 署名が必須。未署名だと macOS の UserNotifications が登録を拒否し、
# 通知が UNErrorDomain error 1 (NotificationsNotAllowed) で落ちる。
# electron-builder は identity:null で署名を飛ばすので、ここで自分で署名する。
#
# 発火条件: desktop/main.js を変更したとき
# 廃止条件: 署名付きの正式配布に切り替えたら不要
set -euo pipefail
cd "$(dirname "$0")"

APP=/Applications/Cockpit.app

echo "▸ 起動中なら終了"
osascript -e 'tell application "Cockpit" to quit' 2>/dev/null || true
sleep 2
pkill -f 'Cockpit.app/Contents/MacOS/Cockpit' 2>/dev/null || true

echo "▸ ビルド"
npx electron-builder --mac --dir >/dev/null

echo "▸ 差し替え"
rm -rf "$APP"
cp -R dist/mac-arm64/Cockpit.app "$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "▸ ad-hoc 署名（通知に必須）"
codesign --force --deep --sign - "$APP"
codesign --verify "$APP" && echo "  署名OK: $(codesign -dv "$APP" 2>&1 | grep Identifier= | head -1)"

echo "▸ 完了。open -a Cockpit で起動"
