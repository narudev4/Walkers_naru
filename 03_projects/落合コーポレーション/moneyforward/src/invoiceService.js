// @ts-check
/**
 * 正規化済み注文 → MF 請求書1枚を発行する中核ロジック（createInvoice.js から抽出）。
 * CLI（createInvoice.js）と webhook サーバの両方から呼べるよう関数化。
 *
 * 流れ:
 *   1. POST /partners                  … 取引先＋部署を作成（既存は order.mf_partner_id を再利用）
 *   2. POST /invoice_template_billings … 請求書を作成（インボイス制度対応テンプレート）
 */
import { mfFetch } from './mfClient.js';
import { buildPartnerRequest, buildDepartmentRequest, buildBillingRequest } from './mapOrder.js';

/**
 * 請求書の宛先 department_id を「確定的に」解決する。
 * 請求書POSTの department_id は必須なので、ここで undefined を絶対に通さない。
 *   1) インラインで部署が返っていればその id を使う
 *   2) 無ければ POST /partners/{id}/departments（201 は bare Department を返す＝spec確認済み）
 *   3) それでも id が取れなければ GET /partners/{id}（検証済みの Partner 形状）で取り直す
 *   4) どうしても取れなければ明示的に throw（undefined を送らない）
 * @param {any} order
 * @param {any} partner GET/POST /partners の応答
 */
async function resolveDepartmentId(order, partner) {
  let dep = (partner.departments || [])[0];
  if (dep && dep.id) return dep.id;

  const created = await mfFetch(`/partners/${partner.id}/departments`, {
    method: 'POST',
    body: buildDepartmentRequest(order),
  });
  if (created && created.id) return created.id;

  const refreshed = await mfFetch(`/partners/${partner.id}`);
  dep = (refreshed.departments || [])[0];
  if (dep && dep.id) return dep.id;

  throw new Error('department_id を取得できませんでした（取引先の部署が作成されていません）。');
}

/**
 * 取引先と部署を用意し、請求書の宛先 department_id を返す。
 * @param {any} order
 */
export async function ensurePartnerAndDepartment(order) {
  // 既存取引先の再利用（決定8: Shopify 顧客フィールドにマネフォ顧客ID=partner_id を保持）
  if (order.mf_partner_id) {
    const partner = await mfFetch(`/partners/${order.mf_partner_id}`);
    const departmentId = await resolveDepartmentId(order, partner);
    return { partnerId: partner.id, departmentId, partnerName: partner.name, reused: true };
  }

  const partner = await mfFetch('/partners', { method: 'POST', body: buildPartnerRequest(order) });
  const departmentId = await resolveDepartmentId(order, partner);
  return { partnerId: partner.id, departmentId, partnerName: partner.name, reused: false };
}

/**
 * 正規化済み注文から MF 請求書を1枚作成する（メール状態=未送信＝下書き）。
 * @param {any} order 正規化済み注文JSON
 * @returns {Promise<{ billing: any, partnerId: string, partnerName: string, departmentId: string, reused: boolean }>}
 */
export async function createInvoiceFromOrder(order) {
  const { partnerId, departmentId, partnerName, reused } = await ensurePartnerAndDepartment(order);
  const billing = await mfFetch('/invoice_template_billings', {
    method: 'POST',
    body: buildBillingRequest(order, departmentId),
  });
  return { billing, partnerId, partnerName, departmentId, reused };
}

/**
 * 請求書番号で請求書を検索して返す（送信後の email_status 検証に使う）。
 * GET /billings に単体GETは無いため document_number 検索で取る（spec確認済み）。
 * @param {string|number} billingNumber
 * @returns {Promise<any|null>}
 */
export async function findBillingByNumber(billingNumber) {
  const res = await mfFetch(`/billings?document_number=${encodeURIComponent(String(billingNumber))}`);
  const list = res?.data || [];
  return list.find((b) => String(b.billing_number) === String(billingNumber)) || list[0] || null;
}
