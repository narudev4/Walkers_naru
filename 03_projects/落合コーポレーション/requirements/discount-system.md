# B2B 掛け率システム 技術検証

最終更新: 2026-05-27（naru セッション）
担当: naru
位置づけ: 5/26 PM MTG で古谷さんから振られた **Customer Metafield + Shopify Functions** の技術検証
リンク: [議事録](./meeting-2026-05-26-pm.md) / [規約調査](./shopify-tos-research.md)

---

## 1. 検証ゴール

落合コーポ B2B の **2 軸柔軟掛け率管理** を Shopify 上で実装可能か検証し、デモ可能なプロトタイプを作る。

**2 軸柔軟掛け率管理**:
- **顧客側**: グループ単位（A / B ランク等） + 個別顧客カスタム
- **商品側**: 商品区分（ラケット / ウェア / シューズ 等）別レート
- → **顧客 × 商品区分** の組合せで最終掛け率を決定
- **新カテゴリ追加で再開発不要**

最終アウトプット: 古谷さんがデモで見せられるレベルの動くプロトタイプ + 設計仕様書

---

## 2. データモデル設計

### 顧客（Customer）側
```
namespace: b2b
- customer_type        single_line_text     "individual" | "corporate"
- discount_group       single_line_text     "A" | "B" | "C" | "custom" 等
- custom_overrides     json                 個別カスタム掛け率（後述）
- corporate_name       single_line_text
```

### 商品（Product）側
```
namespace: b2b
- category             single_line_text     "racket" | "wear" | "shoes" | "ball" | "string" | "accessory"
- sport                single_line_text     "badminton" | "tennis" | "pickleball" | "padel"
```

### Shop（ストア全体）側 — Metaobject で管理
```
metaobject: discount_matrix
fields:
- group            single_line_text    "A" | "B" | "C"
- category         single_line_text    "racket" | "wear" | ...
- discount_rate    number_decimal      0.0 - 1.0
```

→ `discount_matrix` を必要なだけ作成して、グループ × カテゴリの掛け率を表現。新カテゴリ追加時は Metaobject エントリを追加するだけ（コード変更不要）。

### Customer 個別カスタム（オプション）
```
customer.metafields.b2b.custom_overrides (JSON):
{
  "racket": 0.55,        # この顧客限定でラケット掛け率 55%
  "string": 0.80
}
```
→ グループのデフォルトを上書き。

---

## 3. 掛け率計算ロジック

```
最終掛け率(customer, product) =
  customer.custom_overrides[product.category]
    ?? discount_matrix[customer.discount_group][product.category]
    ?? 1.0   // デフォルト（掛け率なし=正価）
```

例:
- Customer A（group=A, custom_overrides={racket: 0.55}）
- Product P（category=racket）
- → custom_overrides 優先で 0.55 適用
- 別の商品 Q（category=wear）
- → discount_matrix[A][wear] にヒットして適用

---

## 4. 実装手段の比較

| 手段 | メリット | デメリット | 採否 |
|---|---|---|---|
| **Shopify Functions (Cart Transform / Discount API)** | チェックアウト時に確実に適用、モダン、APIアクセス可能 | Rust/JS 実装、デプロイ手間、Plus 限定機能あり | ★候補 |
| **Theme Liquid で価格書き換え** | カンタン、表示だけ即反映 | チェックアウトに反映できない、整合性問題 | 補助 |
| **Shopify Scripts (Plus 限定)** | Cart 操作に強い | **Plus 必須** | × |
| **外部 Function (Vercel + Webhook)** | 任意ロジック、自由度高 | 通信遅延、Shopify 外の管理 | 候補 |
| **専用 B2B サイト構築** | 規約縛りなし | コスト大、Shopify と二重管理 | 規約調査次第 |

→ **Shopify Functions (Product Discount API)** を本命に検証。Plus でなくても Basic / Advanced で利用可能。

---

## 5. Shopify Functions プロトタイプ設計

> ⚠️ **2026-06-01 方針転換**: 一次情報調査で **「Shopify Basic + カスタムアプリの Shopify Functions は Plus 限定」**（[shopify.dev 公式](https://shopify.dev/docs/apps/build/functions) + community staff 回答）と確定。本 §5 の Function 方式は Basic では成立しない（App Store 公開アプリ化すれば可だが単一クライアントには過剰）。→ **Draft Order ベース方式に変更**（→ §11）。以下の Function 設計は参考情報として残す。

### 構成
```
落合コーポレーション/
└── shopify/
    └── functions/
        └── b2b-discount/
            ├── package.json
            ├── shopify.extension.toml
            └── src/
                └── run.ts (or .js)
```

### Function の入出力
- **入力 (Input.graphql)**: Cart の line items + customer metafields + product metafields
- **出力**: 各 line に対する `DiscountApplicationStrategy.FIRST` の Discount

### 擬似コード
```ts
export function run(input: RunInput): FunctionRunResult {
  const customer = input.cart.buyerIdentity?.customer;
  if (!customer || customer.metafield_b2b_customer_type !== "corporate") {
    return EMPTY_DISCOUNT;
  }

  const group = customer.metafield_b2b_discount_group; // "A"
  const overrides = JSON.parse(customer.metafield_b2b_custom_overrides || "{}");
  const matrix = input.shop.metaobjects.discount_matrix; // 全エントリ

  const discounts = input.cart.lines.flatMap((line) => {
    const category = line.merchandise.product.metafield_b2b_category;
    if (!category) return [];

    // 個別カスタム優先 → グループのマトリクス → デフォルト 1.0
    const rate =
      overrides[category] ??
      matrix.find(m => m.group === group && m.category === category)?.discount_rate ??
      1.0;

    if (rate >= 1.0) return [];

    return [{
      targets: [{ cartLine: { id: line.id } }],
      value: { percentage: { value: (1 - rate) * 100 } },
    }];
  });

  return { discounts, discountApplicationStrategy: "FIRST" };
}
```

### デプロイ
```bash
shopify app init b2b-discount
cd b2b-discount
shopify app generate extension --type=product_discounts
# 上記コード実装
shopify app deploy
```

→ ストアに Function インストール後、Admin > Discounts でこの Function ベースの自動割引を有効化。

---

## 6. テストシナリオ

### Metaobject エントリ準備
```
discount_matrix:
- {group: "A", category: "racket", rate: 0.60}
- {group: "A", category: "wear", rate: 0.70}
- {group: "B", category: "racket", rate: 0.70}
- {group: "B", category: "wear", rate: 0.80}
```

### テスト Customer
- `corp-a-test@example.com`: type=corporate, group=A
- `corp-b-test@example.com`: type=corporate, group=B
- `corp-custom@example.com`: type=corporate, group=A, custom_overrides={racket: 0.50}
- `individual-test@example.com`: type=individual

### 検証パターン
1. corp-a がラケットをカート → 40% off (0.60)
2. corp-a がウェアをカート → 30% off (0.70)
3. corp-b が同ラケット → 30% off (0.70)
4. corp-custom が同ラケット → 50% off (0.50, override 優先)
5. individual がラケット → 割引なし

---

## 7. 別途検証する点 → 検証結果（2026-06-01 実機検証済み）

| 検証項目 | 結果 |
|---|---|
| **新カテゴリ追加で再開発不要** | ✅ **実証済み**。discount_matrix に `A/ball=0.65` を追加するだけ（コード一切変更なし）で ball 商品に 35%off 適用（Draft #D9）。新グループ追加も同様にデータ追加のみ。 |
| **顧客グループの一括変更** | ✅ **実証済み**。corp-a の `discount_group` を A→B に変更 → ラケットが ¥7,680(0.60)→¥8,960(0.70) に即追従（#D10）。A に戻すと ¥7,680 に復帰（#D11）。 |
| **未登録カテゴリの挙動** | ✅ **正価**。matrix 未定義カテゴリ・category 未設定商品は rate 1.0（正価）に安全フォールバック。 |
| **複数商品の混在カート** | ✅ **各 line 個別レート**。corp-a 混在カートで racket=¥7,680 / wear=¥3,150 / ball=¥7,700 を各 line に正しく適用（#D8）。 |
| **API パフォーマンス** | Draft Order 1件 = 顧客 metafield + variant + matrix全件 + draftOrderCreate の計4リクエスト。**実測 約1.89秒/件**（6件で11.3秒）。Function レイテンシ懸念は該当せず（Function 不使用）。 |
| **管理画面 UI** | discount_matrix は Admin の **Content → Metaobjects** から GUI で追加/編集可（落合社が日常運用可）。掛け率変更は Metaobject の discount_rate 編集、または Customer metafield の discount_group / custom_overrides 編集で完結。独自管理画面は不要（将来 UX 向上のオプション）。 |

> **税の扱い（要確認）**: priceOverride で入れた額は「税抜卸価格」扱いとなり、注文合計に消費税10%が加算される（例 ¥7,680 → 合計 ¥8,448）。日本の B2B 商習慣（税抜卸+消費税）には合致。卸価格を税込で扱いたい場合はストアの税設定で調整 — 古谷さん/落合に確認。

---

## 8. 実装ロードマップ

| Phase | 内容 | 期限 |
|---|---|---|
| 1 | データモデル仕様確定（本ファイル） | 5/27-28 |
| 2 | Metafield / Metaobject 定義（Admin UI） | 5/28-29 |
| 3 | Function プロトタイプ実装 | 5/29-6/2 |
| 4 | テストシナリオ実行 | 6/2-6/3 |
| 5 | 古谷さんレビュー → 落合社デモ | 6/4-6/5 |

※ 規約調査の結果で「Shopify 外システム化」に振れたら、本ファイルは部分的に転用（データモデルは活きる、Function は外部 API に置換）

---

## 9. 古谷さんに確認したい点

- 落合社が日常で掛け率変更する **UI イメージ**は？ Admin の Metaobject 編集を直接見せる？それとも独自管理画面？
- **個別カスタム掛け率**は「商品区分別」だけで足りる？「特定商品の特定顧客向け」までは不要？
- グループ数の想定（A/B/C で足りる？10 グループ超？）
- Plus にする選択肢を本気で持ってるか？（Shopify Scripts 使えるなら設計変わる）

---

## 10. 進捗ログ

| 日時 | 内容 |
|---|---|
| 2026-05-27 | ファイル作成、データモデル / 実装方針ドラフト |
| 2026-06-01 | 技術検証実施。①Basic+カスタムアプリ Functions は Plus 限定と一次情報で確定（当初§5方式が不可）→ ②Draft Order ベースに方針転換し Basic で自前実装。③レート計算 discountEngine 15テスト全パス。④実機5シナリオ+§7全項目 PASS（Draft #D3〜#D11）。実装は `shopify/` 配下。詳細§11。 |

---

## 11. 検証結果サマリ（2026-06-01・古谷さんレビュー用）

### 結論（1行）
> **「顧客 × 商品区分」の柔軟な掛け率は Shopify Basic（月4,100円）で自前実装できる。** ただし手段は「自動チェックアウト割引（Functions）」ではなく **「営業担当/システムが Draft Order 作成時に掛け率を自前適用」** する方式。Draft Order は全プラン共通で動き、銀行振込フロー（規約調査§8.5「注文方法b」）とも整合。トレードオフは "営業担当介在" であって "顧客セルフサービス" ではないこと。

### なぜ Function でなく Draft Order か（すべて一次情報で裏取り）
| 項目 | 結論 |
|---|---|
| Basic + カスタムアプリで Shopify Functions | **不可（Plus 限定）**。[shopify.dev 公式](https://shopify.dev/docs/apps/build/functions) + community staff 回答で確定 |
| Basic で Functions を動かす唯一の道 | App Store 公開アプリ化のみ（審査・公開・保守が必要、単一クライアントには過剰） |
| Draft Order の per-line 掛け率適用 | **Basic で可能**（Admin API `DraftOrderLineItemInput.priceOverride`、実機 trial で確認） |
| Metafield / Metaobject の管理 | Basic で可能（Admin UI から GUI 編集） |

### データモデル（実装済み）
- **Customer metafield** (b2b): `customer_type` / `discount_group` / `custom_overrides`(JSON)
- **Product metafield** (b2b): `category`
- **discount_matrix Metaobject**: group × category × discount_rate（新カテゴリは行追加だけ）
- レート決定: `custom_overrides[category] ?? matrix[group][category] ?? 1.0`

### 検証結果（実機 Draft Order・全 PASS）
- §6 の5シナリオ + §7 混在カート（#D3〜#D8）
- §7 新カテゴリ追加（コード無変更）/ グループ一括変更（#D9〜#D11）
- 詳細は §7 の表を参照

### トレードオフ・残課題
- **トレードオフ**: 営業担当/システム介在（顧客セルフチェックアウトでの自動適用ではない）。セルフ自動適用が必須化すれば Plus or App Store 公開アプリ化の再検討。
- **税**: priceOverride 額は税抜扱い → 消費税が別途加算（§7 末尾、要確認）。
- **ストアフロント価格表示**: ログイン顧客に卸価格を「表示」するのは別途（Theme Liquid + metafield、本検証スコープ外）。
- **本番ストア**: 検証は「落合コーポレーション様 デモ」(Development プラン)で実施。Draft Order 方式は全プラン共通のため本番 Basic に転用可。**ただし本番では Admin API トークンの発行経路を要確認** — Admin 画面に「2026/1/1 以降は新規レガシーカスタムアプリ作成不可」の警告あり。本番ストアでは Dev Dashboard 経由でのアプリ作成になる可能性。
- **マトリクス規模**: matrix は1クエリ `first: 250` で全件取得。group × category が 250 件を超える場合のみページネーション実装（コード変更）が必要。落合の想定（数グループ × 6カテゴリ程度）では十分。
- **セキュリティ**: Admin API トークンは検証用。デモ後にローテーション（再生成）推奨。

### 成果物（`03_projects/落合コーポレーション/shopify/`）
- `src/discountEngine.js`（+ `discountEngine.test.js` 15件）— レート計算（設定駆動・新カテゴリ再開発不要）
- `src/shopifyClient.js` / `probe.js` / `setup.js` / `createDraftOrder.js`（priceOverride/appliedDiscount 両対応）/ `scenarios.js` / `verify-section7.js`
- デモ手順: `npm run probe`（疎通）→ `node --env-file=.env src/scenarios.js`（5シナリオ実演）。各 Draft に Invoice URL 生成済み（Admin で目視可）。
