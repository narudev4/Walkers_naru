# 統合接続契約 — Track B（Shopify）↔ Track A（MF請求書）

> 目的: A・Bを**独立開発**しつつ、最後に**一気通貫**で繋ぐための受け渡しデータ形式の取り決め。
> 両セッションはこのファイルの「正規化注文データ」を境界とする。これさえ守れば別々に作っても繋がる。
>
> **【2026-06-08 実装で確定】** 実際の受け渡し形式は **A側 `moneyforward/samples/order.sample.json` と同形**に統一した（B の `demo-order.js` がこの形式で `output/last-order.json` を出力。`line_items[].wholesale_unit_price` / `customer.company` / `ordered_at` / `fulfilled_at` 等）。**実体は `shopify/src/demo-order.js`（出力）と `moneyforward/src/mapOrder.js`（入力）**で、オフライン受け渡し検証済み。以下の初期設計（partner/items 形式）は経緯の記録。

## 接続点 = 正規化注文データ（normalized order JSON）

Bが Draft Order 作成時にこの形で出力し、Aがこれを入力に MF 請求書を発行する。

```json
{
  "draftOrderId": "gid://shopify/DraftOrder/123",
  "draftOrderName": "#D12",
  "invoiceUrl": "https://.../invoices/...",
  "currency": "JPY",
  "partner": {
    "shopifyCustomerId": "gid://shopify/Customer/456",
    "displayName": "テスト法人A",
    "corporateName": "株式会社サンプル",
    "mfPartnerId": "",
    "paymentTerms": "20th"
  },
  "items": [
    {
      "title": "KAWASAKI ラケット",
      "quantity": 1,
      "category": "racket",
      "rate": 0.60,
      "originalUnitPrice": 12800,
      "unitPriceWholesale": 7680
    }
  ],
  "totalWholesale": 7680
}
```

- `paymentTerms`: `"20th"`（20日締め）/ `"eom"`（末締め）/ `"prepaid"`（前金）。6/3決定2の3区分。
- `mfPartnerId`: MF 取引先ID。初回は空でよい（A側で取引先を新規作成→以後この値を Shopify 顧客へ書き戻す）。
- `unitPriceWholesale`: 掛け率適用後の卸単価（B の `discountedUnitPrice` / priceOverride 額）。

## マッピング（A 側の実装指針）

| 正規化注文データ | MF クラウド請求書 |
|---|---|
| `partner.corporateName` / `mfPartnerId` | 取引先（partner）。無ければ新規作成 |
| `items[].title / quantity / unitPriceWholesale` | 請求書明細（品目・数量・単価） |
| `paymentTerms` | 支払期日の計算（20日締め→翌月20日 等） |
| `currency` | 通貨 |

## 受け渡し方法（段階）

- **段2（A単体）**: B が **案件ルート直下 `output/last-order.json`**（`shopify/` から見て `../output/`）に上記JSONを書き出し → A がそれを読んで請求書発行。疎結合・確実。B側の生成スクリプト = `shopify/src/demo-order.js`。
- **段3（一気通貫）**: A が `draftOrderId` を使い Shopify Admin API から直接引いて請求書発行。両方動いたらこちら。

## 今夜 B 側で追加が必要（現状の欠けピース）

現状の Customer metafield は `b2b.customer_type` / `b2b.discount_group` / `b2b.custom_overrides` のみ。統合のため以下を追加:

- `b2b.corporate_name`（single_line_text）— 取引先名
- `b2b.payment_terms`（single_line_text）— `20th` / `eom` / `prepaid`
- `b2b.mf_partner_id`（single_line_text）— A が発行後に書き戻す枠（初回空）

> デモ最小ラインではこの3つはテスト顧客1名に手動投入でよい（全顧客への展開は本番作業）。
