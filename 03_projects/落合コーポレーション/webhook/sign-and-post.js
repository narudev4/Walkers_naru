// @ts-check
/**
 * ローカル疎通テスト: 実在する最新注文の ID で orders/create Webhook ペイロードを作り、
 * SHOPIFY_WEBHOOK_SECRET で署名して localhost のサーバへ POST する。
 * （Shopify からの実配送と同じ署名方式・同じヘッダ。公開URLなしで end-to-end を検証できる）
 *
 * 実行（webhook/ で）: npm run test:post
 *   = node --env-file=../shopify/.env --env-file=.env sign-and-post.js [orderGid]
 */
import { createHmac } from 'node:crypto';
import { adminGraphQL } from '../shopify/src/shopifyClient.js';

const SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';
const PORT = Number(process.env.PORT || 8788);
if (!SECRET) throw new Error('SHOPIFY_WEBHOOK_SECRET が未設定です（webhook/.env）。');

let orderGid = process.argv[2];
let orderName = '';
if (!orderGid) {
  const d = await adminGraphQL(`{ orders(first: 1, reverse: true, sortKey: CREATED_AT) { nodes { id name } } }`);
  const o = (d.orders.nodes || [])[0];
  if (!o) throw new Error('注文がありません。ストアで購入してから再実行してください。');
  orderGid = o.id;
  orderName = o.name;
}

// 実際の orders/create payload はもっと大きいが、サーバは admin_graphql_api_id しか使わない
const payload = {
  id: Number(String(orderGid).split('/').pop()),
  admin_graphql_api_id: orderGid,
  name: orderName,
  test: true,
};
const body = JSON.stringify(payload);
const hmac = createHmac('sha256', SECRET).update(body).digest('base64');

console.log(`→ POST http://localhost:${PORT}/webhooks/orders-create  (${orderName || orderGid})`);
const res = await fetch(`http://localhost:${PORT}/webhooks/orders-create`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Topic': 'orders/create',
    'X-Shopify-Hmac-Sha256': hmac,
    'X-Shopify-Shop-Domain': process.env.SHOPIFY_STORE_DOMAIN || 'local-test',
    'X-Shopify-Webhook-Id': `local-test-${payload.id}`,
  },
  body,
});
console.log(`← HTTP ${res.status} ${res.status === 200 ? '(受理。処理状況は output/webhook-events.jsonl とサーバログを見る)' : ''}`);
if (res.status !== 200) process.exitCode = 1;
