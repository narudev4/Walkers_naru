#!/usr/bin/env node
/**
 * OAuth セットアップスクリプト
 * 初回実行時にブラウザで Google 認証 → トークンを保存
 *
 * 使い方:
 *   cd 05_development/mcp-youtube-analytics
 *   npm install
 *   npm run setup
 */
import http from 'http';
import { URL } from 'url';
import open from 'open';
import { loadClientSecrets, saveToken, SCOPES } from './auth.js';

const PORT = 3333;

async function main() {
  console.log('🔐 YouTube Analytics API — OAuth セットアップ\n');

  const oauth2Client = loadClientSecrets();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // 常に refresh_token を取得
  });

  // ローカルサーバーで認証コードを受け取る
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const code = url.searchParams.get('code');

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>❌ 認証コードがありません</h1>');
        return;
      }

      // 認証コード → アクセストークン / リフレッシュトークン
      const { tokens } = await oauth2Client.getToken(code);
      saveToken(tokens);

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <html>
        <body style="font-family: sans-serif; text-align: center; padding: 60px; background: #0f172a; color: #e2e8f0;">
          <h1>✅ 認証成功！</h1>
          <p>YouTube Analytics API のトークンを保存しました。</p>
          <p>このページは閉じて大丈夫です。</p>
        </body>
        </html>
      `);

      console.log('✅ トークンを保存しました: token.json');
      console.log('   access_token:', tokens.access_token?.slice(0, 20) + '...');
      console.log('   refresh_token:', tokens.refresh_token ? '取得済み' : '❌ 未取得');
      console.log('\n🎉 セットアップ完了！MCP サーバーを使用できます。');

      // サーバー終了
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 1000);
    } catch (err) {
      console.error('❌ トークン取得エラー:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>❌ エラー</h1><pre>${err.message}</pre>`);
    }
  });

  server.listen(PORT, () => {
    console.log(`📡 認証サーバー起動: http://localhost:${PORT}`);
    console.log('🌐 ブラウザで Google 認証ページを開きます...\n');
    open(authUrl);
  });
}

main().catch(console.error);
