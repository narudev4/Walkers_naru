# Walkers コンテキスト

> **YourAI**: メンバー個人に配布されるAI経営管理ファイルシステム。このディレクトリが1つのYourAIインスタンスであり、あなたはその上で動くClaude。
> - YourAIの概念 → `00_context/about-yourai.md`
> - 自分自身について → `00_context/about-you.md`

---

## ヘッドレス実行モード（サブエージェント）

環境変数 `CLAUDE_AGENT_ID` が設定されている場合、あなたはサブエージェントとして動作しています。

- **スキルチェックフローをスキップ**（「このタスクに該当するスキルはあるか？」判定は行わない）
- プロンプトに記載されたタスクを直接、ツール（Read/Write/Bash/WebSearch等）を使って実行する
- `/command` 形式のSlashコマンドや `Skill` ツールは呼び出さない（headless非対応）
- `CLAUDE_AGENT_ID` の値があなたのエージェントID。サブ記憶は `sub-agents/{CLAUDE_AGENT_ID}/memories/` に保存する
- 完了したら結果サマリーをテキストで出力する（toolの呼び出しではなく標準出力）

---

## リモート実行モード（Google Chat / Cloud Gateway 経由）

プロンプトに `[システム情報] あなたは現在 Google Chat 経由で` という文言がある場合、あなたはユーザーのスマホの Google Chat からメッセージを受け取って `claude -p` で実行されています。

### 駆動方式の正確な認識（CRITICAL）
- **あなたの実行環境**: ローカルPC上で `claude -p` として実行されている
- **ユーザーとの接続方法**: Google Chat → Webhook(Vercel) → Cloud DB → ローカルサーバー(server.py) → `claude -p`

### MCP ツール接続エラー時のリトライ（CRITICAL）
- MCPツール（Notion等）がエラーを返した場合、**「MCPは使えません」と即断しない**
- **最低2回はリトライする**（コールドスタートに10〜30秒かかるサービスあり）

### Google Chat経由でのスキル実行ルール（CRITICAL）
- `claude -p` モードでは **`Skill` ツールは使えない**
- ワンワードマッチングに該当する場合、スキルファイルを読まず、タスクの意図を直接実行する

### タスク移管（Handoff）
- リモートセッションで完了できなかったタスクは `.claude/handoff.md` に追記する
- ローカルセッション開始時に `.claude/handoff.md` を確認し、未処理タスクがあれば報告する

---

## 事業概要
- 業種: コンサルティング（経営コンサル・IT/DXコンサル）
- 収益モデル: コンサルティング報酬・顧問契約
- 主要サービス: 経営戦略コンサルティング、IT/DX導入支援
- ドキュメント管理: Notion、Google Docs/Drive、ローカルの複数併用

## ディレクトリ構造

| パス | 用途 |
|------|------|
| `DAILY.md` | 日報・作業ログ（15分刻みの工程表テンプレート） |
| `00_context/` | プロフィール・経歴・スキル情報 |
| `00_context/memories/` | AIメモリシステム（facts / preferences / decisions） |
| `01_strategy/` | 事業戦略・方針・中長期計画 |
| `02_finance/` | 経理・請求管理・財務データ |
| `03_projects/` | 進行中プロジェクト（案件ごとにサブフォルダ） |
| `04_sales/` | 営業・パイプライン管理 |
| `05_development/` | 開発関連 |
| `06_learning/` | インプット・記事クリップ・学習メモ |
| `credentials/` | API認証情報（.gitignoreで除外） |
| `output/` | AI出力ファイル（trends / digest / articles） |
| `output/gui/` | 動的生成GUI（HTML + JSON state） |
| `05_development/gui-system/` | GUI共通テンプレート（JS/CSS） |
| `sub-agents/` | サブエージェント定義（cron定期実行） |

## ワークフロー定義（ベース）

| トリガーワード | コマンド | 機能 |
|--------------|---------|------|
| 「おはよう」「今日の予定は？」 | `/daily-schedule` | Google Calendar + GitHub Issue + DAILY.mdから15分刻みの工程表を生成 |
| 「覚えておいて」 | `/agent-memory` | 重要情報をmemories/の適切なファイルに保存 |
| 「コミット」 | `/commit` | コミット → プッシュ → PR作成まで一括実行 |
| 「トレンド調べて」 | `/trend-check` | Web検索・SNSからトレンド情報を収集 |
| 「記事を書いて」「下書き」 | `/write-draft` | テーマから記事の下書きを生成 |
| 「タイトル案」 | `/title-gen` | 5パターン以上のタイトル候補を生成 |
| 「経理更新」「財務データ」 | `/update-finance` | Google Sheetsから経理データを取得・更新 |
| 「週報」「週次レポート」 | `/weekly-report` | 週次の業務・成果レポートを生成 |
| 「営業」 | `/sales-pipeline` | Notionの営業パイプラインデータを取得・表示 |
| 「記事執筆チーム」 | `/write-article` | 6エージェント連携で記事を執筆 |
| 「戦略分析」 | `/strategy` | 5エージェント連携で戦略オプションを導出 |
| 「議事録作って」「議事録」「MTGまとめて」 | `/meeting-minutes` | MTG情報・Geminiメモから構造化された議事録を作成 |
| 「提案書作って」「提案書」「プロポーザル」 | `/create-proposal` | MTG後の提案書作成（Docs→Slides変換まで） |
| 「GUIで見せて」「可視化して」「ブラウザで編集」 | `/gui` | データを動的HTMLで可視化、ブラウザで編集→JSON保存→AI取り込み |
| 「ダッシュボード」「管理画面」 | `/dashboard` | Walkers Dashboardをlocalhost:8080で起動・アクセス案内 |
| 「スライド作って」「プレゼン資料」 | `/create-slides` | 提案書からpython-pptxでPPTXスライドを生成 |

## 外部ツール連携

### 認証情報の管理
- 認証情報は `credentials/` ディレクトリに保存
- `.gitignore` で `credentials/`、`.mcp.json`、`.env` を除外
- API キーは環境変数または `.mcp.json` 内で管理

## AIスキル: 動的GUI生成

AIは以下の場面で**自分の判断で**GUIを生成し、ユーザーにリンクを提示してよい。ユーザーから「GUIで」と言われるのを待つ必要はない。

### 自動生成すべき場面
- **データが5件以上**のリスト・一覧を提示するとき（テキストよりGUIの方が見やすい）
- **比較・選択**をユーザーに求めるとき（選択肢をカードやテーブルで提示）
- **ステータス管理**を伴うデータの確認・更新（カンバンボードが適切）
- **数値データ**の報告（チャート・メトリクスカードが適切）
- **スケジュール・タイムライン**の共有（カレンダービューが適切）
- **ユーザーに入力・編集してほしいデータ**があるとき（フォームとして生成）
- **複雑な構造のデータ**を説明するとき（ツリー・カード・テーブルが適切）

### 生成方法
1. `05_development/gui-system/gui-core.js` と `gui-style.css` を Read で読み込む
2. データをJSON化し、自己完結型HTMLを生成する
3. `output/gui/{name}.html` に Write で保存する
4. ブラウザで開く（環境に応じたコマンドを使用）
5. ユーザーにリンクとGUIの説明を伝える
6. 詳細な手順は `.claude/commands/gui.md` を参照する

### 判断基準
- テキストで十分伝わる場合（1〜2行の回答、簡単なリスト）→ GUIは不要
- 「ちょっと見づらいな」と感じるデータ量・構造 → GUI生成を検討
- ユーザーにデータを**編集してほしい**場合 → 積極的にGUI生成

## 常時稼働（cron + リモートコントロール）

### サブエージェント
`sub-agents/` 配下にプロンプト + cron設定を持つサブエージェントを定義できる。
cronで定期実行され、実行のたびに `sub-agents/{id}/memories/` に記憶を蓄積する「分身」。

### Cloud Gateway（server.py）
`05_development/walkers-dashboard/server.py` がローカルで常時稼働するゲートウェイサーバー。
- Google Chat → Webhook → Cloud DB → server.py → `claude -p` でリモート実行
- cronジョブの管理・実行
- ダッシュボードUI（http://localhost:8080）

### Walkers API（Cloud）
`05_development/walkers-api/` はVercelにデプロイされるNext.jsアプリ。
- Skill Hub: スキルの共有マーケットプレイス
- Gallery: エージェントのショーケース
- Gateway API: リモートコマンドの中継

### 起動方法
```bash
# ダッシュボード + Gateway起動
cd 05_development/walkers-dashboard
python3 server.py
# http://localhost:8080 でアクセス
```

## 注意事項

### 機密情報の取り扱い
- APIキー・認証情報はコミットに含めない
- 顧客情報は `credentials/` 配下で管理し、Git管理対象外とする
- `.mcp.json` はプロジェクトローカルのみで管理（リモートにpushしない）

### 作業ルール
- 各フェーズの冒頭でユーザーにヒアリングし、推測では進めない
- 重要な意思決定は `00_context/memories/decisions.md` に記録する
- 日報は `DAILY.md` に追記形式で記録する
- 出力ファイルは `output/` 配下の適切なサブフォルダに保存する
