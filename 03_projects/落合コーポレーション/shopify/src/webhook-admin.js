// @ts-check
/**
 * orders/create Webhook 購読の管理 CLI（list / create / delete）。
 * 公開エンドポイント（Vercel 等）ができたら create で登録する。
 *
 *   node --env-file=.env src/webhook-admin.js list
 *   node --env-file=.env src/webhook-admin.js create https://<公開URL>/webhooks/orders-create
 *   node --env-file=.env src/webhook-admin.js delete gid://shopify/WebhookSubscription/xxxx
 *
 * 署名キーについて（重要）:
 *   API（カスタムアプリのトークン）で登録した Webhook の HMAC 署名キーは
 *   「そのカスタムアプリの API シークレットキー」（管理画面 > アプリ開発 > API資格情報）。
 *   これを webhook/.env の SHOPIFY_WEBHOOK_SECRET に設定すること。
 */
import { adminGraphQL } from './shopifyClient.js';

const [cmd, arg] = process.argv.slice(2);

async function list() {
  const d = await adminGraphQL(`{
    webhookSubscriptions(first: 50) {
      nodes {
        id topic createdAt
        endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } }
      }
    }
  }`);
  const nodes = d.webhookSubscriptions.nodes || [];
  if (!nodes.length) {
    console.log('（このアプリの Webhook 購読はありません）');
    return;
  }
  for (const n of nodes) {
    const url = n.endpoint?.callbackUrl || n.endpoint?.__typename || '-';
    console.log(`${n.topic}  ${url}\n  id=${n.id}  created=${n.createdAt}`);
  }
}

/** @param {string} url */
async function create(url) {
  if (!url || !url.startsWith('https://')) {
    throw new Error('callbackUrl は https:// で始まる公開URLが必要です（localhost・ストア独自ドメイン・Shopifyドメインは不可）。');
  }
  const d = await adminGraphQL(
    `mutation ($url: URL!) {
      webhookSubscriptionCreate(
        topic: ORDERS_CREATE
        webhookSubscription: { callbackUrl: $url, format: JSON }
      ) {
        webhookSubscription { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } }
        userErrors { field message }
      }
    }`,
    { url }
  );
  const r = d.webhookSubscriptionCreate;
  if (r.userErrors?.length) throw new Error('userErrors: ' + JSON.stringify(r.userErrors));
  console.log('✅ 登録しました:', r.webhookSubscription.topic, '→', r.webhookSubscription.endpoint.callbackUrl);
  console.log('   id =', r.webhookSubscription.id);
  console.log('   ⚠️ 署名キー: このアプリの「APIシークレットキー」を webhook/.env の SHOPIFY_WEBHOOK_SECRET に設定すること。');
}

/** @param {string} id */
async function remove(id) {
  if (!id) throw new Error('削除する WebhookSubscription の gid を指定してください（list で確認）。');
  const d = await adminGraphQL(
    `mutation ($id: ID!) {
      webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } }
    }`,
    { id }
  );
  const r = d.webhookSubscriptionDelete;
  if (r.userErrors?.length) throw new Error('userErrors: ' + JSON.stringify(r.userErrors));
  console.log('✅ 削除しました:', r.deletedWebhookSubscriptionId);
}

try {
  if (cmd === 'list') await list();
  else if (cmd === 'create') await create(arg);
  else if (cmd === 'delete') await remove(arg);
  else {
    console.log('使い方: node --env-file=.env src/webhook-admin.js <list|create <url>|delete <gid>>');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
