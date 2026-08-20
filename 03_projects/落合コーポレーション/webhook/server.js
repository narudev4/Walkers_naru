// @ts-check
/**
 * Shopify orders/create Webhook 受信サーバ（③都度払い 請求書自動化の本番入口）。
 * 受信と署名検証だけ担当し、処理本体は pipeline.js（watch.js と共通）。
 *
 * フロー:
 *   POST /webhooks/orders-create
 *     1. HMAC-SHA256 署名検証（X-Shopify-Hmac-Sha256 vs 生ボディ）→ 不一致は 401
 *     2. 即 200 を返す（Shopify は 5 秒以内の応答を要求。処理は非同期で続行）
 *     3. pipeline.processOrderGid() … 注文取得 → MF請求書作成 → ③のみ自動送信 → API検証
 *
 * 起動（webhook/ で）: npm start
 *   = node --env-file=../shopify/.env --env-file=../moneyforward/.env --env-file=.env server.js
 *
 * 環境変数（webhook/.env）:
 *   SHOPIFY_WEBHOOK_SECRET … 署名検証キー。本番(API登録のWebhook)は「カスタムアプリのAPIシークレットキー」。
 *                            ローカルテストでは sign-and-post.js と同じ値なら何でもよい。
 *   PORT=8788 / SEND_MODE=none|browser / IMMEDIATE_TERMS=prepaid,immediate
 *
 * 注意: 開発ストアの注文は全てテスト注文。本番投入時は payload.test の扱いを決めること。
 */
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { processOrderGid, logEvent, SEND_MODE, IMMEDIATE_TERMS, EVENTS_LOG_PATH } from './pipeline.js';

const PORT = Number(process.env.PORT || 8788);
const SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';

if (!SECRET) {
  console.error('SHOPIFY_WEBHOOK_SECRET が未設定です（webhook/.env）。署名検証できないため起動を中止します。');
  process.exit(1);
}

/** HMAC 検証（生ボディ・base64・timingSafeEqual）。 @param {Buffer} rawBody @param {string} headerHmac */
function verifyHmac(rawBody, headerHmac) {
  if (!headerHmac) return false;
  const digest = createHmac('sha256', SECRET).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(headerHmac);
  return a.length === b.length && timingSafeEqual(a, b);
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, send_mode: SEND_MODE, immediate_terms: IMMEDIATE_TERMS }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/webhooks/orders-create') {
    res.writeHead(404).end();
    return;
  }

  /** @type {Buffer[]} */
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const hmac = String(req.headers['x-shopify-hmac-sha256'] || '');
    if (!verifyHmac(raw, hmac)) {
      logEvent({ step: 'reject', reason: 'HMAC不一致', from: req.socket.remoteAddress });
      res.writeHead(401).end();
      return;
    }
    // Shopify の 5 秒タイムアウト対策: 先に 200 を返し、処理は非同期で続行
    res.writeHead(200).end();

    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      logEvent({ step: 'error', reason: 'JSONパース失敗' });
      return;
    }
    const topic = String(req.headers['x-shopify-topic'] || '');
    if (topic && topic !== 'orders/create') {
      logEvent({ step: 'skip', reason: `対象外トピック: ${topic}` });
      return;
    }
    const orderGid = payload.admin_graphql_api_id || (payload.id ? `gid://shopify/Order/${payload.id}` : null);
    if (!orderGid) {
      logEvent({ step: 'skip', reason: 'payload に注文IDがない', payloadKeys: Object.keys(payload || {}) });
      return;
    }
    processOrderGid(orderGid).catch((e) => logEvent({ step: 'error', error: e.message }));
  });
});

server.listen(PORT, () => {
  console.log(`🚀 orders/create Webhook 受信サーバ起動: http://localhost:${PORT}`);
  console.log(`   POST /webhooks/orders-create（HMAC検証あり） / GET /healthz`);
  console.log(`   SEND_MODE=${SEND_MODE} / ③判定値=[${IMMEDIATE_TERMS.join(', ')}]`);
  console.log(`   ログ: ${EVENTS_LOG_PATH}`);
});
