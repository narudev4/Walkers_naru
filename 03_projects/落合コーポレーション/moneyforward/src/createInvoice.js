// @ts-check
/**
 * Shopify 注文1件 → マネーフォワード クラウド請求書 API で請求書を1枚発行する（CLI）。
 * 中核ロジックは invoiceService.js（webhook サーバと共通）。
 *
 * 流れ:
 *   0. GET  /office                      … トークン疎通（認証エラーと payload エラーの切り分け）
 *   1. POST /partners                    … 取引先＋部署を作成（既存は order.mf_partner_id を再利用）
 *   2. POST /invoice_template_billings   … 請求書を作成（インボイス制度対応テンプレート）
 *   3. 結果（請求書ID/番号/合計/PDF URL）を表示
 *
 *   実行: npm run invoice:sample
 *         node --env-file=.env src/createInvoice.js <order.json>
 */
import { readFileSync } from 'node:fs';
import { mfFetch } from './mfClient.js';
import { createInvoiceFromOrder } from './invoiceService.js';

const orderPath = process.argv[2] || 'samples/order.sample.json';

/** @param {any} n */
function yen(n) {
  const v = Number(n);
  return Number.isFinite(v) ? '¥' + v.toLocaleString('ja-JP') : String(n ?? '-');
}

async function main() {
  const order = JSON.parse(readFileSync(orderPath, 'utf8'));
  console.log('=== Shopify 注文 → MF 請求書 発行 ===');
  console.log('入力注文:', orderPath, '—', order.name || order.id);

  // 0) トークン疎通
  const office = await mfFetch('/office');
  console.log('事業者  :', office.name || '(名称未設定)', `(office_id=${office.id})`);

  // 1) 取引先＋部署 → 2) 請求書作成
  const { billing, partnerId, partnerName, departmentId, reused } = await createInvoiceFromOrder(order);
  console.log(
    `取引先  : ${partnerName} (partner_id=${partnerId} / ${reused ? '再利用' : '新規作成'}, department_id=${departmentId})`
  );
  if (!reused) {
    console.log('  ↳ この partner_id が「マネフォ顧客ID」。決定8によりShopify顧客フィールドへ保存し次回再利用。');
  }

  // 3) 結果
  console.log('\n✅ 請求書を作成しました（MF クラウド請求書の「請求書」一覧に表示されます）');
  console.log('  請求書ID     :', billing.id);
  console.log('  請求書番号   :', billing.billing_number || '(自動採番/未設定)');
  console.log('  宛先         :', billing.partner_name);
  console.log('  請求日       :', billing.billing_date, '/ 売上計上日:', billing.sales_date || '-');
  console.log('  小計/消費税/合計:', yen(billing.subtotal_price), '/', yen(billing.excise_price), '/', yen(billing.total_price));
  console.log('  メール状態   :', billing.email_status, '（自動送付はしない＝下書き相当。決定5の運用に整合）');
  console.log('  PDF(API)     :', billing.pdf_url);
  console.log('\n→ ブラウザで MF クラウド請求書にログイン →「請求書」一覧で、この1枚が確認できます（＝API発行の証明）。');
}

main().catch((e) => {
  console.error('\n❌ 失敗:', e.message);
  process.exitCode = 1;
});
