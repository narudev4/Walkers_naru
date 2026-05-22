# Agent Runtime (v3) 設計と運用

S3 上のコンテキストを真理源として、クラウド常駐の Claude エージェントが Google Workspace MCP・タスクグラフを操作する。

## アーキテクチャ

```
EventBridge Scheduler ─┐
                       │ (06:00 / 22:00 JST)
                       ▼
                  ┌────────────────────────────────┐
                  │ ECS Fargate Service             │
                  │ ┌────────────────────────────┐  │
                  │ │ agent.py (Anthropic SDK)    │  │
                  │ │  ├─ Google Workspace MCP    │  │
                  │ │  │   (uvx workspace-mcp)    │  │
                  │ │  ├─ task_graph.py           │  │
                  │ │  └─ boto3 (S3, Secrets)     │  │
                  │ └────────────────────────────┘  │
                  └──────────┬─────────────────────┘
                             │
                ┌────────────┴────────────────┐
                ▼                             ▼
        S3: walkers-context-prod        Secrets Manager
        ├─ context/                     ├─ walkers/anthropic-api-key
        ├─ projects/                    └─ walkers/google-oauth-tokens
        ├─ tasks/{project}.json
        └─ html/
```

## なぜ ECS Fargate (Lambda ではなく)

- **MCP セッションは長寿命** — Lambda の 15 分上限と相性が悪い
- **Google OAuth リフレッシュトークンを memory 上で持ち回したい** — Lambda の cold start は OAuth フローを再実行する負荷を生む
- **Fargate Spot で常駐コスト ¥1,500/月 程度** — 自宅 Windows OFF 時の保険として常駐させても安い
- **Slack 入口 (v4) で API Gateway 経由のリクエスト処理にもそのまま使える**

## ファイル構成

```
05_development/agent-runtime/
├── Dockerfile                 # Python 3.12 + uv + workspace-mcp
├── pyproject.toml             # 依存ライブラリ
├── agent.py                   # メインループ / MCP セッション管理
├── task_graph.py              # タスク永続化 / Calendar 連携
├── scheduled_morning.py       # 朝のエントリ
├── scheduled_evening.py       # 夜のエントリ
├── handler_slack.py           # v4: Slack webhook ハンドラ
└── iac/
    ├── main.tf                # ECR / ECS / IAM / EventBridge / Secrets
    ├── variables.tf
    └── outputs.tf
```

## タスクグラフのデータモデル

`s3://walkers-context-prod/tasks/{project_id}.json`:

```json
{
  "project_id": "walkers-internal",
  "updated_at": "2026-05-21T06:00:00+09:00",
  "tasks": [
    {
      "id": "t-001",
      "title": "クライアント A 提案書ドラフト",
      "owner": "naru",
      "due": "2026-05-25",
      "status": "in_progress",
      "depends_on": [],
      "calendar_event_id": "abc123",
      "notes": "前提条件ヒアリング待ち"
    }
  ]
}
```

`status` は `todo` / `in_progress` / `blocked` / `done` / `cancelled`。

Agent は朝 06:00 に各プロジェクトのタスクを棚卸しし、`due` が当日のものを Google Calendar に予定として書き込む (`mcp__google-workspace__create_event` を使用、`naru.hosoya@walker-s.co.jp` のカレンダーに対して)。

## OAuth トークンの取り扱い

Google Workspace MCP (`uvx workspace-mcp`) は OAuth フローでブラウザを開く必要がある。ECS 上ではブラウザを開けないため、以下の運用にする:

1. **初回**: Mac で `uvx workspace-mcp` を起動 → ブラウザ OAuth 完了 → ローカルに `~/.config/google-workspace-mcp/tokens.json` が生成
2. このファイルを Secrets Manager `walkers/google-oauth-tokens` に登録 (JSON 文字列として)
3. ECS 起動時、Agent コンテナがエントリポイントで Secrets Manager から JSON を取得 → 期待パスに書き出し → MCP プロセスを起動
4. リフレッシュトークンが回転したら定期的に Secrets Manager に書き戻す (`agent.py` の `_persist_tokens()` で対応)

## Secrets Manager のキー一覧

| キー | 内容 |
|---|---|
| `walkers/anthropic-api-key` | Anthropic API key (sk-ant-...) |
| `walkers/google-oauth-tokens` | Google OAuth トークン JSON 全文 |
| `walkers/basic-auth` (v2) | CloudFront Basic 認証パス |
| `walkers/slack-signing-secret` (v4) | Slack signing secret |
| `walkers/slack-bot-token` (v4) | Slack bot token |

## CloudWatch Logs

ロググループ: `/ecs/walkers-agent`

主要ログイベント:
- `agent_started` — task 起動
- `mcp_connected` — Google Workspace MCP 接続成功
- `task_graph_loaded {project}` — `tasks/{project}.json` 読込
- `task_graph_saved {project}` — 保存
- `calendar_event_created {event_id}` — Calendar 書込
- `claude_api_call {tokens_used}` — Claude API 呼出
- `error.<kind>` — 各種失敗

## ローカル開発

```bash
cd 05_development/agent-runtime
uv sync
# .env.local に ANTHROPIC_API_KEY を書く
ANTHROPIC_API_KEY=$(cat .env.local | grep ANTHROPIC | cut -d= -f2) \
  uv run python agent.py --once --project walkers-internal
```

## デプロイ

`/agent-deploy` スキル経由で:

1. `docker build --platform linux/amd64 .`
2. ECR push
3. `aws ecs update-service --force-new-deployment`

詳細は `.claude/skills/agent-deploy/SKILL.md`。

## 緊急停止

Agent が暴走 (Claude API を無限に叩く等) した場合:

```bash
aws ecs update-service --cluster walkers-agent --service walkers-agent --desired-count 0
```

ECR の最新イメージを直前タグに戻し、`--desired-count 1` で復旧。
