// @ts-check
/**
 * OAuth2 認可フロー実行ツール。
 *   既定          : ローカルにコールバックサーバーを立て、ブラウザ認可後の code を自動受信して交換。
 *   --manual      : サーバーを立てず、リダイレクト後のURL（または code）を貼り付けて交換。
 *                   （アプリ登録で http://localhost のリダイレクトURIが使えない場合のフォールバック）
 *
 *   実行: npm run auth         /  npm run auth:manual
 */
import http from 'node:http';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { exec } from 'node:child_process';
import { assertAppCredentials, config } from './config.js';
import { createPkce, buildAuthorizeUrl, exchangeCode } from './oauth.js';
import { saveTokens } from './tokens.js';

const MANUAL = process.argv.includes('--manual');

/** macOS なら既定ブラウザでURLを開く（失敗は無視）。 @param {string} url */
function tryOpen(url) {
  if (process.platform === 'darwin') exec(`open "${url}"`, () => {});
}

/** code → トークン交換 → 保存。 @param {string} code @param {string} expectedState @param {string} verifier @param {string} [returnedState] */
async function exchangeAndSave(code, expectedState, verifier, returnedState) {
  if (returnedState && returnedState !== expectedState) {
    throw new Error('state 不一致（CSRF 防止チェック失敗）。最初からやり直してください。');
  }
  if (!code) throw new Error('認可コード(code)が取得できませんでした。');
  console.log('\n認可コードを受領 → トークン交換中...');
  const tokens = await exchangeCode(code, verifier);
  const path = saveTokens(tokens);
  console.log('✅ トークン取得・保存完了:', path);
  console.log('   scope:', tokens.scope, '/ expires_in:', tokens.expires_in, '秒');
  console.log('\n次の確認コマンド:');
  console.log('   npm run whoami           # トークン疎通（GET /office）');
  console.log('   npm run invoice:sample   # サンプル注文で請求書1枚を作成');
}

async function main() {
  assertAppCredentials();

  const { codeVerifier, codeChallenge, state } = createPkce();
  const authorizeUrl = buildAuthorizeUrl({ codeChallenge, state });

  console.log('\n=== マネーフォワード OAuth 認可 ===');
  console.log('リダイレクトURI:', config.redirectUri, '（アプリ登録の設定と1文字違わず一致が必須）');
  console.log('スコープ        :', config.scope);
  console.log('認証方式        :', config.tokenAuthMethod);
  console.log('\n▼ 次のURLをブラウザで開いて認可してください:\n');
  console.log(authorizeUrl + '\n');

  if (MANUAL) {
    tryOpen(authorizeUrl);
    const rl = createInterface({ input: stdin, output: stdout });
    const pasted = (
      await rl.question('認可後のリダイレクト先URL全体（または code 値）を貼り付け: ')
    ).trim();
    rl.close();

    let code = pasted;
    let returnedState;
    if (pasted.includes('code=')) {
      const u = new URL(pasted.includes('://') ? pasted : 'http://x/?' + pasted.replace(/^\?/, ''));
      code = u.searchParams.get('code') || '';
      returnedState = u.searchParams.get('state') || undefined;
    }
    await exchangeAndSave(code, state, codeVerifier, returnedState);
    return;
  }

  // 自動モード: コールバックサーバー
  const redirect = new URL(config.redirectUri);
  const port = Number(redirect.port || (redirect.protocol === 'https:' ? 443 : 80));

  const server = http.createServer(async (req, res) => {
    if (!req.url) return;
    const u = new URL(req.url, `http://${redirect.host}`);
    if (u.pathname !== redirect.pathname) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    const errCode = u.searchParams.get('error');
    if (errCode) {
      const desc = u.searchParams.get('error_description') || '';
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>認可エラー</h1><p>${errCode}: ${desc}</p>`);
      console.error('\n❌ 認可エラー:', errCode, desc);
      process.exitCode = 1;
      server.close();
      return;
    }

    try {
      const code = u.searchParams.get('code') || '';
      const returnedState = u.searchParams.get('state') || undefined;
      await exchangeAndSave(code, state, codeVerifier, returnedState);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>認可完了 ✅</h1><p>ターミナルに戻ってください。このタブは閉じて構いません。</p>');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>トークン交換に失敗</h1><pre>${(e && e.message) || e}</pre>`);
      console.error('\n❌', (e && e.message) || e);
      process.exitCode = 1;
    } finally {
      server.close();
    }
  });

  server.listen(port, redirect.hostname, () => {
    console.log(
      `コールバック待機中: ${config.redirectUri}  （自動で開かない場合は上のURLを手動で開く / Ctrl+C で中断）`
    );
    tryOpen(authorizeUrl);
  });
}

main().catch((e) => {
  console.error('\n❌ 失敗:', e.message);
  process.exitCode = 1;
});
