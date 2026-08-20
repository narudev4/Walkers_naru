// @ts-check
/**
 * Shopify 注文（正規化済み）→ マネーフォワード クラウド請求書 API のペイロード変換。
 * moneyforward/src/mapOrder.js のコピー（Vercel Function 用に自己完結化）。
 */

/** undefined / 空文字 のキーを落とす。 @param {Record<string,any>} obj */
export function pruneEmpty(obj) {
  /** @type {Record<string,any>} */
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

/** ISO日時 or 日付文字列 → 'YYYY-MM-DD'。 @param {string} [iso] */
export function toDate(iso) {
  if (!iso) return undefined;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** 'YYYY-MM-DD' に n 日加算して 'YYYY-MM-DD' を返す。 @param {string} [dateStr] @param {number} n */
export function addDays(dateStr, n) {
  if (!dateStr) return undefined;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** 取引先（Partner）作成リクエストボディ。 @param {any} order */
export function buildPartnerRequest(order) {
  const c = order.customer || {};
  const department = pruneEmpty({
    zip: c.zip, tel: c.tel, prefecture: c.prefecture,
    address1: c.address1, address2: c.address2,
    person_name: c.person_name, person_dept: c.person_dept, email: c.email,
  });
  return pruneEmpty({
    name: c.company || c.person_name || '取引先',
    name_suffix: '御中',
    departments: Object.keys(department).length ? [department] : undefined,
  });
}

/** 部署（Department）単体作成リクエスト。 @param {any} order */
export function buildDepartmentRequest(order) {
  const c = order.customer || {};
  const body = pruneEmpty({
    zip: c.zip, tel: c.tel, prefecture: c.prefecture,
    address1: c.address1, address2: c.address2,
    person_name: c.person_name, person_dept: c.person_dept, email: c.email,
  });
  if (!Object.keys(body).length) body.person_dept = 'ご担当者';
  return body;
}

/**
 * 請求書（invoice_template_billings）作成リクエストボディ。
 * @param {any} order
 * @param {string} departmentId
 */
export function buildBillingRequest(order, departmentId) {
  const items = (order.line_items || []).map((li) =>
    pruneEmpty({
      name: li.title, unit: li.unit, price: li.wholesale_unit_price,
      quantity: li.quantity, excise: li.tax_rate || 'ten_percent',
    })
  );
  const billingDate = toDate(order.fulfilled_at) || toDate(order.ordered_at);
  const dueDays = Number.isFinite(order.payment_term_days) ? order.payment_term_days : 30;
  const dueDate = toDate(order.due_at) || addDays(billingDate, dueDays);

  return pruneEmpty({
    department_id: departmentId,
    title: order.title || `ご注文 ${order.name || ''}`.trim(),
    billing_date: billingDate,
    due_date: dueDate,
    sales_date: toDate(order.ordered_at),
    memo: order.memo,
    items,
  });
}
