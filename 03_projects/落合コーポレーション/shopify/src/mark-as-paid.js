// @ts-check
/**
 * Order を「支払い済み」にマークする。
 * ⚠ 要スコープ: write_orders + mark_orders_as_paid 権限
 *
 * 実行: node --env-file=.env src/mark-as-paid.js <orderId>
 *   例: node --env-file=.env src/mark-as-paid.js gid://shopify/Order/6958961819949
 */
import { adminGraphQL } from './shopifyClient.js';

const orderId = process.argv[2];
if (!orderId) {
  console.error('Usage: node --env-file=.env src/mark-as-paid.js <orderId>');
  process.exit(1);
}

const MUTATION = `
  mutation markPaid($input: OrderMarkAsPaidInput!) {
    orderMarkAsPaid(input: $input) {
      order {
        id name displayFinancialStatus
        netPaymentSet { shopMoney { amount currencyCode } }
        totalOutstandingSet { shopMoney { amount } }
      }
      userErrors { field message }
    }
  }
`;

const data = await adminGraphQL(MUTATION, { input: { id: orderId } });
const result = data.orderMarkAsPaid;

if (result.userErrors?.length) {
  console.error('❌ userErrors:', JSON.stringify(result.userErrors, null, 2));
  process.exit(1);
}

const o = result.order;
console.log(`✅ ${o.name} → ${o.displayFinancialStatus}`);
console.log(`   入金: ¥${o.netPaymentSet.shopMoney.amount}  残高: ¥${o.totalOutstandingSet.shopMoney.amount}`);
