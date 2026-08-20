// @ts-check
/**
 * 「Shopify 管理画面で作成した実際の注文（最新 Draft Order）」を読み、
 * Track A（MF請求書 / moneyforward/createInvoice.js）が食う正規化注文 JSON を
 * 案件ルート直下 output/last-order.json に書き出す。
 *
 * これが方式C（段3 一気通貫）の glue:
 *   Shopify管理画面で注文(Draft Order)作成 → 本スクリプトで正規化 → MF請求書を下書き作成 → MF画面から送信
 *
 * demo-order.js との違い:
 *   - demo-order.js  : 固定顧客・固定商品で「新規に」Draft Order を作る（掛け率を計算して適用）
 *   - 本スクリプト    : 「既にある最新の」Draft Order を読むだけ。割引計算はしない（今回スコープ外）。
 *                      Draft Order に入っている確定単価(discountedUnitPrice)をそのまま MF へ渡す。
 *
 * 実行: node --env-file=.env src/draft-to-order.js
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminGraphQL } from './shopifyClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url)); // .../shopify/src
// 案件ルート直下 output/last-order.json（shopify/src から見て ../../output）
const OUT_PATH = resolve(__dirname, '../../output/last-order.json');

// 顧客 email が取れない / テスト用ダミー(example.com 等)の場合のデモ既定送信先（= MF 請求書の着信先）。
const DEMO_EMAIL = 'naru.hosoya+shopifydemo@walker-s.co.jp';

// 実際には配信されないダミーアドレスのドメイン（example.com / *.test / *.invalid 等）。
const DUMMY_EMAIL = /@(example\.(com|org|net)|[^@]*\.(test|invalid|example|localhost))$/i;

/**
 * MF 請求書の着信先メールを決める。デモ顧客の email がダミーだと実際には届かないため、
 * その場合のみ naru のデモ受信アドレスへ置換する。本番の実ドメインはそのまま使う。
 * @param {string} [raw]
 */
function resolveDeliveryEmail(raw) {
  const email = (raw || '').trim();
  return !email || DUMMY_EMAIL.test(email) ? DEMO_EMAIL : email;
}

// 最新の Draft Order を1件取得（顧客の取引先 metafield と各 line の確定単価込み）。
const Q = `{
  draftOrders(first: 1, reverse: true) {
    nodes {
      id name createdAt invoiceUrl email
      customer {
        id displayName email
        corporateName: metafield(namespace: "b2b", key: "corporate_name") { value }
        paymentTerms:  metafield(namespace: "b2b", key: "payment_terms")  { value }
        mfPartnerId:   metafield(namespace: "b2b", key: "mf_partner_id")   { value }
      }
      lineItems(first: 50) {
        nodes {
          title quantity
          originalUnitPriceSet   { shopMoney { amount } }
          discountedUnitPriceSet { shopMoney { amount } }
        }
      }
    }
  }
}`;

const data = await adminGraphQL(Q);
const o = (data.draftOrders.nodes || [])[0];
if (!o) {
  throw new Error('Draft Order が1件もありません。Shopify 管理画面で注文(下書き)を作成してから再実行してください。');
}

const c = o.customer || {};
const now = new Date().toISOString();

const line_items = o.lineItems.nodes.map((li) => {
  // Draft Order の確定単価をそのまま採用（割引が入っていればその額、無ければ定価）。計算はしない。
  const amount =
    li.discountedUnitPriceSet?.shopMoney?.amount ?? li.originalUnitPriceSet?.shopMoney?.amount;
  return {
    title: li.title,
    quantity: li.quantity,
    wholesale_unit_price: Number(amount),
    tax_rate: 'ten_percent',
    unit: '個',
  };
});

// Track A（createInvoice.js）が読む形式（order.sample.json と同形）に合わせる。
const normalized = {
  id: o.id,
  name: o.name,
  ordered_at: o.createdAt || now, // 売上計上=注文時（決定3）
  fulfilled_at: now, // 請求確定=発送時（決定4）。デモは発送済み想定
  payment_term: c.paymentTerms?.value || 'immediate', // ③都度払い相当
  mf_partner_id: c.mfPartnerId?.value || null, // 既存取引先があれば再利用（決定8）
  customer: {
    company: c.corporateName?.value || c.displayName || '取引先（デモ）',
    person_name: c.displayName || '',
    email: resolveDeliveryEmail(c.email || o.email), // MF 請求書の着信先（デモ用ダミーは naru 受信先へ置換）
  },
  line_items,
  invoice_url: o.invoiceUrl, // 参考: Shopify Draft Order の Invoice URL
};

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(normalized, null, 2));

console.log(`✅ 最新 Draft Order ${o.name} を正規化 → ${OUT_PATH}`);
console.log(`   取引先: ${normalized.customer.company} <${normalized.customer.email}>  支払区分=${normalized.payment_term}`);
for (const li of line_items) {
  console.log(`   ・${li.title} × ${li.quantity} @¥${li.wholesale_unit_price.toLocaleString('ja-JP')}`);
}
console.log('\n→ 次: cd ../moneyforward && node --env-file=.env src/createInvoice.js ../output/last-order.json');
