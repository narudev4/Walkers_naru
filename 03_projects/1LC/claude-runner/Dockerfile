# claude-runner: Claude Code CLI を非対話 (`claude -p`) で常駐実行するための最小イメージ
# - ベース: Ubuntu 24.04
# - 非 root ユーザー `runner` で実行
# - 公式インストーラ (ネイティブバイナリ、Node.js 不要) を使用
# - 認証トークンは絶対にイメージに焼かない (実行時に --env-file で渡す)
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
# 最小構成: curl (インストーラ取得), ca-certificates (TLS), git (claude が作業ツリー検出に使う), ripgrep (Grep ツール)
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates git ripgrep \
 && rm -rf /var/lib/apt/lists/*

# 非 root ユーザー (ubuntu:24.04 は uid 1000 が既に "ubuntu" なので 1001 を使う)
RUN useradd -m -u 1001 -s /bin/bash runner
USER runner
WORKDIR /home/runner

# 公式インストーラ (https://code.claude.com/docs/en/setup) → ~/.local/bin/claude
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/runner/.local/bin:${PATH}"

# 作業用ディレクトリ (ホストからマウントする想定)
RUN mkdir -p /home/runner/work
WORKDIR /home/runner/work

ENTRYPOINT ["claude"]
CMD ["--version"]
