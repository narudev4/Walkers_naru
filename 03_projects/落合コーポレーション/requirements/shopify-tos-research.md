# Shopify 規約調査（決済外出し）

最終更新: 2026-05-27（naru セッション）
担当: naru
位置づけ: 5/26 PM MTG で古谷さんから振られた**規約調査タスク**の進捗ファイル
リンク: [議事録](./meeting-2026-05-26-pm.md) / [B2B 実装プラン](./b2b-implementation.md)

---

## 1. 調査の目的

落合コーポ B2B 売上は**銀行振込**が必須。Shopify 内で決済を完結すると手数料が乗る。これを **Shopify 外に逃す or 請求書払い** で実装した場合の **Shopify 利用規約抵触リスクと技術可能性**を調査する。

最終アウトプット: **判断材料を一覧化した規約レポート**（古谷さんが次回定例で落合社に提示できる粒度）

---

## 2. 調査の論点

### A. 決済を Shopify 外に逃す手法
- ① **手動マーク注文（Manual / Bank Deposit Payment）**: Shopify の組み込み "Manual payment method" を使い、注文成立時に「銀行振込待ち」ステータス → 落合社が入金確認後に手動で支払済みに更新
- ② **チェックアウト後の請求書発行**: Shopify 上ではタダで注文だけ確定（¥0 など）→ マネフォから請求書発行
- ③ **Draft Order + Invoice**: Shopify の Draft Order を作って Invoice URL を送信 → 顧客は支払うが Shopify Payments を経由
- ④ **B2B 専用システムを Shopify 外に構築**、在庫だけ API 連携

### B. それぞれの規約上のリスク
- Shopify Terms of Service の「**Shopify Payments 強制要件**」の有無
- "Payments Outside of Checkout" の取扱い（Shopify Payments 利用ストアでは外部決済禁止）
- B2B（Shopify Plus）と Basic プランでの差
- 規約違反した場合のペナルティ（ストア凍結等）

### C. 技術的な実装可能性
- Manual payment method の B2B シナリオでの使い勝手
- 注文確定 → 振込待ち → 入金確認 → 出荷 のフロー
- 在庫の引き当てタイミング
- マネフォとの整合

### D. Shopify Plus B2B 機能
- そもそも Plus にすれば Net Terms（請求書払い）標準サポート
- Plus 料金は月 $2,500〜（円高だと 50 万 / 年 ×??）
- Plus を使わない方針との比較

---

## 3. 一次情報リソース（読みに行く）

### Shopify 公式
- [ ] **Shopify Terms of Service**: https://www.shopify.com/legal/terms
- [ ] **Shopify Payments Terms**: https://www.shopify.com/legal/terms-payments
- [ ] **Acceptable Use Policy**: https://www.shopify.com/legal/aup
- [ ] **Shopify Help: Payment methods**: https://help.shopify.com/en/manual/payments
- [ ] **Manual payment methods**: https://help.shopify.com/en/manual/payments/manual-payment-methods
- [ ] **Bank deposit (Manual)**: https://help.shopify.com/en/manual/payments/manual-payment-methods/bank-deposit
- [ ] **Shopify B2B (Plus 限定機能)**: https://www.shopify.com/plus/solutions/b2b-ecommerce
- [ ] **B2B Net Terms (Plus)**: https://help.shopify.com/en/manual/b2b/payment-terms

### Shopify Community / Forum
- [ ] 同様ケースの公式回答を検索（"B2B invoice payment outside checkout"）

### 日本語情報
- [ ] Shopify Japan 公式 Help: https://help.shopify.com/ja/
- [ ] Shopify Plus 営業窓口に直接問い合わせ（B2B Net Terms の利用条件・料金）

---

## 4. 仮説（調査前の暫定）

### 仮説 1: Manual Payment は規約 OK
Shopify は標準で "Manual payment method" を提供しており、銀行振込・電信送金・小切手・現金引き渡し等を組み込み済 → 一般的な銀行振込フローは **規約上問題ない可能性高い**。

### 仮説 2: Shopify Payments を有効化していると外部決済に制限
Shopify Payments 利用中は、外部の競合決済代行（PayPay 等を直接 API 連携など）の併用に制限がある可能性。Manual payment は別枠で可。

### 仮説 3: 完全外部システム化は規約上 OK だが本末転倒
在庫だけ API 連携、決済・配送は別システム → Shopify は単なる商品データベースになり、月額 ¥4,100 払う意味が薄い。

### 仮説 4: Plus にしないと B2B Net Terms は使えない
Plus 限定機能。Basic / Advanced では Net Terms 標準 UI なし。Manual payment + Draft Order の組合せで擬似実装が必要。

---

## 5. 調査タスク（チェックリスト）

- [ ] § 3 の Shopify TOS を読了
- [ ] § 3 の Shopify Payments Terms を読了
- [ ] Manual payment method の B2B 利用に関する規約条項を抽出
- [ ] Shopify Plus B2B の Net Terms 機能仕様を確認
- [ ] Shopify Plus 料金体系を確認
- [ ] 仮説 1〜4 の検証
- [ ] **判定マトリクス**を作成: 手法 × 規約適合 × 技術実装難度 × コスト
- [ ] 古谷さん向け **1 ページサマリ**作成

---

## 6. 古谷さんに提出するアウトプット案

```
[Shopify 規約調査レポート]

1. 結論（1 行）
2. 推奨案
3. 4 手法の比較表（規約 / 技術 / コスト / 工数）
4. リスク詳細
5. 次のアクション
```

---

## 7. 進捗ログ

| 日時 | 内容 |
|---|---|
| 2026-05-27 | ファイル作成、調査ロードマップ整理 |
| 2026-05-27 | Shopify TOS / Manual Payments / Plus 料金 一次調査完了 → § 8 に結論ドラフト |

---

## 8. 調査結果（暫定結論 2026-05-27）

### 8.1 Shopify TOS の核心条項

- **§ 1.8**: "You agree not to work around, bypass, or circumvent any of the technical limitations of the Services, including to **process orders outside Shopify's Checkout**."
- **§ 4.5**: "You agree to **use Shopify Checkout for any sales** associated with your online store."

→ **オンラインストアの売上は Shopify Checkout を通すことが義務**。完全に Checkout を迂回する外部決済は規約違反。

### 8.2 Manual Payment Methods は規約 OK

Shopify 公式 Help より:
- 銀行振込・代引き・郵便為替・カスタム決済を **Checkout 内で選択可能**
- フロー: 顧客チェックアウト → 注文「Pending」→ マーチャント手動で「Paid」マーク → 出荷
- **「You aren't charged third-party transaction fees for manual payments」**（公式明記、手数料ゼロ）
- プラン制限なし（Basic でも利用可）

**→ 落合社の B2B 銀行振込は、Manual payment method で実装 = 規約 OK + 手数料ゼロ**

### 8.3 Shopify Plus の B2B Net Terms（請求書払い）

- Companies & customers / Catalogs & pricing / Customer accounts / Checkout & draft orders 等の B2B 専用機能あり
- **日本国内 Plus 料金**: 月額 **¥368,000（3年契約） / ¥398,000（1年契約）** = 年 **¥442〜478 万円**
- 落合社予算 50 万 / 補助金 100 万では **完全に届かない**

**→ Plus 採用は予算外。Basic + Manual payment + Draft Order で擬似実装が現実解**

### 8.4 4 手法の比較表

| 手法 | 規約適合 | 手数料 | 技術難度 | コスト | 採否 |
|---|---|---|---|---|---|
| **A. Shopify Manual Payment (銀行振込)** | ✅ OK | ¥0 | 低 | ¥0 | **★本命** |
| **B. Draft Order + Invoice URL** | ✅ OK | ¥0 (Manual併用時) | 低 | ¥0 | 補助運用 |
| **C. Shopify Plus B2B Net Terms** | ✅ OK | ¥0 (Net Terms) | 低 | 月 ¥36.8 万〜 | ❌ 予算外 |
| **D. Shopify 外決済システム + 在庫 API 連携** | ⚠️ §1.8 / §4.5 抵触リスク | ¥0 | 高 | 数十万〜 | ❌ リスク高 |

### 8.5 推奨案

**A + B の組合せ**:
1. B2B 顧客は **招待制で Customer 作成**（5/26 午前 MTG 決定済）
2. 注文方法 a: B2B 顧客がストアフロントで自分でカート→Checkout で **Manual payment「銀行振込」を選択** → 注文 Pending → 落合社が入金確認 → Paid マーク → 出荷
3. 注文方法 b: 営業担当が **Draft Order** を作成 → Invoice URL 送付 → 顧客が Draft Order URL から Manual payment 選択 → 以下同じ
4. **マネフォとの連携**は Shopify 注文データを CSV エクスポート or API 連携で別途実装（古谷さん担当タスク）

### 8.6 残るリスク・確認点

- **「Pending → Paid」ステータス管理が落合社の運用に乗るか**: 入金確認の手数が手動になる
- **マネフォ請求書と Shopify Order の紐付け**: 注文番号で 1:1 紐付けが必要
- **B2B Net Terms（支払期限指定: Net 30 等）の擬似実装**: 注文確定 → 30 日後支払期限 → リマインダー → 入金 のフローを Shopify の Manual payment + 通知でカバーできるか
- **B2B 専用カタログ（個人と法人で見え方を変える）**: Basic では標準サポートなし → 別途 Liquid + Customer Metafield で実装（discount-system.md 担当範囲）

### 8.7 古谷さん向け 1 行サマリ

> **「Shopify Basic + Manual payment method（銀行振込）+ Draft Order」で規約遵守・手数料ゼロ・予算内で B2B 請求書払い相当の運用が可能。Plus は予算外で不要。**

---

## 9. 次の調査タスク

- [ ] Draft Order の Invoice URL 機能の詳細（plan eligibility / メール送信フロー）
- [ ] Shopify Bank Deposit (manual) の Bank Account 表示設定の詳細
- [ ] Shopify Notifications でカスタム振込期限通知が送れるか
- [ ] **次回定例 MTG までに古谷さん向け 1 ページサマリ作成**
