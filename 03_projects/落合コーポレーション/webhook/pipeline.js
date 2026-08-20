// @ts-check
/**
 * 注文 → MF請求書 → （③都度払いのみ）自動送信 → API検証 の共通パイプライン。
 * 入口が Webhook（server.js）でもポーリング監視（watch.js）でも同じ処理を通す。
 *
 * 環境変数:
 *   SEND_MODE=none|browser   … browser: ③都度払いを mf-automation/send-invoice.js で送信まで実行
 *   IMMEDIATE_TERMS=prepaid,immediate … ③都度払いとして自動送信する b2b.payment_terms 値
 */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchNormalizedOrder } from '../shopify/src/orderNormalize.js';
import { createInvoiceFromOrder, findBillingByNumber } from '../moneyforward/src/invoiceService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, '../output');
const EVENTS_LOG = resolve(OUTPUT_DIR, 'webhook-events.jsonl');
const PROCESSED_PATH = resolve(OUTPUT_DIR, 'webhook-processed.json');
const SEND_SCRIPT = resolve(__dirname, '../mf-automation/send-invoice.js');

export const SEND_MODE = process.env.SEND_MODE || 'none'; // 'none' | 'browser'
export const IMMEDIATE_TERMS = (process.env.IMMEDIATE_TERMS || 'prepaid,immediate')
  .split(',').map((s) => s.trim()).filter(Boolean);
export const EVENTS_LOG_PATH = EVENTS_LOG;

/** 二重処理防止: 処理済み注文IDの永続セット（Webhook再配送・監視の重複検知の両方を防ぐ） */
function loadProcessed() {
  try {
    return new Set(JSON.parse(readFileSync(PROCESSED_PATH, 'utf8')));
  } catch {
    return new Set();
  }
}
const processed = loadProcessed();

/** @param {string} orderGid */
export function isProcessed(orderGid) {
  return processed.has(orderGid);
}

/** @param {string} orderGid */
function markProcessed(orderGid) {
  processed.add(orderGid);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(PROCESSED_PATH, JSON.stringify([...processed], null, 2));
}

/** 監査ログ（JSONL＋コンソール）。 @param {Record<string, any>} ev */
export function logEvent(ev) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), ...ev });
  appendFileSync(EVENTS_LOG, line + '\n');
  console.log(line);
}

/**
 * 送信ステップ（A-2: MF画面の Playwright 自動化）を子プロセスで実行。
 * @param {string|number} billingNumber
 * @returns {Promise<{ ok: boolean, output: string }>}
 */
function runBrowserSend(billingNumber) {
  return new Promise((resolveP) => {
    const child = spawn('node', [SEND_SCRIPT, '--billing-number', String(billingNumber)], {
      cwd: dirname(SEND_SCRIPT),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolveP({ ok: code === 0, output: out.trim() }));
    child.on('error', (e) => resolveP({ ok: false, output: String(e) }));
  });
}

/**
 * 注文1件をパイプラインに通す（冪等・処理済みはスキップ）。
 * @param {string} orderGid 'gid://shopify/Order/...'
 */
export async function processOrderGid(orderGid) {
  if (processed.has(orderGid)) {
    logEvent({ step: 'skip', reason: '処理済み（再配送/再検知）', order: orderGid });
    return;
  }
  markProcessed(orderGid); // 先にマークして並行実行の二重発行を防ぐ

  // 請求書「作成前」に失敗したら処理済みマークを外す（次の検知/再配送でリトライ可能にする）。
  // 作成後の失敗（送信失敗等）はマークを残す＝請求書の二重発行を防ぐ。
  let order, billing, partnerId, reused;
  try {
    // 1) 注文の取得・正規化（customer metafield 込みで Admin API から引く）
    order = await fetchNormalizedOrder(orderGid);
    const isImmediateEarly = IMMEDIATE_TERMS.includes(order.payment_term || '');
    logEvent({
      step: 'order', order: order.name, payment_term: order.payment_term,
      immediate: isImmediateEarly, customer: order.customer.company,
    });

    // かけ払い（20th/eom）は注文毎の請求書を作らない。締めバッチ（settle-batch.js）が
    // 期間分を顧客ごと1枚に統合して下書き作成する（D-3: 注文毎下書きは二重請求リスク）。
    if (!isImmediateEarly) {
      logEvent({ step: 'done', order: order.name, result: 'かけ払い→注文毎の請求書は作成しない（締めバッチで期間統合・決定5の人手送付へ）' });
      return;
    }

    // 2) ③都度払いのみ: MF 請求書を即時作成
    ({ billing, partnerId, reused } = await createInvoiceFromOrder(order));
  } catch (e) {
    processed.delete(orderGid);
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(PROCESSED_PATH, JSON.stringify([...processed], null, 2));
    logEvent({ step: 'retryable-error', order: orderGid, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  logEvent({
    step: 'invoice-created', order: order.name, billing_id: billing.id,
    billing_number: billing.billing_number, total: billing.total_price,
    email_status: billing.email_status, partner_id: partnerId, partner_reused: reused,
  });

  // 3) 自動送信（A-2）。ここに到達するのは③都度払いのみ。
  if (SEND_MODE !== 'browser') {
    logEvent({ step: 'done', order: order.name, result: `③都度払いだが SEND_MODE=${SEND_MODE} のため送信せず下書きのまま` });
    return;
  }

  const sent = await runBrowserSend(billing.billing_number);
  logEvent({ step: 'browser-send', order: order.name, ok: sent.ok, output: sent.output.slice(-500) });

  // 4) email_status を API で機械検証（送信ボタンが本当に効いたかをUIではなくデータで確認）
  const after = await findBillingByNumber(billing.billing_number);
  const status = after?.email_status ?? '(取得失敗)';
  logEvent({
    step: 'verify', order: order.name, billing_number: billing.billing_number,
    email_status: status, verified: status !== '未送信' && status !== '(取得失敗)',
  });
}
