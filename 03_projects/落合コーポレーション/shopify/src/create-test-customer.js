// @ts-check
/**
 * B2Bテスト用法人顧客を作成し、メタフィールドを設定する。
 * 実行: node --env-file=.env src/create-test-customer.js
 */
import { adminGraphQL } from './shopifyClient.js';

const TEST_CUSTOMER = {
  firstName: 'テスト',
  lastName: '法人太郎',
  email: 'b2b-test@example.com',
  metafields: [
    {
      namespace: 'b2b',
      key: 'customer_type',
      value: 'corporate',
      type: 'single_line_text_field',
    },
    {
      namespace: 'b2b',
      key: 'customer_code',
      value: 'OC-TEST-001',
      type: 'single_line_text_field',
    },
    {
      namespace: 'b2b',
      key: 'discount_group',
      value: 'A',
      type: 'single_line_text_field',
    },
  ],
};

const CREATE_CUSTOMER = `mutation customerCreate($input: CustomerInput!) {
  customerCreate(input: $input) {
    customer {
      id
      email
      firstName
      lastName
      metafields(first: 10) {
        edges {
          node { namespace key value }
        }
      }
    }
    userErrors { field message }
  }
}`;

async function run() {
  console.log('=== B2Bテスト顧客作成 ===\n');

  const result = await adminGraphQL(CREATE_CUSTOMER, { input: TEST_CUSTOMER });
  const errors = result.customerCreate.userErrors;

  if (errors && errors.length) {
    if (errors.some(e => e.message.includes('has already been taken'))) {
      console.log('[SKIP] メールアドレス b2b-test@example.com は既に登録済み');
      console.log('       既存顧客のメタフィールドを更新します...\n');
      await updateExistingCustomer();
      return;
    }
    console.error('[ERROR]', JSON.stringify(errors, null, 2));
    process.exit(1);
  }

  const c = result.customerCreate.customer;
  console.log(`[OK] 顧客作成完了`);
  console.log(`  ID: ${c.id}`);
  console.log(`  メール: ${c.email}`);
  console.log(`  名前: ${c.lastName} ${c.firstName}`);
  console.log(`  メタフィールド:`);
  for (const edge of c.metafields.edges) {
    const m = edge.node;
    console.log(`    ${m.namespace}.${m.key} = ${m.value}`);
  }
  // アカウント有効化URLを生成
  const activationResult = await adminGraphQL(
    `mutation($id: ID!) {
      customerGenerateAccountActivationUrl(customerId: $id) {
        accountActivationUrl
        userErrors { field message }
      }
    }`,
    { id: c.id }
  );
  const activationUrl = activationResult.customerGenerateAccountActivationUrl?.accountActivationUrl;
  if (activationUrl) {
    console.log(`\nアカウント有効化URL（ブラウザで開いてパスワード設定）:`);
    console.log(`  ${activationUrl}`);
  }
}

async function updateExistingCustomer() {
  const search = await adminGraphQL(`query {
    customers(first: 1, query: "email:b2b-test@example.com") {
      edges { node { id email } }
    }
  }`);

  const existing = search.customers.edges[0]?.node;
  if (!existing) {
    console.error('[ERROR] 顧客が見つかりません');
    process.exit(1);
  }

  const UPDATE = `mutation customerUpdate($input: CustomerInput!) {
    customerUpdate(input: $input) {
      customer {
        id
        metafields(first: 10) {
          edges { node { namespace key value } }
        }
      }
      userErrors { field message }
    }
  }`;

  const result = await adminGraphQL(UPDATE, {
    input: {
      id: existing.id,
      metafields: TEST_CUSTOMER.metafields,
    },
  });

  const errors = result.customerUpdate.userErrors;
  if (errors && errors.length) {
    console.error('[ERROR]', JSON.stringify(errors, null, 2));
    process.exit(1);
  }

  const c = result.customerUpdate.customer;
  console.log(`[OK] メタフィールド更新完了`);
  console.log(`  ID: ${c.id}`);
  for (const edge of c.metafields.edges) {
    const m = edge.node;
    console.log(`  ${m.namespace}.${m.key} = ${m.value}`);
  }
  // アカウント有効化URLを生成
  const activationResult2 = await adminGraphQL(
    `mutation($id: ID!) {
      customerGenerateAccountActivationUrl(customerId: $id) {
        accountActivationUrl
        userErrors { field message }
      }
    }`,
    { id: c.id }
  );
  const activationUrl2 = activationResult2.customerGenerateAccountActivationUrl?.accountActivationUrl;
  if (activationUrl2) {
    console.log(`\nアカウント有効化URL（ブラウザで開いてパスワード設定）:`);
    console.log(`  ${activationUrl2}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
