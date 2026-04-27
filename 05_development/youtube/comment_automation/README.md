# YouTube 既存動画一括コメント投稿ツール

`@walkers-development` の既存152本の動画に対し、サービス案内コメント（固定）と目次コメント（非固定）を自動投稿する。

## アーキテクチャ

3フェーズのハイブリッド設計：

| Phase | スクリプト | 実行方式 | 出力 |
|--|--|--|--|
| A: データ収集 | `01_collect.py` | YouTube Data API (APIキー認証) | `data/videos_raw.json` |
| B: スプシ整形 | `02_to_sheet.py` | ローカル変換 | `data/sheet_rows.{json,tsv}` |
| C: 投稿+固定 | `03_post_comments.py` | Playwright + Chrome CDP | `data/run_log.jsonl` |

API でコメント固定（pin）ができないため、書き込みは Chrome 自動化に寄せている。

## セットアップ

### 1. 依存ライブラリ

```bash
cd /Users/naru/Walkers_naru/05_development/youtube/comment_automation
pip install playwright python-dotenv google-api-python-client
playwright install chromium
```

### 2. YouTube Data API キー取得

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. APIs & Services → Library → **YouTube Data API v3** を有効化
3. APIs & Services → Credentials → **Create Credentials → API key**
4. 作成したキーをコピー

### 3. `.env` 作成

```bash
cp .env.example .env
# エディタで YOUTUBE_API_KEY=... を入れる
```

### 4. Chrome の準備（Phase C のみ）

- Profile 4（walker-s.co.jp）で `@walkers-development` のチャンネル所有者としてログイン済みであること
- 投稿実行前に CDP launcher で起動:
  ```bash
  /Users/naru/Walkers_naru/05_development/scripts/chrome-cdp-launcher.sh start
  ```
  → localhost:9222 で CDP 接続可能な Chrome が立ち上がる

## 実行手順

### Phase A: 動画データ収集

```bash
# 動作確認（1本だけ）
python 01_collect.py --limit 1

# 全152本
python 01_collect.py
```

出力: `data/videos_raw.json`（video_id, title, 概要欄、目次抽出結果、既コメント判定）

### Phase B: スプシ用データ整形

```bash
python 02_to_sheet.py
```

出力:
- `data/sheet_rows.json` — Claude が MCP で Google Sheets に書き込む用
- `data/sheet_rows.tsv` — 手動コピペの fallback

次に Claude に「スプシ作成して」と頼む（`mcp__google-workspace__create_spreadsheet` 経由）。

### 目視確認（手動）

スプシで以下をチェック:
- `toc_parse_ok=FALSE` の行の目次が本当に取れないのか（必要なら `toc_comment` を手修正）
- `already_commented=TRUE` の行（本当にスキップでいいか）
- 概要欄がおかしい動画がないか

### Phase C: 投稿・固定

```bash
# dry-run（投稿せずログだけ）
python 03_post_comments.py --dry-run --limit 3

# 1本だけ本番
python 03_post_comments.py --limit 1

# 特定動画のみ
python 03_post_comments.py --video-id XXXX --video-id YYYY

# 全本（pending のみ、約15〜30分）
python 03_post_comments.py
```

進捗は `data/run_log.jsonl` に逐次追記されるので、中断しても再実行で続きから。

## ステータス定義

| status | 意味 |
|--|--|
| `pending` | 未処理、投稿対象 |
| `skipped_already_commented` | 既にサービス案内コメントあり（APIで検出） |
| `skipped_already_commented_dom` | 実行直前のDOM再チェックで検出 |
| `pending_comments_disabled` | コメント無効化されている |
| `pinned_and_posted` | サービス案内を投稿+固定、目次も投稿 |
| `posted_intro_pinned_toc_empty` | サービス案内のみ（目次が無い動画） |
| `failed:<reason>` | 何らかのエラー |

## トラブルシュート

- **Phase A でAPI割当超過**: 日をまたぐか、`--skip-comment-check` で投稿前チェックを省略（Phase C の DOM 再チェックで拾える）
- **Phase C で固定に失敗**: `_shared/heygen-automation-learnings.md` を参照。React click 吸収の可能性
- **Chrome が CDP で繋がらない**: `chrome-cdp-launcher.sh status` で確認
