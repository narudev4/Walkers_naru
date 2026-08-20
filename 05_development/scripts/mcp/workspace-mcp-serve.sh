#!/bin/bash
# workspace-mcp 共有 HTTP 常駐サーバ起動スクリプト (Option C)
#
# 目的: google-workspace MCP を streamable-http の常駐サーバ 1 個に集約し、
#       全 Claude セッションが http://localhost:8000/mcp へリモート接続する。
#       stdio 版で起きていた「各セッションが自前プロセスを起動し固定ポート 8000 を
#       奪い合う」問題を解消する。
#
# 実行主体: launchd (com.walkers.workspace-mcp)。RunAtLoad + KeepAlive で自動再起動。
# secret: credentials/workspace-mcp/serve.env を source する (= .gitignore 済み)。
#         このスクリプト自体に secret は持たせない (git 管理対象)。
set -euo pipefail

# launchd はログインシェルの環境 (PATH 等) を継承しない。
# uv / workspace-mcp は ~/.local/bin にあるため明示的に通す。
export PATH="/Users/naru/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# GOOGLE_OAUTH_CLIENT_ID / _SECRET / USER_GOOGLE_EMAIL / GOOGLE_MCP_CREDENTIALS_DIR
source /Users/naru/Walkers_naru/credentials/workspace-mcp/serve.env

# 待受ポート。既定 8000。テスト時のみ呼び出し側 (plist) の env で上書き可能。
export WORKSPACE_MCP_PORT="${WORKSPACE_MCP_PORT:-8000}"

# localhost 限定バインド (CRITICAL):
# legacy streamable-http (MCP_ENABLE_OAUTH21 未設定) は MCP レベルの認証が無い。
# 127.0.0.1 に固定し、同一 LAN の他ホストから Google 全権限を叩かれるのを防ぐ。
# ※ 未設定でもこのモードの既定は 127.0.0.1 だが、意図を明示するため固定する。
export WORKSPACE_MCP_HOST="127.0.0.1"

# ポートドリフト防止:
# streamable-http はポートを直接 bind し、衝突時は exit(1) する (KeepAlive が 8000 で再起動)。
# resolver ベースのフォールバックは stdio 専用だが、念のため 0 (フォールバック無し) を明示。
export WORKSPACE_MCP_PORT_FALLBACK_COUNT=0

exec /Users/naru/.local/bin/workspace-mcp \
  --transport streamable-http \
  --single-user \
  --tool-tier complete
