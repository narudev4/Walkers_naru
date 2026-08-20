// @ts-check
/**
 * 締めバッチのデモデータ投入（かけ払い①20th の法人顧客＋発送済み注文2件を作る）。
 *   1. デモ顧客B（株式会社サンプルスポーツ / payment_terms=20th）を確保
 *   2. Draft Order を2件作成 → 完了（支払い保留=Manual Payment 相当）→ 実注文化
 *   3. 各注文をフルフィルメント（発送日=今日 → 20日締め期間に入る）
 * 実行: node --env-file=.env src/demo-settle-data.js
 */
import { adminGraphQL } from './shopifyClient.js';

const EMAIL = 'naru.hosoya+shopifydemo-b@walker-s.co.jp';
const COMPANY = '株式会社サンプルスポーツ';

// 1) 顧客確保（既存再利用 or 作成）＋ metafield
let cust;
{
  const r = await adminGraphQL(
    `mutation ($input: CustomerInput!) { customerCreate(input: $input) { customer { id email } userErrors { field message } } }`,
    { input: { firstName: 'デモ', lastName: '法人B', email: EMAIL } }
  );
  cust = r.customerCreate.customer;
  if (!cust) {
    const s = await adminGraphQL(`query ($q: String!) { customers(first: 1, query: $q) { nodes { id email } } }`, { q: `email:${EMAIL}` });
    cust = s.customers.nodes[0];
    if (cust) console.log('既存顧客Bを再利用:', cust.id);
  }
  if (!cust) throw new Error('顧客Bの作成/取得に失敗');
  const m = await adminGraphQL(
    `mutation ($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`,
    {
      m: [
        { ownerId: cust.id, namespace: 'b2b', key: 'customer_type', type: 'single_line_text_field', value: 'corporate' },
        { ownerId: cust.id, namespace: 'b2b', key: 'corporate_name', type: 'single_line_text_field', value: COMPANY },
        { ownerId: cust.id, namespace: 'b2b', key: 'payment_terms', type: 'single_line_text_field', value: '20th' },
      ],
    }
  );
  if (m.metafieldsSet.userErrors?.length) throw new Error('metafield: ' + JSON.stringify(m.metafieldsSet.userErrors));
  console.log(`✅ 顧客B: ${COMPANY} <${EMAIL}> payment_terms=20th`);
}

// 2) 商品バリアントを取得（先頭3商品）
const pd = await adminGraphQL(`{
  products(first: 3, sortKey: TITLE) {
    nodes { title variants(first: 1) { nodes { id price } } }
  }
}`);
const variants = pd.products.nodes
  .map((p) => ({ title: p.title, id: p.variants.nodes[0]?.id, price: p.variants.nodes[0]?.price }))
  .filter((v) => v.id);
if (variants.length < 2) throw new Error('商品が足りません');
console.log('商品:', variants.map((v) => `${v.title} ¥${v.price}`).join(' / '));

// 3) 注文を2件作成（Draft → 完了(支払い保留) → 発送）
/** @param {{variantId: string, quantity: number}[]} items */
async function createShippedOrder(items) {
  const dr = await adminGraphQL(
    `mutation ($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id name } userErrors { field message } } }`,
    { input: { purchasingEntity: { customerId: cust.id }, lineItems: items } }
  );
  if (dr.draftOrderCreate.userErrors?.length) throw new Error('draftOrderCreate: ' + JSON.stringify(dr.draftOrderCreate.userErrors));
  const draftId = dr.draftOrderCreate.draftOrder.id;

  const cp = await adminGraphQL(
    `mutation ($id: ID!) { draftOrderComplete(id: $id, paymentPending: true) { draftOrder { order { id name } } userErrors { field message } } }`,
    { id: draftId }
  );
  if (cp.draftOrderComplete.userErrors?.length) throw new Error('draftOrderComplete: ' + JSON.stringify(cp.draftOrderComplete.userErrors));
  const order = cp.draftOrderComplete.draftOrder.order;

  const fo = await adminGraphQL(
    `query ($id: ID!) { order: node(id: $id) { ... on Order { fulfillmentOrders(first: 5) { nodes { id status } } } } }`,
    { id: order.id }
  );
  const fulfillmentOrders = fo.order.fulfillmentOrders.nodes.filter((n) => n.status === 'OPEN' || n.status === 'IN_PROGRESS');
  if (!fulfillmentOrders.length) throw new Error(`${order.name}: OPEN な fulfillmentOrder がありません`);
  const ff = await adminGraphQL(
    `mutation ($f: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $f) { fulfillment { id status createdAt } userErrors { field message } }
    }`,
    { f: { lineItemsByFulfillmentOrder: fulfillmentOrders.map((n) => ({ fulfillmentOrderId: n.id })) } }
  );
  if (ff.fulfillmentCreate.userErrors?.length) throw new Error('fulfillmentCreate: ' + JSON.stringify(ff.fulfillmentCreate.userErrors));
  console.log(`✅ ${order.name} 作成＋発送（fulfillment ${ff.fulfillmentCreate.fulfillment.status}）`);
  return order.name;
}

const o1 = await createShippedOrder([{ variantId: variants[0].id, quantity: 2 }]);
const o2 = await createShippedOrder([
  { variantId: variants[1].id, quantity: 1 },
  { variantId: variants[2]?.id || variants[0].id, quantity: 3 },
]);
console.log(`\n→ かけ払い(20th)の発送済み注文 ${o1}, ${o2} を投入しました。次: cd ../webhook && npm run settle -- --term 20th --closing 2026-06-20`);
