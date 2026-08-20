// @ts-check
/**
 * priceOverride 実機検証（load-bearing 前提のチェック）。
 *   実行: node --env-file=.env src/trial.js
 * 確認: variant-backed line に priceOverride を渡すと単価が上書きされるか（税・通貨 JPY 込み）。
 *   - originalUnitPrice が override 値（7680）になれば priceOverride 方式が成立。
 *   - 12800 のままなら priceOverride 無効 → appliedDiscount 方式に切替（createDraftOrder の mode）。
 * 作成した draft order は検証証跡として残す（削除はしない）。
 */
import { adminGraphQL } from './shopifyClient.js';

const VARIANT = 'gid://shopify/ProductVariant/51910940197165'; // ラケット KR-450 ¥12,800
const OVERRIDE = '7680'; // 12800 * 0.60（グループA×racket 想定の卸価格）

const M = `mutation($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder {
      id name invoiceUrl
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 5) {
        nodes {
          title quantity
          originalUnitPriceSet { shopMoney { amount } }
          discountedUnitPriceSet { shopMoney { amount } }
        }
      }
    }
    userErrors { field message }
  }
}`;

const input = {
  presentmentCurrencyCode: 'JPY',
  lineItems: [{ variantId: VARIANT, quantity: 1, priceOverride: { amount: OVERRIDE, currencyCode: 'JPY' } }],
};

console.log(`trial: ラケット ¥12,800 に priceOverride ¥${OVERRIDE} を適用して draftOrderCreate...`);
const data = await adminGraphQL(M, { input });
const errs = data.draftOrderCreate.userErrors;
if (errs && errs.length) {
  console.error('userErrors:', JSON.stringify(errs, null, 2));
  process.exit(1);
}
const o = data.draftOrderCreate.draftOrder;
const line = o.lineItems.nodes[0];
console.log(`\nDraft: ${o.name} (${o.id})`);
console.log(`  line: ${line.title} x${line.quantity}`);
console.log(`  originalUnitPrice:   ${line.originalUnitPriceSet.shopMoney.amount}`);
console.log(`  discountedUnitPrice: ${line.discountedUnitPriceSet.shopMoney.amount}`);
console.log(`  total: ${o.totalPriceSet.shopMoney.amount} ${o.totalPriceSet.shopMoney.currencyCode}`);

const ok = Number(line.originalUnitPriceSet.shopMoney.amount) === Number(OVERRIDE);
console.log(`\n判定: priceOverride は ${ok ? '✅ 有効（originalUnitPrice が上書きされた）' : '❌ 無効（元価格のまま）→ appliedDiscount 方式へ'}`);
