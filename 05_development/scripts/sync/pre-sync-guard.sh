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
  # 鍵ファイル
  '*.key' '*.pem' '*.p12' '*.pfx'
  # 実 .env ファイル (.env.example / .env.sample は対象外として明示列挙)
  '.env' '.env.local' '.env.production' '.env.development' '.env.staging'
  # MCP 設定 (個人 OAuth トークン等含む)
  '.mcp.json'
  # 認証情報
  'credentials.json'
  # API キー・トークン (具体名、'token' のみでは過剰検出)
  'api_key*' 'apikey*' 'access_token*' 'auth_token*' 'tokens.json'
  # secret は接頭辞でなく接尾辞ベース or 具体名で
  'secret.json' 'secrets.json' '*.secret'
  # Shinkoku 系
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

# SSOT: sync.filter で実際に同期されるファイル集合だけを検査対象にする。
# rclone lsf を bisync と同じ filter で回すので、filter で除外されるファイル
# (.env.local 等) は検査に出ず、filter を素通りする新種 secret だけが残る。
# → sync.filter と guard の二重メンテ (PTJ_ glob の drift) を構造的に根絶する。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILTER_FILE="${SCRIPT_DIR}/sync.filter"

if ! command -v rclone >/dev/null 2>&1; then
  echo "${RED}[GUARD] rclone が必要です (filter 駆動の検査に使用)。brew install rclone${NC}" >&2
  exit 4
fi

matches_forbidden() {
  local base="$1" pat
  for pat in "${FORBIDDEN_PATTERNS[@]}"; do
    # shellcheck disable=SC2254
    case "$base" in $pat) return 0 ;; esac
  done
  return 1
}

violations=()
for inc in "${SYNC_INCLUDES[@]}"; do
  [[ -e "$inc" ]] || continue
  if [[ -f "$inc" ]]; then
    # 単一ファイル (DAILY.md): basename を直接照合
    matches_forbidden "${inc##*/}" && violations+=("$inc")
  else
    # ディレクトリ: sync.filter 適用後に実際に同期されるファイルだけを照合
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      matches_forbidden "${f##*/}" && violations+=("$inc/$f")
    done < <(rclone lsf "$inc" --filter-from "$FILTER_FILE" -R --files-only 2>/dev/null || true)
  fi
done

if (( ${#violations[@]} > 0 )); then
  echo "${RED}[GUARD] 秘匿ファイル名パターンを検出 (sync.filter で除外されない領域)。sync を中止します:${NC}" >&2
  printf '  - %s\n' "${violations[@]}" >&2
  exit 1
fi

# 注: 旧版で行っていた 100MB 上限 / node_modules 混入チェックは sync.filter に統合済。
# 必要に応じて手動 sanity check は `rclone lsf walkers-s3:walkers-context-prod --recursive --include '*' --max-size 100M=false` で実施。

# ---- 3. gitleaks による secrets スキャン ------------------------------------

if command -v gitleaks >/dev/null 2>&1; then
  # --no-git: ワーキングツリー直スキャン (git index 関係なく検査)
  # --config: 独立 git リポ等の allowlist (../.gitleaks.toml)
  GITLEAKS_CONFIG="$PROJ_ROOT/.gitleaks.toml"
  config_arg=()
  [[ -f "$GITLEAKS_CONFIG" ]] && config_arg=( --config "$GITLEAKS_CONFIG" )

  if ! gitleaks detect --no-git --source "$PROJ_ROOT" \
        "${config_arg[@]}" \
        --redact --exit-code 3 \
        --report-format json --report-path "$PROJ_ROOT/.sync-gitleaks-report.json" \
        >/dev/null 2>&1; then
    echo "${RED}[GUARD] gitleaks が secrets を検出。詳細: .sync-gitleaks-report.json${NC}" >&2
    echo "  対処: 検出されたファイルを credentials/ へ退避、または .gitleaks.toml の allowlist に追加 (既知/別管理の場合のみ)" >&2
    exit 3
  fi
  rm -f "$PROJ_ROOT/.sync-gitleaks-report.json"
else
  echo "${YELLOW}[GUARD] gitleaks 未インストール。secrets スキャンをスキップします (brew install gitleaks 推奨)。${NC}" >&2
fi

echo "${GREEN}[GUARD] 事前チェック通過${NC}"
exit 0
