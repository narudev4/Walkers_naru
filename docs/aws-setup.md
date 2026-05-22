# AWS セットアップ手順書

クロスデバイス・コンテキスト同期の MVP に必要な AWS リソース構築手順。

## 0. 前提条件

| 項目 | 確認方法 |
|------|---------|
| AWS アカウント開設 | https://aws.amazon.com/jp/register-flow/ で完了 |
| root ユーザーに MFA | IAM コンソール → セキュリティ認証情報 |
| IAM Admin ユーザー作成 | コンソールで作成、AdministratorAccess ポリシー付与 |
| `aws` CLI インストール | `brew install awscli`、`aws --version` で v2 を確認 |
| `aws configure` 完了 | `aws sts get-caller-identity` が JSON を返す |
| `rclone` インストール | `brew install rclone`、`rclone version` で確認 |
| `pandoc` インストール (v2 で必須) | `brew install pandoc` |
| `gitleaks` インストール (推奨) | `brew install gitleaks` |
| リージョン選択 | `ap-northeast-1` (東京) を本書では既定 |

## 1. MVP リソース構築 (1 コマンドで完了)

```bash
cd /Users/naru/Walkers_naru   # Mac の場合
bash 05_development/scripts/sync/aws-bootstrap.sh
```

スクリプトが順に以下を実行:

1. `walkers-context-prod` バケット作成 (Versioning ON / SSE-S3 / Public Block / Lifecycle)
2. `walkers-context-view` バケット作成 (Public Block)
3. IAM ユーザー `walkers-sync-mac` 作成 + 最小権限ポリシー付与 + access key 発行
4. IAM ユーザー `walkers-sync-win` 同上
5. `credentials/rclone.conf` に `[walkers-s3]` / `[walkers-s3-win]` セクションを追記

## 2. 動作確認

```bash
# rclone から S3 が見えるか
rclone --config credentials/rclone.conf lsd walkers-s3:walkers-context-prod

# 初回同期 (空バケットなので --resync 必須)
bash 05_development/scripts/sync/sync-down.sh --resync

# 試しに 1 ファイル作成
mkdir -p 00_context/memories
echo "test $(date)" > 00_context/memories/sync-test.md

# 上げる
bash 05_development/scripts/sync/sync-up.sh --no-view

# S3 に反映確認
rclone --config credentials/rclone.conf cat walkers-s3:walkers-context-prod/context/memories/sync-test.md
```

## 3. もう一方の端末セットアップ (Windows/WSL2)

`credentials/rclone.conf` の `[walkers-s3-win]` セクションをコピーして Windows 側の同じパスに配置 (安全な手段: 1Password CLI / SSH 経由)。

```bash
# WSL2 上で
cd ~/Walkers_naru
bash 05_development/scripts/sync/sync-down.sh --resync
# Mac 側で作成した sync-test.md が落ちてくる
```

## 4. v2 で追加: CloudFront + Basic Auth

`walkers-context-view` バケットの前面に CloudFront を立て、CF Functions で Basic 認証する。詳細は **`.claude/refs/aws-cloudfront.md`** を v2 着手時に新規作成する。

骨格:

1. CloudFront Distribution を OAC (Origin Access Control) 経由で `walkers-context-view` に向ける
2. CF Function (viewer-request) で `Authorization` ヘッダを検証
3. 認証情報は Secrets Manager `walkers/basic-auth` から取得 (CF Function は同期取得不可なので、定数埋め込み + 定期ローテーション運用)
4. `walkers-context-view` のバケットポリシーで CloudFront OAC からのみ GetObject を許可

## 5. コスト見積もり (月額、参考)

| サービス | 想定使用量 | コスト |
|---|---|---|
| S3 Standard | 10GB | ¥30 |
| S3 リクエスト | 月 10K PUT, 100K GET | ¥30 |
| CloudFront | 月 5GB 転送 | ¥80 |
| IAM | 無料 | ¥0 |
| Secrets Manager | 2 シークレット | ¥80 |
| **MVP 合計** |  | **約 ¥220 / 月** |

v3 で Agent SDK ランタイム (ECS Fargate) を載せると、Fargate Spot で常駐 0.25vCPU/0.5GB なら追加 ¥1,500 / 月程度。

## 6. トラブルシュート

| 症状 | 対処 |
|---|---|
| `aws s3api create-bucket` で `BucketAlreadyExists` | S3 バケット名はグローバル一意。`export WALKERS_S3_BUCKET=walkers-context-prod-naru` 等で suffix を付ける |
| `rclone bisync` が `Resync` を要求 | `--resync` フラグ付きで一度実行 |
| `pre-sync-guard.sh` が exit 1 で止まる | 出力を確認し、該当ファイルを `credentials/` or gitignore 配下へ移動 |
| `gitleaks` で false positive | `.gitleaksignore` に該当パスを追記 |

## 7. 鍵ローテーション

3 ヶ月に 1 回:

```bash
# 新しい access key を作成
aws iam create-access-key --user-name walkers-sync-mac
# credentials/rclone.conf を更新
# 古い key を無効化
aws iam update-access-key --user-name walkers-sync-mac --access-key-id OLD_KEY --status Inactive
# 1 週間運用して問題なければ削除
aws iam delete-access-key --user-name walkers-sync-mac --access-key-id OLD_KEY
```
