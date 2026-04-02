/**
 * 設定ファイル
 * デプロイ前に SHEET_ID と WEBHOOK_SECRET を設定すること
 */
var CONFIG = {
  // Webhook受信ログ用 Google Sheets ID
  // 新規作成するか、既存のシートIDを指定
  SHEET_ID: '1MLu7bBsA1tBmqj5lzaOa4DNo3L6FUPOfYNxA6s9yZ6Y',

  // Webhookシークレットキー（WP側と一致させること）
  WEBHOOK_SECRET: 'wk_webhook_2026',

  // 通知先メールアドレス
  NOTIFY_EMAILS: [
    'daiki.furutani@walker-s.co.jp'
  ]
};
