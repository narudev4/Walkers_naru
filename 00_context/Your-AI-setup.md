# Claude Code AI経営管理システム セットアップマニュアル

このドキュメントは「AI経営管理システム」をゼロから再現するための手順書です。Claude Codeはこのファイルの指示に従い、Phase 1から順にユーザーへヒアリングしながら構築を進めてください。

---

## システム全体像

本システムは以下の6フェーズで構築します。

| Phase | 構成要素 | 概要 |
|:------|:--------|:-----|
| 1 | ディレクトリ設計 | 事業情報を格納するフォルダ群を構築する |
| 2 | CLAUDE.md | AIアシスタントの業務マニュアルを整備する |
| 3 | MCP連携 | 12の外部サービスを接続する |
| 4 | Skills定義 | 12のスラッシュコマンドを登録する |
| 5 | Agent Team | マルチエージェントチーム（2チーム）を構成する |
| 6 | Git管理 | バージョン管理とセキュリティを設定する |

**原則**: 各フェーズの冒頭でユーザーにヒアリングし、推測では進めないこと。

---

## Phase 1：ディレクトリ設計

### ヒアリング項目
- プロジェクトフォルダの配置先パス
- 主な業務カテゴリ（戦略、経理、プロジェクト管理、コンテンツ発信、学習 等）
- 既存ドキュメントの保管場所（Notion、Google Docs、ローカル等）

### 構築するディレクトリ

```
{指定パス}/
├── CLAUDE.md                    ← Phase 2で作成
├── DAILY.md                     ← 日報・作業ログ（15分刻みの工程表テンプレート）
├── 00_context/                  ← プロフィール・経歴・スキル情報
│   ├── profile.md               ← 基本情報・スキル・経歴テンプレート
│   ├── portfolio/               ← 実績・ポートフォリオ
│   └── memories/                ← AIメモリシステム（3ファイル構成）
│       ├── facts.md             ← 事実情報・ビジネスデータ
│       ├── preferences.md       ← ユーザーの好み・コミュニケーションスタイル
│       └── decisions.md         ← 意思決定の記録と理由
├── 01_strategy/                 ← 事業戦略・方針・中長期計画
│   └── business-plan.md         ← ビジョン・ミッション・KPIテンプレート
├── 02_finance/                  ← 経理・請求管理・財務データ
│   └── monthly-summary.md       ← 月次収支サマリーテンプレート
├── 03_projects/                 ← 進行中プロジェクト（案件ごとにサブフォルダ）
├── 05_learning/                 ← インプット・記事クリップ・学習メモ
├── credentials/                 ← API認証情報（.gitignoreで除外）
└── output/                      ← AI出力ファイル
    ├── trends/                  ← トレンドレポート
    ├── digest/                  ← 週報・要約
    └── articles/                ← 記事・下書き
```

### DAILY.md テンプレート

```markdown
## YYYY-MM-DD（曜日）

### 今日の工程表
| 時間 | タスク | カテゴリ | 優先度 |
|------|--------|---------|--------|
| 09:00-09:15 | [タスク名] | [カテゴリ] | [高/中/低] |

### 今日のポイント
- 最重要タスク: [名前]
- 締切のあるタスク: [名前（期日）]
- 持ち越しタスク: [名前]

### 完了タスク
- [x] [タスク名]

### 未完了・持ち越しタスク
- [ ] [タスク名]

### メモ・気づき
[フリー記述]
```

### メモリシステム（00_context/memories/）

| ファイル | 用途 | 記録内容の例 |
|---------|------|------------|
| `facts.md` | 事実情報 | 売上データ、契約情報、技術スタック |
| `preferences.md` | ユーザーの好み | コミュニケーションスタイル、作業習慣、ツールの好み |
| `decisions.md` | 意思決定ログ | 決定事項、その理由、決定日 |

### 完了条件
- すべてのディレクトリとテンプレートファイルが作成されている
- ユーザーに構造を提示し、承認を得ている

---

## Phase 2：CLAUDE.mdを整備する

### ヒアリング項目
- AIに求める役割（経営パートナー、リサーチャー、秘書 等）
- 事業概要（業種、収益モデル、主要サービス）
- 日常的に行っている業務
- 自動化したい業務
- 機密情報の取り扱いルール

### 記載するセクション

```markdown
# [事業名] コンテキスト

## あなたの役割
（ヒアリング結果をもとに記述）

## 事業概要
- 業種:
- 収益モデル:
- 主要サービス:
- ドキュメント管理:

## ディレクトリ構造
（Phase 1で作成した各フォルダの役割を表形式で記載）

## ワークフロー定義
（Phase 4で作成するスキルのトリガーワード一覧表）

## 外部ツール連携
（Phase 3で接続するMCPサービスの一覧表）

### 認証情報の管理
（認証ファイルのパスと管理方法）

## 注意事項
### 機密情報の取り扱い
### 作業ルール
```

### 完了条件
- CLAUDE.mdがプロジェクトルートに作成されている
- ユーザーの承認を得ている

---

## Phase 3：MCP連携を設定する

### ヒアリング項目
- 日常的に使用しているツール
- 各ツールのAPIキー・認証情報の準備状況
- 優先的に接続したいサービス

### 接続対象サービス一覧（12サービス）

設定ファイル `.mcp.json` をプロジェクトルートに作成し、以下のサービスを順次接続する。

#### 基盤サービス（優先度：最高）

| サービス | パッケージ | 必要な認証情報 |
|---------|-----------|-------------|
| **GitHub** | `@modelcontextprotocol/server-github` | Personal Access Token (PAT) |
| **Notion** | `@notionhq/notion-mcp-server` | Internal Integration Token |
| **Playwright** | `@playwright/mcp@latest` | なし |

#### Google Workspace（優先度：高）

すべて同一のOAuth 2.0クライアントID/Secretを使用する。Google Cloud Consoleで1つのOAuthクライアントを作成し、各サービスで共有する。

| サービス | パッケージ | 用途 |
|---------|-----------|------|
| **Google Calendar** | `@cocal/google-calendar-mcp` | 予定管理・スケジュール確認 |
| **Google Sheets** | `google-sheets-mcp` | スプレッドシート読み書き・経理データ |
| **Gmail** | `@shinzolabs/gmail-mcp` | メール送受信・検索・管理 |
| **Google Drive** | `@isaacphi/mcp-gdrive` | ファイル管理・検索 |
| **Google Slides** | `@bohachu/google-slides-mcp` | プレゼンテーション作成・編集 |
| **Google Chat** | `@presto-ai/google-workspace-mcp` | チャットスペースへのメッセージ送受信 |

**Google OAuth設定手順:**
1. Google Cloud Console (https://console.cloud.google.com) でプロジェクト作成
2. 「APIとサービス」→「認証情報」→「OAuth 2.0 クライアントID」を作成
3. クライアントID・シークレットを取得
4. リダイレクトURI: `http://localhost:3000/callback`
5. 認証情報を `credentials/gcp-oauth.keys.json` に保存

#### 外部連携サービス（優先度：中〜高）

| サービス | パッケージ | 必要な認証情報 |
|---------|-----------|-------------|
| **X (Twitter)** | `@enescinar/twitter-mcp` | API Key, API Secret Key, Access Token, Access Token Secret |
| **Xserver (SSH)** | `ssh-client-mcp` | SSHキーペア（公開鍵認証） |
| **CodeX (OpenAI)** | `codex-mcp-server` | OpenAI APIキー |

#### X (Twitter) 設定手順
1. Twitter Developer Portal (https://developer.x.com) でBasicプラン（$200/月）を契約
2. Project → Appを作成
3. 「ユーザー認証設定」→ 権限を「読み取りと書き込み」に設定
   - アプリの種類: 「ウェブアプリ、自動化アプリまたはボット」
   - コールバックURL: `https://localhost`
4. 「Keys and Tokens」からAPI Key / API Secret / Access Token / Access Token Secretを取得
   - Access Tokenは「Read and Write」権限で生成すること
5. `.mcp.json`に設定:
```json
"twitter": {
  "command": "npx",
  "args": ["-y", "@enescinar/twitter-mcp"],
  "env": {
    "API_KEY": "取得したAPI Key",
    "API_SECRET_KEY": "取得したAPI Secret Key",
    "ACCESS_TOKEN": "取得したAccess Token",
    "ACCESS_TOKEN_SECRET": "取得したAccess Token Secret"
  }
}
```

#### Xserver (SSH) 設定手順
1. エックスサーバーのサーバーパネルでSSHを有効化
2. **ローカルでパスフレーズなしのSSHキーペアを生成**（推奨）:
   ```bash
   ssh-keygen -t rsa -b 4096 -f ~/.ssh/xserver_rsa_local -N '' -C "claude-code@xserver"
   ```
3. サーバーパネル → 「SSH設定」→「公開鍵登録」タブで公開鍵を登録
4. 接続テスト:
   ```bash
   ssh {サーバーID}@{サーバーID}.xsrv.jp -p 10022 -i ~/.ssh/xserver_rsa_local
   ```
5. `.mcp.json`に設定:
```json
"ssh-xserver": {
  "command": "npx",
  "args": [
    "ssh-client-mcp",
    "--host", "{サーバーID}.xsrv.jp",
    "--port", "10022",
    "--user", "{サーバーID}",
    "--key", "~/.ssh/xserver_rsa_local"
  ]
}
```

**注意**: エックスサーバーの「公開鍵認証用鍵ペアの生成」機能で作成した鍵はパスフレーズ付きになるため、MCP自動接続に不向き。ローカル生成 → 公開鍵登録の方式を推奨する。

#### CodeX (OpenAI) 設定手順
1. OpenAI Platform (https://platform.openai.com/api-keys) でAPIキーを取得
2. Codex CLIをインストール:
   ```bash
   npm i -g @openai/codex
   ```
3. `.mcp.json`に設定:
```json
"codex-cli": {
  "command": "npx",
  "args": ["-y", "codex-mcp-server"],
  "env": {
    "OPENAI_API_KEY": "取得したAPIキー"
  }
}
```

### .mcp.json の全体構成

```json
{
  "mcpServers": {
    "github": { ... },
    "notion": { ... },
    "google-calendar": { ... },
    "google-sheets": { ... },
    "gmail": { ... },
    "google-drive": { ... },
    "google-slides": { ... },
    "google-chat": { ... },
    "playwright": { ... },
    "twitter": { ... },
    "ssh-xserver": { ... },
    "codex-cli": { ... }
  }
}
```

### 完了後の作業
- CLAUDE.mdの「外部ツール連携」セクションに接続済みサービスを追記
- 「認証情報の管理」セクションに認証ファイルパスを記載

### 完了条件
- すべてのサービスのMCP接続が完了している
- 各サービスの接続テストが成功している
- CLAUDE.mdに連携情報が反映されている

---

## Phase 4：Skillsを定義する

### ヒアリング項目
- 最も頻繁に行う繰り返し業務
- 自動化の優先度

### 作成するSkills一覧（12コマンド）

`.claude/commands/` にMarkdownファイルとして作成する。各ファイルには実行手順・参照先・出力形式を明確に定義すること。

#### コアスキル（必須）

| # | ファイル名 | トリガーワード | 機能 |
|---|-----------|--------------|------|
| 1 | `daily-schedule.md` | 「おはよう」「今日の予定は？」 | Google Calendar + GitHub Issue + DAILY.mdから15分刻みの工程表を生成 |
| 2 | `issue-triage.md` | 「Issueにして」「タスク登録して」 | GitHub Issue + Notionタスクを同時作成 |
| 3 | `agent-memory.md` | 「覚えておいて」 | 重要情報を memories/ の適切なファイルに保存 |
| 4 | `commit.md` | 「コミット」 | コミット → プッシュ → PR作成まで一括実行 |

#### 情報収集・コンテンツスキル

| # | ファイル名 | トリガーワード | 機能 |
|---|-----------|--------------|------|
| 5 | `trend-check.md` | 「トレンド調べて」 | Web検索・SNSからトレンド情報を収集し output/trends/ に保存 |
| 6 | `write-draft.md` | 「記事を書いて」「下書き」 | テーマから記事の下書きを生成し output/articles/ に保存 |
| 7 | `title-gen.md` | 「タイトル案」 | 5パターン以上のタイトル候補を生成（直球・疑問・数字・メリット・比較） |

#### 業務管理スキル

| # | ファイル名 | トリガーワード | 機能 |
|---|-----------|--------------|------|
| 8 | `update-finance.md` | 「経理更新」「財務データ」 | Google Sheetsから経理データを取得し 02_finance/ を更新 |
| 9 | `weekly-report.md` | 「週報」「週次レポート」 | 週次の業務・成果レポートを output/digest/ に生成 |
| 10 | `sales-pipeline.md` | 「営業」 | Notionの営業パイプラインデータを取得・表示 |

#### チーム起動スキル

| # | ファイル名 | トリガーワード | 機能 |
|---|-----------|--------------|------|
| 11 | `write-article.md` | 「記事執筆チーム」 | 6エージェント連携で記事を執筆（Phase 5で定義） |
| 12 | `strategy.md` | 「戦略分析」 | 5エージェント連携で戦略オプションを導出（Phase 5で定義） |

#### issue-triage.md の特記事項

GitHub IssueとNotionタスクを**同時に作成**する。Notion APIへの登録はMCPの`API-post-page`にparentシリアライズの不具合があるため、**curlで直接Notion APIを呼び出す**。

```bash
curl -s -X POST 'https://api.notion.com/v1/pages' \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H 'Notion-Version: 2022-06-28' \
  -H 'Content-Type: application/json' \
  -d '{
    "parent": {"database_id": "データベースID"},
    "properties": {
      "Task name": {"title": [{"text": {"content": "タスク名"}}]},
      "Status": {"status": {"name": "Not started"}},
      "Priority": {"select": {"name": "High"}},
      "Description": {"rich_text": [{"text": {"content": "説明文。GitHub Issue: #番号"}}]}
    }
  }'
```

### CLAUDE.mdへの反映
作成したスキルのトリガーワードを「ワークフロー定義」セクションに表形式で追記する。

### 完了条件
- 12個のスキルファイルが `.claude/commands/` に作成されている
- CLAUDE.mdにワークフロー定義が記載されている
- 各スキルのテスト実行が成功している

---

## Phase 5：Agent Teamを構成する

### ヒアリング項目
- チームで取り組みたい業務（記事執筆、戦略分析、競合調査 等）
- まず何チームを構築するか

### 構成するAgent Team（2チーム）

`.claude/agents/` にエージェント定義ファイルを作成する。

#### チームA：記事執筆チーム（write-article.md）

6エージェントが5フェーズで連携する。

| エージェント | 役割 |
|:-----------|:-----|
| リサーチャーA | テーゼ・アンチテーゼ・ジンテーゼの論考分析 |
| リサーチャーB | 技術・産業の事実ベースの調査 |
| リサーチャーC | 批判的思考（Devil's Advocate） |
| 構成エージェント | 3本のリサーチを統合し、記事の構成案を設計 |
| 編集長 | 「洞察の深さ」「論理の明快さ」「So What?の強さ」「構成の完成度」の4軸でレビュー |
| ライター | 編集長のフィードバックを反映した原稿を執筆 |

**フロー**: リサーチャー3名（並列）→ 構成エージェント → 編集長レビュー → ライター → 編集長最終レビュー

**出力先**: `output/articles/YYYY-MM-DD_[テーマ].md`

#### チームB：戦略分析チーム（strategy-analysis.md）

5エージェントが5フェーズで連携する。

| エージェント | 役割 |
|:-----------|:-----|
| 問いの設計 | 分析すべき問いをMECEに構造化 |
| 市場調査 | 市場規模・トレンド・競合を調査 |
| 定量分析 | 財務データ・KPIの分析・シナリオモデリング |
| 戦略設計 | 調査結果を統合し、3つ以上の戦略オプションを策定 |
| 批判的レビュー | 戦略の弱点・リスク・隠れた代替案を指摘 |

**フロー**: 問いの設計 → 市場調査＋定量分析（並列）→ 戦略設計 → 批判的レビュー → 最終統合

**出力先**: `01_strategy/YYYY-MM-DD_[テーマ]_strategy.md`

### Skills連携
- `/write-article` スキルで記事執筆チームを起動
- `/strategy` スキルで戦略分析チームを起動

### 完了条件
- エージェント定義ファイルが `.claude/agents/` に作成されている
- Skills化されコマンド一発で起動できる
- テスト実行で各エージェントが正しく連携することを確認

---

## Phase 6：Git管理を設定する

### 実行内容

1. プロジェクトフォルダをGitリポジトリとして初期化
2. `.gitignore` を作成（以下の内容）:

```
# Authentication & Secrets
.env
.env.*
.mcp.json
*.key
*.pem
credentials/
secrets/

# API Keys & Tokens
**/api_key*
**/token*
**/secret*

# OS Files
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
*.swp
*.swo
*~

# Node.js
node_modules/
```

3. 初回コミットを作成
4. ユーザーの許可を得て、GitHubにプライベートリポジトリを作成しpush

### 完了条件
- Gitリポジトリが初期化されている
- .gitignoreに機密ファイルが登録されている
- GitHubにプライベートリポジトリが作成されている

---

## 最終確認チェックリスト

すべてのPhaseが完了したら、以下を実施する：

### 動作テスト
- [ ] 「おはよう」→ `/daily-schedule` が正常に動作
- [ ] 「タスク登録して [内容]」→ GitHub Issue + Notionタスクが作成される
- [ ] 「覚えておいて [内容]」→ memories/の適切なファイルに保存される
- [ ] 「コミット」→ コミット・プッシュ・PR作成が実行される

### ファイル確認
- [ ] CLAUDE.md: 全セクション（役割・事業概要・ディレクトリ・ワークフロー・外部ツール・注意事項）が記載
- [ ] .mcp.json: 12サービスが設定済み
- [ ] .claude/commands/: 12個のスキルファイル
- [ ] .claude/agents/: 2個のエージェント定義ファイル
- [ ] .gitignore: 機密ファイルが除外されている

### ユーザーへの案内
> セットアップは完了です。
> 明日の朝から「おはよう」と入力するだけで、工程表が自動生成されます。
> 「これも自動化したい」と思った作業があれば、いつでも「これをSkills化して」と声をかけてください。
