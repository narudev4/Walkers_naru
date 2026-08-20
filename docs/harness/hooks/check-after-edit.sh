#!/usr/bin/env bash
# PostToolUse hook（編集後警告・非ブロック）
# 編集したコードファイルだけを lint し、警告があれば Claude に伝えて自己修正させる。
# 全案件共通テンプレ。carveout/project-init が app に配置し、app/.claude/settings.json から呼ぶ。
# 設計方針: 失敗しても必ず exit 0（編集をブロックしない）。重い全体 typecheck はコミット前ゲートに任せる。
set -uo pipefail

INPUT=$(cat)
F=$(printf '%s' "$INPUT" | python3 -c 'import sys,json
d=json.load(sys.stdin)
print(d.get("tool_input",{}).get("file_path","") or d.get("tool_response",{}).get("filePath",""))' 2>/dev/null)

# コードファイル以外は対象外
case "$F" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac
[ -f "$F" ] || exit 0

# package.json のある最近接ディレクトリ（app ルート）を探す
DIR=$(dirname "$F"); ROOT=""
while [ "$DIR" != "/" ] && [ -n "$DIR" ]; do
  [ -f "$DIR/package.json" ] && { ROOT="$DIR"; break; }
  DIR=$(dirname "$DIR")
done
[ -z "$ROOT" ] && exit 0
cd "$ROOT" || exit 0

# eslint 設定が無ければ何もしない（degrade gracefully）
ls .eslintrc* eslint.config.* >/dev/null 2>&1 || exit 0

# 編集ファイルだけ lint（高速・非ブロック）
OUT=$(npx --no-install eslint "$F" 2>&1)
[ $? -eq 0 ] && exit 0

# 警告を Claude に渡す（additionalContext）。既存 naru hook と同じ形式
printf '%s' "$OUT" | tail -25 | python3 -c 'import sys,json
t=sys.stdin.read().strip()
f=sys.argv[1]
print(json.dumps({"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":f"⚠️ lint 警告 ({f}):\n{t}\n→ 次に進む前に修正してください。"}}, ensure_ascii=False))' "$F" 2>/dev/null || true
exit 0
