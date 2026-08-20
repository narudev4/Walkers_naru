# 落合コーポレーション Webhook — Vercel Function デプロイ

Shopify `orders/create` Webhook を受信し、MF クラウド請求書に下書きを自動作成する Vercel Serverless Function。

## 処理フロー

```
POST /api/webhook
  1. HMAC-SHA256 署名検証（X-Shopify-Hmac-Sha256）
  2. 即 200 応答（Shopify は 5秒以内を要求）
  3. waitUntil() で非同期処理:
     a. Shopify Admin API で注文を取得・正規化
     b. payment_term を判定
        - ③都度払い（prepaid/immediate） → MF 請求書を即時作成（下書き）
        - ①②かけ払い（20th/eom）       → スキップ（締めバッチで統合）
```

## 制約事項

### Playwright（③都度払い自動送信）は Vercel Function 非対応

Vercel Function のランタイムには Chromium が含まれないため、`SEND_MODE=browser`（Playwright による MF 画面の自動送信）は動作しない。

- Vercel 上では `SEND_MODE=none`（既定値）で運用し、請求書は「下書き」まで作成
- 送信ステップは以下のいずれかで別途対応:
  - MF クラウド請求書の画面から手動送信
  - ローカルマシンまたは EC2 等で send-invoice.js を定期実行
  - 将来的に MF API に送信エンドポイントが追加された場合は API 経由で送信

### MF トークンの永続化

- MF のアクセストークン/リフレッシュトークンは Vercel 環境変数に設定する
- Function 内でリフレッシュしたトークンはそのインスタンスでのみ有効（永続保存されない）
- トークンの有効期限が切れた場合は、ローカルで `npm run auth` を実行し、得られたトークンを Vercel 環境変数に再設定する
- 長期運用では Vercel KV / Upstash Redis へのトークン永続化を推奨

### 二重発行防止

- インメモリ Set による重複検知（同一インスタンスの連続リクエストのみ対応）
- コールドスタートごとにリセットされるため、Shopify の再配送（数時間後）は防げない
- ただし pipeline 側で「請求書作成前の失敗はマーク解除→リトライ」「作成後はマーク維持」の設計のため、実害は限定的
- 本格運用では Vercel KV / Upstash Redis に移行可能（processedStore インターフェースを差し替えるだけ）

## デプロイ手順

### 1. 環境変数の準備

Vercel ダッシュボード（Settings → Environment Variables）または CLI で以下を設定:

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `SHOPIFY_WEBHOOK_SECRET` | YES | カスタムアプリの API シークレットキー |
| `SHOPIFY_STORE_DOMAIN` | YES | `*.myshopify.com` ドメイン |
| `SHOPIFY_ADMIN_TOKEN` | YES | Admin API アクセストークン（`shpat_` で始まる） |
| `SHOPIFY_API_VERSION` | - | Admin GraphQL API バージョン（既定: `2025-10`） |
| `MF_CLIENT_ID` | YES | MF アプリ client_id |
| `MF_CLIENT_SECRET` | YES | MF アプリ client_secret |
| `MF_ACCESS_TOKEN` | YES | MF API アクセストークン |
| `MF_REFRESH_TOKEN` | - | MF API リフレッシュトークン（自動更新に必要） |
| `MF_TOKEN_AUTH_METHOD` | - | トークンEP認証方式（既定: `client_secret_post`） |
| `SEND_MODE` | - | `none`（既定）。Vercel では `browser` は非対応 |
| `IMMEDIATE_TERMS` | - | ③都度払い判定値（既定: `prepaid,immediate`） |

### 2. プロジェクトリンク

```bash
cd webhook/vercel-deploy

# 対話形式でチーム・プロジェクトを選択（--yes は絶対に付けない！）
vercel link
```

**注意**: `vercel --yes` は絶対に使わない。別チームに新規プロジェクトが作成される事故が発生する。

### 3. 環境変数の設定（CLI）

```bash
# 1つずつ設定（プロンプトで値を入力）
vercel env add SHOPIFY_WEBHOOK_SECRET
vercel env add SHOPIFY_STORE_DOMAIN
vercel env add SHOPIFY_ADMIN_TOKEN
vercel env add MF_CLIENT_ID
vercel env add MF_CLIENT_SECRET
vercel env add MF_ACCESS_TOKEN
vercel env add MF_REFRESH_TOKEN
```

### 4. プレビューデプロイ

```bash
vercel deploy
```

### 5. 動作確認

```bash
# ヘルスチェック
curl https://<preview-url>/api/webhook

# テスト Webhook 送信（sign-and-post.js を流用）
cd ../   # webhook/ に戻る
node --env-file=../shopify/.env --env-file=.env sign-and-post.js --url https://<preview-url>/api/webhook
```

### 6. 本番デプロイ

```bash
cd vercel-deploy
vercel --prod
```

### 7. Shopify Webhook 登録

Shopify Admin → Settings → Notifications → Webhooks で登録:

- **Event**: Order creation
- **Format**: JSON
- **URL**: `https://<prod-domain>/api/webhook`

または Shopify CLI:

```bash
shopify webhook trigger \
  --topic orders/create \
  --address https://<prod-domain>/api/webhook
```

## ディレクトリ構造

```
vercel-deploy/
  api/
    webhook.js         ← Vercel Serverless Function エントリポイント
  lib/
    pipeline.js        ← 注文処理パイプライン
    orderNormalize.js  ← Shopify 注文の正規化
    shopifyClient.js   ← Shopify Admin GraphQL クライアント
    invoiceService.js  ← MF 請求書作成ロジック
    mfClient.js        ← MF API クライアント（環境変数ベース）
    mapOrder.js        ← 注文 → MF API ペイロード変換
  vercel.json          ← Vercel 設定（maxDuration: 60）
  package.json         ← 依存関係（外部依存ゼロ）
  README.md            ← このファイル
```

## ローカルテスト

Vercel CLI でローカル実行:

```bash
cd vercel-deploy

# .env.local に環境変数を設定
cp /dev/null .env.local
# （各環境変数を .env.local に記入）

vercel dev
```

## 元コードとの対応

| 元ファイル | Vercel 版 | 差分 |
|------------|-----------|------|
| `webhook/server.js` | `api/webhook.js` | http.createServer → export default handler |
| `webhook/pipeline.js` | `lib/pipeline.js` | ファイルI/O → console.log、Playwright → 非対応 |
| `shopify/src/shopifyClient.js` | `lib/shopifyClient.js` | 同一（依存ゼロ） |
| `shopify/src/orderNormalize.js` | `lib/orderNormalize.js` | import パス変更のみ |
| `moneyforward/src/mfClient.js` | `lib/mfClient.js` | tokens.js/oauth.js → 環境変数ベースに簡素化 |
| `moneyforward/src/invoiceService.js` | `lib/invoiceService.js` | import パス変更のみ |
| `moneyforward/src/mapOrder.js` | `lib/mapOrder.js` | 同一 |
