// @ts-check
/**
 * デモ用: テスト法人 corp-a に「取引先情報」metafield を投入する。
 *   実行: node --env-file=.env src/demo-setup.js
 *
 * 統合接続契約（session-prompts/integration-contract.md）で MF 請求書発行に必要な
 *   - b2b.corporate_name : 取引先名
 *   - b2b.payment_terms  : 支払区分（20th / eom / prepaid）
 * を補う。既存の b2b.customer_type / discount_group / custom_overrides には触れない。
 *
 * 注: b2b.mf_partner_id（MF取引先ID）は Track A が請求書発行後に書き戻す枠のため、
 *     ここでは投入しない（空文字 metafield は Shopify が拒否するため）。
 */
import { adminGraphQL } from './shopifyClient.js';

const CORP_A = 'gid://shopify/Customer/9665098318125'; // corp-a-test（scenarios.js より）

const SET = `mutation($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value }
    userErrors { field message }
  }
}`;

const metafields = [
  { ownerId: CORP_A, namespace: 'b2b', key: 'corporate_name', type: 'single_line_text_field', value: '株式会社サンプル商会' },
  { ownerId: CORP_A, namespace: 'b2b', key: 'payment_terms', type: 'single_line_text_field', value: '20th' },
];

const r = await adminGraphQL(SET, { metafields });
const e = r.metafieldsSet.userErrors;
if (e && e.length) {
  console.error('❌ userErrors:', JSON.stringify(e, null, 2));
  process.exit(1);
}
console.log('✅ corp-a に取引先情報 metafield を投入:');
for (const m of r.metafieldsSet.metafields) console.log(`   b2b.${m.key} = ${m.value}`);
