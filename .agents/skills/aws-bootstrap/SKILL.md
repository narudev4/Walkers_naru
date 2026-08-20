---
description: AWS アカウント未開設状態から、S3 バケット 2 つ・IAM ユーザー 2 つ・ライフサイクル設定までを対話で構築する。MVP のクロスデバイス同期に必要な最低限のリソース。
---

# aws-bootstrap

AWS アカウントを開設したばかりの状態から、Walkers コンテキスト同期に必要なリソースを構築する。

## 前提

ユーザーに以下を確認してから着手:

1. AWS アカウント開設済 (https://aws.amazon.com/jp/register-flow/)
2. root ユーザーに MFA 設定済
3. IAM Admin ユーザー作成済、`aws configure` で Access Key 設定済
4. リージョンは `ap-northeast-1` (デフォルト、変更可)

未完了なら手順を案内してから止まる。

## トリガー

- 「AWS セットアップ」「aws bootstrap」「同期を始めたい」
- 初回の `/sync-down` 失敗時 (rclone.conf が無いケース)

## 実行手順

1. ユーザーに前提条件 4 項目を 1 つずつ確認
2. `bash 05_development/scripts/sync/aws-bootstrap.sh --check` で既存リソースを確認
3. 必要なら本実行: `bash 05_development/scripts/sync/aws-bootstrap.sh`
4. スクリプトが `credentials/rclone.conf` に access key を書き込む (gitignore 配下)
5. 完了後に `/sync-down --resync` で初回同期を案内

## オプション

| フラグ | 用途 |
|---|---|
| `--check` | 存在チェックのみ (作成しない) |
| `--skip-cloudfront` | MVP 時点での S3 + IAM のみ作成 |

## 構築されるリソース

| リソース | 名前 | 設定 |
|---|---|---|
| S3 バケット | `walkers-context-prod` | Versioning ON / SSE-S3 / Public Block / Lifecycle (30d→IA, 180d→Glacier) |
| S3 バケット | `walkers-context-view` | Public Block (CloudFront OAC 経由のみ) |
| IAM User | `walkers-sync-mac` | 該当 S3 バケットへの最小権限 |
| IAM User | `walkers-sync-win` | 該当 S3 バケットへの最小権限 |

CloudFront + CF Functions Basic Auth は v2 で別途 `.Codex/refs/aws-cloudfront.md` 経由で構築。

## 失敗時

- `aws sts get-caller-identity` 失敗 → `aws configure` 案内
- バケット名重複 (S3 はグローバル一意) → suffix を付ける案を提示し `WALKERS_S3_BUCKET` で上書き

## 関連

- `docs/aws-setup.md`: 手順全文
- `/sync-down`, `/sync-up`: bootstrap 完了後に使う
