# 別アカウント / 別端末から作業を再開する手順

S3 クロスデバイス同期 (MVP) の真価は「**どんな Claude アカウント / どんな端末からも、最後の作業状態に戻れる**」こと。本書はそのための具体手順。

## 前提

- S3 リソース構築済 (`/aws-bootstrap` 実行済、`docs/aws-setup.md` 参照)
- `credentials/rclone.conf` に `[walkers-s3]` / `[walkers-s3-win]` セクションが揃っている (1Password などで安全に配布)
- 主作業端末で最低 1 回 `/sync-up` が成功し、S3 にコンテキストが置かれている

## ケース A: 同じ Mac で **別 Claude アカウント** から再開

最も簡単。ローカルファイルはそのまま、Claude セッションだけ別アカウントで起動。

```bash
# 1. Walkers ディレクトリへ
cd ~/Walkers_naru

# 2. 念のため最新を取り込み (他端末で更新があれば反映)
bash 05_development/scripts/sync/sync-down.sh

# 3. 別アカウントでログイン済の状態で claude 起動
claude
```

新アカウントの Claude には前セッションのチャット履歴は引き継がれないが、**ローカルファイル (CLAUDE.md, スキル, 各種コンテキスト) はすべて読み込まれる**ので、状態の把握 → 続き作業はすぐできる。

「前回どこまで決めたか」を取り戻すには:
- `cat .review/decisions.md` (議論ログ)
- `cat DAILY.md` (日報)
- `git log --oneline -10` (直近 commit)

## ケース B: **別 Mac** から再開（新端末セットアップ含む）

```bash
# 1. 必要ツールをインストール
brew install rclone awscli gitleaks pandoc git gh
curl -LsSf https://astral.sh/uv/install.sh | sh   # v3 Agent runtime 用

# 2. リポジトリを clone
git clone git@github.com:<owner>/Walkers_naru.git
cd Walkers_naru

# 3. aws CLI 設定 (1Password の Walkers IAM Admin Item から)
aws configure
# Default region: ap-northeast-1
# 動作確認
aws sts get-caller-identity

# 4. credentials/rclone.conf を配布する (Mac 間の安全な手段)
#    例: 1Password CLI 経由
op read "op://Walkers/rclone.conf/notesPlain" > credentials/rclone.conf
chmod 600 credentials/rclone.conf

# 5. 初回同期 (bisync の state がないので --resync 必須)
bash 05_development/scripts/sync/sync-down.sh --resync

# 6. claude 起動
claude
```

## ケース C: **Windows / WSL2** から再開

```bash
# WSL2 内で
# 1-3 は Mac と同様 (apt または brew on WSL)
sudo apt install -y rclone awscli gitleaks pandoc git gh

git clone git@github.com:<owner>/Walkers_naru.git
cd Walkers_naru
aws configure
op read "op://Walkers/rclone.conf/notesPlain" > credentials/rclone.conf
chmod 600 credentials/rclone.conf

# 4. Windows 用の rclone remote (walkers-s3-win) で初回同期
WALKERS_S3_REMOTE=walkers-s3-win \
  bash 05_development/scripts/sync/sync-down.sh --resync
```

## ケース D: **iPhone (リモコン)** から作業継続

iPhone からは直接 Claude を起動できないので、Windows プロキシ経由:

1. iPhone → Splashtop / Microsoft Remote Desktop で Windows に接続
2. Windows 側のターミナルで:
   ```bash
   cd ~/Walkers_naru
   bash 05_development/scripts/sync/sync-down.sh
   claude
   ```
3. 作業後:
   ```bash
   bash 05_development/scripts/sync/sync-up.sh
   ```

軽い閲覧だけなら CloudFront 経由 (v2 で構築予定):
- iPhone Safari で `https://<cloudfront-domain>/` → S3 view bucket の HTML を Basic 認証で見る

## トラブルシュート

| 症状 | 対処 |
|---|---|
| `aws sts get-caller-identity` が NoCredentials | `aws configure` を再実行 |
| rclone bisync が `Resync` を要求 | `bash sync-down.sh --resync` で復旧 |
| sync 中に competing lock エラー | `rm .sync.lock` してから再実行 |
| `credentials/rclone.conf` がない | `/aws-bootstrap` を再実行するか、1Password から配布 |
| 同期したのに最新が見えない | 他端末で `sync-up` が完了してるか確認、`rclone --config credentials/rclone.conf ls walkers-s3:walkers-context-prod/context` で S3 側を直接確認 |

## 注意

- `credentials/` 配下は **絶対に git に push しない** (.gitignore で除外済み)
- `aws_secret_access_key` を URL や Slack / GitHub Issue に貼らない (Claude もこれを書こうとしたら拒否する)
- 3 ヶ月に 1 回 access key をローテーション (`docs/aws-setup.md` 7 章)

## 関連

- `docs/aws-setup.md`: AWS 初回セットアップ手順
- `docs/agent-runtime.md`: v3 のクラウド常駐 Agent (ECS Fargate)
- `.review/decisions.md`: 設計議論ログ
