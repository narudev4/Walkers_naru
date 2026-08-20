# ③都度払い 請求書 自動送信化 — 論点と調査計画

最終更新: 2026-06-09
背景: 古谷さん・先方の理想 = **③都度払い（即/当日払い・かけ払いじゃない顧客）は、注文確定 → MFから請求書を自動送信（下書きなし）**。質問No.31「都度払い＝即時自動送信」と整合。
※ かけ払い（①20日締め/②末締め）は決定5「下書き→人が確認送付」のまま。本メモは **③都度払い専用**。

> 運用ルール: **確実になった項目だけ §1 へ。未確認は §2 に置き、「できる」と書かない**（憶測禁止）。確定したらシート（請求書フロー現状）へ昇格。

---

## 1. 確実なこと（調査済み・確定）

- **MF請求書 API v3 にメール送信エンドポイントが無い**（複数回確認・確定）
  - path 全8本: `office` / `partners` / `items` / `billings` / `invoice_template_billings` / `quotes` / `sent_histories` / `posting`
  - 送信系は `POST /billings/{id}/posting`（＝**有料の物理郵送**・402 Payment Required）のみ。**メール送信エンドポイントは存在しない**。
  - `/sent_histories` は **GET（送付履歴の参照）のみ**。`email_status` は `null=未送信` / `sent=送付済み` の**読み取り専用**。
  - `POST /invoice_template_billings`（作成）に**自動送信フラグ無し** → 作成時は必ず `email_status=未送信`（下書き）。
- **MF UIから手動送信すると `do_not_reply@moneyforward.com` で届く**（請求書番号3で実証済み）。
- Shopify の注文確認メール（`store+...@t.shopifyemail.com`）と MF の請求書メールは**別物**。前者は請求書ではない（Shopify標準の自動送信）。

→ **確定結論**: 「**MF公式APIだけで請求書をメール自動送信する**」ことは**できない**。自動送信を実現するには §2 の手段確定が前提。

---

## 2. 調査項目（未確定・これから調べる）

### Q-A. 「MFから送信」を自動化する技術手段（最重要・ここが全体の鍵）
APIに送信が無い中で、差出人を `do_not_reply@moneyforward.com`（＝MF公式）にしたまま自動送信する道:
- [x] **A-1. MFに「自動送信」設定が本当に無いか最終確認**（公式ドキュメントで確認）。→ **確定: クラウド請求書に作成時の自動メール送信機能は無い**（送付は全て手動／「毎月自動作成」は作成のみで顧客送信しない）。詳細・一次情報はスプシ「自動送信化_調査」§調査結果。
- [ ] A-2. MF UIの送信操作を**ブラウザ自動化**（Playwright等でログイン→請求書→送信ボタン）で代行できるか。脆さ（UI変更・2段階認証・利用規約/自動操作の可否）を評価。
- [ ] A-3. MFの**上位プラン/別API**（定期請求 invoice_template 等）で送信が自動化できるか。※「都度払い＝注文ごと」なので定期請求は形が合わない可能性。
- [ ] A-4. 「MFから」を諦め、請求書PDF（API応答 `pdf_url`）を**自前(Gmail等)で自動送信**する案の許容可否（差出人がMF外になる→先方確認が必要）。

### Q-B. Shopify Webhook → API発火（自動トリガー）
- [x] **B-1. `orders/create` Webhook は Shopify Basic で使えるか（Shopify Plus 不要か）** → **確定: 公式一次情報に orders/create のプラン/Plus要件の記載なし＝全プランで購読可**（read_orders スコープ要）。受信に公開https常駐エンドポイント必須。詳細はスプシ「自動送信化_調査」§調査結果。
- [ ] B-2. Webhook受信の**常駐エンドポイント**（Vercel Function 等）の構築要否・運用コスト・MFトークン(refresh)の常駐管理。
- [ ] B-3. 支払区分（③都度払い）の判定をどこで持つか（顧客 metafield `payment_terms`）。注文時に③だけ発火させる。

### Q-C. 全体フロー設計（確定後に詰める）
注文確定(Webhook, ③のみ) → MF請求書作成(API) → 送信(Q-Aで確定した手段) → 取引先にメール。
どこまで自動化し、どこを人手に残すか。

---

## 3. 実装状況（2026-06-10 ローカル実装・検証済み）

```
Shopify 注文確定（orders/create）
  → webhook/server.js（HMAC検証 → 即200 → 非同期処理 → 再配送の二重発行防止）
  → 注文を Admin API で取得・正規化（shopify/src/orderNormalize.js・metafield込み）
  → MF請求書を下書き作成（moneyforward/src/invoiceService.js）… 全支払区分共通（決定5）
  → b2b.payment_terms == 'prepaid'（③都度払い）かつ SEND_MODE=browser のときだけ
     mf-automation/send-invoice.js（Playwright・A-2）で MF画面の送信を自動実行
  → GET /billings?document_number=… の email_status で送信成功を機械検証
```

- ✅ **ローカルe2e検証済み（2026-06-10）**: 署名付き模擬配送 → 実注文#1003取得 → MF請求書#5自動作成（¥41,580・未送信）→ `20th` 判定で送信せず停止（決定5どおり）。不正署名401・再配送スキップも確認。
- ✅ **A-2送信（Playwright）実証済み（2026-06-10）**: 請求書6（¥22,550）・7（¥84,480）を自動送信し、API `email_status=送付済み` を2連続確認。差出人=do_not_reply@moneyforward.com。誤送信防止＝送信前にモーダルの請求書番号を照合（不一致は中止・リトライ1回）。送付済みはスキップ。セレクタの要点: 行=`div[class*="listItem___"]`（コンテナ不可）／確定=`getByRole('button',{name:'送信する'})`（Reactはvalueをプロパティ設定するためCSS属性セレクタ不可）。
- 🟨 **実Shopify配送**: 公開URL（Vercel等）デプロイ後に `shopify/src/webhook-admin.js create <url>` で登録（未実施）。署名キー=カスタムアプリのAPIシークレットキー。

### 動かし方
```bash
# 受信サーバ（webhook/ で）
npm start                 # SEND_MODE は webhook/.env（none=下書きまで / browser=③を送信まで）
# ローカル模擬配送（webhook/ 別ターミナル）
npm run test:post
# A-2 初回セットアップ（mf-automation/ で・人がログイン）
npm run login
# 単体送信テスト
node send-invoice.js --billing-number 5 --headed
# 締めバッチ（①②かけ払い・顧客ごと期間統合の下書き作成。送信しない=決定5）
npm run settle -- --term 20th [--closing YYYY-MM-DD] [--force]
npm run settle -- --term eom
```

### 締めバッチ（①②かけ払い）— 2026-06-10 実装・ローカル検証済み
- `webhook/settle-batch.js`: 期間内に**発送（フルフィルメント）された**注文を顧客別に統合し、MF請求書を**下書きで**1枚/顧客 作成（決定2/4/5/6/7・要件定義書「質問事項」確定分に準拠）。
- 検証: 顧客B（サンプルスポーツ・20th）の発送済み2注文 → 請求書No.10 ¥45,870（期間5/21〜6/20・支払期日7/20自動計算）。未発送注文#1009の除外、同一締めの二重実行防止も確認。
- 仮仕様: 明細粒度=「MM/DD 注文番号 商品名」行（確認事項#2(a)確定後に調整）。返品(d)未実装。
- パイプライン変更（D-3）: かけ払い注文は注文毎の請求書を作らない（締めバッチに一本化）。

---

## 4. 調査の進め方（次アクション）

1. **A-1**（MFに自動送信設定が無いか最終確認）を潰す ← 全体の前提。無ければ A-2/A-4 へ分岐。
2. **B-1**（Basic で Webhook 使えるか＝Plus不要か）を確定。
3. 確実になった項目を §1 へ昇格 → シート（請求書フロー現状）にサマリ反映。

> 現状の手動フロー（注文 → `order-to-invoice.js` → `createInvoice.js` → MF画面で送信）は動作確認済み。本メモは**それを「注文確定で全自動」に引き上げる**ための調査。
