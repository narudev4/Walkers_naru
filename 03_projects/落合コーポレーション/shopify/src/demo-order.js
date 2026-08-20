// @ts-check
/**
 * デモ用: 法人顧客の「発注」を再現し、掛け率適用 Draft Order を生成して
 *   統合接続契約の「正規化注文データ JSON」を 案件ルート直下 output/last-order.json に書き出す。
 *   実行: node --env-file=.env src/demo-order.js
 *
 * これが Track B → Track A の受け渡し点（段3 一気通貫の土台）。
 * Track A（MF請求書）はこの JSON を読んで請求書を発行する。
 *
 * 前提: demo-setup.js を先に実行し、corp-a に corporate_name/payment_terms を投入済みであること。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiscountedDraftOrder } from './createDraftOrder.js';
import { adminGraphQL } from './shopifyClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url)); // .../shopify/src
// 案件ルート直下 output/last-order.json（shopify/src から見て ../../output）
const OUT_PATH = resolve(__dirname, '../../output/last-order.json');

const CORP_A = 'gid://shopify/Customer/9665098318125'; // corp-a（group A）
const LINES = [
  { variantId: 'gid://shopify/ProductVariant/51910940197165', quantity: 2 }, // racket ¥12,800 → A/racket=0.60 → ¥7,680
  { variantId: 'gid://shopify/ProductVariant/51910943670573', quantity: 5 }, // wear   ¥4,500  → A/wear=0.70  → ¥3,150
];

// 取引先情報（demo-setup で投入した metafield）を取得
const PARTNER_Q = `query($id: ID!) {
  customer(id: $id) {
    id displayName
    corporateName: metafield(namespace: "b2b", key: "corporate_name") { value }
    paymentTerms:  metafield(namespace: "b2b", key: "payment_terms")  { value }
    mfPartnerId:   metafield(namespace: "b2b", key: "mf_partner_id")   { value }
  }
}`;

const { customer } = await adminGraphQL(PARTNER_Q, { id: CORP_A });
if (!customer) throw new Error('customer 取得失敗');

// 発注（掛け率適用 Draft Order 生成）＋ 計算内訳取得
const { order, computed } = await createDiscountedDraftOrder({
  customerId: CORP_A, lines: LINES, mode: 'priceOverride', currency: 'JPY', returnComputed: true,
});

const now = new Date().toISOString();
const line_items = computed.map((c) => ({
  title: c.productTitle || c.title,
  quantity: c.quantity,
  wholesale_unit_price: c.unitPrice, // 掛け率適用後の卸単価（税抜）
  tax_rate: 'ten_percent',
  unit: '個',
}));

// Track A（moneyforward/createInvoice.js）が読む形式（order.sample.json と同形）に合わせる
const normalized = {
  id: order.id,
  name: order.name,
  ordered_at: now, // 売上計上=注文時（決定3）
  fulfilled_at: now, // 請求確定=発送時（決定4）。デモは発送済み想定
  payment_term: 'immediate', // ③都度払い相当。①②は将来 取引先の payment_deadline_setting で出し分け
  mf_partner_id: customer.mfPartnerId?.value || null, // 既存取引先があれば再利用（決定8）
  customer: {
    company: customer.corporateName?.value || customer.displayName,
    person_name: customer.displayName,
    email: 'naru.hosoya+shopifydemo@walker-s.co.jp',
  },
  line_items,
  invoice_url: order.invoiceUrl, // 参考: Shopify Draft Order の Invoice URL
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(normalized, null, 2));
console.log(`\n📝 正規化注文データを書き出し: ${OUT_PATH}`);
console.log('   → これが Track A（MF請求書）の入力になります（段3 一気通貫）。');
console.log('\n' + JSON.stringify(normalized, null, 2));
