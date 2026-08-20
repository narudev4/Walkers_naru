# 完全理解設計書 05 — 画面一覧・機能一覧・API設計・環境情報・バックログ

最終更新: 2026-07-22 ／ ステータス: クロスレビュー反映済み（Haiku+引用検証217件+Codex 見落とし検出。naru 逆レビュー QA 待ち）

> 確定事項の正は真理源スプシ「確認事項」タブ。本ファイルは 2026-07-22 時点のコード・設定の実在確認（Read／grep）に基づく現状整理であり、未確定事項は未確定と明記する。
> 工程 No は「ローンチ工程表_draft（v2）」の番号を指す（本設計書群 02／04 と共通の採番）。

---

## 1. 画面一覧

### 1-1. 一般のお客様向け（B2C）14画面

> トンマナ（色・雰囲気）は **6案から選定中・未確定**（案Bが有力候補・宏樹様のご決定待ち。2026-07-21 naru 訂正、詳細は 02 §3 P-7）。下表の「実装済み」はデモストア上の機能・骨格の完成を指し、トンマナ反映は含まない。実装テーマは **Rise**（spec の「Dawn」記述は旧計画・→ 00 Z-7）。

| # | 画面 | 実装方法 | 状況（2026-07-22） | 根拠 |
|---|---|---|---|---|
| 1 | ヘッダー・フッター | Rise テーマ（header.liquid／footer.liquid） | ✅ 骨格実装済み。ロゴ画像・確定カラーの反映は未（デザイントラック）。 | shopify-theme/sections/ に実在。 |
| 2 | トップページ | Rise セクション（hp-hero.liquid／hp-cta.liquid 等） | ✅ デモ実装済み。案B詳細指示（スライダー・キャッチコピー・シャトル画像）の反映は未。 | shopify-theme/sections/hp-hero.liquid ほか。 |
| 3 | 商品一覧（カテゴリ別） | コレクション + main-collection-product-grid.liquid | ✅ 18コレクション + 親コレクション作成済み（バドミントン／テニス。野球・ピックルボールなしに 7/2 訂正済み）。実商品データは未投入。 | launch-plan/00-inventory.md F-1。 |
| 4 | 商品詳細 | main-product.liquid（B2B 卸価格スニペットを render） | ✅ 実装済み（Phase3 完了）。 | shopify-theme/snippets/b2b-wholesale-price.liquid。 |
| 5 | カート | テーマ標準（main-cart-items.liquid ほか） | ✅ テーマに含む。 | shopify-theme/templates/cart.json。 |
| 6 | チェックアウト | Shopify 標準（Basic 制約内） | ✅ 標準機能。銀行振込・代引きは設定済み、クレカ（Shopify Payments）は本番審査待ち。 | 00-inventory.md D-5／D-7。 |
| 7 | 注文完了 | Shopify 標準サンクスページ | ✅ 標準機能。 | — |
| 8 | 会員登録 | main-register.liquid（ゲスト購入無効化済み＝会員必須） | ✅ 設定済み。 | 00-inventory.md D-1。 |
| 9 | ログイン | main-login.liquid | ✅ 実装済み（B2B 顧客番号ログイン UI を同居。§1-2 参照）。 | shopify-theme/sections/main-login.liquid。 |
| 10 | パスワード再設定 | main-reset-password.liquid | ✅ 標準機能。 | テーマに実在。 |
| 11 | マイページ TOP | main-account.liquid | ✅ 標準機能。 | テーマに実在。 |
| 12 | 注文履歴 | main-order.liquid（account/orders） | ✅ 標準機能。 | テーマに実在。 |
| 13 | 会社概要・お問合せ | ページ機能 + page.contact.json | ⬜ 未作成。ページ作成 API（write_content）が現行トークンに無く、本番 Custom App 再作成（工程 No.20）または Admin 手動での作成が必要。 | 00-inventory.md R-21／R-22。 |
| 14 | 特商法・プライバシーポリシー・利用規約（法定3点） | ページ機能 | ⬜ 未作成。特商法の記載事項（責任者名・電話・返品条件）は先方回答待ち（P-9）。 | 00-inventory.md R-23／P-9。 |

### 1-2. 業者様向け（B2B）6画面

> 業者様向け（B2B）トンマナは **作成中**（競合調査から作り直し中・7/22 方針。共有は工程 No.2）。

| # | 画面 | 実装方法 | 状況（2026-07-22） | 根拠 |
|---|---|---|---|---|
| 1 | B2B ログイン | main-login.liquid に顧客番号入力 UI（顧客番号→メアド解決してログイン） | 🔶 テーマ UI は実装済み。ただし照会先 `/apps/b2b-lookup`（App Proxy バックエンド）は**リポジトリに存在せず未実装**。採否含む本番設計（レート制限・総当たり対策）は未確定＝工程 No.11。 | main-login.liquid:166 の fetch 先が未実装（grep 確認）。 |
| 2 | B2B 商品一覧 | b2b-card-price.liquid（コレクションページ卸価格表示） | ✅ 実装済み。 | shopify-theme/snippets/b2b-card-price.liquid、00-inventory.md B-4/B-5。 |
| 3 | B2B 商品詳細 | b2b-wholesale-price.liquid（卸価格・掛率表示） | ✅ Phase3 完了。 | main-product.liquid に render 済み。 |
| 4 | B2B カート・チェックアウト | カート→「法人価格で注文する」→ Vercel Function（create-draft-order.js）→ invoice URL リダイレクト | ✅ デモ版完了（テーマ #181578989869）。方式(b)カート→Draft Order の**正式クローズは古谷さん合意待ち**＝工程 No.5。エッジケース検証（二重クリック・在庫切れ等）も残。 | snippets/b2b-cart-checkout.liquid + webhook/vercel-deploy/api/create-draft-order.js。 |
| 5 | B2B マイページ | Shopify 標準 account + 取引条件表示カスタマイズ | ✅ デモ実装済み（E-5）。 | 00-inventory.md「テーマUI」行。 |
| 6 | B2B 会員申請 | 招待制のため画面なし（管理者が Admin で登録・招待メール送信） | —（対象外）。実顧客の本登録は本番工程。 | implementation-spec.md Task2。 |

---

## 2. 機能一覧

### 2-1. 実装済み（コード実在＋検証記録あり）

| 機能 | 対応ファイル | 備考 |
|---|---|---|
| B2C／B2B 共存ストア（1ストア内 Liquid 分岐） | shopify-theme/snippets/b2b-*.liquid **6種**（card-price／cart-checkout／login-banner／nav-switcher／order-form／wholesale-price） | `customer.metafields.b2b.customer_type` で表示分岐。Basic＝1ストア制約への対応。 |
| テーマ内表示切替（ナビ・バナー・価格） | b2b-nav-switcher.liquid／b2b-login-banner.liquid／b2b-card-price.liquid／b2b-wholesale-price.liquid | Rise テーマ（shopify-theme/config/settings_schema.json で確認）。 |
| 顧客 metafield（b2b.customer_type／discount_group／custom_overrides／payment_terms／mf_partner_id／customer_code） | shopify/src/setup.js ほか（詳細は 01-data-dictionary.md） | 定義・投入済み（demo 顧客）。 |
| 2軸カスケード割引（override → matrix → 正価） | shopify/src/discountEngine.js | 15テスト全パス。Vercel 側は create-draft-order.js に同ロジックを再実装。 |
| metaobject 掛率表（discount_matrix） | shopify/src/setup.js（metaobjectDefinitionCreate／metaobjectCreate） | **値は demo 値**。setup.js の投入は A/B の4行のみ（A/racket=0.60・A/wear=0.70・B/racket=0.70・B/wear=0.80）で、**C グループは投入エントリ無し・実機投入未確認**（→ 00 Z-5）。実値は未回収（P-1）。 |
| カート→Draft Order 自動生成（掛率適用・invoice URL 返却） | webhook/vercel-deploy/api/create-draft-order.js | corporate 判定 403・appliedDiscount（PERCENTAGE）方式。デモ版完了。 |
| Webhook HMAC 検証 | webhook/vercel-deploy/api/webhook.js（verifyHmac） | HMAC-SHA256・raw body・timingSafeEqual。不一致 401。 |
| 注文正規化（Admin API + metafield 取得） | webhook/vercel-deploy/lib/orderNormalize.js | ダミー email→デモ受信先置換ロジックあり（本番 E2E＝工程 No.23 で残存確認要）。 |
| 支払条件判定（③都度払い即時／①②かけ払いスキップ） | webhook/vercel-deploy/lib/pipeline.js | IMMEDIATE_TERMS（既定 prepaid,immediate）で分岐。 |
| MF 請求書下書き自動作成（取引先自動作成含む） | webhook/vercel-deploy/lib/invoiceService.js + mapOrder.js | 請求書 #2〜#11 実発行済み（naru トライアル口座）。 |
| MF 請求書 URL の Shopify 注文への書戻し | lib/pipeline.js + lib/shopifyClient.js（setOrderMetafield） | `b2b.mf_invoice_url`／`b2b.mf_billing_number` を metafieldsSet で書込み（A案・B案どちらでも使う照合キー）。 |
| MF トークン自動更新 | moneyforward/src/mfClient.js | 401→ディスク再読→refresh 1回再試行。**Vercel 版（lib/mfClient.js）は環境変数ベースで、リフレッシュ結果はインスタンス内のみ有効**（永続化なし）。 |
| かけ払い締めバッチ（顧客別統合・冪等） | webhook/settle-batch.js | 実装済み・ローカル検証済み。**cron は未設定**（工程 No.25）。二重実行防止は output/settle-runs.json。 |
| ③都度払い請求書の自動メール送信（Playwright A-2） | mf-automation/send-invoice.js | 請求書 #6・#7 で実証。**Vercel Function 非対応**（Chromium 無し）のため別プロセス実行が前提。B案採用なら本番不使用の予備手段。 |
| Webhook 購読管理 CLI | shopify/src/webhook-admin.js | webhookSubscriptionCreate／Delete／list。本番購読済み（sub=1905646272813）。 |

### 2-2. 未実装・進行中

| 機能 | 状態 | 対応ファイル／移管先 |
|---|---|---|
| 締めバッチの返品・キャンセル除外（REFUNDED／PARTIALLY_REFUNDED／cancelledAt） | ⬜ 未実装（settle-batch.js:13 に「未実装（確認待ち）」と明記。返品済み注文も現状は金額に乗る）。 | 工程 No.14。 |
| 請求書メール B案（Shopify メール1通に MF 請求書 URL 集約） | ⬜ **未確定**（A案暫定運用中。最終確定＝工程 No.3、B案採用時の実装＝工程 No.35）。 | 照合キー（confirmation_number）と書戻し metafield は準備済み。 |
| カート→Draft Order 方式の正式クローズ + エッジケース検証 | 🔶 デモ版完了・古谷さん合意待ち（工程 No.5）。二重クリック・在庫切れ・B2C 商品混在・Function 障害時の検証が残。 | api/create-draft-order.js。 |
| 顧客番号ログインのバックエンド（App Proxy `/apps/b2b-lookup`） | ⬜ 未実装（テーマ UI のみ先行）。採否含め工程 No.11。 | main-login.liquid:166。 |
| MF 取引先突合（既存顧客への b2b.mf_partner_id 付与） | ⬜ 未実施。やらないと注文・締めのたびに MF 取引先が重複作成される。 | 工程 No.24。 |
| かけ払い明細粒度の本番確定 | 🔶 **商品単位の行**で仮実装（line item ごとに1行・settle-batch.js:145-152。確認事項#2 の記録「注文単位」とは逆 → 00 Z-3）。本番前に確認事項#2(a) の回答反映。 | settle-batch.js。 |
| 送料プロファイル（B2C／B2B）・Shopify Payments・後払い・PayPay・佐川連携・在庫設定・法定ページ | ⬜ 未設定／未着手。設計は design/shipping-config.md 等にあり、実施はローンチ工程表_draft（v2）へ移管済み。 | 同工程表 D〜H 領域。 |

---

## 3. API 設計

### 3-1. Shopify Admin GraphQL API

- **クライアント**: `shopify/src/shopifyClient.js`（fetch ベース・依存ゼロ。`X-Shopify-Access-Token` ヘッダ・API バージョン既定 `2025-10`）。Vercel 版は `webhook/vercel-deploy/lib/shopifyClient.js`（metafieldsSet ラッパー setOrderMetafield を追加）。
- **認証**: Custom App の Admin API アクセストークン（`shpat_`）。環境変数 `SHOPIFY_STORE_DOMAIN`／`SHOPIFY_ADMIN_TOKEN`／`SHOPIFY_API_VERSION`。

#### スコープ

| 区分 | 内容 | 根拠 |
|---|---|---|
| 現行 | **16スコープ**（デモストアの Custom App に付与済み。内訳の一覧スクショは未取得＝本番 Custom App 再作成（工程 No.16 相当のスクショ取得）で確定させる）。 | decisions-implementation.md D-2。 |
| 本番で追加予定 | `write_orders`（orderMarkAsPaid が ACCESS_DENIED だったため）／`read_payment_gateways`／`write_content`（コーポレート・法定ページの API 作成用）。 | D-2 + 00-inventory.md R-2／R-21。 |

#### 主要クエリ／ミューテーション（コード grep で確認済み）

| オペレーション | 使用箇所 | 用途 |
|---|---|---|
| `draftOrderCreate` | api/create-draft-order.js、shopify/src/createDraftOrder.js | 掛率適用（appliedDiscount／priceOverride）の Draft Order 作成。 |
| `draftOrderComplete(paymentPending: true)` | shopify/src/demo-settle-data.js:65 | Draft Order→通常注文化（Manual Payment＝支払保留)。Dev store の storefront checkout 制約（D-1）の回避にも使用。※draft-to-order.js は読み取りのみで complete を呼ばない。 |
| `orderMarkAsPaid` | shopify/src/mark-as-paid.js | 入金消込。**現行トークンでは ACCESS_DENIED**（write_orders 未付与）。 |
| `metafieldsSet` | lib/shopifyClient.js（書戻し）、setup 系 | MF 請求書 URL 書戻し・顧客／商品 metafield 投入。 |
| `metaobjectDefinitionCreate`／`metaobjectCreate` | shopify/src/setup.js | discount_matrix 定義・行投入。 |
| `customerCreate`／`customerUpdate` | create-test-customer.js／demo-customer.js | B2B 顧客作成・metafield 更新。 |
| `collectionCreate` | setup-collections.js | スポーツ×カテゴリのコレクション作成。 |
| `pageCreate` | setup-pages.js | ページ作成（**write_content 不足で現行は実行不可**）。 |
| `webhookSubscriptionCreate`／`Delete`／一覧 | webhook-admin.js | orders/create 購読管理。 |
| `orders(first: 100, …)` + fulfillments | webhook/settle-batch.js | 締め期間内の発送済み注文の抽出。 |
| `customer`／`nodes(ProductVariant)`／`metaobjects` クエリ | api/create-draft-order.js | 顧客 metafield・商品カテゴリ・掛率表の取得。 |

### 3-2. マネーフォワード クラウド請求書 API（v3）

- **ベース URL**: `https://invoice.moneyforward.com/api/v3`（moneyforward/src/config.js。一次情報＝公式 OpenAPI・RFC 8414 メタデータで確定済み）。
- **認証**: OAuth2 認可コードフロー + PKCE（S256）。認可 `https://api.biz.moneyforward.com/authorize`／トークン `…/token`。スコープ `mfc/invoice/data.write`。トークン EP 認証方式は `client_secret_post`（既定）。
- **トークンリフレッシュ**: mfClient.js が 401 検知→①ディスクの新トークン再読（並行プロセスのリフレッシュ競合対策）→②refresh_token で1回だけ更新・保存→再試行。Vercel 版は環境変数ベースで、リフレッシュはインスタンス内のみ（期限切れ時はローカル `npm run auth` → Vercel 環境変数再設定。長期運用は KV 等への永続化を推奨＝README 記載）。

#### 使用エンドポイント

| エンドポイント | 使用箇所 | 用途 |
|---|---|---|
| `GET /office` | whoami.js | トークン疎通確認。 |
| `POST /partners` | invoiceService.js（ensurePartnerAndDepartment） | 取引先＋部署の新規作成。 |
| `GET /partners/{id}` | 同上 | 既存取引先の再利用（`order.mf_partner_id` があるとき）。 |
| `POST /partners/{id}/departments` | 同上（resolveDepartmentId） | 請求書必須の department_id を確定的に解決。 |
| `POST /invoice_template_billings` | invoiceService.js（createInvoiceFromOrder） | 請求書作成（インボイス制度対応テンプレート・メール状態＝未送信＝下書き）。 |
| `GET /billings?document_number=` | invoiceService.js（findBillingByNumber） | 送信後の email_status 検証（単体 GET が無いため検索で代替）。 |

#### 制約

- **メール送信エンドポイントが存在しない**（API v3 仕様確認済み・D-3）。③都度払いの自動送信は Playwright（mf-automation/send-invoice.js・A-2 方式）で UI 操作を代行。差出人は MF 公式（do_not_reply@moneyforward.com）のまま。
- MF に sandbox 環境なし。検証は naru トライアル口座の実 API（D-5）。

### 3-3. Webhook（Shopify → Vercel）

| 項目 | 内容 |
|---|---|
| トピック | `orders/create`（対象外トピックは 200 でスキップ）。 |
| 署名検証 | HMAC-SHA256（`X-Shopify-Hmac-Sha256` vs raw body・base64・timingSafeEqual）。不一致は 401。シークレット＝Custom App の API シークレットキー（**App 再作成でキーが変わる**点は本番移行の要注意事項＝04-flow-diagrams.md 参照）。 |
| 応答設計 | 即 200（Shopify の 5 秒制限対策）→ `waitUntil()` で非同期処理（Vercel Fluid Compute）。 |
| 二重発行防止 | インメモリ Set（コールドスタートでリセット）。請求書作成前の失敗はマーク解除→再配送でリトライ、作成後はマーク維持。永続化が必要なら KV へ差し替え可能な processedStore 抽象。 |
| Function 構成 | `api/webhook.js`（受信）＋ `api/create-draft-order.js`（B2B 発注）＋ `lib/`（pipeline／orderNormalize／shopifyClient／invoiceService／mfClient／mapOrder の vendor コピー。cross-dir import 不可のため＝D-4）。`vercel.json` の maxDuration は webhook.js=60／create-draft-order.js=30。 |

---

## 4. 環境情報

### 4-1. 現在の環境（2026-07-22）

| 項目 | 値 |
|---|---|
| デモストア Admin | https://admin.shopify.com/store/xn-dfum9d9e7a6a1b3d8dc3778hkjvcsh3d |
| デモストア Storefront | https://xn-dfum9d9e7a6a1b3d8dc3778hkjvcsh3d.myshopify.com/ （パスワード: `eahayl`） |
| ストア種別 | **未確認**（Client transfer store か Dev store か。本番移行フローの分岐点＝工程 No.6 で naru が Dev Dashboard を確認）。 |
| テーマ | Rise（shopify-theme/ にローカル管理。デモテーマ #181578989869）。 |
| Webhook 実行環境 | Vercel（ochiai-corp-webhook.vercel.app 稼働・orders/create 購読済み sub=1905646272813）。 |
| Vercel 環境変数 | SHOPIFY_WEBHOOK_SECRET／SHOPIFY_STORE_DOMAIN／SHOPIFY_ADMIN_TOKEN／SHOPIFY_API_VERSION／MF_CLIENT_ID／MF_CLIENT_SECRET／MF_ACCESS_TOKEN／MF_REFRESH_TOKEN／MF_TOKEN_AUTH_METHOD／SEND_MODE（=none）／IMMEDIATE_TERMS（webhook/vercel-deploy/README.md の表）。**本番／preview の env 分離方針は工程 No.21 で確定・適用**。 |
| MF 口座 | naru のトライアル口座（検証用）。 |
| cron | **未設定**（締めバッチは手動実行のみ。本番設定＝工程 No.25。cron 不発を検知する仕組みは現状なし＝04-flow-diagrams.md）。 |

### 4-2. 本番移行で変わるもの／変わらないもの

| 区分 | 項目 | 内容・移管先 |
|---|---|---|
| 変わる | ストア本体 | 本番 Basic 契約（工程 No.18）＋テーマ・metafield 定義・metaobject の移行（No.19）。移行方式はストア種別（No.6）次第。 |
| 変わる | Custom App・トークン | 本番ストアで再作成（旧16スコープ + write_orders + read_payment_gateways + write_content 付与・No.20）。**API シークレットキー＝Webhook HMAC キーも変わる**。 |
| 変わる | Vercel 環境変数・Webhook 購読 | SHOPIFY_STORE_DOMAIN／ADMIN_TOKEN／WEBHOOK_SECRET を本番値へ更新し、orders/create を本番ストアに再登録（No.21）。 |
| 変わる | MF 認可 | 先方（落合コーポ）の既存 MF ビジネスプランで OAuth し直し・naru 検証トークン撤去（No.22。CONTEXT.md §14）。**MF_CLIENT_ID を先方口座で発行し直す必要があるかは未確認**（No.12 で調査）。 |
| 変わる | データ | 掛率 demo 値→実値、仮商品→実商品マスタ、テスト顧客→実顧客。既存顧客への mf_partner_id 突合（No.24）。 |
| 変わる | 運用 | 締めバッチ cron 稼働開始（No.25）・本番 E2E 再検証（No.23。orderNormalize.js のダミー email 置換の残存確認を含む）。 |
| 変わらない | コードベース | Vercel Function（api/＋lib/）・discountEngine・settle-batch・mf-automation のロジック本体。 |
| 変わらない | データモデル | metafield（b2b.*）／metaobject（discount_matrix）の定義構造・掛率カスケード（override→matrix→正価）。 |
| 変わらない | MF API 仕様 | エンドポイント・OAuth フロー・「メール送信 API なし」の制約。 |

---

## 5. バックログ（implementation-spec.md 残作業表の 2026-07-22 時点ステータス）

> 以下は spec（T1／T2／T3 番号）の集約。**残作業の管理はローンチ工程表_draft（v2）へ移管済み**であり、本表は spec との突合用スナップショット。対応する工程 No が確認できたものは付記した（付記のないものも同工程表の該当領域に含まれる）。

### Task 1: 請求書発行ロジック

| # | 作業 | 2026-07-22 ステータス | 移管先・備考 |
|---|---|---|---|
| T1-1 | Vercel Function デプロイ | ✅ 完了（ochiai-corp-webhook.vercel.app 稼働）。 | 本番 env 更新は工程 No.21。 |
| T1-2 | Shopify webhook 登録（orders/create） | ✅ 完了（sub=1905646272813）。 | 本番ストアへの再登録は工程 No.21。 |
| T1-3 | B案: Shopify メールに請求書 URL 集約 | ⬜ **未確定**（A案暫定運用中。7/22 に spec とスプシの矛盾を「未確定」へ整理済み）。 | 最終確定＝工程 No.3、B案採用時の実装＝工程 No.35。 |
| T1-4 | 明細粒度＝**商品単位の行**で仮実装（確認事項#2 の記録「注文単位」とは逆 → 00 Z-3） | ✅ demo 実装済み。本番粒度の確定は残（確認事項#2(a)）。 | 本番前に古谷さん／先方確認。 |
| T1-5 | 返品・キャンセルの締めバッチ反映 | ⬜ 未実装（settle-batch.js に未実装と明記）。 | 工程 No.14。 |
| T1-6 | cron 設定（20日／末日 23:59 JST） | ⬜ 未設定。 | 工程 No.25。 |

### Task 2: B2B EC と B2C EC の作成

| # | 作業 | 2026-07-22 ステータス | 移管先・備考 |
|---|---|---|---|
| T2-1 | B2C 用コレクション作成 | ✅ 完了（18＋親。バドミントン／テニス）。 | 実商品投入は別途（商品マスタ待ち）。 |
| T2-2 | テーマ設定（トップ／ヘッダー／フッター） | ✅ 骨格デモ実装済み（Rise。spec 記載の Dawn から変更）。トンマナ反映は未（B2C＝6案から選定中・B2B＝作成中）。 | デザイントラック（並行）。 |
| T2-3 | コーポレートページ作成 | ⬜ 未作成（write_content 不足。コンテンツも未受領）。 | 工程 No.20 後 or Admin 手動。 |
| T2-4 | 法定ページ作成（特商法／プラポリ／利用規約） | ⬜ 未作成（法務テキスト未受領＝P-9）。 | ローンチ工程表へ移管済み。 |
| T2-5 | B2C／B2B ナビゲーション分岐 | ✅ 完了（b2b-nav-switcher.liquid・E-2）。 | — |
| T2-6 | B2C 送料設定 | ⬜ 未設定（設計は design/shipping-config.md に確定済み）。 | ローンチ工程表へ移管済み。 |
| T2-7 | B2B 送料設定 | ⬜ 未設定（沖縄5万円閾値の先方確認＝P-4 が残）。 | 同上。Draft Order への送料自動適用は要検証（S-6）。 |
| T2-8 | B2C 決済設定 | 🔶 一部完了（銀行振込・代引きは設定済み）。クレカ（Shopify Payments）・後払い・PayPay は本番審査・選定待ち。 | ローンチ工程表へ移管済み。 |
| T2-9 | B2B Manual Payment 設定 | ✅ 完了（方式確定・draftOrderComplete(paymentPending) で検証済み）。 | — |
| T2-10 | ゲスト購入無効化 | ✅ 完了（Admin UI 設定済み）。 | — |
| T2-11 | 顧客番号ログインの実現方法 | 🔶 テーマ UI 実装済み・照会バックエンド未実装・**採否未確定**。 | 工程 No.11（本番設計 or 不採用判断）。 |
| T2-12 | B2B マイページ（取引条件表示等） | ✅ デモ実装済み（E-5）。請求書 DL 表示はメール方式（No.3）の確定に依存。 | — |

### Task 3: B2B 値引きロジック

| # | 作業 | 2026-07-22 ステータス | 移管先・備考 |
|---|---|---|---|
| T3-1 | 掛率ダミー値の discount_matrix 投入 | ✅ 完了（setup.js 投入は A/B の4行のみ。**C グループは投入エントリ無し・実機投入未確認** → 00 Z-5）。**実値は未回収（P-1）**で、掛率実データ投入はローンチ工程表へ移管済み。 | 差替えは matrix 行更新のみ・コード変更不要（検証済み）。 |
| T3-2 | 発注 UI（カート→注文依頼） | ✅ デモ版完了（カート→Draft Order→invoice URL）。方式の正式クローズは古谷さん合意待ち。 | 工程 No.5＋エッジケース検証。 |
| T3-3 | 商品一覧での卸価格表示 | ✅ 完了（b2b-card-price.liquid）。 | — |
| T3-4 | 商品マスタ CSV インポートスクリプト | ⬜ 未着手（受領状況の事実確認が先。T3-4「CSV 受領済み」と Q-5「未受領」の矛盾は未解消）。 | ローンチ工程表へ移管済み（受領状況確認とセット）。 |

---

## 6. 本ファイルの未確定事項（断定しない）

| 項目 | 現状 |
|---|---|
| ストア種別（Client transfer／Dev store） | 未確認（工程 No.6）。 |
| 顧客番号ログインの採否 | 未確定（工程 No.11）。 |
| MF クライアントアプリの本番発行主体 | 未確認（工程 No.12）。 |
| 掛率の実値・「掛け」の基準 | demo 値運用中（P-1 未回収）。 |
| 一般のお客様向け（B2C）トンマナ | 6案からご検討中（案B有力・未確定）。 |
| 業者様向け（B2B）トンマナ | 作成中。 |
| 請求書メール A案／B案 | 未確定（A案暫定運用中・工程 No.3 で確定）。 |
| 現行 16 スコープの内訳 | 一覧未取得（本番 Custom App 再作成時にスクショで確定）。 |
