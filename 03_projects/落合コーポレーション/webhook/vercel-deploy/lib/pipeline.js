// @ts-check
/**
 * 注文 → MF請求書 → （③都度払いのみ）下書き作成 の共通パイプライン。
 * webhook/pipeline.js の Vercel Function 版。
 *
 * 差分:
 *   - ファイルシステム永続化（JSONL ログ・processed.json）→ console.log のみ
 *   - Playwright 子プロセス起動 → 非対応（SEND_MODE=none 固定の想定）
 *   - import パスをローカル lib/ 配下に変更
 */
import { fetchNormalizedOrder } from './orderNormalize.js';
import { createInvoiceFromOrder, findBillingByNumber } from './invoiceService.js';
import { setOrderMetafield } from './shopifyClient.js';

export const SEND_MODE = process.env.SEND_MODE || 'none';
export const IMMEDIATE_TERMS = (process.env.IMMEDIATE_TERMS || 'prepaid,immediate')
  .split(',').map((s) => s.trim()).filter(Boolean);

/**
 * 監査ログ（コンソール出力のみ。Vercel の Log Drains で外部に転送可能）。
 * @param {Record<string, any>} ev
 */
export function logEvent(ev) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...ev });
  console.log(line);
}

/**
 * 注文1件をパイプラインに通す。
 *
 * @param {string} orderGid 'gid://shopify/Order/...'
 * @param {{ has(id: string): boolean, add(id: string): void, delete(id: string): void }} processedStore
 *   二重発行防止ストア。呼び出し元が管理する（インメモリ Set / Vercel KV 等）。
 */
export async function processOrderGid(orderGid, processedStore) {
  let order, billing, partnerId, reused;
  try {
    // 1) 注文の取得・正規化（customer metafield 込みで Admin API から引く）
    order = await fetchNormalizedOrder(orderGid);
    const isImmediate = IMMEDIATE_TERMS.includes(order.payment_term || '');
    logEvent({
      step: 'order', order: order.name, payment_term: order.payment_term,
      immediate: isImmediate, customer: order.customer.company,
    });

    // かけ払い（20th/eom）は注文毎の請求書を作らない。
    // 締めバッチ（settle-batch.js）が期間分を顧客ごと1枚に統合して下書き作成する。
    if (!isImmediate) {
      logEvent({
        step: 'done', order: order.name,
        result: 'かけ払い→注文毎の請求書は作成しない（締めバッチで期間統合・決定5の人手送付へ）',
      });
      return;
    }

    // 2) ③都度払いのみ: MF 請求書を即時作成
    ({ billing, partnerId, reused } = await createInvoiceFromOrder(order));
  } catch (e) {
    // 請求書「作成前」に失敗 → 処理済みマークを外す（次の再配送でリトライ可能にする）
    processedStore.delete(orderGid);
    logEvent({
      step: 'retryable-error', order: orderGid,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  const mfInvoiceUrl = `https://invoice.moneyforward.com/billings/${billing.id}`;

  logEvent({
    step: 'invoice-created', order: order.name, billing_id: billing.id,
    billing_number: billing.billing_number, total: billing.total_price,
    email_status: billing.email_status, partner_id: partnerId, partner_reused: reused,
    mf_invoice_url: mfInvoiceUrl,
  });

  // 3) MF請求書URLをShopify注文メタフィールドに書き戻す（案A: メール連携用）
  if (order.id) {
    try {
      await setOrderMetafield(order.id, 'b2b', 'mf_invoice_url', mfInvoiceUrl);
      await setOrderMetafield(order.id, 'b2b', 'mf_billing_number', String(billing.billing_number));
      logEvent({
        step: 'metafield-written', order: order.name,
        fields: ['b2b.mf_invoice_url', 'b2b.mf_billing_number'],
      });
    } catch (e) {
      logEvent({
        step: 'metafield-error', order: order.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 4) 自動送信: Vercel Function 上では Playwright が動かないため、
  //    SEND_MODE=browser は非対応。下書き作成までで完了とする。
  if (SEND_MODE === 'browser') {
    logEvent({
      step: 'warn', order: order.name,
      result: 'SEND_MODE=browser は Vercel Function では非対応。下書きのまま完了。送信は別プロセスで実行してください。',
    });
  }

  logEvent({
    step: 'done', order: order.name,
    result: `③都度払い → MF請求書 No.${billing.billing_number} を下書き作成完了 / URL→order metafield書込み済`,
  });
}
