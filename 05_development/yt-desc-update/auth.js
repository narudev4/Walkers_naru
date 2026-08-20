/**
 * OAuth 2.0 認証ヘルパー（YouTube Data API 書き込み用）
 * - クライアント: credentials/gcp-oauth.keys.json（installed / desktop）
 * - トークン保存先: credentials/yt-desc-update-token.json（credentials/ は .gitignore 配下）
 * - スコープ: youtube.force-ssl（動画の読み取り + 概要欄の更新に必要）
 */
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const CLIENT_SECRET_PATH = path.join(REPO_ROOT, 'credentials', 'gcp-oauth.keys.json');
export const TOKEN_PATH = path.join(REPO_ROOT, 'credentials', 'yt-desc-update-token.json');
export const REDIRECT_URI = 'http://localhost:3456/callback';
export const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

// 対象チャンネル: @walkers-development
export const TARGET_CHANNEL_ID = 'UC_0tc8sWy5uuVuqLU0eajYw';

export function makeOAuthClient() {
  if (!fs.existsSync(CLIENT_SECRET_PATH)) {
    throw new Error(`OAuth クライアントが見つかりません: ${CLIENT_SECRET_PATH}`);
  }
  const { installed } = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf-8'));
  return new google.auth.OAuth2(installed.client_id, installed.client_secret, REDIRECT_URI);
}

export function saveToken(token) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

export function hasToken() {
  return fs.existsSync(TOKEN_PATH);
}

export async function getAuthedClient() {
  const client = makeOAuthClient();
  if (!hasToken()) {
    throw new Error('未認可です。先に `npm run setup` を実行してブラウザ認可を完了してください。');
  }
  client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8')));
  client.on('tokens', (tk) => {
    const cur = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    if (tk.refresh_token) cur.refresh_token = tk.refresh_token;
    if (tk.access_token) cur.access_token = tk.access_token;
    if (tk.expiry_date) cur.expiry_date = tk.expiry_date;
    saveToken(cur);
  });
  return client;
}
