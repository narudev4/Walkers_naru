# 6/9 デモ runbook（朝の再現台本）

> 目的: 朝、疲れた頭でも・新しいセッションでも、このファイル1枚で 6/9 デモを再現する。
> 構成: **A=MF請求書API実証**（別「MF」セッション）＋ **B=B2Bストアモック**（実装済み・本書が主にカバー）。
> 最終形（方式C・2026-06-09 実装/検証済）: 管理画面で注文(Draft Order)→`draft-to-order.js`で正規化→MF請求書を下書き作成→**MF画面から送信＝請求書がメールで届く**。
> ※ MF請求書APIにメール自動送信は無いため、送信はMF管理画面の手動操作（決定5「下書き→人が確認送付」の運用そのもの）。

---

## 0. 安定情報（これを使う・揮発しない）

| 項目 | 値 |
|---|---|
| ストア | https://xn-dfum9d9e7a6a1b3d8dc3778hkjvcsh3d.myshopify.com/ |
| ストアパスワード | `eahayl` |
| **永続デモテーマ** | **B2B Demo `#181445329197`** → URLに `?preview_theme_id=181445329197` を付ける |
| デモ法人顧客 | `naru.hosoya+shopifydemo@walker-s.co.jp`（corporate / group A / 取引先=株式会社サンプル商会 / 支払=20日締め） |
| デモ顧客パスワード | （activate URLで設定済み。忘れたら `shopify/src/demo-customer.js` 再実行でURL再発行） |

> ⚠️ `theme dev` の `preview_theme_id`（181445...067053 等）は**セッション揮発**で朝には消える。**必ず上の永続テーマ `181445329197` を使う**こと。

### 商品URL（末尾に `?preview_theme_id=181445329197` を付ける）
| 商品 | 区分 | 期待表示 | パス |
|---|---|---|---|
| KAWASAKI ラケット KR-450 | racket | ¥12,800→**¥7,680（40%OFF）** | `/products/kawasaki-バドミントンラケット-kr-450` |
| THOMAS CUP ゲームシャツ TC-201 | wear | ¥4,500→**¥3,150（30%OFF）** | `/products/thomas-cup-ゲームシャツ-tc-201` |
| ELITE TOP シャトルコック KS-301 | ball | **卸対象外＝正価**（matrix未定義） | `/products/elite-top-シャトルコック-ks-301` |

---

## 1. デモ当日の通し（B：ストアフロント）

1. ストアにアクセス → パスワード `eahayl`
2. **デモ顧客でログイン**（`/account/login`、上記メール＋パスワード）
3. **ラケット商品ページ**（preview_theme_id付き）を開く
   → 価格の下に「🏢 法人卸価格（Aランク） ¥12,800→**¥7,680** 40%OFF」
   → 説明: 「**ログインすると御社ランクの卸価格が自動で出ます**」
4. ウェア（30%OFF）、シャトル（対象外＝正価）も開く
   → 「**商品区分ごとに掛け率が変わる**」「**新カテゴリが増えても再開発不要**（データ追加だけ）」
5. ⚠️ **カートに追加ボタンは押さない**（Basicでは正価でチェックアウトしてしまう。卸はDraft Orderで確定する設計。ページにも注記済み）

## 2. デモ当日の通し（発注 → Draft Order：ハイブリッド実演）

6. 「**発注すると裏でこうなります**」→ ターミナルで:
   ```bash
   cd /Users/naru/Walkers_naru/03_projects/落合コーポレーション/shopify
   node --env-file=.env src/demo-order.js
   ```
   → 掛け率適用 Draft Order #Dxx 生成 ＋ **Invoice URL** ＋ `output/last-order.json` 書き出し
7. 出力された **Invoice URL** をブラウザで開く → 「卸価格で注文/請求が確定できる」を見せる

## 3. デモ当日の通し（方式C：実際の注文 → MF請求書 → 送付＝届く）

> **2026-06-09 実装・検証済**。「Shopifyで注文 → 請求書がメールで届く」を一気通貫で実演する。割引(掛率)は今回スコープ外＝注文の確定単価をそのままMFへ。

8. **（任意）その場でShopifyに注文を作る**: 管理画面 → 下書き注文 → デモ法人顧客＋商品で作成。既存の最新 Draft Order（#D23 等）を使うなら省略可。
9. **最新の注文を正規化**（実際の注文を読み込む glue・割引計算はしない）:
   ```bash
   cd /Users/naru/Walkers_naru/03_projects/落合コーポレーション/shopify
   node --env-file=.env src/draft-to-order.js
   ```
   → 最新 Draft Order を `output/last-order.json` に書き出し（取引先・品目・確定単価・支払区分）。
   ※ ダミーemail(example.com 等)は naru 受信先 `naru.hosoya+shopifydemo@walker-s.co.jp` に自動置換。
10. **MF請求書を下書き作成**:
   ```bash
   cd /Users/naru/Walkers_naru/03_projects/落合コーポレーション/moneyforward
   node --env-file=.env src/createInvoice.js ../output/last-order.json
   ```
   → MFクラウド請求書に「ご注文 #Dxx」が1枚作成（メール状態=未送信＝下書き）。合計はShopifyと一致。
11. **MF管理画面で送信＝請求書が届く**: <https://invoice.moneyforward.com/> にログイン →「請求書」一覧 → 該当請求書を開く → **送信（メール送付）** → `naru.hosoya+shopifydemo@walker-s.co.jp` への着信を画面共有で見せる。これが「**注文したら請求書が届く**」のゴール。

- ✅ 検証済(6/9): Shopify #D23 ¥34,221 → MF請求書番号3 ¥34,221（一致）を **下書き作成まで** 実コードで発行。
- 🔴 **デモ前チェック（必須・最終リンクは未検証）** — 「届く」だけは下書き作成の先で、まだ実際の着信を通していない:
  1. MFクラウド請求書の**設定で事業者名・差出人(送信元)メールが設定済みか確認**（トライアル口座は未設定のことがあり、未設定だと送信不可/空表示の恐れ。README が送信を見送った理由＝「メール設定が必要」）。
  2. 請求書を開き「送信(メール送付)」を1回実行 → `naru.hosoya+shopifydemo@walker-s.co.jp` に**実際に着信するか**を本番前に確認。
  3. フォールバック（万一MF送信が間に合わない/届かない時）: MF請求書PDF（API応答 `pdf_url`）を Gmail で naru 宛に送る、または §4 の B 単体（下書き作成までを画面で見せる）。
- ※ 旧 `demo-order.js`（固定注文を新規作成・掛率込み）は B 単体の掛率実演用として併存。実注文ベースの一気通貫は本 §3 の `draft-to-order.js` を使う。

---

## 4. フォールバック（A が間に合わない場合）

- **B単体で完結**: 卸価格表示 → 発注（Draft Order）→ Invoice URL まで見せる（全部動く）
- A は「**配線は完成、MF認証情報待ち＝実装可否は『可能』**」と正直に説明
- → これでも「実装できるか」の判定デモとしては成立する

---

## 5. 話すポイント（古谷さん／落合社向け）

- 提案の「ログイン後に卸価格を自動表示」は Shopify Functions が必要 → **Plus限定（月36.8万）で予算外**
- → **Draft Order方式（Basic 月4,100円）**で実現。**計算ロジックは提案通り（顧客×商品区分の2軸）**、変えたのは適用の**タイミングだけ**
- 完全セルフチェックアウト(c)は Plus 必要 → 今回は **Basic可能なハイブリッド**（表示はセルフ／確定はDraft Order）
- 決済は銀行振込（Manual Payment・手数料ゼロ・規約OK）

---

## 6. 注意・既知の挙動

- **ログアウト時・個人顧客では卸価格ブロックは出ない**（＝仕様。法人ログイン時のみ）
- 税: 卸単価は**税抜**。Draft Order合計は消費税10%加算（例 ¥31,110 → ¥34,221）
- `preview_theme_id=181445329197`（永続テーマ）。`theme dev` の揮発IDは使わない

---

## 7. 段3（統合）の検証 ToDo（A完成後・本番デモ前に必ず1回通す）

- A が `output/last-order.json` を読んで請求書を出せたら、**実際の受け渡しを1回 end-to-end で通す**
- スキーマdrift注意: フィールド名、`mfPartnerId` が空のときのA側の取引先新規作成、`totalWholesale`（税抜）と MF の税処理の整合
- 接続契約: `session-prompts/integration-contract.md`

---

## 8. ファイル役割（早見表）

| ファイル | 役割 |
|---|---|
| `shopify/src/demo-order.js` | 発注→掛け率Draft Order→`last-order.json`（B→A受け渡し） |
| `shopify/src/demo-customer.js` | デモ法人顧客作成＋group A＋パスURL発行 |
| `shopify/src/demo-setup.js` | corp-a に取引先情報metafield投入 |
| `shopify/src/publish-storefront.js` | metafield定義＋Metaobjectを storefront 公開 |
| `shopify/src/setup.js` | discount_matrix・商品category・テスト顧客（初期投入） |
| `shopify/src/createDraftOrder.js` | 掛け率Draft Order本体（既存・本検証の核） |
| `shopify-theme/snippets/b2b-wholesale-price.liquid` | 卸価格表示Liquid（商品ページ） |
| `session-prompts/integration-contract.md` | A↔B 接続契約（正規化注文JSON） |
| `session-prompts/session-A-mf-invoice-poc.md` | Aセッション起動プロンプト |
