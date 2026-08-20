# データモデル完全辞書 — 落合コーポレーション（Shopify B2B/B2C EC + MF請求書連携）

最終更新: 2026-07-22 / ステータス: クロスレビュー反映済み（Haiku+引用検証217件+Codex 見落とし検出。naru 逆レビュー QA 待ち）

> 目的: 全データ項目について「誰が書いて誰が読むか」を一覧化し、PM 古谷さんの抽象的な指摘に即答できる状態を作る。
> 根拠の示し方: コードで確認できた事実は「ファイル名:行」で示す（パスは `03_projects/落合コーポレーション/` からの相対）。
> 確定／未確定の正は真理源スプシ「確認事項」タブ。本辞書で「未確定」と書いた項目は同タブで確定するまで断定しない。

---

## 0. 本辞書の読み方

- **現役（コード一次情報）**: 現行コード（`shopify/src/` `webhook/` `moneyforward/src/` `shopify-theme/`）が実際に読み書きしている系統。namespace `b2b` の metafield と metaobject `discount_matrix`（rate は 0<x≦1 の小数）がこれに当たる。
- **旧デモ実装（実機残存の確認が必要）**: 真理源スプシ「Shopifyカスタムデータ設計」タブ（2026-06-09 取得）に記載の `custom.itemType` 系。現行コードには一切登場しない（→ §7）。
- 「書き手」「読み手」欄の記法: `Admin手動` = Shopify Admin 画面での手入力。`スクリプト名:行` = リポジトリ内コードによる読み書き。
- 掛率の値の意味: rate は「正価に対する係数」。例 rate=0.60 → 正価の 60%（=40% OFF）（`shopify/src/discountEngine.js:14`）。

---

## 1. Customer metafield（namespace: `b2b`）— 現役・全 7 キー

コードから実際に読まれるキーの全量。grep で `namespace: "b2b"` の Customer 向け使用箇所を横断確認済み（2026-07-22）。

| キー | 型 | 取り得る値 | 誰が書くか | 誰が読むか（ファイル:行） |
|---|---|---|---|---|
| `customer_type` | single_line_text | `"corporate"` \| `"individual"` | Admin手動（本番運用）。デモ投入は `shopify/src/setup.js:27-30`・`create-test-customer.js:15-17`。 | 掛率計算の法人判定 `shopify/src/discountEngine.js:54`（`createDraftOrder.js:21` が取得）。Vercel版発注APIの法人ガード `webhook/vercel-deploy/api/create-draft-order.js:183`。テーマの B2B 表示分岐 `shopify-theme/snippets/b2b-nav-switcher.liquid:34`・`b2b-wholesale-price.liquid:9`・`b2b-cart-checkout.liquid:13`・`cart-drawer.liquid:565` ほか。 |
| `discount_group` | single_line_text | `"A"` \| `"B"` \| `"C"` 等（コードはハードコードせず任意文字列を許容。`discountEngine.js:10`）。 | Admin手動。デモ投入は `setup.js:27-29`・`create-test-customer.js:26-29`。 | マトリクス照合 `discountEngine.js:67-68`（`createDraftOrder.js:22` が取得）。`webhook/vercel-deploy/api/create-draft-order.js:187`。テーマ卸価格表示 `b2b-wholesale-price.liquid:11`・`b2b-card-price.liquid:24`。 |
| `custom_overrides` | json | `{"カテゴリ名": rate}` 形式。例 `{"racket": 0.55}`。rate は 0<x≦1（範囲外は無効として正価へフォールバック。`discountEngine.js:33-38`）。 | Admin手動。デモ投入は `setup.js:29`（corp-custom に `{racket: 0.5}`）。 | 掛率の最優先解決 `discountEngine.js:62-65`（`createDraftOrder.js:23,84` が取得・パース）。`webhook/vercel-deploy/api/create-draft-order.js:191`。テーマ `b2b-wholesale-price.liquid:15`・`b2b-card-price.liquid:29`・`b2b-order-form.liquid:29`。 |
| `corporate_name` | single_line_text | 任意の会社名文字列。 | Admin手動。デモ投入は `shopify/src/demo-setup.js:26`。 | 注文正規化で MF 取引先名の第一候補になる `shopify/src/orderNormalize.js:22,82`。締めバッチ `webhook/settle-batch.js:101,163`。`shopify/src/draft-to-order.js:49`・`demo-order.js:32`。 |
| `payment_terms` | single_line_text | `"20th"`（①かけ払い20日締め）\| `"eom"`（②かけ払い末締め）\| `"prepaid"`（③都度払い）。運用ツールの許容値 `shopify/src/set-payment-terms.js:11`。※パイプラインの③判定既定値は `prepaid,immediate`（環境変数 `IMMEDIATE_TERMS`。`webhook/pipeline.js:24-25`）だが、書き込みツール側に `immediate` は無い。 | Admin手動。運用切替ツール `set-payment-terms.js:24-31`。デモ投入は `demo-setup.js:27`。 | ③都度払い（即時請求書化）の判定 `webhook/pipeline.js:94`・`webhook/vercel-deploy/lib/pipeline.js:40`（`orderNormalize.js:23,79` が取得）。締めバッチの対象顧客抽出 `settle-batch.js:102,120`。 |
| `mf_partner_id` | single_line_text | MF クラウド請求書の取引先（Partner）ID 文字列。 | **書き手のコードは現状存在しない**（grep 確認済み 2026-07-22）。`demo-setup.js:11-12` に「請求書発行後に書き戻す枠」とのコメントがあるが書戻し処理は未実装。設定するなら Admin手動。 | MF 取引先の再利用判定（決定8） `moneyforward/src/invoiceService.js:46-49`・`webhook/vercel-deploy/lib/invoiceService.js:38-39`（`orderNormalize.js:24,80`・`settle-batch.js:103,161` が取得）。未設定（null）なら都度 `POST /partners` で新規作成される。 |
| `customer_code` | single_line_text | 顧客番号文字列。例 `"OC-TEST-001"`。 | Admin手動（想定）。デモ投入は `shopify/src/create-test-customer.js:20-24`。 | Draft Order の note への記録 `webhook/vercel-deploy/api/create-draft-order.js:252,257`。マイページ表示 `shopify-theme/sections/main-account.liquid:171`。 |

補足:
- `customer_code` は要件定義書 `requirements/discount-system.md` §2 のデータモデルには無く、B2B 顧客番号ログイン設計（`design/implementation-spec.md` T2-11）の過程で追加されたキー。命名・採番ルールは未確定。
- 要件定義書 §2 記載の `corporate_name` を含め、metafield **定義**（Admin の Custom data 登録）が実機ストアに揃っているかは本辞書では未確認（値の読み書きコードのみ確認）。

---

## 2. Product metafield（namespace: `b2b`）— 現役・全 2 キー

| キー | 型 | 取り得る値 | 誰が書くか | 誰が読むか（ファイル:行） |
|---|---|---|---|---|
| `category` | single_line_text | `"racket"` \| `"wear"` \| `"shoes"` \| `"ball"` \| `"string"` \| `"accessory"` 等（コードはハードコードせず。新カテゴリはデータ追加のみで有効。`discountEngine.js:5-12`）。 | Admin手動。デモ投入は `setup.js:13-17,84-98`（既存商品3点に付与）。本番の一括投入（商品マスタCSVインポート=T3-4）は未実装。 | 掛率計算のカテゴリキー `createDraftOrder.js:31,102`・`discountEngine.js:57-59`。`webhook/vercel-deploy/api/create-draft-order.js:217-219`。テーマ卸価格表示 `b2b-wholesale-price.liquid:12`・`b2b-card-price.liquid:25`・`b2b-order-form.liquid:26`。スマートコレクション自動分類の条件 `shopify/src/setup-collections.js`。 |
| `sport` | single_line_text | `"badminton"` \| `"tennis"` \| `"pickleball"`（要件定義書 §2 には `"padel"` も記載）。 | 値を書くコードは現状存在しない（grep 確認済み）。Admin手動、または T3-4 の CSV インポートで投入予定。 | スマートコレクション自動分類の条件 `setup-collections.js:163,174-216`（metafield 定義 ID を参照して sport×category の親子コレクションを構成）。掛率計算では**使わない**。 |

---

## 3. Order metafield（namespace: `b2b`）— 書戻し系・全 2 キー

MF 請求書の作成結果を Shopify 注文へ書き戻す系統。**Vercel Function 版パイプラインのみ**が書く（ローカル版 `webhook/pipeline.js` には書戻し処理は無い）。

| キー | 型 | 値 | 誰が書くか | 誰が読むか |
|---|---|---|---|---|
| `mf_invoice_url` | single_line_text | `https://invoice.moneyforward.com/billings/{billing.id}`（URL 組み立ては `webhook/vercel-deploy/lib/pipeline.js:68`）。 | ③都度払いの請求書作成直後に `setOrderMetafield` で書込み `webhook/vercel-deploy/lib/pipeline.js:80`。 | **現状コード内に読み手なし**。B案（Shopify メール1通に請求書URL集約=工程No.35）採用時に注文確認メールテンプレートが読む想定（A案/B案は未確定 → §8）。テストシナリオ K-03（`launch-plan/02-test-scenarios.md:146`）が書込み確認対象。 |
| `mf_billing_number` | single_line_text | MF 請求書番号（`String(billing.billing_number)`）。 | 同上 `webhook/vercel-deploy/lib/pipeline.js:81`。 | 同上（現状読み手なし。スタッフが Admin 注文画面で目視確認する用途）。 |

注意: 過去メモに `mf_invoice_number` という表記が見られるが、コード上の正式キーは **`mf_billing_number`**（`webhook/vercel-deploy/lib/pipeline.js:81,84`）。

---

## 4. Metaobject: `discount_matrix` — 現役

### フィールド構造（定義は `shopify/src/setup.js:40-48` で作成）

| フィールド | 型 | 内容 |
|---|---|---|
| `group` | single_line_text_field | 顧客グループ名。`b2b.discount_group` と突合される。 |
| `category` | single_line_text_field | 商品区分名。`b2b.category` と突合される。 |
| `discount_rate` | number_decimal | 掛率。有効範囲 0<x≦1 の**小数**（例 0.60 = 正価の60%）。範囲外・非数は無効として正価 1.0 にフォールバック（`discountEngine.js:33-38,103-113`）。 |

### demo 値の実エントリ（デモストア投入済み・実値は未確定 → §8）

| group | category | discount_rate | 投入経路 |
|---|---|---|---|
| A | racket | 0.60 | `setup.js:20` |
| A | wear | 0.70 | `setup.js:21` |
| B | racket | 0.70 | `setup.js:22` |
| B | wear | 0.80 | `setup.js:23` |
| A | ball | 0.65 | 2026-06-01 検証時に Admin から手動追加（「新カテゴリ追加で再開発不要」の実証。`requirements/discount-system.md` §7）。 |

※ `design/implementation-spec.md` 確認事項#3 の demo 方針表記「A=0.60/B=0.70/C=0.80」のうち **C グループのエントリは `setup.js` に無い**。C が実機に手動投入済みかは未確認。

### 読み手

- Draft Order 生成（全件取得 `first: 250`） `shopify/src/createDraftOrder.js:37-41,94-95`。
- Vercel 版発注 API（`first: 100`） `webhook/vercel-deploy/api/create-draft-order.js:72-80,140-150`。
- テーマの卸価格表示（`shop.metaobjects.discount_matrix.values` を全件ループ） `b2b-wholesale-price.liquid:18-24`・`b2b-card-price.liquid:35`・`b2b-order-form.liquid:33`。

### 編集方法

- Shopify Admin の **Content → Metaobjects → Discount Matrix** から GUI で追加・編集可（落合社が日常運用可能。`requirements/discount-system.md` §7「管理画面 UI」で実機確認済み）。
- 新カテゴリ・新グループの追加はエントリ追加のみ（コード変更・再デプロイ不要。§7 で実証済み）。
- 制約: 全件取得は 1 クエリ `first: 250`（Vercel 版は 100）。件数が上限を超える場合のみページネーション実装が必要。

---

## 5. MF 請求書側フィールド（`moneyforward/src/mapOrder.js` のマッピング）

MF クラウド請求書 API へのペイロード組み立て。入力は §6 の「正規化JSON」。

### 5-1. 取引先（`POST /partners`。`buildPartnerRequest` = `mapOrder.js:44-62`）

| MF フィールド | 値の出所 | 備考 |
|---|---|---|
| `name` | `customer.company`（= `b2b.corporate_name` ?? 顧客 displayName） | フォールバック `'取引先（サンプル）'`（`mapOrder.js:57`）。 |
| `name_suffix` | 固定 `'御中'` | `mapOrder.js:58`。 |
| `departments[0]` | 下記 5-2 をインライン添付 | 既存取引先（`mf_partner_id` あり）はこの POST 自体をスキップし再利用（`invoiceService.js:46-49`）。 |

### 5-2. 部署（Department。請求書の宛先。`buildDepartmentRequest` = `mapOrder.js:65-80`）

| MF フィールド | 値の出所 | 備考 |
|---|---|---|
| `person_name` | `customer.person_name`（= 顧客 displayName） | |
| `email` | `customer.email`（`resolveDeliveryEmail` 通過後） | ダミー email（example.com 等）はデモ受信先 `naru.hosoya+shopifydemo@walker-s.co.jp` に置換（`orderNormalize.js:9-15`）。**本番では置換ロジックの無効化が必要**。 |
| `zip` / `tel` / `prefecture` / `address1` / `address2` / `person_dept` | 正規化JSONにあれば | 現行の `normalizeOrder` はこれらを**セットしない**ため実質未使用（住所連携は未実装）。全項目空なら `person_dept='ご担当者'` を保険投入（`mapOrder.js:78`）。 |

`department_id` は請求書 POST の必須項目のため、インライン→単体POST→GET の3段で確定的に解決し、取れなければ throw（`invoiceService.js:23-38`）。

### 5-3. 請求書（`POST /invoice_template_billings`。`buildBillingRequest` = `mapOrder.js:87-116`）

| MF フィールド | 値の出所 | 備考 |
|---|---|---|
| `department_id` | 5-2 で解決した部署 ID | 必須（`mapOrder.js:107`）。 |
| `title` | `order.title` \|\| `` `ご注文 ${order.name}` `` | ③都度払いは「ご注文 #1004」形式。①②締め請求は `settle-batch.js:156` が `「{期間} 締め分 御請求」` を明示指定。 |
| `billing_date`（請求日） | `fulfilled_at`（発送日）→ fallback `ordered_at` | 決定4「請求確定=発送時」（`mapOrder.js:99`）。①②の統合請求書は締め日 23:59 を fulfilled_at に入れる（`settle-batch.js:158`）。 |
| `due_date`（支払期日） | `order.due_at`（明示）> `billing_date + payment_term_days 日` > `billing_date + 30日` | `mapOrder.js:103-104`。③都度払いの「請求日+7日」は仕様（`implementation-spec.md` Task 1）だが、**③のパイプラインは `due_at` も `payment_term_days` もセットしないため実装上は既定の +30 日が入る**（→ §8 の仕様乖離として要確認）。①②は `settle-batch.js:69,75` が翌月20日／翌月末を `due_at` に明示。 |
| `sales_date`（売上計上日） | `ordered_at`（注文日） | 決定3「売上計上=注文時」（`mapOrder.js:112`）。①②の統合請求書は仮で締め日（`settle-batch.js:157`、確定後に調整とコメントあり）。 |
| `memo` | `order.memo` | 現状セットする呼び出し元なし。 |
| `items[].name`（品目名） | `line_items[].title` | ③は商品名そのまま。①②は `「MM/DD 注文番号 商品名」`（`settle-batch.js:150`。明細粒度は仮仕様 → §8）。 |
| `items[].price`（単価） | `line_items[].wholesale_unit_price` | 掛率適用後の確定卸単価（税抜）。掛率の再計算は**しない**（`mapOrder.js:10`）。 |
| `items[].quantity` | `line_items[].quantity` | |
| `items[].unit` | 固定 `'個'` | `orderNormalize.js:72`。 |
| `items[].excise`（税率） | 固定 `'ten_percent'` | インライン品目では必須（`mapOrder.js:94-96`）。軽減税率商品は考慮外。 |

---

## 6. 相互参照マップ — Shopify 注文 → 正規化JSON → MF 請求書

データの流れ（③都度払い経路。①②はソースが `settle-batch.js` の期間集約になる以外は同型）:

```
Shopify Order (orders/create webhook)
  → orderNormalize.js: Admin API で注文 + customer metafield を取得し正規化JSON化
  → pipeline.js: payment_term で ③即時 / ①②締めバッチ送り を分岐
  → invoiceService.js + mapOrder.js: MF 取引先確保 → 請求書作成
  → (Vercel版のみ) 注文 metafield へ mf_invoice_url / mf_billing_number 書戻し
```

| # | Shopify 側の出所 | 正規化JSONキー（`orderNormalize.js:67-88`） | MF 請求書側の行き先（§5） |
|---|---|---|---|
| 1 | Order `id` | `id` | （書戻し先の特定に使用。`vercel-deploy/lib/pipeline.js:78-81`） |
| 2 | Order `name`（#1004 等） | `name` | `title`（「ご注文 #1004」） |
| 3 | Order `createdAt` | `ordered_at` | `sales_date`（決定3） |
| 4 | 発送日（プロトタイプは処理時刻 `now` で代用。`orderNormalize.js:69,78`） | `fulfilled_at` | `billing_date`（決定4） |
| 5 | Customer metafield `b2b.payment_terms` | `payment_term` | （分岐制御のみ。①②は `due_at` 計算の起点） |
| 6 | Customer metafield `b2b.mf_partner_id` | `mf_partner_id` | 取引先の再利用判定（決定8） |
| 7 | Customer metafield `b2b.corporate_name` ?? `displayName` | `customer.company` | Partner `name` |
| 8 | Customer `displayName` | `customer.person_name` | Department `person_name` |
| 9 | Customer `email` ?? Order `email`（ダミーはデモ宛に置換） | `customer.email` | Department `email`（=請求書メールの宛先） |
| 10 | LineItem `title` | `line_items[].title` | `items[].name` |
| 11 | LineItem `quantity` | `line_items[].quantity` | `items[].quantity` |
| 12 | LineItem `discountedUnitPriceSet` ?? `originalUnitPriceSet`（注文の確定単価。掛率は Draft Order 作成時に適用済み） | `line_items[].wholesale_unit_price` | `items[].price` |
| 13 | （固定値） | `line_items[].tax_rate = 'ten_percent'` / `unit = '個'` | `items[].excise` / `items[].unit` |
| 14 | （①②のみ）`settle-batch.js:69,75` の締め計算 | `due_at` | `due_date` |

掛率データ（§1 `discount_group`・`custom_overrides` / §2 `category` / §4 `discount_matrix`）はこの表の**上流**、Draft Order 作成時（`createDraftOrder.js` / `vercel-deploy/api/create-draft-order.js`）にのみ使われ、注文確定後は #12 の「確定単価」としてだけ流れる。すなわち **MF 側は掛率を知らない**。

---

## 7. 旧デモ実装の残骸に関する注記（重要）

真理源スプシ「**Shopifyカスタムデータ設計**」タブ（2026-06-09 取得）には、次の旧実装が「🟢現役」、`b2b.*` / `discount_matrix` が「⚪残骸」と記載されている。

| 系統 | 内容 |
|---|---|
| 旧デモ実装 | Product: `custom.itemType` → metaobject `itemtype` / Customer: `custom.2_f` → metaobject `customerclass` / 割引率は**整数%**。 |
| 現行コード | Customer/Product/Order の `b2b.*` metafield + metaobject `discount_matrix`（rate は 0<x≦1 の**小数**）。 |

**コード一次情報による確定事実**: 現行コード（`shopify/src/` `webhook/` `moneyforward/src/` `shopify-theme/`）は `b2b.*` + `discount_matrix` のみを使用し、`custom.itemType` / `itemtype` / `customerclass` / `custom.2_f` はコードに一切登場しない（grep 確認済み 2026-07-22。本辞書作成時にも再確認し 0 件）。よって「**コード上の現役 = `b2b.*` 系**」が確定であり、スプシタブの「🟢現役／⚪残骸」ラベルは stale の疑いが濃い。

**未確認事項**: ストア実機上に旧デモ実装の metafield 定義・metaobject エントリが**残存しているかは実機未確認**。残存していても現行コードは参照しないため動作影響はないが、Admin 画面上の混乱要因になるため、実機確認のうえ (a) スプシタブのラベル訂正、(b) 残骸エントリの削除可否判断、を行うこと。

---

## 8. 未確定事項（断定禁止リスト）

確定の正は真理源スプシ「**確認事項**」タブ。以下は本辞書の記載を demo 前提として読むこと。

| # | 項目 | 現状（demo） | 未確定の中身 |
|---|---|---|---|
| 1 | 掛率の実値 | demo 値: A=0.60 / B=0.70 / C=0.80（実機投入済みは §4 の表のとおり。C は投入未確認） | 区分別の正しい値。および「掛け」の基準が**上代比か下代比か**も未確定。要件定義書 No.2 の値は壊れている（全区分同一値かつ値>1.0）。 |
| 2 | かけ払い請求書の明細粒度 | **商品単位の行**（line item ごとに1行、各行に `「MM/DD 注文番号 商品名」` を前置。`settle-batch.js:145-152`。※確認事項#2 の記録「注文単位で仮実装」とは逆 → 00 Z-3） | 商品単位か注文単位か等の最終粒度（確認事項#2(a)）。 |
| 3 | 返品・キャンセルの扱い | demo は考慮外（`settle-batch.js:13`） | 締めバッチへの反映方法（確認事項#2(d)）。 |
| 4 | 請求書メールの届け方（A案/B案） | A案（Shopify+MF の 2 通）で暫定運用中 | B案（Shopify メール 1 通に集約）採用可否は古谷さん確認待ち。B案なら §3 の `mf_invoice_url` に読み手（メールテンプレート）が生まれる。 |
| 5 | ③都度払いの支払期日 | 実装上は請求日+30日（`mapOrder.js:103-104` の既定値。③経路は `due_at` 未指定のため） | 仕様書（`implementation-spec.md` Task 1）は「請求日+7日」。**実装と仕様が乖離しており、どちらが正か要確認**（本辞書作成時の新規発見）。 |
| 6 | `b2b.mf_partner_id` の書戻し | 書き手なし（毎回 null → 新規取引先が作られ得る） | 請求書発行後の自動書戻しを実装するか、Admin 手動運用とするか。 |
| 7 | `b2b.customer_code` の採番・運用 | テスト値 `OC-TEST-001` のみ | 顧客番号の採番ルール・ログインとの関係（T2-11）。 |
| 8 | 旧デモ実装の実機残存 | 未確認 | §7 参照。 |

---

## 付録: 本辞書が根拠としたファイル一覧

| 区分 | ファイル |
|---|---|
| 要件・設計 | `requirements/discount-system.md` / `design/implementation-spec.md` |
| 掛率計算 | `shopify/src/discountEngine.js`（純粋ロジック・テスト 15 件） |
| 注文正規化 | `shopify/src/orderNormalize.js`（Vercel 版: `webhook/vercel-deploy/lib/orderNormalize.js`） |
| Draft Order | `shopify/src/createDraftOrder.js` / `webhook/vercel-deploy/api/create-draft-order.js` |
| パイプライン | `webhook/pipeline.js` / `webhook/vercel-deploy/lib/pipeline.js` / `webhook/settle-batch.js` |
| MF 連携 | `moneyforward/src/invoiceService.js` / `moneyforward/src/mapOrder.js` |
| データ投入 | `shopify/src/setup.js` / `demo-setup.js` / `set-payment-terms.js` / `create-test-customer.js` / `setup-collections.js` |
| テーマ | `shopify-theme/snippets/b2b-*.liquid` / `sections/main-account.liquid` |
