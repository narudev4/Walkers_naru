/**
 * OAuth 2.0 認証ヘルパー
 * YouTube Analytics API のアクセストークン管理
 */
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CLIENT_SECRET_PATH = process.env.YOUTUBE_CLIENT_SECRET_PATH
  || path.join(process.env.HOME || '', '.youtube-mcp', 'client_secret.json');

const SCOPES = [
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.readonly',
];

/**
 * OAuth2 クライアントを取得
 */
export function loadClientSecrets() {
  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    throw new Error(`client_secret.json が見つかりません: ${CLIENT_SECRET_PATH}`);
  }
  const content = fs.readFileSync(CLIENT_SECRET_PATH, 'utf-8');
  const { installed } = JSON.parse(content);
  return new google.auth.OAuth2(
    installed.client_id,
    installed.client_secret,
    'http://localhost:3333'
  );
}

/**
 * 保存済みトークンの読み込み
 */
export function loadSavedToken(oauth2Client) {
  if (!fs.existsSync(TOKEN_PATH)) {
    return false;
  }
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  oauth2Client.setCredentials(token);
  return true;
}

/**
 * トークンを保存
 */
export function saveToken(token) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

/**
 * 認証済み OAuth2 クライアントを取得（MCP サーバー用）
 */
export async function getAuthenticatedClient() {
  const oauth2Client = loadClientSecrets();

  if (!loadSavedToken(oauth2Client)) {
    throw new Error(
      'OAuth トークンが未取得です。先に setup.js を実行してください:\n' +
      '  cd 05_development/mcp-youtube-analytics && npm run setup'
    );
  }

  // トークンの自動リフレッシュ
  oauth2Client.on('tokens', (tokens) => {
    const current = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    if (tokens.refresh_token) {
      current.refresh_token = tokens.refresh_token;
    }
    current.access_token = tokens.access_token;
    current.expiry_date = tokens.expiry_date;
    saveToken(current);
  });

  return oauth2Client;
}

export { SCOPES, TOKEN_PATH, CLIENT_SECRET_PATH };
