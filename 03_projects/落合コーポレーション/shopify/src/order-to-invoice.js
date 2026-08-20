// @ts-check
/**
 * 「デモストアで購入した実際の注文(Order)」を読み、MF請求書が食う正規化JSONを
 * output/last-order.json に書き出す。draft-to-order.js の Order 版。
 *   ストアフロントで購入 → 本スクリプトで正規化 → createInvoice.js で請求書作成 → MF画面送信。
 * 中身は orderNormalize.js（webhook サーバと共通）。割引計算はしない。
 * 実行: node --env-file=.env src/order-to-invoice.js
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNormalizedOrder } from './orderNormalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../../output/last-order.json');

const normalized = await fetchNormalizedOrder();
// CLI は従来挙動を維持: 支払区分が未設定なら 'immediate' 扱い（デモ互換）
normalized.payment_term = normalized.payment_term || 'immediate';

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(normalized, null, 2));
console.log(`✅ 最新の注文 ${normalized.name} を正規化 → ${OUT_PATH}`);
console.log(`   取引先: ${normalized.customer.company} <${normalized.customer.email}>  支払区分=${normalized.payment_term}`);
for (const li of normalized.line_items) console.log(`   ・${li.title} × ${li.quantity} @¥${li.wholesale_unit_price.toLocaleString('ja-JP')}`);
console.log('\n→ 次: cd ../moneyforward && node --env-file=.env src/createInvoice.js ../output/last-order.json');
