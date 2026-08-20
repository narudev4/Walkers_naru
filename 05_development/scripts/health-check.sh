#!/bin/bash
# health-check.sh — SessionStart hook 用の環境ヘルスチェック
# 目的: 「無音の故障」（トークン失効・stale データ・未コミット肥大）をセッション冒頭で1行可視化する
# 設計: 常に exit 0（セッション開始を絶対に妨げない）。結果は4時間キャッシュ。各チェックは max 3秒
# 廃止条件: 意思決定キュー(B14)のダッシュボードが同等の健全性表示を持ち、naru がそちらを常用し始めたら本 hook を外す

set +e
ROOT="/Users/naru/Walkers_naru"
CACHE="$ROOT/.ops/health-cache.txt"
CACHE_TTL=14400  # 4時間

# キャッシュが新しければそれを返す
if [ -f "$CACHE" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$CACHE" 2>/dev/null || echo 0) ))
  if [ "$AGE" -lt "$CACHE_TTL" ]; then
    cat "$CACHE"
    exit 0
  fi
fi

PARTS=()

# 1. Notion トークン生存
if [ -f "$ROOT/credentials/notion_token" ]; then
  NTOKEN=$(head -1 "$ROOT/credentials/notion_token" | tr -d '[:space:]')
  NCODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 \
    -H "Authorization: Bearer $NTOKEN" -H "Notion-Version: 2022-06-28" \
    "https://api.notion.com/v1/users/me" 2>/dev/null)
  [ "$NCODE" = "200" ] && PARTS+=("Notion:OK") || PARTS+=("⚠️Notion:${NCODE:-timeout}(トークン要確認/NA-004)")
fi

# 2. tl;dv API 生存
if [ -f "$ROOT/credentials/tldv_api_key.txt" ]; then
  TKEY=$(head -1 "$ROOT/credentials/tldv_api_key.txt" | tr -d '[:space:]')
  TCODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 \
    -H "x-api-key: $TKEY" "https://pasta.tldv.io/v1alpha1/meetings?limit=1" 2>/dev/null)
  [ "$TCODE" = "200" ] && PARTS+=("tl;dv:OK") || PARTS+=("⚠️tl;dv:${TCODE:-timeout}")
fi

# 4. 未コミット数
UNCOMMITTED=$(cd "$ROOT" && git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "${UNCOMMITTED:-0}" -gt 120 ]; then
  PARTS+=("⚠️git:未コミット${UNCOMMITTED}件")
else
  PARTS+=("git:未コミット${UNCOMMITTED}件")
fi

RESULT="[health $(date '+%m/%d %H:%M')] $(IFS=' | '; echo "${PARTS[*]}")"
mkdir -p "$ROOT/.ops"
echo "$RESULT" > "$CACHE"
echo "$RESULT"
exit 0
