// @ts-check
/**
 * E2E テスト: B2B 受注フロー全体（Shopify 掛率計算 → Draft Order → Order → MF 請求書ペイロード）
 *
 * 実行:
 *   cd /Users/naru/Walkers_naru/03_projects/落合コーポレーション && \
 *   node --env-file=shopify/.env test/e2e-b2b-flow.js
 *
 * 前提:
 *   - shopify/.env に SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN が設定済み
 *   - ストアに b2b.category メタフィールドを持つ商品が1件以上ある
 *   - テスト顧客 CUSTOMER_ID が存在する
 */

import { createDiscountedDraftOrder } from '../shopify/src/createDraftOrder.js';
import { adminGraphQL } from '../shopify/src/shopifyClient.js';
import { normalizeOrder } from '../shopify/src/orderNormalize.js';
import { buildBillingRequest } from '../moneyforward/src/mapOrder.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CUSTOMER_ID = 'gid://shopify/Customer/9665098318125';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function assert(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

const results = [];
function recordStep(name, ok, detail = '') {
  results.push({ name, ok, detail });
}

// ---------------------------------------------------------------------------
// Step 0 — Variant 探索: b2b.category メタフィールドを持つ商品を1件選ぶ
// ---------------------------------------------------------------------------
let variantId;
let variantTitle;
try {
  console.log('\n--- Step 0: b2b.category 付き Variant を探索 ---');
  const data = await adminGraphQL(`{
    productVariants(first: 10) {
      nodes {
        id title price
        product {
          title
          category: metafield(namespace: "b2b", key: "category") { value }
        }
      }
    }
  }`);
  const variants = data.productVariants.nodes || [];
  const match = variants.find((v) => v.product?.category?.value);
  if (!match) {
    // b2b.category が無い場合は先頭 variant をフォールバック
    const fallback = variants[0];
    assert(fallback, 'ストアに ProductVariant が1件もありません');
    console.log(`  b2b.category 付き variant なし → 先頭 variant をフォールバック使用: ${fallback.title}`);
    variantId = fallback.id;
    variantTitle = fallback.title;
  } else {
    console.log(`  選択: ${match.product.title} / ${match.title}  category=${match.product.category.value}  price=${match.price}`);
    variantId = match.id;
    variantTitle = match.title;
  }
  recordStep('Step 0: Variant 探索', true, variantTitle);
} catch (err) {
  recordStep('Step 0: Variant 探索', false, err.message);
  console.error('Step 0 失敗:', err.message);
  printSummary();
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 1 — Dry Run: 掛率計算のみ（Draft Order は作らない）
// ---------------------------------------------------------------------------
let dryResult;
try {
  console.log('\n--- Step 1: Dry Run（掛率計算） ---');
  dryResult = await createDiscountedDraftOrder({
    customerId: CUSTOMER_ID,
    lines: [{ variantId, quantity: 2 }],
    dryRun: true,
  });

  assert(dryResult.dryRun === true, 'dryRun フラグが true であること');
  assert(Array.isArray(dryResult.computed), 'computed が配列であること');
  assert(dryResult.computed.length > 0, 'computed が空でないこと');

  const c = dryResult.computed[0];
  assert(typeof c.rate === 'number', 'rate が数値であること');
  assert(typeof c.unitPrice === 'number', 'unitPrice が数値であること');
  assert(c.rate > 0 && c.rate <= 1, `rate が 0 < rate <= 1 の範囲であること (実際: ${c.rate})`);
  assert(c.unitPrice > 0, `unitPrice が正の値であること (実際: ${c.unitPrice})`);

  console.log(`  rate=${c.rate}  unitPrice=${c.unitPrice}  discount=${c.discountPercentage}%  source=${c.source}`);
  recordStep('Step 1: Dry Run', true, `rate=${c.rate} unitPrice=${c.unitPrice}`);
} catch (err) {
  recordStep('Step 1: Dry Run', false, err.message);
  console.error('Step 1 失敗:', err.message);
}

// ---------------------------------------------------------------------------
// Step 2 — Draft Order 作成（実際に作成）
// ---------------------------------------------------------------------------
let draft;
try {
  console.log('\n--- Step 2: Draft Order 作成 ---');
  draft = await createDiscountedDraftOrder({
    customerId: CUSTOMER_ID,
    lines: [{ variantId, quantity: 1 }],
    returnComputed: true,
  });

  // returnComputed=true の場合は { order, computed }
  const order = draft.order || draft;
  assert(order.id, 'Draft Order に id があること');
  assert(order.name, 'Draft Order に name があること');
  assert(order.totalPriceSet?.shopMoney?.amount, 'totalPriceSet が存在すること');

  console.log(`  Draft Order: ${order.name}  合計: ${order.totalPriceSet.shopMoney.amount} ${order.totalPriceSet.shopMoney.currencyCode}`);
  draft = order; // 以降は order 本体を使う
  recordStep('Step 2: Draft Order 作成', true, draft.name);
} catch (err) {
  recordStep('Step 2: Draft Order 作成', false, err.message);
  console.error('Step 2 失敗:', err.message);
}

// ---------------------------------------------------------------------------
// Step 3 — Draft Order → Order（draftOrderComplete）
// ---------------------------------------------------------------------------
let completedOrder;
try {
  assert(draft?.id, 'Step 2 で Draft Order が作成されていること');
  console.log('\n--- Step 3: draftOrderComplete（Order 確定） ---');

  const COMPLETE_MUTATION = `mutation($id: ID!) {
    draftOrderComplete(id: $id, paymentPending: true) {
      draftOrder {
        order {
          id name displayFinancialStatus
        }
      }
      userErrors { field message }
    }
  }`;

  const res = await adminGraphQL(COMPLETE_MUTATION, { id: draft.id });
  const errs = res.draftOrderComplete.userErrors;
  if (errs && errs.length) {
    throw new Error('draftOrderComplete userErrors: ' + JSON.stringify(errs, null, 2));
  }

  completedOrder = res.draftOrderComplete.draftOrder.order;
  assert(completedOrder, 'draftOrderComplete が Order を返すこと');
  assert(completedOrder.id, 'Order に id があること');
  assert(completedOrder.name, 'Order に name があること');
  assert(completedOrder.displayFinancialStatus === 'PENDING', `financialStatus が PENDING であること (実際: ${completedOrder.displayFinancialStatus})`);

  console.log(`  Order: ${completedOrder.name}  status=${completedOrder.displayFinancialStatus}`);
  recordStep('Step 3: draftOrderComplete', true, `${completedOrder.name} (${completedOrder.displayFinancialStatus})`);
} catch (err) {
  recordStep('Step 3: draftOrderComplete', false, err.message);
  console.error('Step 3 失敗:', err.message);
}

// ---------------------------------------------------------------------------
// Step 4 — Order 正規化（normalizeOrder）
// ---------------------------------------------------------------------------
let normalized;
try {
  assert(completedOrder?.id, 'Step 3 で Order が作成されていること');
  console.log('\n--- Step 4: Order 正規化 ---');

  // ORDER_FIELDS と同じクエリで Order を取得
  const ORDER_QUERY = `query($id: ID!) {
    node(id: $id) {
      ... on Order {
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
      }
    }
  }`;

  const data = await adminGraphQL(ORDER_QUERY, { id: completedOrder.id });
  assert(data.node, 'Order ノードが取得できること');

  normalized = normalizeOrder(data.node);
  assert(normalized.id, 'normalized.id が存在すること');
  assert(normalized.name, 'normalized.name が存在すること');
  assert(Array.isArray(normalized.line_items), 'line_items が配列であること');
  assert(normalized.line_items.length > 0, 'line_items が空でないこと');
  assert(normalized.customer, 'customer が存在すること');
  assert(normalized.customer.company, 'customer.company が存在すること');
  assert(normalized.customer.email, 'customer.email が存在すること');

  const li = normalized.line_items[0];
  assert(typeof li.wholesale_unit_price === 'number', 'wholesale_unit_price が数値であること');
  assert(li.wholesale_unit_price > 0, 'wholesale_unit_price が正の値であること');

  console.log(`  取引先: ${normalized.customer.company}  payment_term=${normalized.payment_term}`);
  console.log(`  line_items: ${normalized.line_items.length} 件`);
  for (const item of normalized.line_items) {
    console.log(`    ${item.title} x${item.quantity} @${item.wholesale_unit_price}`);
  }
  recordStep('Step 4: Order 正規化', true, `${normalized.line_items.length} line items`);
} catch (err) {
  recordStep('Step 4: Order 正規化', false, err.message);
  console.error('Step 4 失敗:', err.message);
}

// ---------------------------------------------------------------------------
// Step 5 — MF 請求書ペイロード構築（API 呼び出しなし）
// ---------------------------------------------------------------------------
let mfPayload;
try {
  assert(normalized, 'Step 4 で正規化済み Order があること');
  console.log('\n--- Step 5: MF 請求書ペイロード構築 ---');

  mfPayload = buildBillingRequest(normalized, 'test-dept-id');

  assert(mfPayload.department_id === 'test-dept-id', 'department_id が設定されていること');
  assert(mfPayload.title, 'title が存在すること');
  assert(mfPayload.billing_date, 'billing_date が存在すること');
  assert(mfPayload.due_date, 'due_date が存在すること');
  assert(Array.isArray(mfPayload.items), 'items が配列であること');
  assert(mfPayload.items.length > 0, 'items が空でないこと');

  const item = mfPayload.items[0];
  assert(item.name, 'items[0].name が存在すること');
  assert(typeof item.price === 'number', 'items[0].price が数値であること');
  assert(typeof item.quantity === 'number', 'items[0].quantity が数値であること');
  assert(item.excise, 'items[0].excise が存在すること');

  // billing_date < due_date の順序チェック
  assert(mfPayload.billing_date <= mfPayload.due_date, `due_date(${mfPayload.due_date}) が billing_date(${mfPayload.billing_date}) 以降であること`);

  console.log(`  title: ${mfPayload.title}`);
  console.log(`  billing_date: ${mfPayload.billing_date}  due_date: ${mfPayload.due_date}  sales_date: ${mfPayload.sales_date}`);
  console.log(`  items: ${mfPayload.items.length} 件`);
  for (const it of mfPayload.items) {
    console.log(`    ${it.name}  price=${it.price}  qty=${it.quantity}  excise=${it.excise}`);
  }
  recordStep('Step 5: MF ペイロード構築', true, `${mfPayload.items.length} items`);
} catch (err) {
  recordStep('Step 5: MF ペイロード構築', false, err.message);
  console.error('Step 5 失敗:', err.message);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
function printSummary() {
  console.log('\n========================================');
  console.log('  E2E B2B Flow Summary');
  console.log('========================================');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  for (const r of results) {
    const mark = r.ok ? '✅' : '❌';
    const detail = r.detail ? ` — ${r.detail}` : '';
    console.log(`  ${mark} ${r.name}${detail}`);
  }
  console.log('----------------------------------------');
  console.log(`  Passed: ${passed}  Failed: ${failed}  Total: ${results.length}`);
  if (failed > 0) {
    console.log('  RESULT: FAIL');
  } else {
    console.log('  RESULT: ALL PASS');
  }
  console.log('========================================\n');
}

printSummary();

if (results.some((r) => !r.ok)) {
  process.exit(1);
}
