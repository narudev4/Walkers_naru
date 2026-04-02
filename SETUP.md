# YourAI セットアップガイド

> このテンプレートから自分のYourAIインスタンスを作成する手順です。
> 所要時間: 約30〜60分

---

## 前提条件

| ソフトウェア | バージョン | 確認コマンド |
|------------|----------|------------|
| Claude Code | 最新版 | `claude --version` |
| Node.js | 18以上 | `node --version` |
| Git | 任意 | `git --version` |
| Python3 | 3.9以上 | `python3 --version` |

---

## Step 1: フォルダ配置とリネーム

```bash
# ダウンロードフォルダに展開後、リネーム
mv ~/Downloads/Walkers_template_20260402 ~/Walkers_<あなたの名前>

# 例:
mv ~/Downloads/Walkers_template_20260402 ~/Walkers_tanaka
```

## Step 2: Git初期化

```bash
cd ~/Walkers_<あなたの名前>

git init
git add -A
git commit -m "Initial YourAI setup"

# GitHubにプライベートリポジトリを作成（gh CLI使用）
gh repo create Walkers_<あなたの名前> --private --source=. --push
```

## Step 3: 個人設定ファイルの編集

### 3-1. custom/CLAUDE_LOCAL.md

自分の情報を設定します:

```bash
# エディタで開く
code custom/CLAUDE_LOCAL.md
```

最低限設定する項目:
- **インスタンス名**: `Walkers_<あなたの名前>`
- **オーナー**: あなたの名前
- **マシン**: MacBook / Windows PC 等
- **シェル**: zsh / bash / Git Bash
- **ベースパス**: プロジェクトルートの絶対パス
- **個人カレンダーID**: あなたのGmail
- **仕事メール**: 会社のメールアドレス

### 3-2. 00_context/about-you.md

自己認識ドキュメントを編集:

```bash
code 00_context/about-you.md
```

### 3-3. CLAUDE.md を再生成

```bash
./sync-engine.sh --force
```

## Step 4: MCP接続設定

`.mcp.json` のプレースホルダーを実際の認証情報に置き換えます。

### 優先度: 最高（まず接続すべき）

| サービス | 設定に必要なもの | 取得方法 |
|---------|--------------|--------|
| Notion | Internal Integration Token | Notion Settings > Integrations > 新規作成 |
| Google Calendar | OAuth Client ID/Secret | Google Cloud Console > 認証情報 |
| Google Sheets | （Calendarと同じOAuth） | 同上 |
| Google Drive | （Calendarと同じOAuth） | 同上 |

### Google OAuth 設定手順（初回のみ）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. 「APIとサービス」→「認証情報」→「OAuth 2.0 クライアントID」を作成
3. アプリケーションの種類: 「デスクトップアプリ」
4. クライアントID・シークレットを取得
5. 認証情報を `credentials/gcp-oauth.keys.json` に保存:

```json
{
  "installed": {
    "client_id": "<取得したクライアントID>",
    "client_secret": "<取得したシークレット>",
    "redirect_uris": ["http://localhost:3000/callback"]
  }
}
```

6. 必要なAPIを有効化:
   - Google Calendar API
   - Google Sheets API
   - Google Drive API
   - Google Slides API

### 優先度: 高

| サービス | 設定方法 |
|---------|--------|
| Gmail | Claude Code起動 → `/settings` → Connectors → Gmail を Connect |
| Google Slides | （Calendarと同じOAuth） |

### 優先度: 任意

| サービス | 設定に必要なもの |
|---------|--------------|
| GitHub | Personal Access Token |
| X (Twitter) | API Key 4種（Basic Plan: $200/月） |
| Xserver (SSH) | SSHキーペア |

## Step 5: 動作確認

```bash
# Claude Codeをプロジェクトルートで起動
cd ~/Walkers_<あなたの名前>
claude
```

| # | テスト | 入力 | 期待結果 |
|---|-------|------|---------|
| 1 | CLAUDE.md読み込み | `あなたの役割は？` | 経営パートナー等と回答 |
| 2 | スキル実行 | `/daily-schedule` | スキルが起動する（カレンダー未接続ならエラーでOK） |
| 3 | メモリ保存 | `「テスト」と覚えておいて` | 00_context/memories/ に保存 |
| 4 | GUI生成 | `テストデータをGUIで見せて` | output/gui/ にHTML生成 |

### sync-engine 確認

```bash
./sync-engine.sh --dry-run

# 期待される出力:
# [OK] Already synced to version 1.0.0
```

---

## ディレクトリ構造

```
Walkers_<あなたの名前>/
├── CLAUDE.md              ← 自動生成（直接編集しない）
├── DAILY.md               ← 日報
├── SETUP.md               ← このファイル
├── sync-engine.sh         ← 同期スクリプト
├── core/                  ← 共通コンポーネント（READ-ONLY）
│   ├── CLAUDE_BASE.md     ← CLAUDE.mdの共通部分
│   ├── skills/            ← 共通スキル（25個）
│   ├── agent-teams/       ← Agent Teamsテンプレート
│   └── version.json       ← バージョン管理
├── custom/                ← 個人設定（WRITABLE）
│   ├── CLAUDE_LOCAL.md    ← インスタンス固有の設定
│   ├── skills/            ← カスタムスキル（27個）
│   ├── memories/          ← 個人メモリ
│   └── credentials/       ← 認証情報
├── .claude/commands/      ← スキル実行ファイル（sync-engineで自動配置）
├── 00_context/            ← プロフィール・記憶
├── 01_strategy/           ← 事業戦略・方針
├── 02_finance/            ← 経理・請求管理
├── 03_projects/           ← 進行中プロジェクト
├── 04_sales/              ← 営業・パイプライン
├── 05_development/        ← 開発関連
├── 06_learning/           ← インプット・学習
├── credentials/           ← API認証情報（.gitignore除外）
├── output/                ← AI出力
└── sub-agents/            ← サブエージェント
```

## 利用可能なスキル一覧（51個）

### 基本スキル（core: 25個）

| コマンド | 機能 |
|---------|------|
| `/daily-schedule` | 15分刻み工程表を生成 |
| `/agent-memory` | 重要情報をメモリに保存 |
| `/commit` | コミット→プッシュ→PR作成 |
| `/trend-check` | トレンド情報を収集 |
| `/write-draft` | 記事の下書きを生成 |
| `/title-gen` | タイトル候補を5パターン以上 |
| `/update-finance` | 経理データ取得・更新 |
| `/weekly-report` | 週次レポート生成 |
| `/sales-pipeline` | 営業パイプライン表示 |
| `/write-article` | 6エージェント連携で記事執筆 |
| `/strategy` | 戦略オプション導出 |
| `/meeting-minutes` | 議事録作成 |
| `/create-proposal` | 提案書作成 |
| `/gui` | 動的GUI生成 |
| `/dashboard` | ダッシュボード起動 |
| `/create-slides` | PPTXスライド生成 |
| `/cleanup-for-sharing` | テンプレート化 |
| `/task-organize` | タスク整理 |
| `/task-register` | タスク登録 |
| `/session-checkpoint` | セッション状態保存 |
| `/context-manage` | コンテキスト管理 |
| `/research` | 情報収集・キャッチアップ |
| `/misoca` | 請求書・見積書操作 |
| `/schedule-adjust` | 日程調整 |
| `/article-monitor` | 記事更新モニター |

### 拡張スキル（custom: 27個）

| コマンド | 機能 |
|---------|------|
| `/dept-content` | コンテンツ部長AI起動 |
| `/dept-sales` | 営業部長AI起動 |
| `/dept-backoffice` | BO部長AI起動 |
| `/dept-strategy` | 戦略部長AI起動 |
| `/dept-admin` | 管理部長AI起動 |
| `/seo-article` | SEO記事制作 |
| `/repost-note` | note転載 |
| `/youtube-script` | YouTube台本制作 |
| `/youtube-research` | YouTube動画リサーチ |
| `/morning-routine` | 毎朝定例業務 |
| `/article-slides` | 記事→スライド変換 |
| `/yt-scrape` | 記事スクレイピング |
| `/yt-script` | HeyGen用台本生成 |
| `/yt-slides` | PPTX自動生成 |
| `/yt-voice` | ElevenLabs音声生成 |
| `/yt-split-audio` | 音声分割 |
| `/yt-heygen` | HeyGen動画生成 |
| `/yt-upload` | YouTube投稿 |
| `/yt-produce` | 動画一括制作 |
| `/yt-thumbnail` | サムネイル生成 |
| `/issue-triage` | Issue・タスク登録 |
| `/gmail-reply` | Gmail返信下書き |
| `/article-revise` | 記事修正 |
| `/create-diagrams` | 図解作成 |
| `/create-mockup` | モックアップ作成 |
| `/test` | テスト |
| `/write-draft` | 記事下書き（カスタム版） |

---

## 今後のアップデート

管理者から `core/` の更新通知が来たら:

```bash
# 最新のcore/を取得（方法は管理者の指示に従う）
# sync-engineで反映
./sync-engine.sh --force
```

`core/` はREAD-ONLY。カスタマイズは `custom/` で行ってください。

---

困ったら: Claude Codeを起動して「セットアップを手伝って」と入力してください。
