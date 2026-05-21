#!/usr/bin/env bash
# aws-bootstrap.sh
# AWS アカウント (未開設からスタート前提) を一通り設定する対話スクリプト。
# 必要なリソース: S3 x 2, IAM User x 2, CloudFront Distribution, CF Function, Secrets Manager
#
# 前提:
#   - AWS アカウント開設済 (https://aws.amazon.com/jp/register-flow/)
#   - root ユーザーに MFA 設定済
#   - IAM Admin ユーザーを 1 つ作成し、その access key を aws configure 済
#
# 使い方:
#   ./aws-bootstrap.sh                  # 対話モード
#   ./aws-bootstrap.sh --check          # 既存リソースの存在チェックのみ
#   ./aws-bootstrap.sh --skip-cloudfront # MVP の S3 + IAM だけ作る

set -euo pipefail

PROJ_ROOT="$(git rev-parse --show-toplevel)"
cd "$PROJ_ROOT"

REGION="${WALKERS_AWS_REGION:-ap-northeast-1}"
DATA_BUCKET="${WALKERS_S3_BUCKET:-walkers-context-prod}"
VIEW_BUCKET="${WALKERS_S3_VIEW_BUCKET:-walkers-context-view}"

RED=$'\033[31m'; YELLOW=$'\033[33m'; GREEN=$'\033[32m'; NC=$'\033[0m'

CHECK_ONLY=0; SKIP_CF=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    --skip-cloudfront) SKIP_CF=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 64 ;;
  esac
done

# ---- 依存チェック ----------------------------------------------------------
if ! command -v aws >/dev/null 2>&1; then
  echo "${RED}aws CLI が必要 (brew install awscli)${NC}" >&2; exit 4
fi
if ! aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1; then
  echo "${RED}aws configure が未完了。Access Key を設定してください。${NC}" >&2; exit 4
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "${GREEN}[aws-bootstrap] AWS Account: $ACCOUNT_ID  Region: $REGION${NC}"

# ---- 確認: 存在チェック ----------------------------------------------------
check_bucket() {
  local b="$1"
  if aws s3api head-bucket --bucket "$b" 2>/dev/null; then
    echo "  ${GREEN}✓${NC} $b 存在"
    return 0
  else
    echo "  ${YELLOW}-${NC} $b 未作成"
    return 1
  fi
}

echo "${GREEN}[check] S3 バケット${NC}"
check_bucket "$DATA_BUCKET" && data_exists=1 || data_exists=0
check_bucket "$VIEW_BUCKET" && view_exists=1 || view_exists=0

if (( CHECK_ONLY == 1 )); then exit 0; fi

# ---- データバケット作成 -----------------------------------------------------
if (( data_exists == 0 )); then
  echo "${GREEN}[create] $DATA_BUCKET${NC}"
  aws s3api create-bucket --bucket "$DATA_BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
  aws s3api put-bucket-versioning --bucket "$DATA_BUCKET" \
    --versioning-configuration Status=Enabled
  aws s3api put-bucket-encryption --bucket "$DATA_BUCKET" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api put-public-access-block --bucket "$DATA_BUCKET" \
    --public-access-block-configuration '{"BlockPublicAcls":true,"IgnorePublicAcls":true,"BlockPublicPolicy":true,"RestrictPublicBuckets":true}'
  aws s3api put-bucket-lifecycle-configuration --bucket "$DATA_BUCKET" --lifecycle-configuration '{
    "Rules": [
      {"ID":"transition-to-ia","Status":"Enabled","Filter":{},"Transitions":[{"Days":30,"StorageClass":"STANDARD_IA"}]},
      {"ID":"transition-to-glacier","Status":"Enabled","Filter":{},"Transitions":[{"Days":180,"StorageClass":"GLACIER"}]},
      {"ID":"expire-old-versions","Status":"Enabled","Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":365}}
    ]
  }'
fi

# ---- view バケット作成 ----------------------------------------------------
if (( view_exists == 0 && SKIP_CF == 0 )); then
  echo "${GREEN}[create] $VIEW_BUCKET${NC}"
  aws s3api create-bucket --bucket "$VIEW_BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"
  aws s3api put-public-access-block --bucket "$VIEW_BUCKET" \
    --public-access-block-configuration '{"BlockPublicAcls":true,"IgnorePublicAcls":true,"BlockPublicPolicy":true,"RestrictPublicBuckets":true}'
fi

# ---- IAM ユーザー作成 -------------------------------------------------------
mkdir -p "$PROJ_ROOT/credentials"
RCLONE_CONF="$PROJ_ROOT/credentials/rclone.conf"
touch "$RCLONE_CONF"; chmod 600 "$RCLONE_CONF"

create_iam_user() {
  local user="$1"
  if aws iam get-user --user-name "$user" >/dev/null 2>&1; then
    echo "  ${GREEN}✓${NC} IAM user $user 存在"
    return
  fi
  echo "${GREEN}[create] IAM user $user${NC}"
  aws iam create-user --user-name "$user"

  # スコープを限定したインラインポリシー
  policy=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket","s3:GetBucketLocation","s3:GetBucketVersioning"],
      "Resource": ["arn:aws:s3:::$DATA_BUCKET","arn:aws:s3:::$VIEW_BUCKET"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:GetObjectVersion","s3:ListBucketMultipartUploads","s3:AbortMultipartUpload","s3:ListMultipartUploadParts"],
      "Resource": ["arn:aws:s3:::$DATA_BUCKET/*","arn:aws:s3:::$VIEW_BUCKET/*"]
    }
  ]
}
JSON
  )
  aws iam put-user-policy --user-name "$user" --policy-name "walkers-sync-policy" --policy-document "$policy"

  echo "${GREEN}[create] $user の access key を発行${NC}"
  key_json=$(aws iam create-access-key --user-name "$user")
  ak=$(echo "$key_json" | sed -n 's/.*"AccessKeyId": "\([^"]*\)".*/\1/p')
  sk=$(echo "$key_json" | sed -n 's/.*"SecretAccessKey": "\([^"]*\)".*/\1/p')

  if [[ -z "$ak" || -z "$sk" ]]; then
    echo "${RED}access key 生成失敗 (jq があれば確実です)${NC}" >&2
    exit 5
  fi

  remote_name="walkers-s3"
  if [[ "$user" == *win* ]]; then remote_name="walkers-s3-win"; fi

  cat >> "$RCLONE_CONF" <<EOF

[$remote_name]
type = s3
provider = AWS
env_auth = false
access_key_id = $ak
secret_access_key = $sk
region = $REGION
storage_class = STANDARD
acl = private
server_side_encryption = AES256
EOF
  echo "  ${GREEN}→${NC} $RCLONE_CONF に [$remote_name] を追記"
}

create_iam_user "walkers-sync-mac"
create_iam_user "walkers-sync-win"

echo "${GREEN}[done] MVP 用 AWS リソース作成完了${NC}"
echo "次のステップ:"
echo "  1. rclone bisync $DATA_BUCKET を初回 --resync で実行 (sync-down.sh --resync)"
echo "  2. CloudFront + CF Functions Basic Auth は別途 v2 で設定 (.claude/refs/aws-cloudfront.md 参照予定)"
echo "  3. credentials/rclone.conf は .gitignore 配下に置いたまま、絶対 push しない"
