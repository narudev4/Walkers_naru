// @ts-check
/**
 * 締めバッチ（①20日締め／②末締め のかけ払い顧客向け・月次統合請求書の下書き作成）。
 *
 * 仕様（第3回MTG決定2/4/5/6/7 ＋ 要件定義書「質問事項」タブ確定分）:
 *   - 対象 = 締め期間内に「フルフィルメント（発送）」された注文（決定4: 請求確定=発送時）
 *   - 顧客（b2b.payment_terms が一致）ごとに 1 枚の請求書を「下書きで」作成（決定5: 人が確認して送付）
 *   - 支払期日: ①20日締め→翌月20日払い ／ ②末締め→翌月末払い
 *   - イレギュラー（来月請求への繰越等）は受けない（決定7）→ 発送日基準で機械的に締める
 *   - 本番では 締め日 23:59 に cron 実行（決定6）。本スクリプトは手動/cron 両用。
 *
 * 明細の粒度は仮仕様（確認事項#2(a) 待ち）: 「MM/DD 注文番号 商品名 × 数量 @確定単価」の商品行。
 * 返品・キャンセル(d)は未実装（確認待ち）。
 *
 *   実行（webhook/ で）:
 *     npm run settle -- --term 20th --closing 2026-06-20
 *     node --env-file=../shopify/.env --env-file=../moneyforward/.env --env-file=.env settle-batch.js --term 20th [--closing YYYY-MM-DD] [--force]
 *   --closing 省略時は「直近の締め日」を自動計算（20th: 直近の20日 / eom: 直近の月末）。
 *   同じ term+closing は二重実行しない（output/settle-runs.json。--force で上書き実行）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminGraphQL } from '../shopify/src/shopifyClient.js';
import { resolveDeliveryEmail } from '../shopify/src/orderNormalize.js';
import { createInvoiceFromOrder } from '../moneyforward/src/invoiceService.js';
import { logEvent } from './pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_PATH = resolve(__dirname, '../output/settle-runs.json');

const args = process.argv.slice(2);
/** @param {string} name */
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const TERM = argValue('--term');
const FORCE = args.includes('--force');
if (TERM !== '20th' && TERM !== 'eom') {
  console.error('使い方: settle-batch.js --term <20th|eom> [--closing YYYY-MM-DD] [--force]');
  process.exit(1);
}

/** JST の今日 'YYYY-MM-DD'。 */
function todayJST() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
/** @param {number} y @param {number} m 1-12 → その月の末日(数値) */
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** @param {number} y @param {number} m 1-12 @param {number} d */
const fmt = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** 締め日（省略時は直近の締め日）から期間と支払期日を計算する。 @param {'20th'|'eom'} term @param {string} [closingArg] */
function computePeriod(term, closingArg) {
  let closing = closingArg;
  if (!closing) {
    const [y, m, d] = todayJST().split('-').map(Number);
    if (term === '20th') {
      closing = d >= 20 ? fmt(y, m, 20) : (m === 1 ? fmt(y - 1, 12, 20) : fmt(y, m - 1, 20));
    } else {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      closing = fmt(py, pm, lastDay(py, pm)); // 直近の月末（当月末はまだ来ていない前提）
    }
  }
  const [cy, cm, cd] = closing.split('-').map(Number);
  let start, due;
  if (term === '20th') {
    // 期間: 前月21日〜当月20日 ／ 支払期日: 翌月20日
    start = cm === 1 ? fmt(cy - 1, 12, 21) : fmt(cy, cm - 1, 21);
    due = cm === 12 ? fmt(cy + 1, 1, 20) : fmt(cy, cm + 1, 20);
  } else {
    // 期間: 当月1日〜末日 ／ 支払期日: 翌月末
    start = fmt(cy, cm, 1);
    const ny = cm === 12 ? cy + 1 : cy;
    const nm = cm === 12 ? 1 : cm + 1;
    due = fmt(ny, nm, lastDay(ny, nm));
  }
  return { closing, start, due };
}

const { closing, start, due } = computePeriod(TERM, argValue('--closing'));
const runKey = `${TERM}:${closing}`;

let runs = {};
try { runs = JSON.parse(readFileSync(RUNS_PATH, 'utf8')); } catch { /* 初回 */ }
if (runs[runKey] && !FORCE) {
  console.error(`この締めは実行済みです: ${runKey}（請求書: ${JSON.stringify(runs[runKey].billings)}）。やり直すなら --force。`);
  process.exit(1);
}

console.log(`=== 締めバッチ（${TERM === '20th' ? '①20日締め' : '②末締め'}） ===`);
console.log(`期間: ${start} 〜 ${closing}（発送日基準・決定4/7） / 支払期日: ${due}`);

// 1) 期間に関係し得る注文を取得（プロトタイプ: 直近100件から発送日でフィルタ）
const d = await adminGraphQL(`{
  orders(first: 100, reverse: true, sortKey: CREATED_AT) {
    nodes {
      id name createdAt email
      fulfillments(first: 5) { createdAt }
      customer {
        id displayName email
        corporateName: metafield(namespace: "b2b", key: "corporate_name") { value }
        paymentTerms:  metafield(namespace: "b2b", key: "payment_terms")  { value }
        mfPartnerId:   metafield(namespace: "b2b", key: "mf_partner_id")   { value }
      }
      lineItems(first: 50) {
        nodes {
          title quantity
          originalUnitPriceSet   { shopMoney { amount } }
          discountedUnitPriceSet { shopMoney { amount } }
        }
      }
    }
  }
}`);

/** UTC ISO → JST 'YYYY-MM-DD' @param {string} iso */
const jstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

const targets = (d.orders.nodes || []).filter((o) => {
  if (o.customer?.paymentTerms?.value !== TERM) return false;
  const shipped = (o.fulfillments || []).map((f) => jstDate(f.createdAt));
  return shipped.some((day) => day >= start && day <= closing);
});

if (!targets.length) {
  console.log('対象注文がありません（期間内に発送された該当区分の注文なし）。');
  process.exit(0);
}

// 2) 顧客ごとにグループ化
/** @type {Map<string, any[]>} */
const byCustomer = new Map();
for (const o of targets) {
  const key = o.customer.id;
  if (!byCustomer.has(key)) byCustomer.set(key, []);
  byCustomer.get(key)?.push(o);
}
console.log(`対象: ${targets.length} 注文 / ${byCustomer.size} 顧客`);

// 3) 顧客ごとに統合請求書（下書き）を作成 — 送信はしない（決定5: 人が確認して送付）
const results = [];
for (const orders of byCustomer.values()) {
  const c = orders[0].customer;
  const periodLabel = `${start.replaceAll('-', '/')}〜${closing.replaceAll('-', '/')}`;
  const line_items = orders.flatMap((o) => {
    const day = jstDate(o.fulfillments[0].createdAt).slice(5).replace('-', '/');
    return o.lineItems.nodes.map((li) => {
      const amount = li.discountedUnitPriceSet?.shopMoney?.amount ?? li.originalUnitPriceSet?.shopMoney?.amount;
      // 明細粒度は仮仕様: 「MM/DD 注文番号 商品名」の商品行（確認事項#2(a) 確定後に調整）
      return { title: `${day} ${o.name} ${li.title}`, quantity: li.quantity, wholesale_unit_price: Number(amount), tax_rate: 'ten_percent', unit: '個' };
    });
  });
  const consolidated = {
    id: `settle:${runKey}:${c.id}`,
    name: periodLabel,
    title: `${periodLabel} 締め分 御請求`,
    ordered_at: `${closing}T23:59:00+09:00`, // 仮: 統合請求書の売上計上日は締め日（確定後に調整）
    fulfilled_at: `${closing}T23:59:00+09:00`, // 請求日 = 締め日（決定6）
    due_at: due,
    payment_term: TERM,
    mf_partner_id: c.mfPartnerId?.value || null,
    customer: {
      company: c.corporateName?.value || c.displayName || '取引先',
      person_name: c.displayName || '',
      email: resolveDeliveryEmail(c.email),
    },
    line_items,
  };
  const { billing, partnerId, reused } = await createInvoiceFromOrder(consolidated);
  logEvent({
    step: 'settle-invoice-created', term: TERM, closing, customer: consolidated.customer.company,
    orders: orders.map((o) => o.name), billing_number: billing.billing_number,
    total: billing.total_price, email_status: billing.email_status, partner_id: partnerId, partner_reused: reused,
  });
  console.log(`✅ ${consolidated.customer.company}: 請求書 No.${billing.billing_number}（${orders.length}注文 / 合計 ¥${Number(billing.total_price).toLocaleString('ja-JP')} / ${billing.email_status}）`);
  results.push({ customer: consolidated.customer.company, billing_number: billing.billing_number });
}

// 4) 実行記録（二重実行防止）
runs[runKey] = { at: new Date().toISOString(), period: { start, closing, due }, billings: results };
mkdirSync(dirname(RUNS_PATH), { recursive: true });
writeFileSync(RUNS_PATH, JSON.stringify(runs, null, 2));
console.log(`\n→ MF クラウド請求書の「請求書」一覧に下書きが入りました。スタッフが確認して送付（決定5）。`);
console.log(`   実行記録: ${RUNS_PATH}（同じ締めの再実行は --force が必要）`);
