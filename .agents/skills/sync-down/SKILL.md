---
description: 作業開始時に S3 (walkers-context-prod) から最新コンテキストをローカルへ取り込む。Mac/Windows 間の橋渡し。
---

# sync-down

S3 を真理源として、`00_context/`, `01_strategy/`, `02_finance/`, `03_projects/`, `04_sales/`, `06_learning/`, `DAILY.md` をローカルに差分同期する。

## トリガー

ユーザーが以下を言ったら自動で起動:

- 「同期して」「最新取って」「sync down」「pull」
- 朝の作業開始時 (`/morning-routine` から内部呼出)
- セッション切替後の最初の作業前

## 実行手順

1. `bash 05_development/scripts/sync/sync-down.sh` を実行
2. 競合があれば `.conflict-{timestamp}` ファイルが出るので、`/context-doctor` を案内
3. `--dry-run` で差分だけ見たい場合は引数に渡す

## オプション

| フラグ | 用途 |
|---|---|
| `--dry-run` | 何が変わるかだけ表示 (実反映しない) |
| `--resync` | 初回 or 状態破損時のフル同期 |

## 失敗時

- `rclone` が無い → `brew install rclone` を案内
- `credentials/rclone.conf` が無い → `/aws-bootstrap` を案内
- bisync が `Resync` を要求 → `--resync` 付きで再実行

## 関連

- `/sync-up`: ローカル → S3
- `/context-doctor`: 競合ファイル一覧と整合チェック
- `/aws-bootstrap`: AWS リソース初期構築
