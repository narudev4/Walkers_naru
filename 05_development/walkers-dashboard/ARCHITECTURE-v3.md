# Walkers Dashboard v3 アーキテクチャ設計書

**バージョン**: v1.0
**作成日**: 2026-03-11
**ステータス**: 設計確定・実装前

---

## 1. 概要・目的

Walkers Dashboard（localhost:8080）に以下の機能を追加し、WalkersのAI業務基盤を構築する。

### 追加機能

| 機能 | 概要 |
|------|------|
| **Agents パネル** | OpenClaw模倣の定期実行（Heartbeat）+ サブエージェント管理（ACP接続） |
| **Gallery パネル** | バイブコーディング成果物の社内共有ギャラリー（Skill Hub的UI） |
| **Webhook Gateway** | LINE/Slack等からのスキル起動（即時応答） |
| **Cron Engine** | Claude Code Max を活用した定期タスク実行 |

### なぜやるか

- **Agents**: スキルの定期実行（トレンドチェック、記事モニター等）やサブエージェントの起動・監視をダッシュボードから一元管理したい
- **Gallery**: AIで作った成果物が散在しており、「誰が何を作ったか」が見えない。営業モックではなく自社ツール・自分プロダクトを共有するギャラリー
- **Webhook/Cron**: モバイルから指示を出して即レスが返る仕組み + バックグラウンド定期実行

---

## 2. 設計判断

### 判断 #1: モック vs 成果物の分離

| 分類 | 対象 | 管理場所 |
|------|------|---------|
| 営業モック | hasegawa-j-studio, tire-wms, blueshift-mockup 等 | Projects パネル（03_projects/配下） |
| バイブコーディング成果物 | SEO Monitor, ChatHub拡張, GAS Renamer 等 | **Gallery パネル（新規）** |

**理由**: 営業モックはクライアント提案用で案件に紐づく。成果物は自社ツールとして社内共有が目的。混同すると管理が破綻する。

### 判断 #2: Gallery DB → Google Sheets

Skill Hubと同じパターンで、Google Sheetsをマスターデータ＋ローカルJSONキャッシュ。

- 複数PCから参照可能
- オフライン時はJSONフォールバック
- gallery-registry シートを新規作成

### 判断 #3: 定期実行マシン → 会社共有PC（Win + Mac混在）

- 常時稼働の共有PC 2台にジョブ設定（1台プライマリ、1台バックアップ）
- Windows: タスクスケジューラ / Mac: launchd/cron
- 個人PCは開発・ダッシュボード操作用

### 判断 #4: LLMコスト設計 → Max + API ハイブリッド

| 実行パターン | LLM | コスト |
|------------|-----|-------|
| 定期実行（cron） | Claude Code Max (scheduled-tasks) | **$0** |
| ダッシュボード手動操作 | Claude Code Max | **$0** |
| LLM不要の処理 | なし | **$0** |
| チャット即時応答 | Anthropic API | **従量課金** |

**契約リソース**:
- 幹部メンバー各自 Claude Max（個人PC用）
- 共有PC用 Claude Max 1アカウント（定期実行エンジンとして活用）
- Anthropic APIキー（チャット即時応答用、未取得）

### 判断 #5: チャット連携 → Webhook Gateway + API即時応答

- モバイルから指示 → 即レスが基本
- LINE / Slack / 専用アプリ 複数対応
- Webhookゲートウェイで共通パイプライン化

### 判断 #6: MCP接続方針 → ハイブリッド

| 実行経路 | ツール接続方法 |
|---------|-------------|
| Claude Code Max（定期実行） | 既存の .mcp.json + MCPサーバー経由 |
| Anthropic API（チャット） | Python直接API呼び出し（Tool Use） |

よく使うAPI操作は共通Pythonモジュールとして切り出し、両方から共有:
- `tools/google_calendar.py`
- `tools/notion_client.py`
- `tools/taskgod_client.py`

### 判断 #7: OpenClawパターンの適用

OpenClawのアーキテクチャから以下を採用:

| OpenClaw パターン | Walkers 適用 |
|-----------------|-------------|
| Single Gateway | server.py を拡張してゲートウェイ化 |
| Two-tier Heartbeat | 安いチェック先 → LLMは必要時のみエスカレーション |
| HEARTBEAT.md | heartbeats.json + チェック項目 |
| Channel Layer | 共通メッセージ構造でLINE/Slack/API統一 |
| Skills as Markdown | .claude/commands/*.md（既存） |
| Device Tokens | チャット認証（将来実装） |

---

## 3. 全体構成図

### レイヤーアーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│  Chat Layer                                              │
│  LINE Bot | Slack Bot | Dashboard Chat | 専用アプリ       │
└─────────────────────────┬───────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Webhook Gateway                                         │
│  HTTP Server (POST /webhook/{source})                    │
│  Command Parser (テキスト → スキル名 + パラメータ)         │
│  Auth & Rate Limit (署名検証・レート制限)                  │
└─────────────────────────┬───────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Skill Engine                                            │
│  Skill Router (.claude/commands/*.md マッチング)          │
│  Cron Scheduler (heartbeats.json 定期実行管理)            │
│  Agent Manager (サブエージェント起動・停止・監視)           │
└─────────────────────────┬───────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  LLM Layer                                               │
│  Claude Code Max ($0): 定期実行 + ダッシュボード手動       │
│  Anthropic API (従量): チャット即時応答                    │
│  Tool Use (MCP): Google/Notion/TaskGod等操作              │
└─────────────────────────┬───────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Data Layer                                              │
│  Google Sheets (Gallery/Skill Hub registry)               │
│  Local JSON (heartbeats/agents/config キャッシュ)          │
│  File System (スキル定義/ログ/成果物)                      │
└─────────────────────────┬───────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Infra Layer                                             │
│  会社共有PC #1 (cron + Webhook Gateway)                   │
│  会社共有PC #2 (バックアップ)                              │
│  個人PC (開発 + ダッシュボード操作)                        │
└─────────────────────────────────────────────────────────┘
```

### スキル実行フロー例（LINEから /trend-check）

```
📱 LINE「/trend-check AI市場」
  → Webhook Gateway（署名検証 → パース）
    → Skill Router（trend-check.md 読み込み）
      → Anthropic API（Claude + Tool Use）
        → 結果保存（output/trends/ + Sheets）
  ← Response Formatter（LINE用フォーマット）
📱 LINE「AI市場のトレンドレポートです: ...」
```

---

## 4. コンポーネント詳細

### 4.1 Agents パネル

#### Heartbeat Manager（定期実行）

OpenClaw風の定期タスク管理。スキルをcronスケジュールで自動実行。

**データ構造** (`heartbeats.json`):
```json
{
  "tasks": [{
    "id": "daily-trend-check",
    "name": "Daily Trend Check",
    "description": "/trend-check を毎朝実行",
    "schedule": "0 9 * * 1-5",
    "skill": "trend-check",
    "enabled": true,
    "lastRun": "2026-03-10T09:03:12",
    "lastStatus": "success",
    "log": ["2026-03-10 09:03 OK", "2026-03-09 09:02 OK"]
  }]
}
```

**API**:
- `GET /api/heartbeats` — 一覧
- `POST /api/heartbeats` — 新規作成
- `PUT /api/heartbeats/{id}` — 更新（pause/resume含む）
- `DELETE /api/heartbeats/{id}` — 削除

**UI**: テーブル形式（Status / Name / Schedule / Last Run / Actions）+ 作成モーダル

#### Sub-Agent Manager（ACP接続）

`.claude/agents/*.md` のエージェント定義を自動検出 + 手動登録。起動・停止・ログ監視。

**データ構造** (`agents.json`):
```json
{
  "agents": [{
    "id": "strategy-analysis",
    "name": "Strategy Analysis Team",
    "description": "5エージェント連携で戦略オプションを導出",
    "type": "local",
    "definitionPath": ".claude/agents/strategy-analysis.md",
    "capabilities": ["strategy", "research"],
    "status": "stopped",
    "registeredAt": "2026-03-09T15:00:00"
  }]
}
```

**API**:
- `GET /api/agents` — 一覧（ライブステータス付き）
- `POST /api/agents` — 登録
- `POST /api/agents/{name}/start` — 起動
- `POST /api/agents/{name}/stop` — 停止
- `GET /api/agents/{name}/logs` — ログ取得
- `DELETE /api/agents/{name}` — 登録解除

**UI**: カードグリッド + Start/Stop/Logs ボタン + 登録モーダル + ログビューアモーダル

### 4.2 Gallery パネル

#### コンセプト

Skill Hubと同じUI/UXパターンで、バイブコーディング成果物を一覧・カテゴリ分類・プレビュー。
「誰が何を作ったか」が社内メンバー全員に見えるギャラリー。

**営業モックは含まない。自社ツール・自分プロダクトのみ。**

#### 自動スキャン対象

| カテゴリ | スキャン先 | 検出方法 |
|---------|----------|---------|
| webapp | output/deploy/*/package.json | package.json存在 |
| gui | output/gui/*.html | HTMLファイル（system除外） |
| slides | output/slides/*.pptx + *.py | ファイル拡張子 |
| extension | 05_development/chat-hub-extension/manifest.json | manifest.json存在 |
| gas | 05_development/gas-*/appsscript.json | appsscript.json存在 |
| script | output/*.mjs, output/*.py | ファイル拡張子 |
| mcp | 05_development/mcp-*/ | ディレクトリ名パターン |

#### データ構造 (`gallery.json` + Google Sheets)

```json
{
  "items": [{
    "id": "seo-monitor",
    "name": "SEO Monitor",
    "type": "webapp",
    "category": "tool",
    "description": "記事のSEO鮮度を自動監視",
    "path": "output/deploy/seo-monitor",
    "tech": ["next.js", "tailwind", "anthropic-sdk"],
    "creator": "daiki",
    "createdAt": "2026-03-01T00:00:00",
    "updatedAt": "2026-03-11T00:00:00",
    "status": "published",
    "deployUrl": "https://seo-monitor.vercel.app",
    "tags": ["seo", "monitoring", "ai"]
  }]
}
```

**API**:
- `GET /api/gallery` — 一覧
- `POST /api/gallery/scan` — ファイルシステム再スキャン
- `PUT /api/gallery/{id}` — メタデータ編集
- `POST /api/gallery/publish` — 公開
- `POST /api/gallery/unpublish` — 非公開

**UI**: Skill Hubと同パターン（カテゴリフィルタ、検索、カードグリッド、プレビューモーダル、編集モーダル）

### 4.3 Webhook Gateway

#### 構成

```
POST /webhook/line   → LINE Messaging API Webhook
POST /webhook/slack  → Slack Events API
POST /webhook/api    → 汎用REST API（専用アプリ等）
```

各エンドポイントで:
1. 署名検証（LINE: X-Line-Signature, Slack: X-Slack-Signature）
2. メッセージ抽出 → 共通フォーマット変換
3. Command Parser → スキル名 + パラメータ
4. Anthropic API で即時処理
5. 結果をチャネル別フォーマットで返信

### 4.4 Cron Engine

Claude Code Maxのscheduled-tasksを活用した定期実行。

```
共有PC → Claude Code (Max) → scheduled-tasks
  └── heartbeats.json から登録されたタスクを実行
       ├── Tier 1: 安いチェック（LLM不要）
       │   └── 変化なし → スキップ
       └── Tier 2: 変化あり → LLMエスカレーション
            └── 分析・通知
```

---

## 5. 対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `05_development/walkers-dashboard/server.py` | API追加: heartbeats, agents, gallery, webhook |
| `05_development/walkers-dashboard/index.html` | 新パネル2つ + モーダル + CSS |
| `05_development/walkers-dashboard/refresh.sh` | gallery/agents データ収集 |
| `05_development/walkers-dashboard/config.json` | 新設定キー |
| `05_development/walkers-dashboard/heartbeats.json` | **新規**: Heartbeatタスク永続化 |
| `05_development/walkers-dashboard/agents.json` | **新規**: サブエージェント登録 |
| `05_development/walkers-dashboard/gallery.json` | **新規**: ギャラリーアイテム（ローカルキャッシュ） |
| `output/agent-logs/` | **新規**: エージェントログディレクトリ |
| Google Sheets | **新規**: gallery-registry シート |

---

## 6. 実装フェーズ

### Phase 1: データ基盤 + ブランチ
- `git checkout -b feature/dashboard-agents-gallery`
- heartbeats.json / agents.json / gallery.json 作成
- output/agent-logs/ ディレクトリ作成
- config.json 新設定キー追加

### Phase 2: Gallery（Backend + Frontend）
- server.py: Gallery API (scan, list, update, publish)
- server.py: Google Sheets連携
- index.html: Gallery パネル（カード、フィルタ、検索、モーダル）
- refresh.sh: gallery データ収集

### Phase 3: Agents - Heartbeat（Backend + Frontend）
- server.py: Heartbeat CRUD API
- server.py: Cron Engine
- index.html: Agents パネル - Heartbeat セクション

### Phase 4: Agents - Sub-Agent（Backend + Frontend）
- server.py: Agent CRUD + start/stop/logs API
- server.py: subprocess管理
- index.html: Agents パネル - Sub-Agent セクション + ログビューア

### Phase 5: Skill Executor
- anthropic Python SDK 導入
- スキル定義(.md) → システムプロンプト変換
- Tool Use定義
- 実行結果のフォーマット・保存

### Phase 6: Webhook Gateway
- Webhook受信エンドポイント
- Command Parser
- LINE/Slack API連携
- レスポンスフォーマッター

### Phase 7: 統合テスト + 本番設定
- 全API curlテスト
- ブラウザUIテスト
- 共有PCへのデプロイ・ジョブ設定
- ngrok/Cloudflare Tunnel設定

---

## 7. セキュリティ

- 全ID: `_sanitize_skill_name()` でサニタイズ
- 全パス: `resolve_safe()` で検証
- Deploy API: preview のみ（`--prod` は渡さない）
- Agent start: 事前登録済みの definitionPath のみ実行可能
- `read_only` 設定: 全write系APIで尊重
- Webhook: 署名検証必須、レート制限

---

## 8. オープンクエスチョン（未決事項）

| # | 論点 | 対応時期 |
|---|------|---------|
| 1 | Webhook公開方法（ngrok / Cloudflare Tunnel / 固定IP） | Phase 6 |
| 2 | APIキー月額予算・モデル選択（Sonnet vs Opus） | Phase 5 |
| 3 | チャットの認証（誰がスキル起動できるか） | Phase 6 |
| 4 | Gallery公開範囲（社内のみ or 将来外部） | 運用後判断 |
| 5 | Claude Code Max 同時実行制限・挙動 | 運用後検証 |

---

## 参考

- [OpenClaw Architecture](https://docs.openclaw.ai/concepts/architecture)
- [OpenClaw Heartbeat](https://github.com/openclaw/openclaw/blob/main/docs/gateway/heartbeat.md)
- [OpenClaw ACP Agents](https://docs.openclaw.ai/tools/acp-agents)
- Walkers Dashboard v2 PATCH-NOTES: `05_development/walkers-dashboard/PATCH-NOTES-v2.md`
