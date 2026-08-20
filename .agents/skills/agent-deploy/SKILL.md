---
description: v3 のクラウド常駐 Agent SDK ランタイムをビルド・ECR push・ECS Fargate にデプロイする。Google Workspace MCP と S3 をつないだエージェントを動かすための運用スキル。
---

# agent-deploy

`05_development/agent-runtime/` のコンテナイメージをビルドして AWS ECS Fargate に反映する。

## 前提

1. `/aws-bootstrap` 完了済 (S3 バケット存在)
2. ECR リポジトリ `walkers-agent` が `iac/` の Terraform で apply 済
3. Secrets Manager に以下が登録済:
   - `walkers/anthropic-api-key`
   - `walkers/google-oauth-tokens`
4. `aws configure` が完了している

未完了なら `docs/agent-runtime.md` を案内して止まる。

## トリガー

- 「Agent デプロイ」「agent deploy」「ランタイム更新」
- Agent コード (`05_development/agent-runtime/*.py`) 変更後

## 実行手順

### 1. IaC 確認 (初回のみ)

```bash
cd 05_development/agent-runtime/iac
terraform init
terraform plan
terraform apply
```

### 2. コンテナビルド + ECR push

```bash
PROJ_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJ_ROOT/05_development/agent-runtime"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="${WALKERS_AWS_REGION:-ap-northeast-1}"
ECR_REPO="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/walkers-agent"

aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ECR_REPO"
docker build --platform linux/amd64 -t walkers-agent:latest .
docker tag walkers-agent:latest "$ECR_REPO:latest"
docker tag walkers-agent:latest "$ECR_REPO:$(date +%Y%m%d-%H%M%S)"
docker push "$ECR_REPO:latest"
docker push "$ECR_REPO:$(date +%Y%m%d-%H%M%S)"
```

### 3. ECS Service の更新 (rolling deploy)

```bash
aws ecs update-service \
  --cluster walkers-agent \
  --service walkers-agent \
  --force-new-deployment \
  --region $REGION
```

### 4. ロールバック手順

```bash
# 直前タグ確認
aws ecr describe-images --repository-name walkers-agent --region $REGION \
  --query 'sort_by(imageDetails,& imagePushedAt)[*].imageTags[]' --output table

# task-definition を直前タグに戻して再デプロイ
# (Terraform 経由が安全)
```

## 失敗時

- `docker build` 失敗 → 依存ライブラリ確認 (`uv pip list` 等)
- ECR push 認証失敗 → ECR token 期限 (12h) → `get-login-password` を再実行
- ECS deploy で task が CrashLoopBackOff → CloudWatch Logs `/ecs/walkers-agent` を確認

## 関連

- `docs/agent-runtime.md`: 全体設計とトラブルシュート
- `/aws-bootstrap`: MVP リソース構築
- `/sync-up`: 同期側のスキル
