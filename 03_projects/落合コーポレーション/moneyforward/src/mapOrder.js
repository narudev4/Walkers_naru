// @ts-check
/**
 * Shopify 注文（正規化済み）→ マネーフォワード クラウド請求書 API のペイロード変換。
 *
 * 6/3 第3回MTG の決定を反映:
 *   - 決定3: 売上計上 = 注文時      → billing.sales_date = 注文日(ordered_at)
 *   - 決定4: 請求確定 = 発送時      → billing.billing_date = 発送日(fulfilled_at)
 *   - 決定8: マネフォ顧客ID連携     → 既存取引先は order.mf_partner_id を再利用、無ければ新規作成
 *
 * 単価は wholesale_unit_price（掛け率適用後の卸単価）をそのまま使う。掛け率計算は Track B の領分。
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

/** ISO日時 or 日付文字列 → 'YYYY-MM-DD'（タイムゾーンのオフセットを尊重）。 @param {string} [iso] */
export function toDate(iso) {
  if (!iso) return undefined;
  // '2026-06-08T20:00:00+09:00' → '2026-06-08' のように先頭10文字で十分（入力はJST前提）
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** 'YYYY-MM-DD' に n 日加算して 'YYYY-MM-DD' を返す（UTC基準・月跨ぎ/年跨ぎ対応）。 @param {string} [dateStr] @param {number} n */
export function addDays(dateStr, n) {
  if (!dateStr) return undefined;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** 取引先（Partner）作成リクエストボディを組み立てる。 @param {any} order */
export function buildPartnerRequest(order) {
  const c = order.customer || {};
  const department = pruneEmpty({
    zip: c.zip,
    tel: c.tel,
    prefecture: c.prefecture,
    address1: c.address1,
    address2: c.address2,
    person_name: c.person_name,
    person_dept: c.person_dept,
    email: c.email,
  });
  return pruneEmpty({
    name: c.company || c.person_name || '取引先（サンプル）',
    name_suffix: '御中',
    // PartnerCreateRequest は departments[] をインラインで受け付ける（最低1項目）
    departments: Object.keys(department).length ? [department] : undefined,
  });
}

/** 部署（Department）単体作成リクエスト（インライン作成が空だった場合のフォールバック）。 @param {any} order */
export function buildDepartmentRequest(order) {
  const c = order.customer || {};
  const body = pruneEmpty({
    zip: c.zip,
    tel: c.tel,
    prefecture: c.prefecture,
    address1: c.address1,
    address2: c.address2,
    person_name: c.person_name,
    person_dept: c.person_dept,
    email: c.email,
  });
  // 「最低1項目」を満たすための保険
  if (!Object.keys(body).length) body.person_dept = 'ご担当者';
  return body;
}

/**
 * 請求書（invoice_template_billings）作成リクエストボディを組み立てる。
 * @param {any} order
 * @param {string} departmentId 取引先の部署ID（請求書の宛先）
 */
export function buildBillingRequest(order, departmentId) {
  const items = (order.line_items || []).map((li) =>
    pruneEmpty({
      name: li.title,
      unit: li.unit,
      price: li.wholesale_unit_price,
      quantity: li.quantity,
      // item_id を指定しないインライン品目では excise（税率）が必須
      excise: li.tax_rate || 'ten_percent',
    })
  );

  const billingDate = toDate(order.fulfilled_at) || toDate(order.ordered_at); // 請求確定=発送時（決定4）
  // 支払期日(due_date): MF は「due_date は billing_date より後」を要求（同日/空は 422）。
  //   優先順: order.due_at（明示）> billing_date + order.payment_term_days 日 > billing_date + 30日（既定 net-30）
  //   ①②（締め払い）では将来、取引先の payment_deadline_setting に基づく締め支払日へ差し替える想定。
  const dueDays = Number.isFinite(order.payment_term_days) ? order.payment_term_days : 30;
  const dueDate = toDate(order.due_at) || addDays(billingDate, dueDays);

  return pruneEmpty({
    department_id: departmentId, // 必須
    // 通常は「ご注文 #1004」。締め請求など明示タイトルがある場合はそれを優先
    title: order.title || `ご注文 ${order.name || ''}`.trim(),
    billing_date: billingDate,
    due_date: dueDate,
    sales_date: toDate(order.ordered_at), // 売上計上=注文時（決定3）
    memo: order.memo,
    items,
  });
}
