// @ts-check
/**
 * オフライン ドライラン: Shopify 注文JSON → MF 送信ペイロード（取引先/請求書）を表示する。
 * ネットワーク・認証情報 ともに不要。認可が間に合わない局面でも「Shopify→MF の配線が
 * 完成している」ことを即座に提示できる（実装可否＝『可能』の見せ場）。
 *   実行: npm run map:sample  /  node src/mapOrder.cli.js <order.json>
 */
import { readFileSync } from 'node:fs';
import { buildPartnerRequest, buildBillingRequest } from './mapOrder.js';

const orderPath = process.argv[2] || 'samples/order.sample.json';
const order = JSON.parse(readFileSync(orderPath, 'utf8'));

console.log('=== オフライン ドライラン（送信されるペイロード・ネットワーク不要）===');
console.log('入力注文:', orderPath, '—', order.name || order.id, '\n');

console.log('── POST /partners （取引先＋部署）──');
console.log(JSON.stringify(buildPartnerRequest(order), null, 2));

console.log('\n── POST /invoice_template_billings （請求書）──');
console.log(JSON.stringify(buildBillingRequest(order, '<department_id: 取引先作成時に取得>'), null, 2));

console.log('\n→ これが MF 請求書 API に送られる実ボディ。認証情報が揃えば `npm run invoice:sample` で実発行。');
