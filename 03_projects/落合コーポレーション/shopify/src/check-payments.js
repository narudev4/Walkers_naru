// @ts-check
/** ストアの決済方法（特に Manual Payment＝銀行振込）が有効か確認。実行: node --env-file=.env src/check-payments.js */
const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const V = process.env.SHOPIFY_API_VERSION || '2025-10';

const r = await fetch(`https://${DOMAIN}/admin/api/${V}/payment_gateways.json`, {
  headers: { 'X-Shopify-Access-Token': TOKEN || '' },
});
const text = await r.text();
console.log('HTTP', r.status);
try {
  const j = JSON.parse(text);
  const gws = j.payment_gateways || [];
  if (!gws.length) {
    console.log('決済方法: 0件（Manual Payment 未設定の可能性 → admin「設定>決済>手動の決済方法」で追加が必要）');
  }
  for (const g of gws) {
    console.log(`- ${g.name} | enabled=${g.enabled} | type=${g.provider_type || g.type || '?'}`);
  }
} catch {
  console.log('（payment_gateways API はこのトークンのスコープ外の可能性）:', text.slice(0, 300));
}
