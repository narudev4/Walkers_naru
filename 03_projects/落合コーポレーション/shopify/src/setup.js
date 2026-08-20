// @ts-check
/**
 * データモデル投入（Phase 4）。実行: node --env-file=.env src/setup.js
 *   1. discount_matrix Metaobject 定義（group/category/discount_rate）
 *   2. マトリクス4エントリ（A/racket=0.60, A/wear=0.70, B/racket=0.70, B/wear=0.80）
 *   3. 既存商品3点に b2b.category 付与
 *   4. テスト顧客4件 + b2b metafields
 * 冪等性は緩め（再実行時は重複を警告スキップ）。検証用の初回投入を想定。
 */
import { adminGraphQL } from './shopifyClient.js';

// probe で確認した商品ID → category
const PRODUCT_CATEGORY = {
  'gid://shopify/Product/10234681393453': 'ball', // ELITE TOP シャトルコック
  'gid://shopify/Product/10234685817133': 'racket', // KAWASAKI ラケット
  'gid://shopify/Product/10234688536877': 'wear', // THOMAS CUP ゲームシャツ
};

const MATRIX = [
  { group: 'A', category: 'racket', discount_rate: '0.60' },
  { group: 'A', category: 'wear', discount_rate: '0.70' },
  { group: 'B', category: 'racket', discount_rate: '0.70' },
  { group: 'B', category: 'wear', discount_rate: '0.80' },
];

const CUSTOMERS = [
  { email: 'corp-a-test@example.com', firstName: 'Corp', lastName: 'A', meta: { customer_type: 'corporate', discount_group: 'A' } },
  { email: 'corp-b-test@example.com', firstName: 'Corp', lastName: 'B', meta: { customer_type: 'corporate', discount_group: 'B' } },
  { email: 'corp-custom-test@example.com', firstName: 'Corp', lastName: 'Custom', meta: { customer_type: 'corporate', discount_group: 'A', custom_overrides: JSON.stringify({ racket: 0.5 }) } },
  { email: 'individual-test@example.com', firstName: 'Individual', lastName: 'Test', meta: { customer_type: 'individual' } },
];

async function step1_definition() {
  const M = `mutation($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition { id type }
      userErrors { field message code }
    }
  }`;
  const definition = {
    type: 'discount_matrix',
    name: 'Discount Matrix',
    fieldDefinitions: [
      { key: 'group', name: 'Group', type: 'single_line_text_field' },
      { key: 'category', name: 'Category', type: 'single_line_text_field' },
      { key: 'discount_rate', name: 'Discount Rate', type: 'number_decimal' },
    ],
  };
  const r = await adminGraphQL(M, { definition });
  const e = r.metaobjectDefinitionCreate.userErrors;
  if (e && e.length) {
    if (e.some((x) => x.code === 'TAKEN' || /taken|exist/i.test(x.message))) {
      console.log('  discount_matrix 定義: 既存（スキップ）');
      return;
    }
    throw new Error('定義作成エラー: ' + JSON.stringify(e));
  }
  console.log('  discount_matrix 定義: 作成 OK');
}

async function step2_entries() {
  const M = `mutation($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message code }
    }
  }`;
  for (const row of MATRIX) {
    const metaobject = {
      type: 'discount_matrix',
      fields: [
        { key: 'group', value: row.group },
        { key: 'category', value: row.category },
        { key: 'discount_rate', value: row.discount_rate },
      ],
    };
    const r = await adminGraphQL(M, { metaobject });
    const e = r.metaobjectCreate.userErrors;
    if (e && e.length) console.warn(`  entry ${row.group}/${row.category}: 警告 ${JSON.stringify(e)}`);
    else console.log(`  entry ${row.group}/${row.category}=${row.discount_rate}: ${r.metaobjectCreate.metaobject.handle}`);
  }
}

async function step3_productCategories() {
  const M = `mutation($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key value ownerType }
      userErrors { field message }
    }
  }`;
  const metafields = Object.entries(PRODUCT_CATEGORY).map(([ownerId, value]) => ({
    ownerId, namespace: 'b2b', key: 'category', type: 'single_line_text_field', value,
  }));
  const r = await adminGraphQL(M, { metafields });
  const e = r.metafieldsSet.userErrors;
  if (e && e.length) console.warn('  商品 category: 警告 ' + JSON.stringify(e));
  else console.log(`  商品 category 設定: ${r.metafieldsSet.metafields.length} 件`);
}

async function step4_customers() {
  const CREATE = `mutation($input: CustomerInput!) {
    customerCreate(input: $input) { customer { id email } userErrors { field message } }
  }`;
  const SET = `mutation($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { id key } userErrors { field message } }
  }`;
  const created = [];
  for (const c of CUSTOMERS) {
    const r = await adminGraphQL(CREATE, { input: { firstName: c.firstName, lastName: c.lastName, email: c.email } });
    const e = r.customerCreate.userErrors;
    if (e && e.length) { console.warn(`  customer ${c.email}: 警告 ${JSON.stringify(e)}（既存の可能性）`); continue; }
    const id = r.customerCreate.customer.id;
    const metafields = Object.entries(c.meta).map(([key, value]) => ({
      ownerId: id, namespace: 'b2b', key,
      type: key === 'custom_overrides' ? 'json' : 'single_line_text_field',
      value: String(value),
    }));
    const sr = await adminGraphQL(SET, { metafields });
    const se = sr.metafieldsSet.userErrors;
    if (se && se.length) console.warn(`  customer ${c.email} metafields: ${JSON.stringify(se)}`);
    console.log(`  customer ${c.email}: ${id}  +${metafields.length} metafields`);
    created.push({ email: c.email, id });
  }
  return created;
}

console.log('--- 1. Metaobject 定義 ---'); await step1_definition();
console.log('--- 2. Matrix エントリ ---'); await step2_entries();
console.log('--- 3. 商品 category ---'); await step3_productCategories();
console.log('--- 4. テスト顧客 ---'); const customers = await step4_customers();
console.log('\nセットアップ完了。テスト顧客ID:');
for (const c of customers) console.log(`  ${c.email}  ${c.id}`);
