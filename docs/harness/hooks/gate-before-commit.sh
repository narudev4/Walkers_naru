#!/usr/bin/env bash
# PreToolUse hook（コミット前ゲート・ブロック）
# `git commit` を検知したら lint + typecheck + test を走らせ、失敗したらコミットを止める。
# 全案件共通テンプレ。carveout/project-init が app に配置し、app/.claude/settings.json から呼ぶ。
# ブロック方式: exit 2 + stderr（PreToolUse は exit 2 でツール実行を止め、stderr を Claude に渡す）。
set -uo pipefail

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | python3 -c 'import sys,json
d=json.load(sys.stdin); print(d.get("tool_input",{}).get("command",""))' 2>/dev/null)

# git commit 以外は素通り
case "$CMD" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# app ルート（package.json 最近接）。無ければゲートなし
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$ROOT/package.json" ] || exit 0
cd "$ROOT" || exit 0

if [ -f pnpm-lock.yaml ]; then PM="pnpm"; elif [ -f yarn.lock ]; then PM="yarn"; else PM="npm"; fi
has() { python3 -c 'import sys,json;print("1" if sys.argv[1] in json.load(open("package.json")).get("scripts",{}) else "")' "$1" 2>/dev/null; }

FAIL=""; RAN=0
run() { # $1=ラベル $2=コマンド
  RAN=$((RAN+1)); echo "▶ $1 ..." >&2
  if ! eval "$2" >/tmp/gate-$$.log 2>&1; then
    FAIL="${FAIL}\n--- $1 失敗 ---\n$(tail -30 /tmp/gate-$$.log)"
  fi
}

[ -n "$(has lint)" ] && run "lint" "$PM run lint"
if [ -n "$(has typecheck)" ]; then run "typecheck" "$PM run typecheck"
elif [ -f tsconfig.json ]; then run "typecheck" "npx --no-install tsc --noEmit"; fi
[ -n "$(has test)" ] && run "test" "$PM test"
rm -f /tmp/gate-$$.log

if [ -n "$FAIL" ]; then
  printf '⛔ コミット前ゲート不合格。修正してから再コミットしてください。%b\n' "$FAIL" >&2
  exit 2
fi
[ "$RAN" -eq 0 ] && exit 0   # 検査項目なし＝ゲートなしで素通り（誤った合格表示を出さない）
echo "✅ コミット前ゲート通過（${RAN}項目: lint/typecheck/test のうち定義分）" >&2
exit 0
