# HP問い合わせフォーム Webhook自動化

## 概要

WalkersHP（walker-s.co.jp）のお問い合わせフォーム・資料請求フォームの送信内容を、リアルタイムでGoogle Sheetsに記録し、社内メール通知を行うシステム。

## 目的

| 課題 | 解決策 |
|------|--------|
| フォーム送信に気づくのが遅れる | 送信直後にGmailで社内通知 |
| 問い合わせ履歴がWP管理画面でしか見れない | Google Sheetsに自動蓄積、いつでも閲覧・分析可能 |
| リード対応の抜け漏れ | 一覧化により対応状況を可視化（将来拡張） |

## システム構成

```
[WordPress/WPForms]
    │ フォーム送信完了時に自動実行（PHPフック）
    │ wp_remote_post()（非同期）
    ▼
[Google Apps Script Web App]
    │ doPost() でJSON受信
    │
    ├─→ Google Sheets「お問い合わせ」シートにログ記録
    ├─→ Google Sheets「資料請求」シートにログ記録
    ├─→ Google Sheets「raw_log」シートに生データ保存
    ├─→ Gmail で社内通知メール送信
    └─→ （将来拡張）TaskGod/Notion/カレンダー連携
```

## 対象フォーム

| フォーム | WPForms ID | 累計送信数 | フィールド |
|---------|-----------|----------|----------|
| お問い合わせ | 222 | 3,724件 | お名前*, 貴社名*, メールアドレス*, 電話番号, お問い合わせ内容* |
| 資料請求 | 6572 | 160件 | お名前*, 貴社名, メールアドレス*, 電話番号*, ご興味のある事業内容*, 予算×3, メルマガ希望 |

## セキュリティ

- **シークレットキー認証**: WP側とGAS側で共有キーを検証。不正なPOSTを拒否
- **GASアクセス制御**: 「全員（匿名含む）」でPOST受付だが、シークレットキーがないとデータは記録されない
- **個人情報の取り扱い**: Google Sheets内に保存。Google Workspaceの組織管理下
- **通信経路**: WordPress → Google Apps Script はHTTPS暗号化通信

## ファイル構成

```
gas-webhook-receiver/
├── Code.gs              # メインロジック（doPost受信・Sheets記録・通知）
├── Config.gs            # 設定値（Sheets ID、シークレットキー、通知先）
├── appsscript.json      # GASプロジェクト設定
├── .clasp.json          # claspプロジェクト紐付け（デプロイ後に生成）
├── .claspignore         # clasp pushの対象制御
├── wpforms-webhook.php  # WordPress側に設置するPHPスニペット
└── README.md            # 本ファイル
```

## セットアップ手順

### Step 1: Google Sheets を準備

1. Google Sheets を新規作成（名前例: `Walkers_HP_Webhook_Log`）
2. シートIDをメモ（URLの `/d/` と `/edit` の間の文字列）
3. `Config.gs` の `SHEET_ID` にセット

### Step 2: GAS プロジェクトを作成・デプロイ

```bash
# GASプロジェクトディレクトリに移動
cd 05_development/gas-webhook-receiver

# GASプロジェクトを新規作成（初回のみ）
clasp create --type webapp --title "Walkers Webhook Receiver"

# コードをプッシュ
clasp push --force

# Web Appとしてデプロイ
clasp deploy --description "v1.0 - Initial deployment"
```

- デプロイ時の設定:
  - 実行ユーザー: **自分**
  - アクセス権限: **全員（匿名含む）**
- デプロイURL（`https://script.google.com/macros/s/XXXXX/exec`）をメモ

### Step 3: テスト送信

```bash
# curlでテストPOST
curl -X POST \
  'https://script.google.com/macros/s/DEPLOY_ID/exec' \
  -H 'Content-Type: application/json' \
  -d '{
    "secret": "wk_webhook_2026",
    "form_id": 222,
    "form_name": "テスト",
    "fields": [
      {"id": "1", "name": "お名前", "value": "テスト太郎", "type": "text"},
      {"id": "2", "name": "貴社名", "value": "テスト株式会社", "type": "text"},
      {"id": "3", "name": "メールアドレス", "value": "test@example.com", "type": "email"},
      {"id": "4", "name": "電話番号", "value": "090-1234-5678", "type": "phone"},
      {"id": "5", "name": "お問い合わせ内容", "value": "Webhook受信テスト", "type": "textarea"}
    ],
    "entry_id": 99999,
    "timestamp": "2026-03-09T15:00:00+09:00",
    "source_ip": "127.0.0.1"
  }'
```

確認ポイント:
- [ ] Google Sheets の「お問い合わせ」シートにデータが記録されること
- [ ] Gmail に通知メールが届くこと
- [ ] raw_log シートにJSONが保存されること

### Step 4: WordPress側にPHPスニペットを設置

1. WordPress管理画面にログイン
2. **Code Snippets** プラグインを使用する場合:
   - 「スニペット」→「新規追加」
   - `wpforms-webhook.php` の中身をコピー＆ペースト
   - タイトル: `WPForms Webhook → GAS`
   - スコープ: **サーバーサイドのみ**
   - **有効化**
3. デプロイURLを `$webhook_url` に設定（`TODO_DEPLOY_ID` を実際のIDに置換）

### Step 5: 本番テスト

1. WPFormsのPreview画面からテスト送信
2. Google Sheets + Gmail通知を確認
3. 問題なければ完了

## 通知メールの例

### お問い合わせフォームの場合

```
件名: 【HPお問い合わせ】テスト株式会社 テスト太郎様

新規お問い合わせがありました。

━━━━━━━━━━━━━━━━━━━━━━
お名前: テスト太郎
貴社名: テスト株式会社
メール: test@example.com
電話番号: 090-1234-5678

お問い合わせ内容:
Webhookの受信テストです
━━━━━━━━━━━━━━━━━━━━━━
受信時刻: 2026/3/9 15:00:00
```

## 将来拡張（Phase 2以降）

| 機能 | 概要 | 優先度 |
|------|------|--------|
| 営業パイプライン自動登録 | 問い合わせ → Notion/TaskGodにリード自動作成 | 高 |
| AI分類 | 問い合わせ内容をAIで分析、緊急度・案件種別を自動判定 | 中 |
| 自動返信メール | フォーム種別に応じたテンプレートで即時自動返信 | 中 |
| 日程調整リンク | 空きカレンダー枠付きのミーティング予約リンク自動送付 | 中 |
| Slack通知 | Slack連携による即時通知（メールより早い） | 低 |
| ダッシュボード連携 | Walkers Dashboardにリアルタイムでリード表示 | 低 |

## 運用・保守

- **GASの実行ログ**: GASエディタ > 実行 > 実行ログ で確認
- **エラーログ**: Google Sheets の `error_log` シートに自動記録
- **シークレットキー変更**: Config.gs と wpforms-webhook.php の両方を更新
- **通知先追加**: Config.gs の `NOTIFY_EMAILS` 配列に追加

## 承認・変更履歴

| 日付 | 内容 | 承認者 |
|------|------|--------|
| 2026/03/09 | 初版作成・社内レビュー依頼 | 古谷大輝 |
| | 承認・デプロイ実施 | |
