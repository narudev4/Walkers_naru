// @ts-check
/**
 * 落合コーポ B2B 掛け率計算エンジン（Admin API 非依存の純粋ロジック）
 *
 * 【設計方針 — 新カテゴリ追加で再開発不要】
 *   カテゴリ名・グループ名・レートはすべて「データ」として外部から渡す:
 *     - 顧客側:  Customer Metafield (b2b.discount_group, b2b.custom_overrides)
 *     - 商品側:  Product Metafield  (b2b.category)
 *     - 行列:    discount_matrix Metaobject の全エントリ
 *   本モジュールはカテゴリ名/グループ名を一切ハードコードしない。
 *   → 新カテゴリ・新グループの追加は「データ（Metaobject エントリ）を足すだけ」で、
 *      コード変更・再デプロイ不要。これが本検証の核心要件（discount-system.md §7）。
 *
 * 【掛け率の意味】 rate は「正価に対する係数」。例 rate=0.60 → 正価の60%（=40% OFF）。
 */

/**
 * 小数桁を持たない通貨（最小単位=1）。JPY はここに含まれ整数丸めになる。
 * 参照: ISO 4217 / Shopify presentment currency の慣行。
 * @type {Set<string>}
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD', 'UGX', 'XAF', 'XOF', 'XPF',
]);

/**
 * 掛け率の値を検証して正規化する。0 < rate <= 1 のみ有効。
 * 文字列（Metafield/Metaobject は文字列で返ることがある）も数値化する。
 * 不正値（0以下・1超・非数）は null を返し、呼び出し側で正価(1.0)にフォールバックさせる。
 * @param {unknown} value
 * @returns {number|null}
 */
export function normalizeRate(value) {
  const r = typeof value === 'string' ? parseFloat(value) : value;
  if (typeof r !== 'number' || !Number.isFinite(r)) return null;
  if (r <= 0 || r > 1) return null;
  return r;
}

/**
 * 顧客 × 商品区分 の最終掛け率を解決する。
 * 優先順位: ① 個別override → ② グループ×区分マトリクス → ③ 1.0（正価）
 *
 * @param {object} args
 * @param {string} [args.customerType]   "corporate" | "individual"
 * @param {string} [args.discountGroup]  "A" | "B" | "C" | ...
 * @param {Record<string, number|string>} [args.customOverrides]  {category: rate}
 * @param {string} [args.productCategory] "racket" | "wear" | ...
 * @param {Array<{group:string, category:string, discountRate:number|string}>} [args.matrix]
 * @returns {{ rate:number, source:'non-corporate'|'no-category'|'custom_override'|'matrix'|'default' }}
 */
export function resolveRate({ customerType, discountGroup, customOverrides, productCategory, matrix }) {
  // 法人以外（個人）は割引対象外 → 正価
  if (customerType !== 'corporate') {
    return { rate: 1.0, source: 'non-corporate' };
  }
  // category 未設定の商品は正価（未登録カテゴリの挙動 — §7）
  if (!productCategory) {
    return { rate: 1.0, source: 'no-category' };
  }
  // ① 個別カスタム override が最優先
  if (customOverrides && Object.prototype.hasOwnProperty.call(customOverrides, productCategory)) {
    const r = normalizeRate(customOverrides[productCategory]);
    if (r != null) return { rate: r, source: 'custom_override' };
  }
  // ② グループ × 区分マトリクス
  if (discountGroup && Array.isArray(matrix)) {
    const entry = matrix.find((m) => m.group === discountGroup && m.category === productCategory);
    if (entry) {
      const r = normalizeRate(entry.discountRate);
      if (r != null) return { rate: r, source: 'matrix' };
    }
  }
  // ③ デフォルト正価
  return { rate: 1.0, source: 'default' };
}

/**
 * 1 line の卸価格と割引率を計算する。
 *   - unitPrice: draftOrderCreate の priceOverride に渡す卸単価
 *   - discountPercentage: フォールバック方式 appliedDiscount(PERCENTAGE) に渡す値
 * @param {object} args
 * @param {number} args.originalPrice  正価（通貨の主単位。例 JPY 5000）
 * @param {number} args.rate           掛け率 0<rate<=1
 * @param {string} [args.currency]     ISO通貨コード（既定 JPY）
 * @returns {{ unitPrice:number, discountPercentage:number, rate:number }}
 */
export function computeLinePricing({ originalPrice, rate, currency = 'JPY' }) {
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(String(currency).toUpperCase());
  const raw = originalPrice * rate;
  const unitPrice = zeroDecimal ? Math.round(raw) : Math.round(raw * 100) / 100;
  // 浮動小数誤差を抑えるため小数2桁で丸め（Shopify の percentage は小数可）
  const discountPercentage = Math.round((1 - rate) * 100 * 100) / 100;
  return { unitPrice, discountPercentage, rate };
}

/**
 * 割引率（整数%・古谷さん設計）→ 掛率へ変換。
 * 例: 30（=30%引き）→ 0.70。0 は「割引しない」の有効値として 1.0。
 * 負・100以上・非数は null（呼び出し側で正価 1.0 にフォールバック）。
 * 根拠: launch-plan/20（2026-08-04 仕様確定）・21 §5（異常時方針）。
 * @param {unknown} percent
 * @returns {number|null}
 */
export function percentToRate(percent) {
  const n = typeof percent === 'string' ? parseFloat(percent) : percent;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n === 0) return 1.0;
  if (n < 0 || n >= 100) return null;
  return (100 - n) / 100;
}

/**
 * 顧客区分 × 商品区分 の最終掛け率を解決する（古谷さん設計・2026-08-04 確定）。
 * 手順: 顧客の顧客区分（customerclass）を取得 → 区分の typeCustom を見る
 *   - false → 区分側の typeA/B/C（割引率%）を適用
 *   - true  → 顧客個別の custom.itemA/B/CdiscountRate を適用
 * 未設定・不正値は正価 1.0 にフォールバック。
 *
 * @param {object} args
 * @param {string} [args.customerType]  "corporate" | "individual"（b2b.customer_type。維持対象）
 * @param {Record<string, string>|null} [args.classFields]  customerclass の fields マップ（typeA/typeB/typeC/typeCustom。値は文字列）
 * @param {Record<string, string|number|undefined>} [args.customerOverrides]  {A,B,C}: 顧客個別の割引率%
 * @param {string} [args.itemType]  商品区分名 'A' | 'B' | 'C'（itemtype.name）
 * @returns {{ rate:number, source:'non-corporate'|'no-class'|'no-itemtype'|'class'|'customer_custom'|'invalid-fallback' }}
 */
export function resolveRateFurutani({ customerType, classFields, customerOverrides, itemType }) {
  if (customerType !== 'corporate') {
    return { rate: 1.0, source: 'non-corporate' };
  }
  if (!classFields) {
    return { rate: 1.0, source: 'no-class' };
  }
  if (!itemType) {
    return { rate: 1.0, source: 'no-itemtype' };
  }
  const isCustom = classFields.typeCustom === 'true' || /** @type {any} */ (classFields.typeCustom) === true;
  const percent = isCustom
    ? customerOverrides?.[itemType]
    : classFields[`type${itemType}`];
  const rate = percentToRate(percent);
  if (rate == null) {
    return { rate: 1.0, source: 'invalid-fallback' };
  }
  return { rate, source: isCustom ? 'customer_custom' : 'class' };
}

/**
 * discount_matrix Metaobject の生エントリ配列を resolveRate が使う形に正規化。
 * Admin API のレスポンス整形用ヘルパ（フィールド名の揺れを吸収）。
 * @param {Array<Record<string, any>>} rawEntries
 * @returns {Array<{group:string, category:string, discountRate:number}>}
 */
export function normalizeMatrix(rawEntries) {
  if (!Array.isArray(rawEntries)) return [];
  return rawEntries
    .map((e) => ({
      group: String(e.group ?? '').trim(),
      category: String(e.category ?? '').trim(),
      discountRate: normalizeRate(e.discount_rate ?? e.discountRate),
    }))
    .filter((e) => e.group && e.category && e.discountRate != null)
    // @ts-ignore discountRate は上の filter で number 確定
    ;
}
