---
description: 作業終了時にローカルから S3 (walkers-context-prod) へ書き戻し、CloudFront 配下の HTML ビューも自動再生成する。
---

# sync-up

ローカルのコンテキスト変更を S3 に反映する。`/session-checkpoint` の後に必ず呼ぶ。

## トリガー

- 「保存して」「同期上げ」「sync up」「push して」
- `/session-checkpoint` の末尾 (自動連鎖)
- 重要な編集 (decisions.md 更新等) の直後

## 実行手順

1. `bash 05_development/scripts/sync/sync-up.sh` を実行
2. 内部で:
   - `pre-sync-guard.sh` が secrets / 100MB 超 / 禁止ディレクトリ混入を検査
   - 違反があれば中止 (exit code 1-3)
   - 通過したら rclone bisync で S3 に反映
   - 最後に `context-view.sh` で HTML 再生成 → view bucket に publish

## オプション

| フラグ | 用途 |
|---|---|
| `--dry-run` | 何が変わるか確認のみ |
| `--no-view` | HTML 再生成をスキップ (高速) |
| `--resync` | 状態破損時のフル同期 |

## 失敗時の対処

| Exit code | 原因 | 対処 |
|---|---|---|
| 1 | 秘匿ファイル検出 | 該当ファイルを `credentials/` か `.gitignore` 配下に移動 |
| 2 | 100MB 超 | 圧縮 or `output/` 配下へ移動 |
| 3 | gitleaks が secrets 検出 | `.sync-gitleaks-report.json` を確認し該当箇所を除去 |
| 5 | bisync 失敗 | `--resync` で復旧、または `/context-doctor` |
| 75 | 別の同期処理稼働中 | `.sync.lock` を確認、必要なら削除 |

## 関連

- `/sync-down`: S3 → ローカル
- `/context-view`: HTML 再生成のみ
- `/session-checkpoint`: セッション保存 (sync-up を連鎖呼出する)
