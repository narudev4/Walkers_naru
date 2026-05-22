#!/usr/bin/env bash
# context-view.sh
# Markdown コンテキストを HTML 化し、S3 view bucket (walkers-context-view) に公開する。
# CloudFront + CF Functions Basic Auth でスマホ Safari から閲覧する想定。
#
# 使い方:
#   ./context-view.sh             # 生成 + S3 アップロード
#   ./context-view.sh --local     # 生成のみ (S3 アップロードしない)
#   ./context-view.sh --open      # 生成 + ブラウザ起動 (macOS)

set -euo pipefail

PROJ_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJ_ROOT"

S3_REMOTE="${WALKERS_S3_REMOTE:-walkers-s3}"
VIEW_BUCKET="${WALKERS_S3_VIEW_BUCKET:-walkers-context-view}"
RCLONE_CONF="${PROJ_ROOT}/credentials/rclone.conf"
OUT_DIR="${PROJ_ROOT}/output/context-view"
mkdir -p "$OUT_DIR"

RED=$'\033[31m'; YELLOW=$'\033[33m'; GREEN=$'\033[32m'; NC=$'\033[0m'

LOCAL_ONLY=0; OPEN_AFTER=0
for arg in "$@"; do
  case "$arg" in
    --local) LOCAL_ONLY=1 ;;
    --open)  OPEN_AFTER=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 64 ;;
  esac
done

# ---- 依存チェック ----------------------------------------------------------
if ! command -v pandoc >/dev/null 2>&1; then
  echo "${RED}[context-view] pandoc が必要です (brew install pandoc)${NC}" >&2
  exit 4
fi

# ---- HTML 化対象を列挙 -----------------------------------------------------
TARGETS=(
  "DAILY.md"
  "00_context"
  "01_strategy"
  "02_finance"
  "03_projects"
  "04_sales"
  "06_learning"
)

generated=()
for t in "${TARGETS[@]}"; do
  if [[ -f "$t" ]]; then
    out="$OUT_DIR/${t%.md}.html"
    pandoc "$t" -s -o "$out" \
      --metadata title="$(basename "$t" .md)" \
      --css /style.css \
      --standalone --quiet
    generated+=("${t%.md}.html|$t")
  elif [[ -d "$t" ]]; then
    while IFS= read -r -d '' md; do
      rel="${md#./}"
      out="$OUT_DIR/${rel%.md}.html"
      mkdir -p "$(dirname "$out")"
      pandoc "$md" -s -o "$out" \
        --metadata title="$rel" \
        --css /style.css \
        --standalone --quiet
      generated+=("${rel%.md}.html|$rel")
    done < <(find "$t" -type f -name '*.md' -not -path '*/node_modules/*' -print0)
  fi
done

# ---- スマホ向け index.html を生成 ------------------------------------------
INDEX="$OUT_DIR/index.html"
NOW="$(date '+%Y-%m-%d %H:%M:%S %Z')"

{
  cat <<'HEAD'
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Walkers Context</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header><h1>Walkers Context</h1><p class="updated">UPDATED</p></header>
<main>
HEAD
  echo "<section><h2>クイックリンク</h2><ul>"
  echo '<li><a href="DAILY.html">DAILY</a></li>'
  echo '<li><a href="00_context/memories/decisions.html">decisions</a></li>'
  echo '<li><a href="00_context/memories/facts.html">facts</a></li>'
  echo '<li><a href="00_context/memories/preferences.html">preferences</a></li>'
  echo "</ul></section>"

  echo "<section><h2>進行中プロジェクト</h2><ul>"
  if [[ -d "03_projects" ]]; then
    while IFS= read -r d; do
      name="${d#03_projects/}"
      readme=""
      for cand in README.md index.md project.md "${name}.md"; do
        if [[ -f "$d/$cand" ]]; then readme="$d/$cand"; break; fi
      done
      if [[ -n "$readme" ]]; then
        echo "<li><a href=\"${readme%.md}.html\">$name</a></li>"
      else
        echo "<li>$name</li>"
      fi
    done < <(find 03_projects -mindepth 1 -maxdepth 1 -type d | sort)
  fi
  echo "</ul></section>"

  echo "<section><h2>全ドキュメント</h2><ul>"
  for line in "${generated[@]}"; do
    href="${line%%|*}"; label="${line##*|}"
    echo "<li><a href=\"$href\">$label</a></li>"
  done
  echo "</ul></section>"
  cat <<'TAIL'
</main>
</body>
</html>
TAIL
} > "$INDEX"

# 動的に UPDATED を差し替え (sed の互換のため別ファイルにリダイレクト)
tmp="$(mktemp)"
awk -v now="$NOW" '{ gsub(/UPDATED/, now); print }' "$INDEX" > "$tmp" && mv "$tmp" "$INDEX"

# ---- 最小 CSS (モバイル可読性重視) -----------------------------------------
cat > "$OUT_DIR/style.css" <<'CSS'
:root{color-scheme:light dark}
body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;
     max-width:760px;margin:0 auto;padding:1rem;line-height:1.7}
header h1{margin:.2em 0}
.updated{color:#888;font-size:.85em}
h2{border-bottom:1px solid #ccc;padding-bottom:.2em;margin-top:2em}
a{color:#0a66c2;text-decoration:none}
a:hover{text-decoration:underline}
pre,code{background:#f5f5f5;padding:.1em .3em;border-radius:3px;font-size:.92em;overflow-x:auto}
@media (prefers-color-scheme: dark){
  body{background:#111;color:#eee}
  pre,code{background:#222}
  h2{border-color:#444}
}
CSS

echo "${GREEN}[context-view] HTML を ${#generated[@]} 件 + index.html を生成${NC}"

# ---- S3 アップロード -------------------------------------------------------
if (( LOCAL_ONLY == 0 )); then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "${RED}[context-view] rclone が必要${NC}" >&2; exit 4
  fi
  if [[ ! -f "$RCLONE_CONF" ]]; then
    echo "${RED}[context-view] $RCLONE_CONF がありません${NC}" >&2; exit 4
  fi

  echo "${GREEN}[context-view] S3 ($VIEW_BUCKET) にアップロード${NC}"
  rclone sync "$OUT_DIR" "${S3_REMOTE}:${VIEW_BUCKET}" \
    --config "$RCLONE_CONF" \
    --header-upload "Cache-Control: max-age=300, must-revalidate" \
    --exclude '.DS_Store' \
    --quiet
  echo "${GREEN}[context-view] 完了 — CloudFront URL を開いて確認してください${NC}"
fi

if (( OPEN_AFTER == 1 )); then
  if command -v open >/dev/null 2>&1; then
    open "$INDEX"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$INDEX"
  fi
fi
