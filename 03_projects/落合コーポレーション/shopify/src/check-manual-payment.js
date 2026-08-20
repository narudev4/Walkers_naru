// @ts-check
/**
 * B2B用 Manual Payment（銀行振込・請求書払い）の有効状態を確認。
 * Admin REST API (payment_gateways) + GraphQL (shop.paymentSettings) の両方で照合。
 * 実行: node --env-file=.env src/check-manual-payment.js
 */
import { adminGraphQL } from './shopifyClient.js';

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';

// --- 1. REST API: payment_gateways ---
async function checkRestPaymentGateways() {
  console.log('--- 1. REST API: payment_gateways ---');
  const url = `https://${DOMAIN}/admin/api/${VERSION}/payment_gateways.json`;
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': TOKEN || '' },
  });
  const text = await res.text();

  if (!res.ok) {
    console.log(`  HTTP ${res.status} — スコープ不足の可能性: ${text.slice(0, 300)}`);
    return [];
  }

  try {
    const json = JSON.parse(text);
    const gateways = json.payment_gateways || [];

    if (!gateways.length) {
      console.log('  決済方法: 0件');
      return [];
    }

    const manual = [];
    for (const g of gateways) {
      const isManual = g.type === 'ManualPaymentGateway' || g.provider_type === 'manual';
      const tag = isManual ? '[MANUAL]' : '[AUTO]  ';
      console.log(`  ${tag} ${g.name} | enabled=${g.enabled} | id=${g.id}`);
      if (isManual) manual.push(g);
    }
    return manual;
  } catch {
    console.log(`  パース失敗: ${text.slice(0, 300)}`);
    return [];
  }
}

// --- 2. GraphQL: shop paymentSettings ---
async function checkGraphQLPaymentSettings() {
  console.log('\n--- 2. GraphQL: shop.paymentSettings ---');
  const query = `{
    shop {
      paymentSettings {
        supportedDigitalWallets
      }
    }
  }`;

  try {
    const data = await adminGraphQL(query);
    const ps = data.shop.paymentSettings;
    console.log(`  supportedDigitalWallets: ${JSON.stringify(ps.supportedDigitalWallets)}`);
  } catch (e) {
    console.log(`  取得失敗（スコープ不足の可能性）: ${e.message.slice(0, 200)}`);
  }
}

// --- 実行 ---
async function run() {
  console.log('=== Manual Payment 確認 ===\n');

  const manualGateways = await checkRestPaymentGateways();
  await checkGraphQLPaymentSettings();

  // サマリ
  console.log('\n--- サマリ ---');
  if (manualGateways.length > 0) {
    console.log(`Manual Payment: ${manualGateways.length} 件有効`);
    for (const g of manualGateways) {
      console.log(`  - ${g.name} (enabled=${g.enabled})`);
    }
  } else {
    console.log('Manual Payment: 未検出');
    console.log('  → Shopify管理画面「設定 > 決済 > 手動の決済方法」で「銀行振込」を追加してください。');
    console.log('  → B2B注文で請求書払い（NET30等）を使うには Payment Terms の設定も必要です。');
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
