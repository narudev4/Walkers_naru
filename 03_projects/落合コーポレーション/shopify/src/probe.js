// @ts-check
/**
 * 疎通確認スクリプト。
 *   実行: cd shopify && node --env-file=.env src/probe.js
 * 確認できること:
 *   - Admin API トークンの疎通（認証 OK か）
 *   - ストアのプラン（Basic / trial / dev か）と通貨
 *   - 登録済み商品と variant（draftOrderCreate に使う variantId）
 *   - 各商品の b2b.category metafield の現状
 */
import { adminGraphQL, apiContext } from './shopifyClient.js';

const QUERY = `{
  shop {
    name
    myshopifyDomain
    currencyCode
    plan { displayName partnerDevelopment shopifyPlus }
  }
  products(first: 20) {
    nodes {
      id
      title
      status
      category: metafield(namespace: "b2b", key: "category") { value }
      variants(first: 5) { nodes { id title price } }
    }
  }
}`;

console.log(`接続先: ${apiContext.DOMAIN} (API ${apiContext.VERSION})  token=${apiContext.hasToken ? 'set' : 'MISSING'}`);

const data = await adminGraphQL(QUERY);

console.log('\n=== Shop ===');
console.log(`  name:        ${data.shop.name}`);
console.log(`  domain:      ${data.shop.myshopifyDomain}`);
console.log(`  currency:    ${data.shop.currencyCode}`);
console.log(`  plan:        ${data.shop.plan.displayName}  (partnerDev=${data.shop.plan.partnerDevelopment}, plus=${data.shop.plan.shopifyPlus})`);

console.log('\n=== Products ===');
for (const p of data.products.nodes) {
  console.log(`- ${p.title}  [${p.status}]  category=${p.category?.value ?? '(未設定)'}`);
  console.log(`    id: ${p.id}`);
  for (const v of p.variants.nodes) {
    console.log(`    variant: ${v.id}  "${v.title}"  ${data.shop.currencyCode} ${v.price}`);
  }
}
console.log('\n疎通 OK。');
