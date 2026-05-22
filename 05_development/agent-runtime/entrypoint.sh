#!/usr/bin/env bash
# entrypoint.sh
# Secrets Manager から Google OAuth トークンを取得してファイルに書き出し、
# その後に CMD を実行する。

set -euo pipefail

if [[ -z "${WALKERS_GOOGLE_OAUTH_SECRET_ID:-}" ]]; then
  echo "[entrypoint] WALKERS_GOOGLE_OAUTH_SECRET_ID 未設定。OAuth トークンの取得をスキップ。" >&2
else
  echo "[entrypoint] Google OAuth トークンを Secrets Manager から取得"
  mkdir -p "${GOOGLE_WORKSPACE_MCP_TOKEN_DIR}"
  aws secretsmanager get-secret-value \
      --secret-id "${WALKERS_GOOGLE_OAUTH_SECRET_ID}" \
      --query SecretString --output text \
    > "${GOOGLE_WORKSPACE_MCP_TOKEN_DIR}/tokens.json"
  chmod 600 "${GOOGLE_WORKSPACE_MCP_TOKEN_DIR}/tokens.json"
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" ]] && [[ -n "${WALKERS_ANTHROPIC_SECRET_ID:-}" ]]; then
  echo "[entrypoint] Anthropic API key を Secrets Manager から取得"
  ANTHROPIC_API_KEY="$(aws secretsmanager get-secret-value \
      --secret-id "${WALKERS_ANTHROPIC_SECRET_ID}" \
      --query SecretString --output text)"
  export ANTHROPIC_API_KEY
fi

exec "$@"
