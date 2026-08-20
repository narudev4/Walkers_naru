// @ts-check
/**
 * Vercel Serverless Function: B2B Draft Order 作成
 *
 * フロー:
 *   1. Shopify テーマのカートページからカート内容 + 顧客ID を受信
 *   2. Admin API で顧客メタフィールド（掛率グループ等）を取得
 *   3. 商品の B2B カテゴリ → ディスカウントマトリクス参照 → 掛率決定
 *   4. draftOrderCreate で卸価格適用の Draft Order を作成
 *   5. invoice URL を返却 → 顧客がリダイレクトされて決済
 *
 * 環境変数:
 *   SHOPIFY_STORE_DOMAIN    … ストアドメイン（*.myshopify.com）
 *   SHOPIFY_ADMIN_TOKEN     … Admin API アクセストークン
 *   SHOPIFY_API_VERSION     … API バージョン（省略時 2025-10）
 */
import { adminGraphQL } from '../lib/shopifyClient.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** @param {any} data @param {number} [status] */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function GET() {
  return json({ ok: true, endpoint: 'create-draft-order' });
}

// ── GraphQL ──

const CUSTOMER_QUERY = `query ($id: ID!) {
  customer(id: $id) {
    id
    email
    firstName
    lastName
    metafields(first: 20) {
      edges { node { namespace key value } }
    }
  }
}`;

const VARIANTS_QUERY = `query ($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      title
      price
      product {
        id
        title
        metafields(first: 10) {
          edges { node { namespace key value } }
        }
      }
    }
  }
}`;

const DISCOUNT_MATRIX_QUERY = `query {
  metaobjects(type: "discount_matrix", first: 100) {
    edges {
      node {
        fields { key value }
      }
    }
  }
}`;

const DRAFT_ORDER_CREATE = `mutation draftOrderCreate($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder {
      id
      name
      invoiceUrl
      totalPriceSet {
        shopMoney { amount currencyCode }
      }
      lineItems(first: 50) {
        edges {
          node {
            title
            quantity
            originalUnitPriceSet { shopMoney { amount } }
          }
        }
      }
    }
    userErrors { field message }
  }
}`;

// ── ヘルパー ──

/**
 * メタフィールド edges → { "namespace.key": value } フラットマップ
 * @param {Array<{node: {namespace: string, key: string, value: string}}>} edges
 */
function flattenMetafields(edges) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const { node } of edges) {
    map[`${node.namespace}.${node.key}`] = node.value;
  }
  return map;
}

/**
 * メタフィールド edges から特定の namespace.key の値を取得
 * @param {Array<{node: {namespace: string, key: string, value: string}}>} edges
 * @param {string} ns
 * @param {string} key
 */
function getMetafield(edges, ns, key) {
  for (const { node } of edges) {
    if (node.namespace === ns && node.key === key) return node.value;
  }
  return null;
}

/**
 * ディスカウントマトリクスからレートを検索
 * @param {Array<{node: {fields: Array<{key: string, value: string}>}}>} matrixEdges
 * @param {string} group
 * @param {string} category
 * @returns {number}
 */
function findRate(matrixEdges, group, category) {
  for (const { node } of matrixEdges) {
    /** @type {Record<string, string>} */
    const fields = {};
    for (const f of node.fields) fields[f.key] = f.value;
    if (fields.group === group && fields.category === category) {
      return parseFloat(fields.discount_rate) || 1.0;
    }
  }
  return 1.0;
}

// ── メインハンドラ ──

/**
 * POST /api/create-draft-order
 * Body: { customerId: number, items: [{ variantId: number, quantity: number }] }
 * @param {Request} req
 */
export async function POST(req) {
  /** @type {any} */
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { customerId, items } = body;
  if (!customerId || !Array.isArray(items) || items.length === 0) {
    return json({ error: 'customerId と items[] が必要です' }, 400);
  }

  try {
    // ── 1) 顧客情報取得 + B2B 確認 ──
    const customerGid = `gid://shopify/Customer/${customerId}`;
    const custData = await adminGraphQL(CUSTOMER_QUERY, { id: customerGid });
    const customer = custData.customer;
    if (!customer) {
      return json({ error: '顧客が見つかりません' }, 404);
    }

    const meta = flattenMetafields(customer.metafields.edges);
    if (meta['b2b.customer_type'] !== 'corporate') {
      return json({ error: 'B2B法人顧客ではありません' }, 403);
    }

    const discountGroup = meta['b2b.discount_group'] || '';
    /** @type {Record<string, any>} */
    let customOverrides = {};
    try {
      customOverrides = JSON.parse(meta['b2b.custom_overrides'] || '{}');
    } catch { /* ignore */ }

    // ── 2) バリアント情報取得 ──
    const variantGids = items.map(
      (/** @type {{variantId: number}} */ i) => `gid://shopify/ProductVariant/${i.variantId}`
    );
    const variantData = await adminGraphQL(VARIANTS_QUERY, { ids: variantGids });
    const variants = (variantData.nodes || []).filter(Boolean);

    if (variants.length === 0) {
      return json({ error: '有効なバリアントが見つかりません' }, 400);
    }

    // ── 3) ディスカウントマトリクス取得 ──
    const matrixData = await adminGraphQL(DISCOUNT_MATRIX_QUERY);
    const matrixEdges = matrixData.metaobjects?.edges || [];

    // ── 4) ラインアイテム組み立て（卸価格適用）──
    /** @type {Array<any>} */
    const lineItems = [];
    for (const item of items) {
      const gid = `gid://shopify/ProductVariant/${item.variantId}`;
      const variant = variants.find((/** @type {any} */ v) => v.id === gid);
      if (!variant) continue;

      const productCategory = getMetafield(
        variant.product?.metafields?.edges || [], 'b2b', 'category'
      ) || '';

      // 掛率カスケード: custom_overrides → discount_matrix → 1.0（正価）
      let rate = 1.0;
      if (productCategory && customOverrides[productCategory] != null) {
        rate = parseFloat(customOverrides[productCategory]) || 1.0;
      } else if (discountGroup && productCategory) {
        rate = findRate(matrixEdges, discountGroup, productCategory);
      }

      /** @type {any} */
      const lineItem = {
        variantId: gid,
        quantity: item.quantity,
      };

      if (rate < 1.0) {
        const discountPercent = Math.round((1 - rate) * 10000) / 100;
        lineItem.appliedDiscount = {
          valueType: 'PERCENTAGE',
          value: discountPercent,
          title: `B2B卸価格 (掛率${Math.round(rate * 100)}%)`,
        };
      }

      lineItems.push(lineItem);
    }

    if (lineItems.length === 0) {
      return json({ error: 'ラインアイテムを構成できませんでした' }, 400);
    }

    // ── 5) Draft Order 作成 ──
    const customerCode = meta['b2b.customer_code'] || '';
    const draftInput = {
      customerId: customerGid,
      useCustomerDefaultAddress: true,
      tags: ['b2b-draft-order'],
      note: `B2Bオンライン注文（${customer.lastName || ''} ${customer.firstName || ''} / ${customerCode}）`,
      lineItems,
    };

    const draftResult = await adminGraphQL(DRAFT_ORDER_CREATE, { input: draftInput });
    const errors = draftResult.draftOrderCreate.userErrors;
    if (errors?.length > 0) {
      console.error('DraftOrder userErrors:', JSON.stringify(errors));
      return json({ error: 'Draft Order 作成エラー', details: errors }, 500);
    }

    const draft = draftResult.draftOrderCreate.draftOrder;

    console.log(JSON.stringify({
      at: new Date().toISOString(),
      step: 'draft-order-created',
      id: draft.id,
      name: draft.name,
      invoiceUrl: draft.invoiceUrl,
      total: draft.totalPriceSet?.shopMoney?.amount,
      customer: customerGid,
      customerCode,
    }));

    // ── 6) invoice URL を返す ──
    return json({
      ok: true,
      draftOrderId: draft.id,
      draftOrderName: draft.name,
      invoiceUrl: draft.invoiceUrl,
      total: draft.totalPriceSet?.shopMoney,
      lineItems: draft.lineItems.edges.map((/** @type {any} */ e) => ({
        title: e.node.title,
        quantity: e.node.quantity,
        unitPrice: e.node.originalUnitPriceSet?.shopMoney?.amount,
      })),
    });
  } catch (e) {
    console.error('create-draft-order error:', e);
    return json({
      error: 'サーバーエラーが発生しました',
      message: e instanceof Error ? e.message : String(e),
    }, 500);
  }
}
