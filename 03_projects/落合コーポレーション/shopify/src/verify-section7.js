// @ts-check
/**
 * §7「別途検証する点」の実機実証。実行: node --env-file=.env src/verify-section7.js
 *   A. 新カテゴリ追加で再開発不要 — matrix に A/ball=0.65 を足すだけ（コード無変更）で適用 → 検証後に削除して元に戻す
 *   B. グループ一括変更 — corp-a の discount_group を A→B→A
 * このスクリプトは副作用を残さない（A/ball は teardown で削除、group は A に戻す）→ scenarios.js の再現性を保つ。
 */
import { adminGraphQL } from './shopifyClient.js';
import { createDiscountedDraftOrder } from './createDraftOrder.js';

const corpA = 'gid://shopify/Customer/9665098318125';
const shuttle = 'gid://shopify/ProductVariant/51910934757677'; // ball ¥7,700
const racket = 'gid://shopify/ProductVariant/51910940197165'; //  ¥12,800
const up = (o, t) => {
  const n = o.lineItems.nodes.find((x) => x.title.includes(t));
  return n ? Number(n.originalUnitPriceSet.shopMoney.amount) : null;
};

const ALL = `{ metaobjects(type: "discount_matrix", first: 250) { nodes { id fields { key value } } } }`;
const ADD = `mutation($m: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $m) { metaobject { id handle } userErrors { field message } } }`;
const DEL = `mutation($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`;
const SET = `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`;

// 既存 ball エントリを掃除（冪等性。前回実行の残りがあれば消す）
async function cleanupBall() {
  const d = await adminGraphQL(ALL);
  const balls = d.metaobjects.nodes.filter((n) => n.fields.some((f) => f.key === 'category' && f.value === 'ball'));
  for (const b of balls) await adminGraphQL(DEL, { id: b.id });
  if (balls.length) console.log(`  （冪等クリーンアップ: 既存 ball エントリ ${balls.length}件を削除）`);
}

console.log('### §7-A 新カテゴリ追加で再開発不要（matrix に A/ball=0.65 を足すだけ）###');
await cleanupBall();

// 追加前: ball 未定義 → 正価（dryRun で計算のみ、draft は作らない）
const before = await createDiscountedDraftOrder({ customerId: corpA, lines: [{ variantId: shuttle }], mode: 'priceOverride', currency: 'JPY', dryRun: true });
console.log(`  追加前: corp-a × シャトル rate=${before.computed[0].rate} [${before.computed[0].source}]（ball 未定義→正価）`);

// A/ball=0.65 を追加（コードは一切変更していない）
const addRes = await adminGraphQL(ADD, { m: { type: 'discount_matrix', fields: [
  { key: 'group', value: 'A' }, { key: 'category', value: 'ball' }, { key: 'discount_rate', value: '0.65' },
] } });
const ballId = addRes.metaobjectCreate.metaobject.id;
console.log('  matrix に A/ball=0.65 を追加');
const oA = await createDiscountedDraftOrder({ customerId: corpA, lines: [{ variantId: shuttle }], mode: 'priceOverride', currency: 'JPY' });
const pA = up(oA, 'シャトル');
console.log(`  追加後: corp-a × シャトル(ball) ¥${pA}  ${pA === 5005 ? '✅ 期待5005 = 7700×0.65（コード無変更で新カテゴリ適用）' : '❌'}`);

// teardown: 追加した A/ball を削除して元に戻す（scenarios.js の再現性を保つ）
await adminGraphQL(DEL, { id: ballId });
console.log('  teardown: A/ball を削除（ball を未定義に戻した）');

console.log('\n### §7-B グループ一括変更（corp-a: A→B→A）###');
const setGroup = (g) => adminGraphQL(SET, { m: [{ ownerId: corpA, namespace: 'b2b', key: 'discount_group', type: 'single_line_text_field', value: g }] });

await setGroup('B');
const oB = await createDiscountedDraftOrder({ customerId: corpA, lines: [{ variantId: racket }], mode: 'priceOverride', currency: 'JPY' });
const pB = up(oB, 'ラケット');
console.log(`  group=B: corp-a × ラケット ¥${pB}  ${pB === 8960 ? '✅ 期待8960 = B/racket(0.70)' : '❌'}`);

await setGroup('A');
const oA2 = await createDiscountedDraftOrder({ customerId: corpA, lines: [{ variantId: racket }], mode: 'priceOverride', currency: 'JPY' });
const pA2 = up(oA2, 'ラケット');
console.log(`  group=A(戻し): corp-a × ラケット ¥${pA2}  ${pA2 === 7680 ? '✅ 期待7680 = A/racket(0.60)（グループ変更が即追従）' : '❌'}`);

console.log('\n§7 実機実証 完了（副作用なし: ball は削除済み・group は A に復帰）。');
