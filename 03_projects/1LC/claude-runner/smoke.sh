#!/usr/bin/env bash
# トークン認証の疎通テスト。合格条件: is_error=false かつ result に OK が含まれる
set -euo pipefail
cd "$(dirname "$0")"
set +e
out=$(./run.sh "Reply with exactly the word OK and nothing else." --max-turns 1 --model sonnet 2>&1)
rc=$?
set -e
echo "claude exit code: $rc"
echo "$out" | python3 -c '
import sys, json
d = json.loads(sys.stdin.read())
print("is_error      :", d.get("is_error"))
print("result        :", d.get("result"))
print("model usage   :", list(d.get("modelUsage", {}).keys()))
print("duration_ms   :", d.get("duration_ms"))
print("total_cost_usd:", d.get("total_cost_usd"), "(サブスクでは請求に無関係の参考値)")
ok = (not d.get("is_error")) and "OK" in str(d.get("result",""))
print("SMOKE:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
'
