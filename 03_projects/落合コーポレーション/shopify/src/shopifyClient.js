// @ts-check
/**
 * Shopify Admin GraphQL API クライアント（fetch ベース・依存ゼロ）
 * 環境変数（.env）から接続情報を読む。`node --env-file=.env` で実行する前提。
 */

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';

/**
 * Admin GraphQL を1回叩く。userErrors は呼び出し側で個別に確認すること
 * （ここでは transport/GraphQL レベルのエラーのみ throw）。
 * @param {string} query
 * @param {Record<string, any>} [variables]
 * @returns {Promise<any>}
 */
export async function adminGraphQL(query, variables = {}) {
  if (!DOMAIN || !TOKEN) {
    throw new Error(
      'SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_TOKEN が未設定です。shopify/.env を確認し、`node --env-file=.env ...` で実行してください。'
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

export const apiContext = { DOMAIN, VERSION, hasToken: Boolean(TOKEN) };
