// @ts-check
/**
 * 初回セットアップ: ブラウザを開くので人間が MF にログインする（2FA含む）。
 * ログイン完了後にセッション（storageState）を .auth/mf-state.json に保存し、
 * 以後 send-invoice.js はパスワード不要・無人で動く。
 *
 *   実行: npm run login
 *
 * 設計理由: MF のパスワードを保存しない／2FA を自動化しない（規約・安全面）。
 *           セッションが切れたら本スクリプトを再実行するだけ。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(__dirname, '.auth/mf-state.json');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto('https://invoice.moneyforward.com/');

console.log('🌐 ブラウザを開きました。MF クラウド請求書にログインしてください（2段階認証もブラウザ内で完了させる）。');
console.log('   「請求書一覧」など、ログイン後の画面が表示されたら——');
const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question('   このターミナルで Enter を押してください > ');
rl.close();

mkdirSync(dirname(STATE_PATH), { recursive: true });
await context.storageState({ path: STATE_PATH });
await browser.close();
console.log(`✅ セッションを保存しました: ${STATE_PATH}`);
console.log('   → 以後 send-invoice.js は無人で実行できます（セッション切れ時は本スクリプトを再実行）。');
