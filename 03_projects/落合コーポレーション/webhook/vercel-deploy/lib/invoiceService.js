// @ts-check
/**
 * 正規化済み注文 → MF 請求書1枚を発行する中核ロジック。
 * moneyforward/src/invoiceService.js の Vercel Function 版。
 * import パスをローカル lib/ 配下に変更。
 */
import { mfFetch } from './mfClient.js';
import { buildPartnerRequest, buildDepartmentRequest, buildBillingRequest } from './mapOrder.js';

/**
 * 請求書の宛先 department_id を確定的に解決する。
 * @param {any} order
 * @param {any} partner
 * @returns {Promise<string>}
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
 * 正規化済み注文から MF 請求書を1枚作成する（下書き）。
 * @param {any} order
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
 * 請求書番号で請求書を検索して返す。
 * @param {string|number} billingNumber
 * @returns {Promise<any|null>}
 */
export async function findBillingByNumber(billingNumber) {
  const res = await mfFetch(`/billings?document_number=${encodeURIComponent(String(billingNumber))}`);
  const list = res?.data || [];
  return list.find((b) => String(b.billing_number) === String(billingNumber)) || list[0] || null;
}
