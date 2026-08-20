// @ts-check
/**
 * Vercel Serverless Function: Shopify orders/create Webhook 受信。
 *
 * 元の webhook/server.js (Express-free Node.js http) を Vercel Function 形式に変換。
 * Web API (Request/Response) + named exports パターンで実装。
 *
 * 処理フロー:
 *   1. POST /api/webhook のみ受付（GET はヘルスチェック）
 *   2. HMAC-SHA256 署名検証（X-Shopify-Hmac-Sha256 vs raw body）→ 不一致は 401
 *   3. 即 200 を返す（Shopify は 5秒以内の応答を要求）
 *   4. waitUntil() で注文処理を非同期実行（Vercel Fluid Compute）
 *
 * 環境変数:
 *   SHOPIFY_WEBHOOK_SECRET  … 署名検証キー（カスタムアプリの API シークレットキー）
 *   SHOPIFY_STORE_DOMAIN    … ストアドメイン（*.myshopify.com）
 *   SHOPIFY_ADMIN_TOKEN     … Admin API アクセストークン
 *   SHOPIFY_API_VERSION     … Admin GraphQL API バージョン（省略時 2025-10）
 *   MF_CLIENT_ID            … MF クラウド請求書 アプリ client_id
 *   MF_CLIENT_SECRET        … MF クラウド請求書 アプリ client_secret
 *   MF_ACCESS_TOKEN         … MF API アクセストークン
 *   MF_REFRESH_TOKEN        … MF API リフレッシュトークン（省略可）
 *   SEND_MODE               … none（既定）: 下書き作成まで / browser は Vercel では非対応
 *   IMMEDIATE_TERMS         … ③都度払い判定値（カンマ区切り。既定: prepaid,immediate）
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { processOrderGid, logEvent } from '../lib/pipeline.js';

const SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';
const SEND_MODE = process.env.SEND_MODE || 'none';
const IMMEDIATE_TERMS = (process.env.IMMEDIATE_TERMS || 'prepaid,immediate')
  .split(',').map((s) => s.trim()).filter(Boolean);

/**
 * HMAC 検証（raw body bytes・base64・timingSafeEqual）。
 * @param {Buffer} rawBody
 * @param {string} headerHmac
 * @returns {boolean}
 */
function verifyHmac(rawBody, headerHmac) {
  if (!headerHmac) return false;
  const digest = createHmac('sha256', SECRET).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(headerHmac);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 二重発行防止: インメモリ Set。
 * Vercel Function はコールドスタートごとにリセットされるため、
 * これは同一インスタンスの連続リクエストに対する重複防止のみ。
 * 本格運用で永続的な二重防止が必要な場合は Vercel KV / Upstash Redis に移行する。
 * インターフェースを processedStore に抽象化してあるので差し替えは容易。
 */
const processedStore = {
  /** @type {Set<string>} */
  _set: new Set(),
  /** @param {string} id */
  has(id) { return this._set.has(id); },
  /** @param {string} id */
  add(id) { this._set.add(id); },
  /** @param {string} id */
  delete(id) { this._set.delete(id); },
};

/**
 * GET /api/webhook → ヘルスチェック
 * @param {Request} _req
 * @returns {Response}
 */
export function GET(_req) {
  return Response.json({
    ok: true,
    send_mode: SEND_MODE,
    immediate_terms: IMMEDIATE_TERMS,
    runtime: 'vercel-function',
  });
}

/**
 * POST /api/webhook → Shopify Webhook 受信
 * @param {Request} req
 * @returns {Promise<Response>}
 */
export async function POST(req) {
  // ── シークレット未設定 → 500 ──
  if (!SECRET) {
    console.error('SHOPIFY_WEBHOOK_SECRET が未設定です。Vercel の環境変数を確認してください。');
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 });
  }

  // ── raw body 読み取り（HMAC検証にはバイト列が必要）──
  const rawArrayBuffer = await req.arrayBuffer();
  const rawBody = Buffer.from(rawArrayBuffer);

  // ── HMAC 署名検証 ──
  const hmac = req.headers.get('x-shopify-hmac-sha256') || '';
  if (!verifyHmac(rawBody, hmac)) {
    logEvent({ step: 'reject', reason: 'HMAC不一致', from: req.headers.get('x-forwarded-for') || 'unknown' });
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── ペイロード解析（200 を返す前に最低限のバリデーション）──
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    logEvent({ step: 'error', reason: 'JSONパース失敗' });
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const topic = req.headers.get('x-shopify-topic') || '';
  if (topic && topic !== 'orders/create') {
    logEvent({ step: 'skip', reason: `対象外トピック: ${topic}` });
    return Response.json({ ok: true, skipped: true });
  }

  const orderGid = payload.admin_graphql_api_id
    || (payload.id ? `gid://shopify/Order/${payload.id}` : null);
  if (!orderGid) {
    logEvent({ step: 'skip', reason: 'payload に注文IDがない', payloadKeys: Object.keys(payload || {}) });
    return Response.json({ ok: true, skipped: true });
  }

  // 二重発行防止（インメモリ）
  if (processedStore.has(orderGid)) {
    logEvent({ step: 'skip', reason: '処理済み（再配送）', order: orderGid });
    return Response.json({ ok: true, skipped: true });
  }

  // ── waitUntil(): 応答後も Function を生かして注文処理を非同期実行 ──
  waitUntil(
    (async () => {
      processedStore.add(orderGid);
      try {
        await processOrderGid(orderGid, processedStore);
      } catch (e) {
        logEvent({ step: 'error', order: orderGid, error: e instanceof Error ? e.message : String(e) });
      }
    })()
  );

  // ── 即座に 200 を返す（Shopify の 5秒タイムアウト対策）──
  return Response.json({ ok: true });
}
