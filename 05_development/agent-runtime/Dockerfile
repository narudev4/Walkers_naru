# Walkers Agent Runtime
# Python 3.12 + uv + Anthropic SDK + Google Workspace MCP (uvx)
#
# linux/amd64 を強制 (ECS Fargate デフォルト)。M1/M2 Mac でビルドする時は
# docker build --platform linux/amd64 . が必要。

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# システム依存
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
        # workspace-mcp が一部の OAuth フローで使う
        git \
    && rm -rf /var/lib/apt/lists/*

# uv をインストール (workspace-mcp は uvx 経由で起動)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    mv /root/.local/bin/uvx /usr/local/bin/uvx

WORKDIR /app

# Python 依存をインストール
COPY pyproject.toml ./
RUN uv pip install --system --no-cache -e .

# Agent コード
COPY agent.py task_graph.py mcp_session.py s3_context.py \
     scheduled_morning.py scheduled_evening.py handler_slack.py \
     entrypoint.sh ./
RUN chmod +x entrypoint.sh

# workspace-mcp を事前 fetch (uvx 初回起動の cold start を軽減)
RUN uvx --help >/dev/null && \
    (uvx workspace-mcp --help >/dev/null 2>&1 || true)

# OAuth トークン書き出し先
ENV GOOGLE_WORKSPACE_MCP_TOKEN_DIR=/app/.workspace-mcp \
    ANTHROPIC_LOG=info

ENTRYPOINT ["./entrypoint.sh"]
# デフォルトは常駐モード。EventBridge / Slack ハンドラから別エントリ呼出可
CMD ["python", "agent.py", "--mode", "daemon"]
