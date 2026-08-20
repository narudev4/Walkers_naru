#!/usr/bin/env node
/**
 * 初回 OAuth セットアップ。
 * ブラウザで Google 同意 → localhost:3000/callback でコードを受け取りトークン保存。
 *
 * 注意: 同意画面では @walkers-development を管理している Google アカウント／
 *       ブランドチャンネルを選択すること。
 */
import http from 'http';
import { URL } from 'url';
import { exec } from 'child_process';
import { makeOAuthClient, saveToken, SCOPES } from './auth.js';

const PORT = 3456;

const client = makeOAuthClient();
const authUrl = client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent', // refresh_token を確実に取得
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/callback')) {
    res.writeHead(404);
    res.end();
    return;
  }
  const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>認証コードがありません</h1>');
    return;
  }
  try {
    const { tokens } = await client.getToken(code);
    saveToken(tokens);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<body style="font-family:sans-serif;text-align:center;padding:60px"><h1>認証成功</h1><p>このタブは閉じてOKです。</p></body>');
    console.log('✅ トークンを保存しました。');
    console.log('   refresh_token:', tokens.refresh_token ? '取得済み' : '⚠️ 未取得');
    setTimeout(() => { server.close(); process.exit(0); }, 800);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>エラー</h1><pre>${err.message}</pre>`);
    console.error('❌ トークン取得エラー:', err.message);
  }
});

server.listen(PORT, () => {
  console.log('🔐 YouTube 書き込み OAuth セットアップ\n');
  console.log('ブラウザが開かない場合は以下を手動で開いてください:\n');
  console.log(authUrl + '\n');
  console.log('※ 同意画面では @walkers-development のチャンネル／アカウントを選択してください。\n');
  exec(`open "${authUrl}"`);
});
