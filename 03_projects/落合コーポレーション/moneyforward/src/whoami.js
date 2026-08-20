// @ts-check
/**
 * トークン疎通スモークテスト。GET /office を叩いて、認可が通っているかだけを確認する。
 * 請求書作成で失敗したとき「認証の問題」か「ペイロードの問題」かを切り分けるのに使う。
 *   実行: npm run whoami
 */
import { mfFetch, currentTokenInfo } from './mfClient.js';

async function main() {
  const info = currentTokenInfo();
  if (!info) {
    console.error('❌ トークンがありません。`npm run auth` か .env の MF_ACCESS_TOKEN を設定してください。');
    process.exitCode = 1;
    return;
  }
  console.log('トークン: 出所=%s / scope=%s / refresh=%s', info.source, info.scope || '-', info.hasRefresh);

  const office = await mfFetch('/office');
  console.log('✅ /office OK — トークンは有効です');
  console.log('  事業者名 :', office.name || '(名称未設定)');
  console.log('  office_id:', office.id);
  console.log('  登録番号 :', office.registration_code || '(未設定)');
}

main().catch((e) => {
  console.error('\n❌ 疎通失敗:', e.message);
  process.exitCode = 1;
});
