// @ts-check
/**
 * Shopify Admin GraphQL API クライアント（fetch ベース・依存ゼロ）。
 * shopify/src/shopifyClient.js の Vercel Function 版。
 * 環境変数から接続情報を読む（Vercel の Environment Variables で設定）。
 */

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';

const ORDER_METAFIELD_SET = `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value }
    userErrors { field message }
  }
}`;

/**
 * 注文にメタフィールドを書き込む。
 * @param {string} orderGid 'gid://shopify/Order/...'
 * @param {string} namespace
 * @param {string} key
 * @param {string} value
 * @param {string} [type] メタフィールドの型（デフォルト: single_line_text_field）
 */
export async function setOrderMetafield(orderGid, namespace, key, value, type = 'single_line_text_field') {
  const result = await adminGraphQL(ORDER_METAFIELD_SET, {
    metafields: [{
      ownerId: orderGid,
      namespace,
      key,
      value,
      type,
    }],
  });
  const errors = result.metafieldsSet?.userErrors;
  if (errors?.length > 0) {
    throw new Error(`metafieldsSet userErrors: ${JSON.stringify(errors)}`);
  }
  return result.metafieldsSet?.metafields?.[0];
}

/**
 * Admin GraphQL を1回叩く。
 * @param {string} query
 * @param {Record<string, any>} [variables]
 * @returns {Promise<any>}
 */
export async function adminGraphQL(query, variables = {}) {
  if (!DOMAIN || !TOKEN) {
    throw new Error(
      'SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN が未設定です。Vercel の環境変数を確認してください。'
    );
  }
  const url = `https://${DOMAIN}/admin/api/${VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status} (非JSON応答): ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 800)}`);
  }
  if (json.errors) {
    throw new Error('GraphQL errors: ' + JSON.stringify(json.errors, null, 2));
  }
  return json.data;
}
