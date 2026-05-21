#!/usr/bin/env bash
# pre-sync-guard.sh
# S3 への同期前に「絶対に上げてはいけないもの」を検出して中止させる安全装置。
# sync-up.sh から呼ばれる。単独でもデバッグ用に直接実行可。
#
# Exit codes:
#   0 = 安全 (synced OK)
#   1 = 秘匿ファイル検出 (sync 中止)
#   2 = サイズ上限超過 (sync 中止)
#   3 = gitleaks による secrets 検出 (sync 中止)
#   4 = 環境エラー (依存ツール無し等)

set -euo pipefail

PROJ_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJ_ROOT"

RED=$'\033[31m'; YELLOW=$'\033[33m'; GREEN=$'\033[32m'; NC=$'\033[0m'

# ---- 1. 機密ファイル名パターンチェック ---------------------------------------

FORBIDDEN_PATTERNS=(
  '*.key' '*.pem' '*.p12' '*.pfx'
  '.env' '.env.*'
  '.mcp.json'
  '**/credentials.json'
  '**/api_key*' '**/token*' '**/secret*'
  'shinkoku.config.yaml' 'shinkoku.db' 'shinkoku.db-wal' 'shinkoku.db-shm'
)

# sync 対象 (rclone bisync で送るスコープ) を絞り込んだ上でチェック
SYNC_INCLUDES=(
  '00_context'
  '01_strategy'
  '02_finance'
  '03_projects'
  '04_sales'
  '06_learning'
  'DAILY.md'
)

violations=()
for inc in "${SYNC_INCLUDES[@]}"; do
  [[ -e "$inc" ]] || continue
  for pat in "${FORBIDDEN_PATTERNS[@]}"; do
    while IFS= read -r -d '' f; do
      violations+=("$f")
    done < <(find "$inc" -type f -name "${pat##*/}" -print0 2>/dev/null || true)
  done
done

# credentials/ , output/ , node_modules/ 配下の混入チェック
for inc in "${SYNC_INCLUDES[@]}"; do
  [[ -d "$inc" ]] || continue
  while IFS= read -r -d '' d; do
    violations+=("$d (混入禁止ディレクトリ)")
  done < <(find "$inc" -type d \( -name credentials -o -name node_modules -o -name '.git' -o -name '.shinkoku' \) -print0 2>/dev/null || true)
done

if (( ${#violations[@]} > 0 )); then
  echo "${RED}[GUARD] 秘匿ファイル / 禁止ディレクトリを検出。sync を中止します:${NC}" >&2
  printf '  - %s\n' "${violations[@]}" >&2
  exit 1
fi

# ---- 2. 巨大ファイルチェック (100MB 超は除外) --------------------------------

oversize=()
for inc in "${SYNC_INCLUDES[@]}"; do
  [[ -e "$inc" ]] || continue
  while IFS= read -r -d '' f; do
    oversize+=("$f")
  done < <(find "$inc" -type f -size +100M -print0 2>/dev/null || true)
done

if (( ${#oversize[@]} > 0 )); then
  echo "${YELLOW}[GUARD] 100MB 超のファイルを検出。S3 コストと帯域を考慮し中止します:${NC}" >&2
  printf '  - %s\n' "${oversize[@]}" >&2
  echo "  圧縮するか output/ 配下に移動してください。" >&2
  exit 2
fi

# ---- 3. gitleaks による secrets スキャン ------------------------------------

if command -v gitleaks >/dev/null 2>&1; then
  # --no-git: ワーキングツリー直スキャン (git index 関係なく検査)
  if ! gitleaks detect --no-git --source "$PROJ_ROOT" \
        --redact --exit-code 3 \
        --report-format json --report-path "$PROJ_ROOT/.sync-gitleaks-report.json" \
        >/dev/null 2>&1; then
    echo "${RED}[GUARD] gitleaks が secrets を検出。詳細: .sync-gitleaks-report.json${NC}" >&2
    exit 3
  fi
  rm -f "$PROJ_ROOT/.sync-gitleaks-report.json"
else
  echo "${YELLOW}[GUARD] gitleaks 未インストール。secrets スキャンをスキップします (brew install gitleaks 推奨)。${NC}" >&2
fi

echo "${GREEN}[GUARD] 事前チェック通過${NC}"
exit 0
