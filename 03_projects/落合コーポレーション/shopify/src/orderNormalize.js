// @ts-check
/**
 * Shopify 注文(Order) → MF 請求書が食う正規化JSON への共通変換。
 * order-to-invoice.js（CLI・最新注文）と webhook/server.js（orders/create 自動発火）の両方から使う。
 * 割引計算はしない（注文の確定単価 discountedUnitPriceSet ?? originalUnitPriceSet をそのまま）。
 */
import { adminGraphQL } from './shopifyClient.js';

const DEMO_EMAIL = 'naru.hosoya+shopifydemo@walker-s.co.jp';
const DUMMY_EMAIL = /@(example\.(com|org|net)|[^@]*\.(test|invalid|example|localhost))$/i;

/** ダミーemail(example.com等)はデモ受信先に置換する。 @param {string} [raw] */
export function resolveDeliveryEmail(raw) {
  const email = (raw || '').trim();
  return !email || DUMMY_EMAIL.test(email) ? DEMO_EMAIL : email;
}

const ORDER_FIELDS = `
  id name createdAt email
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
`;

/**
 * 注文を取得して正規化する。
 * @param {string|null} [orderGid] 'gid://shopify/Order/...'。省略時は最新注文。
 */
export async function fetchNormalizedOrder(orderGid = null) {
  let o;
  if (orderGid) {
    const d = await adminGraphQL(
      `query ($id: ID!) { node(id: $id) { ... on Order { ${ORDER_FIELDS} } } }`,
      { id: orderGid }
    );
    o = d.node;
  } else {
    const d = await adminGraphQL(
      `{ orders(first: 1, reverse: true, sortKey: CREATED_AT) { nodes { ${ORDER_FIELDS} } } }`
    );
    o = (d.orders.nodes || [])[0];
  }
  if (!o || !o.id) {
    throw new Error(
      orderGid ? `注文が見つかりません: ${orderGid}` : '注文(Order)がありません。ストアで購入を完了してから再実行してください。'
    );
  }
  return normalizeOrder(o);
}

/**
 * GraphQL 応答の Order → 正規化JSON。
 * payment_term は metafield の生値（'20th' | 'eom' | 'prepaid'）または null。
 * ③都度払いかどうかの判定は呼び出し側の責務（webhook server は明示値のみ自動送信）。
 * @param {any} o
 */
export function normalizeOrder(o) {
  const c = o.customer || {};
  const now = new Date().toISOString();
  const line_items = (o.lineItems?.nodes || []).map((li) => {
    const amount = li.discountedUnitPriceSet?.shopMoney?.amount ?? li.originalUnitPriceSet?.shopMoney?.amount;
    return { title: li.title, quantity: li.quantity, wholesale_unit_price: Number(amount), tax_rate: 'ten_percent', unit: '個' };
  });
  return {
    id: o.id,
    name: o.name,
    ordered_at: o.createdAt || now,
    fulfilled_at: now,
    payment_term: c.paymentTerms?.value || null,
    mf_partner_id: c.mfPartnerId?.value || null,
    customer: {
      company: c.corporateName?.value || c.displayName || '取引先（デモ）',
      person_name: c.displayName || '',
      email: resolveDeliveryEmail(c.email || o.email),
    },
    line_items,
  };
}
