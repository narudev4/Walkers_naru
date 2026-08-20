// @ts-check
/**
 * 環境変数と公式エンドポイントの集約。`node --env-file=.env src/*.js` で実行する前提。
 *
 * エンドポイント・スコープ・認証方式は、すべて MF 公式の一次情報で確定済み:
 *   - 請求書 OpenAPI: https://invoice.moneyforward.com/docs/api/v3/reference/iv_web_api.yaml
 *   - 認可メタデータ(RFC 8414): https://api.biz.moneyforward.com/.well-known/oauth-authorization-server
 *       response_types=[code] / grant_types=[authorization_code, refresh_token]
 *       auth_methods=[none, client_secret_basic, client_secret_post] / PKCE=[S256]
 */

export const config = {
  clientId: process.env.MF_CLIENT_ID || '',
  clientSecret: process.env.MF_CLIENT_SECRET || '',
  redirectUri: process.env.MF_REDIRECT_URI || 'http://localhost:8787/callback',
  scope: process.env.MF_SCOPE || 'mfc/invoice/data.write',
  /** 'client_secret_post' | 'client_secret_basic' | 'none' */
  tokenAuthMethod: process.env.MF_TOKEN_AUTH_METHOD || 'client_secret_post',
  authBase: (process.env.MF_AUTH_BASE || 'https://api.biz.moneyforward.com').replace(/\/+$/, ''),
  apiBase: (process.env.MF_API_BASE || 'https://invoice.moneyforward.com/api/v3').replace(/\/+$/, ''),
  envAccessToken: process.env.MF_ACCESS_TOKEN || '',
  envRefreshToken: process.env.MF_REFRESH_TOKEN || '',
};

export const endpoints = {
  authorize: `${config.authBase}/authorize`,
  token: `${config.authBase}/token`,
};

/** アプリ認証情報(client_id 等)が揃っているか検証。認可・トークン操作の前に呼ぶ。 */
export function assertAppCredentials() {
  const missing = [];
  if (!config.clientId) missing.push('MF_CLIENT_ID');
  // none（公開クライアント）の場合は client_secret 不要
  if (config.tokenAuthMethod !== 'none' && !config.clientSecret) missing.push('MF_CLIENT_SECRET');
  if (missing.length) {
    throw new Error(
      `未設定の環境変数: ${missing.join(', ')}\n` +
        '→ moneyforward/.env を確認してください（README「人手ステップ」参照）。'
    );
  }
}
