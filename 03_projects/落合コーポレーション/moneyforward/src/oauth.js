// @ts-check
/**
 * OAuth2 認可コードフロー（MF クラウド認可サーバー）。
 * トークンEPは RFC 6749 準拠で application/x-www-form-urlencoded。
 * クライアント認証は MF アプリ設定の「クライアント認証方式」に合わせて切替:
 *   client_secret_basic  → Authorization: Basic base64(client_id:client_secret)
 *   client_secret_post   → body に client_id / client_secret
 *   none（公開クライアント）→ body に client_id のみ（PKCE で保護）
 */
import { randomBytes, createHash } from 'node:crypto';
import { config, endpoints } from './config.js';

/** base64url エンコード（パディング無し）。 @param {Buffer} buf */
export const base64url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PKCE の verifier / challenge(S256) と state を生成。 */
export function createPkce() {
  const codeVerifier = base64url(randomBytes(48));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  const state = base64url(randomBytes(16));
  return { codeVerifier, codeChallenge, state };
}

/** 認可エンドポイントのURLを組み立てる。 @param {{codeChallenge:string, state:string}} p */
export function buildAuthorizeUrl({ codeChallenge, state }) {
  const u = new URL(endpoints.authorize);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', config.clientId);
  u.searchParams.set('redirect_uri', config.redirectUri);
  u.searchParams.set('scope', config.scope);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

/** トークンEPへ form-urlencoded で POST。 @param {Record<string,string>} params */
async function postToken(params) {
  const body = new URLSearchParams(params);
  /** @type {Record<string,string>} */
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  if (config.tokenAuthMethod === 'client_secret_basic') {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  } else if (config.tokenAuthMethod === 'none') {
    body.set('client_id', config.clientId);
  } else {
    // client_secret_post（既定）
    body.set('client_id', config.clientId);
    body.set('client_secret', config.clientSecret);
  }

  const res = await fetch(endpoints.token, { method: 'POST', headers, body });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`トークンEP 非JSON応答 HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  if (!res.ok) {
    throw new Error(`トークンEP HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

/** 認可コード → トークン交換。 @param {string} code @param {string} [codeVerifier] */
export function exchangeCode(code, codeVerifier) {
  /** @type {Record<string,string>} */
  const params = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  };
  if (codeVerifier) params.code_verifier = codeVerifier;
  return postToken(params);
}

/** リフレッシュトークンでアクセストークンを更新。 @param {string} refreshToken */
export function refreshTokens(refreshToken) {
  return postToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
}
