# 落合コーポレーション様 B2B/B2C 実装プラン

最終更新: 2026-05-26（naru セッション・MTG 後切替）
スコープ: 個人/法人を Customer Metafield で判定し、ログイン後に動的にリダイレクト + 法人ごとの割引率を価格に反映する実装の方針書。詳細仕様は **5/26 16:00 MTG 議事録到着後に再確定**。

---

## 1. 背景と切替経緯

- 当初 16:00 MTG で Shopify モックを「見せる」予定だった
- naru セッションで Rise テーマ + コレクション 2 つ作成までで時間切れ → デモは未提示
- 古谷さんの本意は **「コレクション分け」ではなく「Customer Metafield ベースで動的に切り替える」** 実装の技術検証
- 16:00 MTG で割引ロジックを古谷さんが詰めている最中 → 議事録到着後に再度要件定義

---

## 2. 仮確定事項（議事録到着まで仮置き）

| 項目 | 方針 |
|---|---|
| 個人/法人の判定 | **ログイン後の `customer.metafields.b2b.customer_type`** で分岐 |
| 割引ロジック | **古谷さん MTG 確定待ち**（仮: 法人ごとに固定割引率を Customer Metafield で持つ） |
| 法人専用商品の有無 | **未定**（議事録で確認） |
| 招待制 Customer 作成フロー | **一旦後回し**（5/26 午前 MTG 決定の招待制・顧客番号ログインとの整合は後で詰める） |
| ログイン前の分岐モーダル | **未確定**（議事録で確認） |
| 商品ページの価格表示書き換え or Cart 時 Discount Function 適用 | **未確定**（議事録で確認） |

---

## 3. 実装方針（仮）

### Customer Metafields 設計
```
namespace: b2b
- customer_type     (single_line_text)   # "individual" | "corporate"
- discount_rate     (number_decimal)     # 0.0 - 1.0  ※法人のみ
- corporate_name    (single_line_text)   # 法人名  ※法人のみ
```

### 機能 3 つ

| # | 機能 | 実装手段 |
|---|---|---|
| ① | ログイン後の **個人/法人リダイレクト** | `layout/theme.liquid` で `customer.metafields.b2b.customer_type` を見て JS or Liquid で 302 相当の挙動 |
| ② | **法人ごとの割引適用** | **Shopify Functions (Discount API)** で Cart に `discount_rate` を適用するのがモダン。Liquid 側で表示価格上書きも併用検討 |
| ③ | （未定）**法人専用商品**の閲覧制御 | Tag or Collection で B2B-only 商品を分離、Liquid で `customer.metafields.b2b.customer_type == 'corporate'` 時のみ表示 |

---

## 4. 議事録到着後にやること

1. 議事録から **割引ロジックの確定仕様**を読み取る（一律割引 / 商品別割引 / 階層割引 等）
2. 法人専用商品の **有無を確認**
3. 上記を反映して本ファイル更新
4. ユーザーに「実装方針 OK か」確認
5. 確定後、コード実装開始（次の § 5）

---

## 5. 実装手順（議事録 + 仕様確定後）

### 環境準備
```bash
cd /Users/naru/Walkers_naru/03_projects/落合コーポレーション/shopify
shopify auth login --store=xn-dfum9d9e7a6a1b3d8dc3778hkjvcsh3d.myshopify.com
shopify theme pull --theme=180313358637  # Rise を local に
```

### Metafield 定義
- Admin > Settings > Custom data > Customer で 3 つのメタフィールド定義
- API 名: `b2b.customer_type` / `b2b.discount_rate` / `b2b.corporate_name`

### テスト用 Customer 2 つ
- `individual-test@example.com`: `b2b.customer_type=individual`
- `corporate-test@example.com`: `b2b.customer_type=corporate`, `b2b.discount_rate=0.7`, `b2b.corporate_name="テスト法人"`

### コード実装
1. `layout/theme.liquid` にログイン後リダイレクト処理
2. `sections/main-product.liquid` で価格表示書き換え（仕様確定後）
3. Shopify Function 生成: `shopify app generate extension --type=product_discounts`
4. Function 内で `input.cart.buyerIdentity.customer.metafield(b2b.discount_rate)` を読み取り Cart 全体に適用
5. `shopify app deploy` で Function をストアに反映

### 検証
- 個人ユーザーログイン → 個人向け画面に遷移
- 法人ユーザーログイン → 法人向け画面に遷移
- 法人ユーザーの Cart で割引率適用される
- メタフィールドの discount_rate を 0.8 → 0.5 等変更してリアルタイム反映確認

---

## 6. 今セッションで作ったもの（残してよい）

| 項目 | 状態 | 次セッションでの扱い |
|---|---|---|
| 商品 3 点（既存） | OK | そのまま使う。画像追加は別途 |
| コレクション「個人のお客様向け」 | 作成済 | 本仕様では Metafield ベース判定が主軸。コレクションは補助的に使うか、不要なら削除判断 |
| コレクション「業者のお客様向け（B2B卸売）」 | 作成済 | 同上 |
| Main menu に 2 項目追加 | 保存済（テーマ未紐付け） | 動的判定に切替なら不要。削除候補 |
| パスワード保護: `eahayl` | 把握済 | そのまま |

---

## 7. 関連リンク

- 案件全体: [../CONTEXT.md](../CONTEXT.md)
- デモプラン（旧）: [../demo/demo-plan.md](../demo/demo-plan.md)
- Shopify 管理画面: https://admin.shopify.com/store/xn-dfum9d9e7a6a1b3d8dc3778hkjvcsh3d
- ストアフロント（pw: `eahayl`）: https://xn-dfum9d9e7a6a1b3d8dc3778hkjvcsh3d.myshopify.com/
- Shopify Functions Discount API: https://shopify.dev/docs/api/functions/reference/product-discounts
- Customer Metafields: https://shopify.dev/docs/api/admin-graphql/latest/objects/Customer#field-Customer.fields.metafields

---

## 8. 議事録待ちフラグ 🚧

**5/26 16:00 MTG 議事録 ↓ 到着待ち**

到着したら:
1. 議事録を Read
2. § 2 と § 3 を確定情報で更新
3. § 4 のチェックリストを実行
4. 古谷さんと naru の役割分担を再確認（特に Shopify Functions の実装担当）
