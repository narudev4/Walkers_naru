// @ts-check
/** 最新の Draft Order の Admin URL と line 価格を出力（Admin 目視確認用）。 */
import { adminGraphQL } from './shopifyClient.js';

const d = await adminGraphQL(`{
  draftOrders(first: 1, reverse: true) {
    nodes {
      id name
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 10) { nodes { title originalUnitPriceSet { shopMoney { amount } } } }
    }
  }
}`);
const o = d.draftOrders.nodes[0];
const num = o.id.split('/').pop();
console.log(`${o.name}  合計 ${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode}`);
for (const l of o.lineItems.nodes) console.log(`  ${l.title}: ¥${l.originalUnitPriceSet.shopMoney.amount}`);
console.log(`ADMIN_URL=https://admin.shopify.com/store/xn-dfum9d9e7a6a1b3d8dc3778hkjvcsh3d/draft_orders/${num}`);
