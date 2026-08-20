// @ts-check
/**
 * §6 テストシナリオ + §7 混在カート を実機 Draft Order で検証。
 *   実行: node --env-file=.env src/scenarios.js
 * 各シナリオで Draft Order を生成し、line の単価が期待卸価格と一致するか照合。
 */
import { createDiscountedDraftOrder } from './createDraftOrder.js';

const C = {
  corpA: 'gid://shopify/Customer/9665098318125',
  corpB: 'gid://shopify/Customer/9665098383661',
  corpCustom: 'gid://shopify/Customer/9665098481965',
  individual: 'gid://shopify/Customer/9665098580269',
};
const V = {
  racket: 'gid://shopify/ProductVariant/51910940197165', // ¥12,800 (racket)
  wear: 'gid://shopify/ProductVariant/51910943670573', //   ¥4,500 (wear)
  shuttle: 'gid://shopify/ProductVariant/51910934757677', // ¥7,700 (ball: matrix未定義→正価)
};

const results = [];
const t0 = performance.now();

function unitPrice(order, titleIncludes) {
  const n = order.lineItems.nodes.find((x) => x.title.includes(titleIncludes));
  return n ? Number(n.originalUnitPriceSet.shopMoney.amount) : null;
}

async function run(name, customerId, lines, checks) {
  console.log(`\n===== ${name} =====`);
  const order = await createDiscountedDraftOrder({ customerId, lines, mode: 'priceOverride', currency: 'JPY' });
  let pass = true;
  for (const ch of checks) {
    const actual = unitPrice(order, ch.t);
    const ok = actual === ch.expect;
    if (!ok) pass = false;
    console.log(`   ${ok ? '✅' : '❌'} ${ch.t}: 期待 ¥${ch.expect} / 実際 ¥${actual}`);
  }
  results.push({ name, pass, order: order.name });
}

await run('§6-1 corp-a × ラケット (A/racket=0.60)', C.corpA, [{ variantId: V.racket }], [{ t: 'ラケット', expect: 7680 }]);
await run('§6-2 corp-a × ウェア (A/wear=0.70)', C.corpA, [{ variantId: V.wear }], [{ t: 'シャツ', expect: 3150 }]);
await run('§6-3 corp-b × ラケット (B/racket=0.70)', C.corpB, [{ variantId: V.racket }], [{ t: 'ラケット', expect: 8960 }]);
await run('§6-4 corp-custom × ラケット (override 0.50)', C.corpCustom, [{ variantId: V.racket }], [{ t: 'ラケット', expect: 6400 }]);
await run('§6-5 individual × ラケット (割引なし)', C.individual, [{ variantId: V.racket }], [{ t: 'ラケット', expect: 12800 }]);
await run('§7 混在カート corp-a × 3商品 (個別レート)', C.corpA, [{ variantId: V.racket }, { variantId: V.wear }, { variantId: V.shuttle }], [
  { t: 'ラケット', expect: 7680 }, // A/racket=0.60
  { t: 'シャツ', expect: 3150 }, //   A/wear=0.70
  { t: 'シャトル', expect: 7700 }, // ball は matrix未定義 → rate 1.0 → 正価
]);

console.log('\n===== サマリ =====');
let allPass = true;
for (const r of results) {
  if (!r.pass) allPass = false;
  console.log(`  ${r.pass ? '✅ PASS' : '❌ FAIL'}  ${r.name}  → ${r.order}`);
}
const secs = (performance.now() - t0) / 1000;
console.log(`\n総合: ${allPass ? '✅ 全シナリオ PASS' : '❌ FAIL あり'}`);
console.log(`所要: ${secs.toFixed(1)}秒 / ${results.length}件（約 ${(secs / results.length).toFixed(2)}秒/件、各件4 Admin APIリクエスト）`);
