// @ts-check
/** デモ用ログイン法人顧客を作成＋group A 付与＋パスワード設定URL発行。
 *  実行: node --env-file=.env src/demo-customer.js */
import { adminGraphQL } from './shopifyClient.js';

const EMAIL = 'naru.hosoya+shopifydemo@walker-s.co.jp';

// 1) 作成（既存ならそれを使う）
const CREATE = `mutation($input: CustomerInput!) {
  customerCreate(input: $input) { customer { id email } userErrors { field message } }
}`;
let r = await adminGraphQL(CREATE, { input: { firstName: 'デモ', lastName: '法人A', email: EMAIL } });
let cust = r.customerCreate.customer;
if (!cust) {
  const Q = `query($q: String!) { customers(first: 1, query: $q) { nodes { id email } } }`;
  const s = await adminGraphQL(Q, { q: `email:${EMAIL}` });
  cust = s.customers.nodes[0];
  if (cust) console.log('既存顧客を再利用:', cust.id);
}
if (!cust) throw new Error('顧客作成/取得失敗: ' + JSON.stringify(r.customerCreate.userErrors));
const id = cust.id;

// 2) B2B metafield（group A・取引先・支払区分）
const SET = `mutation($m: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $m) { metafields { key value } userErrors { field message } }
}`;
const meta = [
  { ownerId: id, namespace: 'b2b', key: 'customer_type', type: 'single_line_text_field', value: 'corporate' },
  { ownerId: id, namespace: 'b2b', key: 'discount_group', type: 'single_line_text_field', value: 'A' },
  { ownerId: id, namespace: 'b2b', key: 'corporate_name', type: 'single_line_text_field', value: '株式会社サンプル商会' },
  { ownerId: id, namespace: 'b2b', key: 'payment_terms', type: 'single_line_text_field', value: '20th' },
];
const sr = await adminGraphQL(SET, { m: meta });
const se = sr.metafieldsSet.userErrors;
if (se && se.length) console.log('metafield 警告:', JSON.stringify(se));
else console.log('✅ B2B metafield 付与 (corporate / group A / 20th)');

// 3) パスワード設定URL（クラシック顧客アカウント向け）
const ACT = `mutation($id: ID!) {
  customerGenerateAccountActivationUrl(customerId: $id) { accountActivationUrl userErrors { field message } }
}`;
try {
  const a = await adminGraphQL(ACT, { id });
  const e = a.customerGenerateAccountActivationUrl.userErrors;
  if (e && e.length) {
    console.log('ℹ️ パスワード設定URL不可:', JSON.stringify(e.map((x) => x.message)));
    console.log('   → 新顧客アカウント方式の可能性。ストアのログイン画面で', EMAIL, 'を入力しメールOTPでログインしてください。');
  } else {
    console.log('\n🔑 このURLを開いてパスワード設定 → ログインできます:');
    console.log('  ', a.customerGenerateAccountActivationUrl.accountActivationUrl);
  }
} catch (err) {
  console.log('ℹ️ activation URL 取得不可:', err.message, '→ メールOTPログインを試してください');
}
console.log('\n顧客ID:', id, ' email:', EMAIL);
