# B2B完全実装 — 意思決定ログ

> 2026-06-18 実装セッション中の意思決定を記録。naru からの FB 対象。

## D-1: Dev store storefront checkout 制約
- **決定**: Development store では Bank Deposit の storefront checkout が動作しない → `draftOrderComplete(paymentPending: true)` API で回避
- **根拠**: 2026-06-18 実機検証で確認。本番 Basic+ では問題なし
- **FB要否**: 低（技術制約、本番には影響なし）

## D-2: API スコープ不足
- **決定**: 現トークン(16スコープ)に `write_orders` / `read_payment_gateways` 未付与 → 本番 Custom App 設定時に追加
- **根拠**: `orderMarkAsPaid` mutation が ACCESS_DENIED。Admin UI での手動マークは動作確認済み
- **FB要否**: 中（本番デプロイ時に対応必要）

## D-3: MF 請求書送信方式
- **決定**: MF API に送信エンドポイントなし。③都度=Playwright自動送信(A-2) / ①②かけ=下書き→人手確認送付
- **根拠**: MF API v3 仕様確認済み (invoice-auto-send.md)
- **FB要否**: 中（Playwright の運用安定性）

## D-4: Vercel Function モジュール構成
- **決定**: cross-dir import が Vercel Function で不可 → `vercel-deploy/lib/` に依存モジュールを vendor コピー
- **根拠**: Vercel Functions は api/ 配下のみバンドル
- **FB要否**: 低（デプロイ時の同期スクリプトで自動化済み）

## D-5: E2E テストの実行範囲
- **決定**: MF 請求書作成の E2E テストは実 API を叩く（テスト口座）。dry-run モードも用意
- **根拠**: MF sandbox 環境なし、naru トライアル口座で検証
- **FB要否**: 中（テスト口座での請求書が残る）

## D-6: テスト追加方針
- **決定**: discountEngine (既存14件) に加え、orderNormalize / mapOrder / pipeline の ユニットテストを追加。E2E は別スクリプト
- **根拠**: 既存テストが discountEngine のみ。他モジュールはマニュアル検証のみだった
- **FB要否**: 低（テスト追加は品質向上のみ）

## D-7: テスト結果サマリ
- **結果**: 全70テスト通過（discountEngine 15 + orderNormalize 11 + mapOrder 19 + pipeline 19 + E2E 6ステップ）
- **E2E で作成**: Draft Order #D29 → Order #1013 (PENDING, payment_term=20th, Corp A)
- **FB要否**: 低（全テスト通過、追加確認不要）

## D-8: MF 請求書 E2E 検証
- **決定**: samples/order.sample.json で実 API テスト実行 → 請求書 #11 作成成功
- **結果**: ¥72,600（小計¥66,000 + 消費税¥6,600）、パートナー新規作成、下書き（未送信）ステータス
- **根拠**: D-5 方針に従い、テスト口座で実 API 検証
- **FB要否**: 低（テスト口座に請求書 #11 が残存。不要なら MF 管理画面で削除）

## D-9: Webhook パイプライン統合テスト
- **決定**: ローカルサーバー起動 + sign-and-post.js でフルパイプライン検証
- **結果**: HMAC 署名検証 ✅、dedup (再配送スキップ) ✅、ルーティング (payment_term→かけ/都度) ✅
- **根拠**: Order #1013 (payment_term=20th) が processed.json の dedup で正しくスキップされた
- **FB要否**: 低

## D-10: Vercel デプロイ — ユーザー操作必要
- **決定**: `.vercel/project.json` 未存在のため、初回 `vercel link` が対話式で必要。自動デプロイは不可
- **ユーザーアクション必要**:
  1. `cd webhook/vercel-deploy && vercel link` → チーム・プロジェクト選択
  2. Vercel ダッシュボードで環境変数設定（SHOPIFY_*, MF_*）
  3. `vercel --prod` でプロダクションデプロイ
  4. デプロイ URL 取得後: `cd shopify && node --env-file=.env src/webhook-admin.js create https://<VERCEL_URL>/api/webhook`
- **FB要否**: 高（デプロイ先チーム・プロジェクト名の確認が必要）
