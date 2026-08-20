# Stripe 実装タスク 焦点ブリーフ（naru 担当）

このファイルは新セッション（`aikata/` 配下で起動）が**最短で着手できる**ためのブリーフ。
全体コンテキストは `../CONTEXT.md`、プロジェクト規約は `./CLAUDE.md` を必ず先に読む。

---

## ⚠️ ステータス更新 — 2026-05-27 Stripe NG（先方規約違反）

**Stripe 利用が NG となり、新規決済代行を選び直しになった**（2026-05-27 滝川氏／伊藤氏ルートからの共有）。

> 「今更で申し訳ないのですが、stripeがNG出てしまって新規の決済代行会社選び直しとなります。
> 既存で使ってるAXES、テレコムを利用することになると思いますが、再考になります。確定したら共有いたします」

→ **このファイルの「Stripe を使う」前提は全て暫定的に保留**。確定後、代行名を置換した別ブリーフに再構築する必要がある。

ただし以下は**そのまま使える資産**:
- Phase 0-2 で把握した `repos/love-search_submodule/payment_module/` 構造（戦略パターン: abstract base + 代行ごとの実装）
- Phase 0-3 で把握した DB スキーマ知見:
  - `mst_payment_type` に既存5代行登録（テレコム=1 / BitCash=2 / 銀行=3 / ゼウス=4 / AXES=5）
  - `mst_payment_plan.payment_ids` は CSV 文字列で代行ID列挙
  - `user_payments` には予約プラン/解約予約フィールド**無し** → 新仕様対応で要追加
  - `user_payment_info_axes/telecomcredit/zeus` 等は `userid + sendid + email` 構造
  - 既存プラン料金は旧プラン、新仕様プランは未登録 → 要移行
- Phase 1 設計論点のうち **「変更予約 / 24h前カットオフ / 失敗リトライ 24h→10日→無料化 / APP/WEB 重複防止 / 状態管理 DB」** は決済代行が誰でも必要 → そのまま考察継続可能

**新仕様書（5/25「決済仕様変更まとめ」）は Stripe の `subscription_schedule` や `smart retries` を暗黙の前提に書かれていた可能性が高い**。AXES/テレコムだと「変更予約」「24h前カットオフ」「リトライ 24h→10日→無料化」は**全部自前で cron バッチ + DB 状態機械を組む**必要があり、タスク量とスケジュールに影響が出る前提。確定時に仕様書の見直しが必要になる可能性を中野氏／野呂さんへ伝えるべきか要判断。

**確定するまでこのファイル以下の Stripe 前提セクションは「読み替え用の参考」として扱う。**

---

## ミッション（1行・Stripe 前提・確定後に書き換え）

~~aikata モノレポに、新仕様（5/25「決済仕様変更まとめ」）に従って Stripe による新規会員の月額課金・ポイント購入・既存会員のプラン変更後移行を実装し、評価まで通す。~~ (Stripe NG により暫定保留)

---

## あなたの担当範囲

| 機能 | Stripe対応 |
|---|---|
| 新規会員の月額課金 | ✅ |
| ポイント購入（全会員） | ✅ |
| 既存会員のプラン変更後 | ✅ 変更分から Stripe |
| 既存会員の継続課金 | ❌ AXES/テレコム/ゼウスを維持（触らない） |
| iOS/Google Play アプリ内決済 | ❌ 既存 `aporat/store-receipt-validator` を維持 |

**「既存代行（AXES / テレコム / ゼウス）の処理本体には触らない」**が原則。ただし、新規Stripe決済とコー存させるための分岐ロジック（「この会員は新規だからStripe／既存だから旧代行」）の追加は naru の責任範囲。

---

## 仕様の核（押さえるべき7点）

1. **周期**: 30日一括前払い。プラン 30/90/180/360日（料金表では24ヶ月もあり）。内部は日数管理、JST。
2. **更新タイミング**: 契約日=1日目、満了翌日 0:00 に更新決済。
3. **解約・プラン変更期限**: 次回更新の **24時間前** まで。
4. **プラン変更**: 即時反映せず**「変更予約」**→満了時に新プラン決済→成功で切替。**日割りなし／返金なし**。
5. **失敗リトライ**: 24h → 10日 → 最終失敗で無料化。
6. **APP/WEB 重複課金防止**: 有効サブスクある間は他PF不可、**先に有効化された方を優先**。
7. **状態管理**: 現在プラン / 予約プラン / 決済代行会社 / 契約開始日時 / 次回更新日時 / 解約予約 / 決済状態 / 決済失敗状態。

詳細仕様: https://docs.google.com/document/d/1hVJTM4JYQmd91YDUYMM_0ITPJdtJKs975Op4Kd0m2Xg/edit

---

## 着手順（推奨）

### Phase 0: 環境セットアップと既存把握（最初の1-2時間）

1. `cd /Users/naru/Walkers_naru/03_projects/オーケーウェブ/repos/aikata`
2. `./scripts/bootstrap.sh && docker compose up -d` で ローカル起動
3. `http://localhost:8080/admin/` でログイン疎通（`kenichi.ando@seezoo.co.jp` / `12345678`）
4. `http://localhost:8080/login` でユーザーログイン疎通（`dev1001@aikata.local` / `test1234`）
5. **`repos/love-search_submodule/` を読む** — 既存決済モジュールの構造（AXES/テレコム/ゼウス処理、IAP検証、autoload配線）
6. DB の payment 系テーブル探索:
   ```bash
   docker compose exec db mysql -uroot -proot love_search -e \
     "SHOW TABLES FROM love_search LIKE '%payment%'; SHOW TABLES FROM love_search LIKE '%plan%'; SHOW TABLES FROM love_search LIKE '%subscription%'; SHOW TABLES FROM love_search LIKE '%mile%'; SHOW TABLES FROM love_search LIKE '%point%';"
   ```
7. Stripe Dashboard 疎通（test mode）
   - メール受信確認、`opensite-lvs@…` ワークスペースへの参加
   - test API キー取得（publishable + secret）

### Phase 1: 設計フェーズ（次の1日）

`stripe-best-practices` skill を起動して以下を決定:

1. **Stripe API 選定**:
   - サブスク: **Subscriptions API**（Stripe Customer + Subscription + Price）
   - ポイント購入: **Payment Intents / Checkout Session**（one-time）
   - クレカ入力 UI: **Payment Element**（PCI-DSS SAQ A、新規構築向き）
2. **製品/価格モデル**:
   - Product: 「会員プラン」/「ポイントパック」/「オプション」
   - Price: 各プランの定価/割引価格を Price として登録（または手動 line item）
3. **「変更予約」をどう実装するか** — Stripe は subscription_schedule あり、これを使うか or 自前で管理するか
4. **24時間前カットオフ**の実装場所（フロント表示制限 + バックエンドガード）
5. **失敗リトライ**: Stripe 標準の smart retries を使うか、自前バッチで再試行か
6. **Webhook 設計**: `customer.subscription.*`, `invoice.payment_*`, `payment_intent.*` のどれを受けて何を更新するか
7. **既存DB状態管理との橋渡し**: 既存 `mst_payment_plan` / `user_payment_*` 系をどう Stripe メタデータと紐付けるか
8. **APP/WEB 重複防止**: アプリ内決済と Stripe で **どこで排他チェック**するか（推奨: PHP API 側で集約）

### Phase 2: 実装

優先順:
1. **新規会員 → Stripe サブスク**（メイン経路、最初に動かす）
2. **Webhook 受信 + DB 反映**（決済成否で会員ステータス遷移）
3. **解約 / プラン変更予約**
4. **ポイント購入**（独立、サブスクとほぼ分離可能）
5. **既存会員プラン変更時の Stripe 移行ロジック**
6. **失敗リトライ + 通知**

### Phase 3: 評価（QA）

仕様書「9. 開発上の重要事項」と「8. 決済失敗時仕様」の table-driven テスト。**「事故るとクレームになる部分」が naru の責任**なので、最低限カバーすべきシナリオ:

- 新規 30日プラン契約 → 30日後の更新 → 成功 → 状態継続
- 同 → 更新失敗 → 24h リトライ → 成功
- 同 → 更新失敗 → 24h 失敗 → 10日リトライ → 失敗 → 無料化
- プラン変更予約（30→90日）→ 満了タイミングで切替 → 旧Stripeサブスク終了確認
- 既存会員（AXES等）がプラン変更 → 旧代行が「退会させずに止まる」 + Stripeで新プラン開始
- 24h前カットオフのエッジ（時刻 ±1秒）
- APP/WEB 同時購入の重複防止
- 退会 → 予約・未来課金キャンセル
- ポイント購入 → 即時付与 → 180日後失効

---

## 詰めるべき確認事項（実装中に明確化）

1. **AXES の所在**: `repos/love-search_submodule/` 内を grep（`AXES`, `axes`）
2. **「期限切れ」ステータス**: 新仕様で無料化統一が確定したか（中野⇔滝川コメント中）→ 中野氏に確認
3. **既存代行の「退会させずに止める」実装**: 既存に手を入れる必要が出るので、要確認（古谷さん or 滝川さんルート）
4. **退会後の他ユーザー表示**: 5/26 中野氏の質問が未回答（非表示 vs 退会済み表示）→ 確認後実装
5. **Stripe本人確認の進捗**: 伊藤氏経由で手配中、Liveキー使う前に必要
6. **既存DB schema との合流**: 新規 `user_subscriptions_stripe` 等テーブル足すか、既存 `user_payment_*` 系を拡張するか — 既存モジュール読了後に判断

---

## 重要な制約（aikata/CLAUDE.md より）

- **既存PHP は基本触らない**。API追加が必要なら新規 Controller / Model を足す方針（既存修正は別 PR）
- **`aws_account.php` の AWS IAM 平文キーには触らない**。新たな leak も書き込まない
- **本番DB に繋がない**（認証・VPC構成が別段取り）
- **秘密鍵類はコミットしない**（`.env*`, `*.pem`, `*.p12`, `*.p8`, `*.jks` 全部 gitignore 済み）

---

## このセッションの開始テンプレ

新セッションでこのファイル + CONTEXT.md + aikata CLAUDE.md を読み終わったら、以下のプロンプトで進められる:

```
これから Stripe 決済まわりの実装を進める。
全体コンテキストは ../CONTEXT.md、Stripeタスクの焦点は ../STRIPE_TASK.md、
プロジェクト規約は ./CLAUDE.md を読んだ。

まずは Phase 0: 環境セットアップ + 既存決済モジュール把握をやる。
- bootstrap.sh + docker compose up
- localhost:8080/admin と /login の疎通確認
- repos/love-search_submodule の構造把握（特に既存4代行とIAP検証の処理）
- DBの payment/plan/subscription/mile/point 系テーブル探索

stripe-best-practices skill は Phase 1 の設計時に起動する。
```
