#!/usr/bin/env bash
# claude-runner を非対話 (-p) で 1 回実行するラッパー
# 使い方: ./run.sh "プロンプト" [追加の claude フラグ...]
#   例: ./run.sh "Reply with exactly OK" --max-turns 1
# 前提: 同ディレクトリの .env に CLAUDE_CODE_OAUTH_TOKEN=... がある (.env.example をコピー)
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env がありません。.env.example をコピーしてトークンを入れてください" >&2; exit 2; }
IMAGE="${IMAGE:-claude-runner:local}"
PLATFORM_OPT=""
[ -n "${PLATFORM:-}" ] && PLATFORM_OPT="--platform ${PLATFORM}"   # 例: PLATFORM=linux/amd64 IMAGE=claude-runner:amd64
mkdir -p work
prompt="$1"; shift
docker run --rm ${PLATFORM_OPT} \
  --env-file .env \
  -v "$(pwd)/work:/home/runner/work" \
  "${IMAGE}" \
  -p "${prompt}" --output-format json "$@"
