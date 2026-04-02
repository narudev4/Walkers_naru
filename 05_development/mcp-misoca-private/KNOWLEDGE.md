# Misoca MCP ナレッジベース

Misoca APIを使う際のハマりポイント・仕様の癖・運用ノウハウを蓄積するファイル。
新しい発見があるたびに追記していく。

---

## API仕様の癖

### エンドポイントの単数/複数が不統一
- 一覧取得は複数形: `GET /invoices`, `GET /estimates`, `GET /contacts`
- 詳細取得は単数形: `GET /invoice/{id}`, `GET /estimate/{id}`
- **作成は統一されていない**:
  - 請求書: `POST /invoice`（単数）
  - 見積書: `POST /estimate`（単数）
  - 納品書: `POST /delivery_slip`（単数）
- 間違えると `405 Not Allowed` が返る（エラーメッセージが不親切）

### リクエストボディはフラット構造
- NG: `{ "invoice": { "subject": "...", "items": [...] } }`（ネストしない）
- OK: `{ "subject": "...", "items": [...] }`（トップレベルに直接書く）

### items のフィールド名
- `unit` ではなく **`unit_name`**（単位フィールド）
- `items_attributes` ではなく **`items`**

### contact_id は必須
- 見積書・請求書の作成時に `contact_id` が**必須パラメータ**
- `contact_id` は `GET /contacts` の `id`（送付先ID）
- `contact_group_id`（事業者グループID）とは別物
- 関係: contact_group（事業者） → contact（送付先）が1:N

### 税区分の値
- レスポンス: `STANDARD_TAX_10`, `REDUCED_TAX_8`, `EXEMPTED_TAX` など大文字
- リクエスト時も同じ大文字形式を使う

### ステータス操作のHTTPメソッド
- 「する」= PUT, 「取り消す」= DELETE
  - 送付済み: `PUT /invoice/{id}/submitted`
  - 送付取消: `DELETE /invoice/{id}/submitted`
  - 入金済み: `PUT /invoice/{id}/paid`
  - 入金取消: `DELETE /invoice/{id}/paid`
  - ゴミ箱: `PUT /invoice/{id}/trashed`
  - 復元: `DELETE /invoice/{id}/trashed`

---

## 認証関連

### OAuth2フロー
- 認可URL: `https://app.misoca.jp/oauth2/authorize`
- トークンURL: `https://app.misoca.jp/oauth2/token`
- スコープ: `write`（読み書き両方含む）
- コールバック: `http://localhost:8765/callback`

### トークンの有効期限
- アクセストークン: **24時間**（expires_in: 86400）
- リフレッシュトークン: 有効期限不明（長期間有効の模様）
- MCPサーバー側で自動リフレッシュ実装済み（5分マージン）

### トークンが切れたとき
- `node auth.js` を再実行すれば再取得可能
- ブラウザで Misoca にログイン済みなら、認可画面で即「許可」できる

---

## データ構造メモ

### 請求書（invoice）の主要フィールド
```
id, invoice_number, issue_date, payment_due_on, subject,
recipient_name, invoice_status, payment_status,
body.total_amount, body.tax, body.total_amount_including_tax,
items[].name, items[].unit_price, items[].quantity, items[].unit_name
```

### 見積書（estimate）の主要フィールド
```
id, estimate_number, issue_date, expire_date, subject,
recipient_name, estimate_status,
body.total_amount, body.tax, body.total_amount_including_tax,
items[].name, items[].unit_price, items[].quantity, items[].unit_name
```

### 取引先（contact）の構造
```
contacts（送付先）
  ├── id: 送付先ID（請求書・見積書作成時に使う）
  ├── contact_group_id: 事業者グループID
  ├── recipient_name: 宛名
  └── recipient_mail_address: メールアドレス

contact_groups（事業者グループ）
  ├── id: グループID
  └── recipient_name: 事業者名
```

---

## 金額の表記
- APIレスポンスの金額は文字列: `"772000.0"`（数値ではない）
- 計算する場合は parseFloat() が必要
- price（明細合計）は数値型: `772000`

---

## 運用ノウハウ

### テスト見積書・請求書の扱い
- テスト作成したものは必ず Misoca 管理画面から削除する
- API で `PUT /invoice/{id}/trashed` でゴミ箱に入れることもできる

### よく使う取引先の調べ方
1. `misoca_list_contact_groups` で事業者一覧を取得
2. `misoca_list_contacts` で送付先一覧を取得
3. 請求書・見積書作成時は contacts の `id` を `contact_id` に指定

---

## 未検証・TODO
- [ ] 納品書（delivery_slip）の作成・取得
- [ ] PDF取得のバイナリハンドリング
- [ ] 郵送依頼（send_by_postal_mail）
- [ ] ページネーションのヘッダー情報（total count等）
- [ ] 請求書の更新（PUT）のbody構造
- [ ] Webhook / コールバック通知の有無
