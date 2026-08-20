// @ts-check
/**
 * マネーフォワード クラウド請求書 API クライアント（Vercel Function 版）。
 * moneyforward/src/mfClient.js の簡易版。
 *
 * 差分:
 *   - トークン永続化はファイルシステムではなく環境変数から読む
 *   - OAuth 認可コードフロー（ブラウザリダイレクト）は不要
 *   - refresh_token による自動更新は対応（環境変数 MF_REFRESH_TOKEN があれば）
 */

const API_BASE = (process.env.MF_API_BASE || 'https://invoice.moneyforward.com/api/v3').replace(/\/+$/, '');
const AUTH_BASE = (process.env.MF_AUTH_BASE || 'https://api.biz.moneyforward.com').replace(/\/+$/, '');
const CLIENT_ID = process.env.MF_CLIENT_ID || '';
const CLIENT_SECRET = process.env.MF_CLIENT_SECRET || '';
const TOKEN_AUTH_METHOD = process.env.MF_TOKEN_AUTH_METHOD || 'client_secret_post';

/** ランタイム中のトークン。コールドスタートごとに env から再ロードされる。 */
let accessToken = process.env.MF_ACCESS_TOKEN || '';
let refreshToken = process.env.MF_REFRESH_TOKEN || '';

/**
 * リフレッシュトークンでアクセストークンを更新する。
 * @param {string} rt
 * @returns {Promise<{ access_token: string, refresh_token?: string }>}
 */
async function doRefresh(rt) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt });
  /** @type {Record<string,string>} */
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  if (TOKEN_AUTH_METHOD === 'client_secret_basic') {
    headers.Authorization = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
  } else if (TOKEN_AUTH_METHOD === 'none') {
    body.set('client_id', CLIENT_ID);
  } else {
    // client_secret_post（既定）
    body.set('client_id', CLIENT_ID);
    body.set('client_secret', CLIENT_SECRET);
  }

  const res = await fetch(`${AUTH_BASE}/token`, { method: 'POST', headers, body });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`MF token refresh 非JSON応答 HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  if (!res.ok) {
    throw new Error(`MF token refresh HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

/**
 * MF 請求書 API を1回叩く。401 時にリフレッシュで1回だけリトライ。
 * @param {string} path 例: '/office', '/partners', '/invoice_template_billings'
 * @param {{ method?: string, body?: any }} [opts]
 * @returns {Promise<any>}
 */
export async function mfFetch(path, { method = 'GET', body } = {}) {
  if (!accessToken) {
    throw new Error(
      'MF_ACCESS_TOKEN が未設定です。Vercel の環境変数を確認してください。'
    );
  }

  const send = () =>
    fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body == null ? undefined : JSON.stringify(body),
    });

  let res = await send();

  // 401 → リフレッシュして1回だけリトライ
  if (res.status === 401 && refreshToken) {
    const refreshed = await doRefresh(refreshToken);
    accessToken = refreshed.access_token;
    if (refreshed.refresh_token) {
      refreshToken = refreshed.refresh_token;
    }
    // NOTE: Vercel Function ではリフレッシュ後のトークンを永続保存できない。
    // 長期運用では Vercel KV にトークンを保存するか、外部 OAuth プロキシを使うことを推奨。
    console.log('[mfClient] トークンをリフレッシュしました（当該インスタンス内のみ有効）');
    res = await send();
  }

  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
  }

  if (!res.ok) {
    const detail = json ? JSON.stringify(json) : text.slice(0, 600);
    const hint =
      res.status === 401
        ? '（トークンが無効/期限切れ。Vercel 環境変数の MF_ACCESS_TOKEN を更新してください）'
        : res.status === 403
          ? '（スコープ不足。アプリに mfc/invoice/data.write を付与してください）'
          : '';
    throw new Error(`MF API ${method} ${path} → HTTP ${res.status} ${hint}\n${detail}`);
  }

  return json;
}
