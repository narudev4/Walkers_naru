// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRate, computeLinePricing, normalizeRate, normalizeMatrix, resolveRateFurutani, percentToRate } from './discountEngine.js';

/** discount-system.md §6 のテスト用マトリクス */
const matrix = [
  { group: 'A', category: 'racket', discountRate: 0.60 },
  { group: 'A', category: 'wear', discountRate: 0.70 },
  { group: 'B', category: 'racket', discountRate: 0.70 },
  { group: 'B', category: 'wear', discountRate: 0.80 },
];

// ───────────────────────── §6 テストシナリオ（5パターン） ─────────────────────────

test('§6-1 corp-a × racket → rate 0.60 (matrix)', () => {
  const { rate, source } = resolveRate({ customerType: 'corporate', discountGroup: 'A', productCategory: 'racket', matrix });
  assert.equal(rate, 0.60);
  assert.equal(source, 'matrix');
});

test('§6-2 corp-a × wear → rate 0.70 (matrix)', () => {
  const { rate } = resolveRate({ customerType: 'corporate', discountGroup: 'A', productCategory: 'wear', matrix });
  assert.equal(rate, 0.70);
});

test('§6-3 corp-b × racket → rate 0.70 (matrix, グループで差が出る)', () => {
  const { rate } = resolveRate({ customerType: 'corporate', discountGroup: 'B', productCategory: 'racket', matrix });
  assert.equal(rate, 0.70);
});

test('§6-4 corp-custom × racket → rate 0.50 (custom_override がグループより優先)', () => {
  const { rate, source } = resolveRate({
    customerType: 'corporate', discountGroup: 'A',
    customOverrides: { racket: 0.50 }, productCategory: 'racket', matrix,
  });
  assert.equal(rate, 0.50);
  assert.equal(source, 'custom_override');
});

test('§6-5 individual × racket → rate 1.0 (法人以外は割引なし)', () => {
  const { rate, source } = resolveRate({ customerType: 'individual', discountGroup: 'A', productCategory: 'racket', matrix });
  assert.equal(rate, 1.0);
  assert.equal(source, 'non-corporate');
});

// ───────────────────────── §7 別途検証する点 ─────────────────────────

test('§7 未登録カテゴリ（matrix に無い category）→ rate 1.0', () => {
  const { rate, source } = resolveRate({ customerType: 'corporate', discountGroup: 'A', productCategory: 'shoes', matrix });
  assert.equal(rate, 1.0);
  assert.equal(source, 'default');
});

test('§7 category 未設定の商品 → rate 1.0', () => {
  const { rate, source } = resolveRate({ customerType: 'corporate', discountGroup: 'A', productCategory: undefined, matrix });
  assert.equal(rate, 1.0);
  assert.equal(source, 'no-category');
});

test('§7【核心】新カテゴリ追加で再開発不要: matrix に shoes 行を足すだけで即反映（コード無変更）', () => {
  // コードは一切変更せず、データ（matrix）に1行足すだけ
  const extended = [...matrix, { group: 'A', category: 'shoes', discountRate: 0.65 }];
  const { rate, source } = resolveRate({ customerType: 'corporate', discountGroup: 'A', productCategory: 'shoes', matrix: extended });
  assert.equal(rate, 0.65);
  assert.equal(source, 'matrix');
});

test('§7 新グループ追加も同様にデータ追加だけ（group C を足す）', () => {
  const extended = [...matrix, { group: 'C', category: 'racket', discountRate: 0.85 }];
  const { rate } = resolveRate({ customerType: 'corporate', discountGroup: 'C', productCategory: 'racket', matrix: extended });
  assert.equal(rate, 0.85);
});

// ───────────────────────── 不正値・堅牢性 ─────────────────────────

test('不正レート（0以下・1超・非数）は無効 → 正価フォールバック', () => {
  assert.equal(normalizeRate(0), null);
  assert.equal(normalizeRate(-0.1), null);
  assert.equal(normalizeRate(1.5), null);
  assert.equal(normalizeRate('abc'), null);
  assert.equal(normalizeRate(0.6), 0.6);
  assert.equal(normalizeRate('0.6'), 0.6); // Metafield 文字列
  // matrix のレートが壊れていてもクラッシュせず正価に
  const broken = [{ group: 'A', category: 'racket', discountRate: 9 }];
  const { rate, source } = resolveRate({ customerType: 'corporate', discountGroup: 'A', productCategory: 'racket', matrix: broken });
  assert.equal(rate, 1.0);
  assert.equal(source, 'default');
});

test('override が壊れていればグループのマトリクスにフォールバック', () => {
  const { rate, source } = resolveRate({
    customerType: 'corporate', discountGroup: 'A',
    customOverrides: { racket: 5 }, // 不正値
    productCategory: 'racket', matrix,
  });
  assert.equal(rate, 0.60); // override は無効なので matrix の 0.60
  assert.equal(source, 'matrix');
});

// ───────────────────────── 価格計算 ─────────────────────────

test('computeLinePricing JPY は整数丸め', () => {
  const r = computeLinePricing({ originalPrice: 5000, rate: 0.60, currency: 'JPY' });
  assert.equal(r.unitPrice, 3000);
  assert.equal(r.discountPercentage, 40);
});

test('computeLinePricing JPY 端数は四捨五入', () => {
  const r = computeLinePricing({ originalPrice: 3333, rate: 0.70, currency: 'JPY' });
  assert.equal(r.unitPrice, 2333); // 3333*0.7=2333.1 → 2333
  assert.equal(r.discountPercentage, 30);
});

test('computeLinePricing USD は小数2桁', () => {
  const r = computeLinePricing({ originalPrice: 50, rate: 0.55, currency: 'USD' });
  assert.equal(r.unitPrice, 27.5);
  assert.equal(r.discountPercentage, 45);
});

// ───────────────────────── normalizeMatrix（Admin API レスポンス整形） ─────────────────────────

test('normalizeMatrix は discount_rate(snake) と文字列値を吸収し不正行を除去', () => {
  const raw = [
    { group: 'A', category: 'racket', discount_rate: '0.6' },
    { group: 'A', category: 'wear', discount_rate: 0.7 },
    { group: '', category: 'shoes', discount_rate: 0.5 },   // group 欠落 → 除去
    { group: 'B', category: 'racket', discount_rate: 'x' }, // 不正レート → 除去
  ];
  const norm = normalizeMatrix(raw);
  assert.equal(norm.length, 2);
  assert.deepEqual(norm[0], { group: 'A', category: 'racket', discountRate: 0.6 });
  assert.deepEqual(norm[1], { group: 'A', category: 'wear', discountRate: 0.7 });
});

// ──────────── 古谷さん設計（2026-08-04 確定・launch-plan/20）resolveRateFurutani ────────────
// 実機の customerclass 実データ（2026-08-05 実測・launch-plan/21）を模したフィクスチャ

const classA = { name: '顧客区分A', typeA: '30', typeB: '20', typeC: '10', typeCustom: 'false' };
const classC = { name: '顧客区分C', typeA: '10', typeB: '5', typeC: '2', typeCustom: 'false' };
const classCustom = { name: '顧客区分カスタム', typeA: null, typeB: null, typeC: null, typeCustom: 'true' };

test('F-1 区分A × 商品区分A → 30%引き = 掛率0.70（区分値を適用）', () => {
  const { rate, source } = resolveRateFurutani({ customerType: 'corporate', classFields: classA, itemType: 'A' });
  assert.equal(rate, 0.70);
  assert.equal(source, 'class');
});

test('F-2 区分C × 商品区分C → 2%引き = 掛率0.98', () => {
  const { rate } = resolveRateFurutani({ customerType: 'corporate', classFields: classC, itemType: 'C' });
  assert.equal(rate, 0.98);
});

test('F-3 区分C の顧客に個別値が残っていても無視される（8/4 古谷さん明言）', () => {
  const { rate, source } = resolveRateFurutani({
    customerType: 'corporate', classFields: classC,
    customerOverrides: { A: '90', B: '50', C: '40' }, itemType: 'A',
  });
  assert.equal(rate, 0.90); // classC.typeA=10%引き。個別値90は参照されない
  assert.equal(source, 'class');
});

test('F-4 カスタム区分 → 顧客個別値を適用', () => {
  const { rate, source } = resolveRateFurutani({
    customerType: 'corporate', classFields: classCustom,
    customerOverrides: { A: '25' }, itemType: 'A',
  });
  assert.equal(rate, 0.75);
  assert.equal(source, 'customer_custom');
});

test('F-5 カスタム区分で個別値が未入力 → 正価フォールバック', () => {
  const { rate, source } = resolveRateFurutani({
    customerType: 'corporate', classFields: classCustom,
    customerOverrides: {}, itemType: 'B',
  });
  assert.equal(rate, 1.0);
  assert.equal(source, 'invalid-fallback');
});

test('F-6 顧客区分未設定 → 正価', () => {
  const { rate, source } = resolveRateFurutani({ customerType: 'corporate', classFields: null, itemType: 'A' });
  assert.equal(rate, 1.0);
  assert.equal(source, 'no-class');
});

test('F-7 商品区分未設定 → 正価', () => {
  const { rate, source } = resolveRateFurutani({ customerType: 'corporate', classFields: classA, itemType: '' });
  assert.equal(rate, 1.0);
  assert.equal(source, 'no-itemtype');
});

test('F-8 一般のお客様（非法人）→ 正価', () => {
  const { rate, source } = resolveRateFurutani({ customerType: 'individual', classFields: classA, itemType: 'A' });
  assert.equal(rate, 1.0);
  assert.equal(source, 'non-corporate');
});

test('F-9 percentToRate: 0%は有効（正価）・100%以上と負と非数は無効', () => {
  assert.equal(percentToRate(0), 1.0);
  assert.equal(percentToRate('0'), 1.0);
  assert.equal(percentToRate(30), 0.70);
  assert.equal(percentToRate('30'), 0.70);
  assert.equal(percentToRate(100), null);
  assert.equal(percentToRate(120), null);
  assert.equal(percentToRate(-5), null);
  assert.equal(percentToRate('abc'), null);
  assert.equal(percentToRate(null), null);
  assert.equal(percentToRate(undefined), null);
});

test('F-10 不正値（100%）は区分値でも正価フォールバック', () => {
  const broken = { ...classA, typeA: '100' };
  const { rate, source } = resolveRateFurutani({ customerType: 'corporate', classFields: broken, itemType: 'A' });
  assert.equal(rate, 1.0);
  assert.equal(source, 'invalid-fallback');
});
