// @ts-check
/**
 * ポーリング版の入口: 新しい注文を検知したら pipeline.js に流す（公開URL不要のローカル全自動）。
 * Webhook（server.js）と完全に同じ処理を通る。本番は Webhook、ローカル体験はこちら。
 *
 *   起動（webhook/ で）: npm run watch
 *     = node --env-file=../shopify/.env --env-file=../moneyforward/.env --env-file=.env watch.js
 *
 * 体験フロー: これを起動 → デモストアで購入 → 検知 → MF請求書作成 →
 *             （③都度払い & SEND_MODE=browser なら）MFから自動送信 → メール着信。
 */
import { createServer } from 'node:net';
import { adminGraphQL } from '../shopify/src/shopifyClient.js';
import { processOrderGid, isProcessed, logEvent, SEND_MODE, IMMEDIATE_TERMS, EVENTS_LOG_PATH } from './pipeline.js';

const INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS || 5000);

// 多重起動防止ロック: 2プロセスが同時に動くと同じ注文の二重処理・MFトークンの同時リフレッシュ
// （invalid_grant）を引き起こすため、ローカルポートの占有で単一インスタンスを保証する。
const LOCK_PORT = Number(process.env.WATCH_LOCK_PORT || 8790);
await new Promise((resolveP, rejectP) => {
  const lock = createServer();
  lock.once('error', (/** @type {any} */ e) => {
    if (e && e.code === 'EADDRINUSE') {
      console.error(`❌ 別の watch.js が既に動いています（多重起動防止ロック :${LOCK_PORT}）。先にそちらを停止してください。`);
      process.exit(1);
    }
    rejectP(e);
  });
  lock.listen(LOCK_PORT, '127.0.0.1', () => resolveP(undefined));
});

async function latestOrder() {
  const d = await adminGraphQL(`{
    orders(first: 1, reverse: true, sortKey: CREATED_AT) { nodes { id name } }
  }`);
  return (d.orders.nodes || [])[0] || null;
}

let baseline = await latestOrder();
console.log('👀 注文の監視を開始しました（pipeline 共通版）。');
console.log(`   現在の最新注文: ${baseline?.name || '(なし)'} ← これ以降の新規注文だけ処理します`);
console.log(`   SEND_MODE=${SEND_MODE} / ③判定値=[${IMMEDIATE_TERMS.join(', ')}] / 間隔=${INTERVAL_MS}ms`);
console.log(`   ログ: ${EVENTS_LOG_PATH}`);
console.log('   → デモストアで購入すると、ここから請求書の作成（③なら送信まで）が自動で走ります。Ctrl+C で停止。\n');

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    const cur = await latestOrder();
    if (cur && cur.id !== baseline?.id && !isProcessed(cur.id)) {
      baseline = cur;
      console.log(`\n🛒 新しい注文を検知: ${cur.name} → パイプライン実行\n`);
      await processOrderGid(cur.id);
      console.log('\n— 次の購入を待っています...\n');
    } else {
      baseline = cur || baseline;
    }
  } catch (e) {
    logEvent({ step: 'error', source: 'watch', error: e instanceof Error ? e.message : String(e) });
  } finally {
    busy = false;
  }
}, INTERVAL_MS);
