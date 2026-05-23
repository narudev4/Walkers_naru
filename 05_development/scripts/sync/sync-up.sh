#!/usr/bin/env bash
# sync-up.sh
# ローカルから S3 へコンテキストを反映する。
# 1. pre-sync-guard.sh で安全チェック
# 2. rclone bisync で双方向差分同期 (S3 側変更も拾う)
# 3. context-view.sh を連鎖呼出で HTML 再生成 (--no-view で抑止可)
#
# 使い方:
#   ./sync-up.sh
#   ./sync-up.sh --dry-run
#   ./sync-up.sh --no-view     # HTML 再生成をスキップ
#   ./sync-up.sh --resync      # 状態破損時のフル同期

set -euo pipefail

PROJ_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJ_ROOT"

SCRIPT_DIR="${PROJ_ROOT}/05_development/scripts/sync"
S3_REMOTE="${WALKERS_S3_REMOTE:-walkers-s3}"
BUCKET="${WALKERS_S3_BUCKET:-walkers-context-prod}"
RCLONE_CONF="${PROJ_ROOT}/credentials/rclone.conf"
LOCK="${PROJ_ROOT}/.sync.lock"
LOG_DIR="${PROJ_ROOT}/.sync-logs"
mkdir -p "$LOG_DIR"

RED=$'\033[31m'; YELLOW=$'\033[33m'; GREEN=$'\033[32m'; NC=$'\033[0m'

DRY_RUN=0; NO_VIEW=0; RESYNC=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-view) NO_VIEW=1 ;;
    --resync)  RESYNC=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 64 ;;
  esac
done

# ---- 排他制御 ---------------------------------------------------------------
if [[ -f "$LOCK" ]]; then
  pid=$(cat "$LOCK" 2>/dev/null || echo "")
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "${RED}[sync-up] 別の同期処理が稼働中 (PID $pid)。中止します。${NC}" >&2
    exit 75
  fi
  rm -f "$LOCK"
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

# ---- 1. 安全チェック --------------------------------------------------------
echo "${GREEN}[sync-up] 事前チェック開始${NC}"
"$SCRIPT_DIR/pre-sync-guard.sh"

# ---- 2. rclone 準備 ---------------------------------------------------------
if ! command -v rclone >/dev/null 2>&1; then
  echo "${RED}[sync-up] rclone が見つかりません。${NC}" >&2; exit 4
fi
if [[ ! -f "$RCLONE_CONF" ]]; then
  echo "${RED}[sync-up] $RCLONE_CONF がありません。/aws-bootstrap を先に実行してください。${NC}" >&2; exit 4
fi

PAIRS=(
  "context|00_context"
  "context-daily|DAILY.md"
  "strategy|01_strategy"
  "finance|02_finance"
  "projects|03_projects"
  "sales|04_sales"
  "learning|06_learning"
)

FILTER_FILE="${SCRIPT_DIR}/sync.filter"

FLAGS=(
  --config "$RCLONE_CONF"
  --filter-from "$FILTER_FILE"
  --compare size,modtime,checksum
  --conflict-resolve newer
  --conflict-loser pathname
  --conflict-suffix conflict-$(date +%Y%m%d-%H%M%S)
  --max-delete 50
  --log-file "$LOG_DIR/sync-up-$(date +%Y%m%d-%H%M%S).log"
  --log-level INFO
)
(( DRY_RUN == 1 )) && FLAGS+=( --dry-run )
(( RESYNC == 1 )) && FLAGS+=( --resync )

# DAILY.md は専用ステージングへコピーしてから bisync (rclone は単一ファイル bisync 非対応)
if [[ -f "$PROJ_ROOT/DAILY.md" ]]; then
  mkdir -p "$PROJ_ROOT/.sync-daily"
  cp -p "$PROJ_ROOT/DAILY.md" "$PROJ_ROOT/.sync-daily/DAILY.md"
fi

for pair in "${PAIRS[@]}"; do
  prefix="${pair%%|*}"
  localpath="${pair##*|}"

  if [[ "$localpath" == "DAILY.md" ]]; then
    remote_path="${S3_REMOTE}:${BUCKET}/daily"
    local_path="${PROJ_ROOT}/.sync-daily"
  else
    remote_path="${S3_REMOTE}:${BUCKET}/${prefix}"
    local_path="${PROJ_ROOT}/${localpath}"
    [[ -d "$local_path" ]] || { echo "${YELLOW}[sync-up] スキップ (存在しない): $local_path${NC}"; continue; }
  fi

  echo "${GREEN}[sync-up] $local_path  ⇄  $remote_path${NC}"
  if ! rclone bisync "$local_path" "$remote_path" "${FLAGS[@]}"; then
    echo "${RED}[sync-up] bisync 失敗: $prefix。--resync で復旧を試してください。${NC}" >&2
    exit 5
  fi

  if [[ "$localpath" == "DAILY.md" && -f "$PROJ_ROOT/.sync-daily/DAILY.md" ]]; then
    cp -p "$PROJ_ROOT/.sync-daily/DAILY.md" "$PROJ_ROOT/DAILY.md"
  fi
done

# ---- 3. HTML 再生成 ---------------------------------------------------------
if (( NO_VIEW == 0 && DRY_RUN == 0 )); then
  if [[ -x "$SCRIPT_DIR/context-view.sh" ]]; then
    echo "${GREEN}[sync-up] HTML ビューを再生成${NC}"
    "$SCRIPT_DIR/context-view.sh" || echo "${YELLOW}[sync-up] context-view.sh が非ゼロ終了 (続行)${NC}"
  fi
fi

echo "${GREEN}[sync-up] 完了${NC}"
