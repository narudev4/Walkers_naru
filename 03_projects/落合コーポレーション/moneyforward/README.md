# 落合コーポ — マネーフォワード クラウド請求書 API 実証

**ゴール**: Shopify の注文1件を入力に、マネーフォワード クラウド請求書 API を叩いて **請求書を1枚発行できる**ことを実証する。
= 「Shopify イベントで MF 請求書 API が叩けるか」の実装可否判定を、動くもので示す。

対象は **③都度払い（1注文 → 1請求書・即時発行相当）**。最もシンプルなコア配線を検証する。
①かけ払い20日締め／②末締め（締め日バッチ＋期間集計＋下書き保存）は今回スコープ外（→ 末尾「③→①②拡張」）。

---

## 何が動くか（実装済み）

| ファイル | 役割 |
|---|---|
| `src/oauth.js` | OAuth2 認可コードフロー（PKCE S256・refresh 対応）。トークンEPは form-urlencoded |
| `src/auth.js` | `npm run auth` 認可実行。ローカルコールバック自動受信 or `--manual` 貼付 |
| `src/tokens.js` | トークン永続化（`.mf-tokens.json`／.env フォールバック） |
| `src/mfClient.js` | 請求書APIラッパ。Bearer 認証 + **401時に refresh して1回再試行** |
| `src/mapOrder.js` | **Shopify 注文 → MF ペイロード変換**（取引先・請求書・品目） |
| `src/createInvoice.js` | 取引先作成 → 請求書作成 → 結果表示（メイン） |
| `src/whoami.js` | `GET /office` 疎通スモークテスト |
| `samples/order.sample.json` | 入力サンプル（B2B注文1件・卸価格入り） |

### API 仕様（すべて MF 公式の一次情報で確定済み）

- **API ベース**: `https://invoice.moneyforward.com/api/v3`
- **請求書作成**: `POST /invoice_template_billings`（インボイス制度対応フォーマットの請求書作成。201で `Billing` を返す）
  - ※ 名前の "template" は「適格請求書フォーマット」の意。**定期請求テンプレートではない**。`/billings` は GET のみ。
  - OpenAPI: <https://invoice.moneyforward.com/docs/api/v3/reference/iv_web_api.yaml>
- **OAuth2**（認可サーバー / RFC 8414 メタデータで確定）
  - 認可EP: `https://api.biz.moneyforward.com/authorize`
  - トークンEP: `https://api.biz.moneyforward.com/token`
  - scope: `mfc/invoice/data.write`（読み書き）
  - 認証方式: `client_secret_post` / `client_secret_basic` / `none` から選択（PKCE S256 対応）
  - メタデータ: <https://api.biz.moneyforward.com/.well-known/oauth-authorization-server>
- ガイド: 概要 [a03](https://biz.moneyforward.com/support/invoice/guide/api-guide/a03.html) / スタートアップ [a04](https://biz.moneyforward.com/support/invoice/guide/api-guide/a04.html)

### 請求書作成のAPI呼び出し順序

```
GET  /office                       … トークン疎通（任意・診断用）
POST /partners                     … 取引先＋部署を作成（→ partner_id / department_id を取得）
POST /invoice_template_billings    … 請求書作成（department_id + billing_date + items[] 必須）
```

`npm run invoice:sample` 実行時に実際に送られる請求書ボディ（サンプル注文の場合）:

```json
{
  "department_id": "<作成した取引先の部署ID>",
  "title": "ご注文 #1042",
  "billing_date": "2026-06-08",
  "due_date": "2026-07-08",
  "sales_date": "2026-06-08",
  "items": [
    { "name": "ヨネックス バドミントンラケット ナノフレア800", "unit": "本", "price": 14000, "quantity": 3, "excise": "ten_percent" },
    { "name": "ヨネックス シャトルコック エアロセンサ500", "unit": "ダース", "price": 2400, "quantity": 10, "excise": "ten_percent" }
  ]
}
```

---

## 使い方（クイックスタート）

> 前提: Node.js >= 20（このマシンは v22）。依存パッケージ無し（`npm install` 不要）。

```bash
cd moneyforward
cp .env.example .env          # 値は下記「人手ステップ」で取得して貼る

npm run map:sample            # ⓪ (任意) 認証不要。送信ペイロードをオフライン確認（配線の証明）
npm run auth                  # ① ブラウザで認可 → トークンを .mf-tokens.json に保存
npm run whoami                # ② GET /office で疎通確認（事業者名が出れば成功）
npm run invoice:sample        # ③ サンプル注文で請求書1枚を作成 → ID/番号/合計/PDF URL を表示
```

最後に **MF クラウド請求書にブラウザでログイン →「請求書」一覧**を開くと、API で作られた1枚が見える。= **実装可否＝「可能」の動かぬ証明**。

---

## 人手ステップ（naru がブラウザで実施）

API キー・トークンは本人操作で取得する（Claude はコードと手順のみ。秘密情報は会話に出さない）。

1. **MF トライアル/アカウント登録**（メール認証）。落合本番はビジネスプランだが、実験は naru の新規トライアル口座で行う。
2. **連携用アプリの作成（アプリポータル）**
   - MF クラウド請求書にログイン → サポート「**API連携（開発者向け）**」→「**APIの利用を開始する**」ボタン → **アプリポータル**へ遷移（[a04 ガイド](https://biz.moneyforward.com/support/invoice/guide/api-guide/a04.html)）。
   - 画面の誘導に従いアプリを作成し、以下を設定:
     - **リダイレクトURI（コールバックURL）**: `http://localhost:8787/callback`（`.env` の `MF_REDIRECT_URI` と**1文字違わず一致**させる）
     - **スコープ**: `mfc/invoice/data.write`
     - **クライアント認証方式**: `CLIENT_SECRET_POST`（`.env` の `MF_TOKEN_AUTH_METHOD` と一致）
   - 発行された **client_id / client_secret** を控える。
3. **`.env` に貼る**: `MF_CLIENT_ID` / `MF_CLIENT_SECRET`。
4. `npm run auth` → 開いたブラウザで**認可** → 自動でトークン保存。
5. `npm run whoami` → `npm run invoice:sample`。

詰まったら止めて naru に確認（憶測で進めない）。

---

## フォールバック（登録/OAuth が間に合わない場合）

配線は完成済み。認証情報の発行待ち＝**実装可否は「可能」**として示せる。

- **A. localhost リダイレクトが弾かれる/コールバックを受けられない**
  → `npm run auth:manual`。ブラウザ認可後のリダイレクト先URL（`...?code=...&state=...`）をそのまま貼り付ければトークン交換できる。
- **B. アプリ登録ごと間に合わない**
  → `npm run invoice:sample` まではコード完成済み。`.env` に `MF_ACCESS_TOKEN`（手動取得分）を貼れば即叩ける。
  → デモでは「**配線は完成、残りは認証情報の発行待ち**」と正直に提示すればよい（実装可否判定としては成立）。
- いずれの場合も `npm run map:sample` で**送信ペイロードを即確認可能**（ネットワーク・認証情報 不要）。「配線は完成」の動く証拠として見せられる。

---

## ③ → ①② への拡張メモ（今回スコープ外・数行設計）

③（即時1枚）が動けば、①かけ払い20日締め／②末締めは **cron＋期間集計＋下書き保存** を足すだけの応用:

1. **締め日バッチ**: 締め日前日 23:59 に起動（決定6）。例: 20日締めなら毎月20日 23:59、末締めなら月末23:59。
2. **対象注文の集計**: Shopify から「**発送(fulfilled)済み**かつ当該支払区分かつ当サイクル」の注文を期間集計（請求確定=発送時／決定4。発送日ステータスを参照）。
   取引先単位でまとめ、複数注文を1請求書の `items[]` に束ねる。
3. **下書きで保存**（自動送付しない）: 本実証と同じ `POST /invoice_template_billings` を使う。作成された請求書は `email_status: 未送信` のまま＝下書き相当。翌日スタッフが確認して送付（決定5）。3ヶ月テスト後に完全自動送付へ。
4. **支払区分の出し分け**: 取引先（Partner）の `payment_deadline_setting`（`due_month`/`due_date`/`contingency_day`）で 20日締め・末締めの支払期日を表現。前金区分は請求対象から外し入金確認後に出荷。

→ 変更点は「**いつ・どの注文をまとめて叩くか**」だけ。請求書作成のコア配線（本実証）は共通。

---

## 残課題 / 注意

- **送付は実装しない**: 本実証は「作成」までで完了（決定5の下書き運用に整合）。請求書の送付/郵送は別エンドポイントで、メール設定が必要なため今回は触らない。
- **適格請求書発行事業者登録番号(T番号)** は任意（a04）。設定すると請求書に反映。落合本番では事業者情報に登録済みのはず。
- **クライアント認証方式**は `.env` の `MF_TOKEN_AUTH_METHOD` をアプリ登録設定と一致させること（不一致だとトークンEPが 401 `invalid_client`）。
- **スコープ不足**だと API が 403。アプリに `mfc/invoice/data.write` を付与。
- トークン（`.mf-tokens.json`）・`.env` は **.gitignore 済み**。秘密情報はコミットしない。
- 本実証は **Track B（ストアモック）とは独立**。会計（仕訳）連携・掛け率計算は対象外（掛け率は Track B / `shopify/src/discountEngine.js`。卸価格は入力として受領）。
