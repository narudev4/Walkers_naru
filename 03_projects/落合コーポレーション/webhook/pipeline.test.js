// @ts-check
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// 1. IMMEDIATE_TERMS parsing (replicates the logic from pipeline.js L24-25)
// ---------------------------------------------------------------------------
describe('IMMEDIATE_TERMS parsing', () => {
  /** Replicates: (envValue).split(',').map(s => s.trim()).filter(Boolean) */
  const parse = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);

  test('default "prepaid,immediate" → ["prepaid","immediate"]', () => {
    assert.deepStrictEqual(parse('prepaid,immediate'), ['prepaid', 'immediate']);
  });

  test('empty string → []', () => {
    assert.deepStrictEqual(parse(''), []);
  });

  test('single value "prepaid" → ["prepaid"]', () => {
    assert.deepStrictEqual(parse('prepaid'), ['prepaid']);
  });

  test('whitespace around values is trimmed', () => {
    assert.deepStrictEqual(parse(' prepaid , immediate '), ['prepaid', 'immediate']);
  });

  test('trailing comma does not produce empty element', () => {
    assert.deepStrictEqual(parse('prepaid,'), ['prepaid']);
  });
});

// ---------------------------------------------------------------------------
// 2. Routing decision (inlines the isImmediate check from pipeline.js L94)
// ---------------------------------------------------------------------------
describe('Routing decision (isImmediate)', () => {
  const IMMEDIATE_TERMS = ['prepaid', 'immediate'];
  /** Replicates: IMMEDIATE_TERMS.includes(order.payment_term || '') */
  const isImmediate = (paymentTerm) => IMMEDIATE_TERMS.includes(paymentTerm || '');

  test('payment_term="prepaid" → immediate (true)', () => {
    assert.equal(isImmediate('prepaid'), true);
  });

  test('payment_term="immediate" → immediate (true)', () => {
    assert.equal(isImmediate('immediate'), true);
  });

  test('payment_term="20th" → NOT immediate (batch)', () => {
    assert.equal(isImmediate('20th'), false);
  });

  test('payment_term="eom" → NOT immediate (batch)', () => {
    assert.equal(isImmediate('eom'), false);
  });

  test('payment_term=null → NOT immediate', () => {
    assert.equal(isImmediate(null), false);
  });

  test('payment_term=undefined → NOT immediate', () => {
    assert.equal(isImmediate(undefined), false);
  });
});

// ---------------------------------------------------------------------------
// 3. Dedup Set pattern (replicates processed Set from pipeline.js L29-48)
// ---------------------------------------------------------------------------
describe('Dedup Set pattern', () => {
  test('has() returns true after add()', () => {
    const processed = new Set();
    processed.add('gid://shopify/Order/123');
    assert.equal(processed.has('gid://shopify/Order/123'), true);
  });

  test('has() returns false for unknown GID', () => {
    const processed = new Set();
    processed.add('gid://shopify/Order/123');
    assert.equal(processed.has('gid://shopify/Order/456'), false);
  });

  test('after delete(), has() returns false (retry-able)', () => {
    const processed = new Set();
    processed.add('gid://shopify/Order/123');
    processed.delete('gid://shopify/Order/123');
    assert.equal(processed.has('gid://shopify/Order/123'), false);
  });

  test('Set serialises to JSON array and round-trips', () => {
    const processed = new Set();
    processed.add('gid://shopify/Order/111');
    processed.add('gid://shopify/Order/222');
    const json = JSON.stringify([...processed]);
    const restored = new Set(JSON.parse(json));
    assert.equal(restored.has('gid://shopify/Order/111'), true);
    assert.equal(restored.has('gid://shopify/Order/222'), true);
    assert.equal(restored.size, 2);
  });
});

// ---------------------------------------------------------------------------
// 4. HMAC verification pattern (Shopify webhook signature check)
// ---------------------------------------------------------------------------
describe('HMAC verification', () => {
  const SECRET = 'test-webhook-secret';

  /** Replicates standard Shopify HMAC verification used in server.js */
  function verifyHmac(body, headerValue, secret) {
    if (!headerValue) return false;
    const digest = createHmac('sha256', secret).update(body, 'utf8').digest();
    const supplied = Buffer.from(headerValue, 'base64');
    if (digest.length !== supplied.length) return false;
    return timingSafeEqual(digest, supplied);
  }

  test('correct HMAC → verification passes', () => {
    const body = '{"order_id":123}';
    const hmac = createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');
    assert.equal(verifyHmac(body, hmac, SECRET), true);
  });

  test('wrong HMAC → verification fails', () => {
    const body = '{"order_id":123}';
    const wrongHmac = createHmac('sha256', 'wrong-secret').update(body, 'utf8').digest('base64');
    assert.equal(verifyHmac(body, wrongHmac, SECRET), false);
  });

  test('missing HMAC header → verification fails', () => {
    const body = '{"order_id":123}';
    assert.equal(verifyHmac(body, undefined, SECRET), false);
    assert.equal(verifyHmac(body, '', SECRET), false);
  });

  test('tampered body → verification fails', () => {
    const body = '{"order_id":123}';
    const hmac = createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');
    assert.equal(verifyHmac('{"order_id":999}', hmac, SECRET), false);
  });
});
