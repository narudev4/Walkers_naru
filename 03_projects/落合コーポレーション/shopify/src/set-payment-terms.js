// @ts-check
/**
 * 顧客の支払区分（b2b.payment_terms）を切り替える運用ツール。
 *   node --env-file=.env src/set-payment-terms.js <顧客email> <20th|eom|prepaid>
 * 例: ③都度払いテスト用にデモ顧客を prepaid へ →
 *     node --env-file=.env src/set-payment-terms.js naru.hosoya+shopifydemo@walker-s.co.jp prepaid
 */
import { adminGraphQL } from './shopifyClient.js';

const [email, value] = process.argv.slice(2);
const ALLOWED = ['20th', 'eom', 'prepaid'];
if (!email || !ALLOWED.includes(value)) {
  console.error(`使い方: node --env-file=.env src/set-payment-terms.js <顧客email> <${ALLOWED.join('|')}>`);
  process.exit(1);
}

const s = await adminGraphQL(
  `query ($q: String!) { customers(first: 1, query: $q) { nodes { id email displayName } } }`,
  { q: `email:${email}` }
);
const cust = s.customers.nodes[0];
if (!cust) throw new Error(`顧客が見つかりません: ${email}`);

const r = await adminGraphQL(
  `mutation ($m: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $m) { metafields { key value } userErrors { field message } }
  }`,
  {
    m: [{ ownerId: cust.id, namespace: 'b2b', key: 'payment_terms', type: 'single_line_text_field', value }],
  }
);
const errs = r.metafieldsSet.userErrors;
if (errs && errs.length) throw new Error('userErrors: ' + JSON.stringify(errs));
console.log(`✅ ${cust.displayName} <${cust.email}> の payment_terms を「${value}」に変更しました。`);
console.log(`   （戻す例: node --env-file=.env src/set-payment-terms.js ${email} 20th）`);
