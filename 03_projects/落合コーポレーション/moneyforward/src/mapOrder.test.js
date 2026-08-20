// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  pruneEmpty,
  toDate,
  addDays,
  buildPartnerRequest,
  buildDepartmentRequest,
  buildBillingRequest,
} from './mapOrder.js';

// ── pruneEmpty ──────────────────────────────────────────────
describe('pruneEmpty', () => {
  test('null / undefined / empty string are removed', () => {
    assert.deepStrictEqual(
      pruneEmpty({ a: 'x', b: null, c: '', d: undefined }),
      { a: 'x' },
    );
  });

  test('0 and false are kept', () => {
    assert.deepStrictEqual(
      pruneEmpty({ a: 0, b: false }),
      { a: 0, b: false },
    );
  });
});

// ── toDate ──────────────────────────────────────────────────
describe('toDate', () => {
  test('ISO datetime with offset → YYYY-MM-DD', () => {
    assert.equal(toDate('2026-06-18T12:00:00+09:00'), '2026-06-18');
  });

  test('plain date string passes through', () => {
    assert.equal(toDate('2026-01-01'), '2026-01-01');
  });

  test('undefined → undefined', () => {
    assert.equal(toDate(undefined), undefined);
  });
});

// ── addDays ─────────────────────────────────────────────────
describe('addDays', () => {
  test('+30 days', () => {
    assert.equal(addDays('2026-06-18', 30), '2026-07-18');
  });

  test('month boundary: Jan 30 + 2 → Feb 01', () => {
    assert.equal(addDays('2026-01-30', 2), '2026-02-01');
  });

  test('year boundary: Dec 30 + 3 → next year Jan 02', () => {
    assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  });

  test('undefined dateStr → undefined', () => {
    assert.equal(addDays(undefined, 5), undefined);
  });
});

// ── buildPartnerRequest ─────────────────────────────────────
describe('buildPartnerRequest', () => {
  test('order with company → name=company, name_suffix=御中, departments populated', () => {
    const order = {
      customer: {
        company: '落合コーポレーション',
        person_name: '落合太郎',
        email: 'test@example.com',
        zip: '100-0001',
        tel: '03-1234-5678',
        prefecture: '東京都',
        address1: '千代田区1-1',
      },
    };
    const result = buildPartnerRequest(order);
    assert.equal(result.name, '落合コーポレーション');
    assert.equal(result.name_suffix, '御中');
    assert.ok(Array.isArray(result.departments));
    assert.equal(result.departments.length, 1);
    assert.equal(result.departments[0].person_name, '落合太郎');
    assert.equal(result.departments[0].email, 'test@example.com');
  });

  test('minimal customer (person_name only) → name=person_name', () => {
    const order = {
      customer: { person_name: '山田花子' },
    };
    const result = buildPartnerRequest(order);
    assert.equal(result.name, '山田花子');
    assert.equal(result.name_suffix, '御中');
    assert.ok(Array.isArray(result.departments));
    assert.equal(result.departments[0].person_name, '山田花子');
  });
});

// ── buildDepartmentRequest ──────────────────────────────────
describe('buildDepartmentRequest', () => {
  test('empty customer → fallback person_dept=ご担当者', () => {
    const result = buildDepartmentRequest({ customer: {} });
    assert.equal(result.person_dept, 'ご担当者');
  });

  test('customer with fields → those fields returned', () => {
    const order = { customer: { person_name: '佐藤', tel: '090-0000-0000' } };
    const result = buildDepartmentRequest(order);
    assert.equal(result.person_name, '佐藤');
    assert.equal(result.tel, '090-0000-0000');
  });
});

// ── buildBillingRequest ─────────────────────────────────────
describe('buildBillingRequest', () => {
  const baseOrder = {
    name: '#1004',
    ordered_at: '2026-06-01T10:00:00+09:00',
    fulfilled_at: '2026-06-05T15:00:00+09:00',
    line_items: [
      {
        title: 'テスト商品A',
        unit: '個',
        wholesale_unit_price: 1500,
        quantity: 10,
        tax_rate: 'ten_percent',
      },
      {
        title: 'テスト商品B',
        wholesale_unit_price: 800,
        quantity: 5,
      },
    ],
  };

  test('full order → items mapped with price, quantity, excise', () => {
    const result = buildBillingRequest(baseOrder, 'dept-001');
    assert.equal(result.department_id, 'dept-001');
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].name, 'テスト商品A');
    assert.equal(result.items[0].price, 1500);
    assert.equal(result.items[0].quantity, 10);
    assert.equal(result.items[0].excise, 'ten_percent');
    // item without explicit tax_rate → defaults to ten_percent
    assert.equal(result.items[1].excise, 'ten_percent');
  });

  test('default due_date: billing_date + 30 days', () => {
    const result = buildBillingRequest(baseOrder, 'dept-001');
    // billing_date = fulfilled_at = 2026-06-05
    assert.equal(result.billing_date, '2026-06-05');
    // due_date = 2026-06-05 + 30 = 2026-07-05
    assert.equal(result.due_date, '2026-07-05');
  });

  test('custom payment_term_days → billing_date + N days', () => {
    const order = { ...baseOrder, payment_term_days: 60 };
    const result = buildBillingRequest(order, 'dept-001');
    // due_date = 2026-06-05 + 60 = 2026-08-04
    assert.equal(result.due_date, '2026-08-04');
  });

  test('sales_date = ordered_at (決定3)', () => {
    const result = buildBillingRequest(baseOrder, 'dept-001');
    assert.equal(result.sales_date, '2026-06-01');
  });

  test('title defaults to "ご注文 #1004" format', () => {
    const result = buildBillingRequest(baseOrder, 'dept-001');
    assert.equal(result.title, 'ご注文 #1004');
  });

  test('explicit title overrides default', () => {
    const order = { ...baseOrder, title: '6月分まとめ請求' };
    const result = buildBillingRequest(order, 'dept-001');
    assert.equal(result.title, '6月分まとめ請求');
  });
});
