#!/bin/bash
# YouTube AI動画 自動制作ランナー
# launchd から毎日深夜に実行される
# スプシから未着手URLを1件取得 → STEP 1〜6 を自動実行

set -euo pipefail

WORKDIR="/Users/naru/Walkers_naru/05_development/youtube"
LOG_DIR="$WORKDIR/logs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/auto-produce_${TIMESTAMP}.log"

mkdir -p "$LOG_DIR"

echo "=== YouTube Auto-Produce: $(date) ===" | tee "$LOG_FILE"

# claude CLI へのプロンプト
# MCP接続済み環境で実行されるため、Google Sheets MCP でスプシ読み書き可能
PROMPT=$(cat <<'PROMPT_EOF'
YouTube動画の自動制作を実行する。確認ゲートなし・全自動モード。

## 手順

### 1. スプシから未着手URLを取得
スプレッドシート ID: 10KOwMXfHJqAdPDCWloWio1IZC_o6IUGUaoUCPsVl1l0
- B列（ステータス）が「未着手」の行を上から1件取得
- 該当なければ「未着手URLなし」と出力して終了
- 該当URLのB列を「処理中」に更新、D列に現在日時を記入
- A列のURLからslugを抽出（例: what-is-zapier）、C列に記入

### 2. STEP 1: 記事スクレイピング
/yt-scrape スキルを実行。URL → projects/{slug}/article.md

### 3. STEP 2: 台本生成（確認ゲートなし）
/yt-script スキルを実行。article.md → script.md
台本の品質確認はスキップ。自動で次に進む。

### 4. STEP 3: スライド生成
/yt-slides スキルを実行。script.md → slides.json → slides.pptx
カードの文字量ルールを厳守（1アイテム最大15文字、\n禁止、最大3アイテム/カード）。

### 5. STEP 4: 音声生成
/yt-voice スキルを実行。script.md → full.wav

### 6. STEP 5: 音声分割
/yt-split-audio スキルを実行。full.wav → scenes/*.wav

### 7. STEP 5.5: 概要欄チャプター生成
scenes/*.wav の秒数から累積タイムスタンプを算出し、script.md の概要欄を更新。

### 8. STEP 6: HeyGen セットアップ
/yt-heygen スキルを実行。
Phase 0: PPTXアップロード（browser-use CLI）
Phase 1+2: 音声アップ + アバター配置（Playwright CDP）

### 9. スプシ更新
B列を「HeyGen準備完了」に更新、E列に完了日時を記入。

### 10. macOS通知
osascript -e 'display notification "{slug} HeyGen準備完了。確認してGenerate押してね" with title "YouTube自動化"'

## 重要ルール
- 各STEPでエラーが出た場合、スプシのB列を「エラー」、F列にエラー内容を記入して終了
- 確認ゲート（OK待ち）は一切行わない
- 全て自動で進める
PROMPT_EOF
)

cd "$WORKDIR"

echo "Starting claude with auto-produce prompt..." | tee -a "$LOG_FILE"
echo "Working directory: $WORKDIR" | tee -a "$LOG_FILE"

# claude CLI 実行（非対話モード）
claude -p "$PROMPT" \
  --verbose \
  2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

echo "" | tee -a "$LOG_FILE"
echo "=== Completed with exit code: $EXIT_CODE at $(date) ===" | tee -a "$LOG_FILE"

# 異常終了時のmacOS通知
if [ $EXIT_CODE -ne 0 ]; then
  osascript -e "display notification \"自動制作でエラーが発生しました。ログを確認してください。\" with title \"YouTube自動化 エラー\"" 2>/dev/null || true
fi

exit $EXIT_CODE
