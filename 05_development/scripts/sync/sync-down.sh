#!/usr/bin/env bash
# sync-down.sh
# S3 (walkers-context-prod) からローカルへ最新コンテキストを取り込む。
# rclone bisync の差分同期で、競合は newer 採用・loser を .conflict-{ts} で保持。
#
# 使い方:
#   ./sync-down.sh             # 通常実行
#   ./sync-down.sh --dry-run   # 何が変わるかだけ表示
#   ./sync-down.sh --resync    # 初回 or 状態破損時のフル同期

set -euo pipefail

PROJ_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJ_ROOT"

S3_REMOTE="${WALKERS_S3_REMOTE:-walkers-s3}"   # rclone.conf の [walkers-s3] を指す
BUCKET="${WALKERS_S3_BUCKET:-walkers-context-prod}"
RCLONE_CONF="${PROJ_ROOT}/credentials/rclone.conf"
LOCK="${PROJ_ROOT}/.sync.lock"
LOG_DIR="${PROJ_ROOT}/.sync-logs"
mkdir -p "$LOG_DIR"

RED=$'\033[31m'; YELLOW=$'\033[33m'; GREEN=$'\033[32m'; NC=$'\033[0m'

DRY_RUN=0; RESYNC=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --resync)  RESYNC=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 64 ;;
  esac
done

# ---- 排他制御 ---------------------------------------------------------------
if [[ -f "$LOCK" ]]; then
  pid=$(cat "$LOCK" 2>/dev/null || echo "")
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "${RED}[sync-down] 別の同期処理が稼働中 (PID $pid)。中止します。${NC}" >&2
    exit 75
  fi
  echo "${YELLOW}[sync-down] 古いロックを除去します。${NC}"
  rm -f "$LOCK"
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

# ---- rclone 設定確認 --------------------------------------------------------
if ! command -v rclone >/dev/null 2>&1; then
  echo "${RED}[sync-down] rclone が見つかりません。brew install rclone もしくは https://rclone.org/install/${NC}" >&2
  exit 4
fi
if [[ ! -f "$RCLONE_CONF" ]]; then
  echo "${RED}[sync-down] $RCLONE_CONF がありません。/aws-bootstrap を先に実行してください。${NC}" >&2
  exit 4
fi

# ---- bisync 対象 prefix と includes の対応 -----------------------------------
# S3 側 prefix とローカルパスのマッピング (1 対 1)
# context/   → 00_context, DAILY.md
# projects/  → 03_projects
# strategy/  → 01_strategy
# finance/   → 02_finance
# sales/     → 04_sales
# learning/  → 06_learning
#
# 個別 bisync は state ファイルが prefix ごとに必要なので prefix 単位で実行。

PAIRS=(
  "context|00_context"
  "context-daily|DAILY.md"
  "strategy|01_strategy"
  "finance|02_finance"
  "projects|03_projects"
  "sales|04_sales"
  "learning|06_learning"
)

SCRIPT_DIR="${PROJ_ROOT}/05_development/scripts/sync"
FILTER_FILE="${SCRIPT_DIR}/sync.filter"

FLAGS=(
  --config "$RCLONE_CONF"
  --filter-from "$FILTER_FILE"
  --compare size,modtime,checksum
  --conflict-resolve newer
  --conflict-loser pathname
  --conflict-suffix conflict-$(date +%Y%m%d-%H%M%S)
  --max-delete 50
  --log-file "$LOG_DIR/sync-down-$(date +%Y%m%d-%H%M%S).log"
  --log-level INFO
)
(( DRY_RUN == 1 )) && FLAGS+=( --dry-run )
(( RESYNC == 1 )) && FLAGS+=( --resync )

for pair in "${PAIRS[@]}"; do
  prefix="${pair%%|*}"
  localpath="${pair##*|}"

  # 単一ファイル (DAILY.md) は親ディレクトリで bisync
  if [[ "$localpath" == "DAILY.md" ]]; then
    remote_path="${S3_REMOTE}:${BUCKET}/daily"
    local_path="${PROJ_ROOT}/.sync-daily"
    mkdir -p "$local_path"
    [[ -f "$PROJ_ROOT/DAILY.md" && ! -e "$local_path/DAILY.md" ]] && cp -p "$PROJ_ROOT/DAILY.md" "$local_path/DAILY.md"
  else
    remote_path="${S3_REMOTE}:${BUCKET}/${prefix}"
    local_path="${PROJ_ROOT}/${localpath}"
    mkdir -p "$local_path"
  fi

  echo "${GREEN}[sync-down] $remote_path  ⇄  $local_path${NC}"
  if ! rclone bisync "$remote_path" "$local_path" "${FLAGS[@]}"; then
    echo "${RED}[sync-down] bisync 失敗: $prefix。--resync で復旧を試してください。${NC}" >&2
    exit 5
  fi

  # DAILY.md は本体に反映
  if [[ "$localpath" == "DAILY.md" && -f "$local_path/DAILY.md" ]]; then
    cp -p "$local_path/DAILY.md" "$PROJ_ROOT/DAILY.md"
  fi
done

echo "${GREEN}[sync-down] 完了${NC}"
