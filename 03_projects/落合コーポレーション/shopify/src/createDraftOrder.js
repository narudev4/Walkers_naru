// @ts-check
/**
 * Draft Order 生成（顧客 × 商品区分の掛け率を自前適用）— 本検証の本体。
 *
 * 流れ: customer/product の b2b metafield と discount_matrix Metaobject を Admin API で取得
 *       → discountEngine でレート計算 → draftOrderCreate で各 line に価格適用。
 *
 * 価格適用は2方式を mode で切替（discount-system.md の設計どおり）:
 *   - 'priceOverride'   : variant 価格 × rate を卸単価として直接上書き（第一候補・B2B卸として自然）
 *   - 'appliedDiscount' : 各 line に「○% off」を適用（保証されたフォールバック）
 * priceOverride が variant-backed line で期待どおり効くかは Phase 2 の trial で実機検証し確定する。
 *
 * 実行例: node --env-file=.env src/createDraftOrder.js
 */
import { adminGraphQL } from './shopifyClient.js';
import { resolveRate, computeLinePricing, normalizeMatrix } from './discountEngine.js';

const CUSTOMER_Q = `query($id: ID!) {
  customer(id: $id) {
    id displayName
    customerType: metafield(namespace: "b2b", key: "customer_type") { value }
    discountGroup: metafield(namespace: "b2b", key: "discount_group") { value }
    customOverrides: metafield(namespace: "b2b", key: "custom_overrides") { value }
  }
}`;

const VARIANTS_Q = `query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id title price
      product { id title category: metafield(namespace: "b2b", key: "category") { value } }
    }
  }
}`;

// discount_matrix Metaobject の全エントリを取得（Admin API は全件取得可。Shopify Functions では不可な操作）
const MATRIX_Q = `{
  metaobjects(type: "discount_matrix", first: 250) {
    nodes { handle fields { key value } }
  }
}`;

const DRAFT_CREATE = `mutation($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder {
      id name invoiceUrl
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 50) {
        nodes {
          title quantity
          originalUnitPriceSet { shopMoney { amount } }
          discountedUnitPriceSet { shopMoney { amount } }
          appliedDiscount { value valueType title }
        }
      }
    }
    userErrors { field message }
  }
}`;

/** Metaobject の fields 配列を {group, category, discount_rate} に変換 */
function metaobjectToRow(node) {
  const f = Object.fromEntries(node.fields.map((x) => [x.key, x.value]));
  return { group: f.group, category: f.category, discountRate: f.discount_rate };
}

/**
 * @param {object} args
 * @param {string} args.customerId  gid://shopify/Customer/...
 * @param {Array<{variantId:string, quantity?:number}>} args.lines
 * @param {'priceOverride'|'appliedDiscount'} [args.mode]
 * @param {string} [args.currency]
 * @param {boolean} [args.dryRun]  true なら draftOrderCreate を呼ばず計算結果だけ返す
 * @param {boolean} [args.returnComputed]  true なら {order, computed} を返す（既定 false=order のみ・後方互換）
 */
export async function createDiscountedDraftOrder({ customerId, lines, mode = 'priceOverride', currency = 'JPY', dryRun = false, returnComputed = false }) {
  // 1) 顧客 metafields
  const { customer } = await adminGraphQL(CUSTOMER_Q, { id: customerId });
  if (!customer) throw new Error(`customer が見つかりません: ${customerId}`);
  const customerType = customer.customerType?.value;
  const discountGroup = customer.discountGroup?.value;
  let customOverrides = {};
  try {
    customOverrides = customer.customOverrides?.value ? JSON.parse(customer.customOverrides.value) : {};
  } catch {
    console.warn('custom_overrides の JSON パース失敗 → 無視');
  }

  // 2) variant + product.category + price
  const { nodes } = await adminGraphQL(VARIANTS_Q, { ids: lines.map((l) => l.variantId) });
  const variantMap = new Map((nodes || []).filter(Boolean).map((v) => [v.id, v]));

  // 3) discount_matrix（全件）
  const matrixData = await adminGraphQL(MATRIX_Q);
  const matrix = normalizeMatrix(matrixData.metaobjects.nodes.map(metaobjectToRow));

  // 4) 各 line の rate と価格を計算
  const computed = lines.map((l) => {
    const v = variantMap.get(l.variantId);
    if (!v) throw new Error(`variant が見つかりません: ${l.variantId}`);
    const category = v.product?.category?.value;
    const { rate, source } = resolveRate({ customerType, discountGroup, customOverrides, productCategory: category, matrix });
    const original = parseFloat(v.price);
    const { unitPrice, discountPercentage } = computeLinePricing({ originalPrice: original, rate, currency });
    return { variantId: l.variantId, quantity: l.quantity ?? 1, title: v.title, productTitle: v.product?.title, category, rate, source, original, unitPrice, discountPercentage };
  });

  console.log(`\n顧客: ${customer.displayName}  type=${customerType}  group=${discountGroup}  overrides=${JSON.stringify(customOverrides)}`);
  console.log(`掛け率マトリクス: ${matrix.length} 件`);
  for (const c of computed) {
    console.log(`  ${c.title}  cat=${c.category ?? '(none)'}  rate=${c.rate} [${c.source}]  ${currency} ${c.original} → ${c.unitPrice}  (-${c.discountPercentage}%)`);
  }
  if (dryRun) return { dryRun: true, computed };

  // 5) draftOrderCreate（mode で価格適用方式を切替）
  const lineItems = computed.map((c) => {
    if (mode === 'appliedDiscount') {
      const item = { variantId: c.variantId, quantity: c.quantity };
      if (c.rate < 1) {
        item.appliedDiscount = { valueType: 'PERCENTAGE', value: c.discountPercentage, title: `B2B (${c.source})` };
      }
      return item;
    }
    // priceOverride: rate<1 のときのみ卸単価を上書き
    const item = { variantId: c.variantId, quantity: c.quantity };
    if (c.rate < 1) {
      item.priceOverride = { amount: String(c.unitPrice), currencyCode: currency };
    }
    return item;
  });

  const input = {
    purchasingEntity: { customerId },
    presentmentCurrencyCode: currency,
    lineItems,
  };
  const res = await adminGraphQL(DRAFT_CREATE, { input });
  const errs = res.draftOrderCreate.userErrors;
  if (errs && errs.length) throw new Error('draftOrderCreate userErrors: ' + JSON.stringify(errs, null, 2));
  const order = res.draftOrderCreate.draftOrder;
  console.log(`\n✅ Draft Order 作成: ${order.name}  合計 ${order.totalPriceSet.shopMoney.amount} ${order.totalPriceSet.shopMoney.currencyCode}`);
  console.log(`   Invoice URL: ${order.invoiceUrl}`);
  return returnComputed ? { order, computed } : order;
}

// 直接実行時の最小サンプル（Phase 3 のシナリオは scenarios.js から呼ぶ）
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const customerId = process.env.TEST_CUSTOMER_ID;
  const variantId = process.env.TEST_VARIANT_ID;
  const mode = /** @type {any} */ (process.env.DRAFT_MODE || 'priceOverride');
  if (!customerId || !variantId) {
    console.error('TEST_CUSTOMER_ID と TEST_VARIANT_ID を環境変数で指定してください（probe で ID を確認）。');
    process.exit(1);
  }
  await createDiscountedDraftOrder({ customerId, lines: [{ variantId, quantity: 1 }], mode });
}
