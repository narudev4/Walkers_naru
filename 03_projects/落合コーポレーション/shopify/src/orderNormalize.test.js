// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeliveryEmail, normalizeOrder } from './orderNormalize.js';

const DEMO_EMAIL = 'naru.hosoya+shopifydemo@walker-s.co.jp';

// ───────────────────────── resolveDeliveryEmail ─────────────────────────

test('resolveDeliveryEmail: empty string → demo email', () => {
  assert.equal(resolveDeliveryEmail(''), DEMO_EMAIL);
});

test('resolveDeliveryEmail: undefined → demo email', () => {
  assert.equal(resolveDeliveryEmail(undefined), DEMO_EMAIL);
});

test('resolveDeliveryEmail: example.com → demo email (dummy regex match)', () => {
  assert.equal(resolveDeliveryEmail('test@example.com'), DEMO_EMAIL);
});

test('resolveDeliveryEmail: .test TLD → demo email', () => {
  assert.equal(resolveDeliveryEmail('user@foo.test'), DEMO_EMAIL);
});

test('resolveDeliveryEmail: real .co.jp address → passes through', () => {
  assert.equal(resolveDeliveryEmail('real@company.co.jp'), 'real@company.co.jp');
});

test('resolveDeliveryEmail: whitespace-padded dummy → trimmed then matched → demo email', () => {
  assert.equal(resolveDeliveryEmail('  spaced@example.com  '), DEMO_EMAIL);
});

// ───────────────────────── normalizeOrder ─────────────────────────

/** GraphQL Order shape helper */
function makeOrder(overrides = {}) {
  return {
    id: 'gid://shopify/Order/123',
    name: '#1001',
    createdAt: '2026-06-01T00:00:00Z',
    email: 'order@example.com',
    customer: {
      id: 'gid://shopify/Customer/456',
      displayName: 'Taro Yamada',
      email: 'taro@company.co.jp',
      corporateName: { value: 'Ochiai Corp' },
      paymentTerms: { value: '20th' },
      mfPartnerId: { value: 'MF-001' },
    },
    lineItems: {
      nodes: [
        {
          title: 'Racket A',
          quantity: 2,
          originalUnitPriceSet: { shopMoney: { amount: '5000' } },
          discountedUnitPriceSet: { shopMoney: { amount: '3000' } },
        },
      ],
    },
    ...overrides,
  };
}

test('normalizeOrder: full order with all customer metafields', () => {
  const result = normalizeOrder(makeOrder());

  assert.equal(result.id, 'gid://shopify/Order/123');
  assert.equal(result.name, '#1001');
  assert.equal(result.ordered_at, '2026-06-01T00:00:00Z');
  assert.equal(result.payment_term, '20th');
  assert.equal(result.mf_partner_id, 'MF-001');
  assert.equal(result.customer.company, 'Ochiai Corp');
  assert.equal(result.customer.person_name, 'Taro Yamada');
  assert.equal(result.customer.email, 'taro@company.co.jp');
  assert.equal(result.line_items.length, 1);
  assert.equal(result.line_items[0].title, 'Racket A');
  assert.equal(result.line_items[0].quantity, 2);
  assert.equal(result.line_items[0].wholesale_unit_price, 3000);
  assert.equal(result.line_items[0].tax_rate, 'ten_percent');
  assert.equal(result.line_items[0].unit, '個');
});

test('normalizeOrder: missing customer metafields → graceful fallback', () => {
  const order = makeOrder({
    customer: {
      id: 'gid://shopify/Customer/789',
      displayName: 'Demo User',
      email: 'demo@example.com',
      corporateName: null,
      paymentTerms: null,
      mfPartnerId: null,
    },
  });
  const result = normalizeOrder(order);

  assert.equal(result.payment_term, null);
  assert.equal(result.mf_partner_id, null);
  assert.equal(result.customer.company, 'Demo User'); // fallback to displayName
  assert.equal(result.customer.email, DEMO_EMAIL);    // example.com → demo
});

test('normalizeOrder: line item uses discountedUnitPriceSet when present', () => {
  const result = normalizeOrder(makeOrder());
  assert.equal(result.line_items[0].wholesale_unit_price, 3000);
});

test('normalizeOrder: line item falls back to originalUnitPriceSet when discounted is missing', () => {
  const order = makeOrder({
    lineItems: {
      nodes: [
        {
          title: 'Wear B',
          quantity: 1,
          originalUnitPriceSet: { shopMoney: { amount: '8000' } },
          discountedUnitPriceSet: null,
        },
      ],
    },
  });
  const result = normalizeOrder(order);
  assert.equal(result.line_items[0].wholesale_unit_price, 8000);
  assert.equal(result.line_items[0].title, 'Wear B');
});

test('normalizeOrder: order name propagation', () => {
  const order = makeOrder({ name: '#2025' });
  const result = normalizeOrder(order);
  assert.equal(result.name, '#2025');
});
