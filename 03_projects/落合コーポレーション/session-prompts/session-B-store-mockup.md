# セッションB 起動プロンプト — B2Bストアモック（ログイン→卸価格→発注）

> 使い方:
> ```bash
> cd /Users/naru/Walkers_naru/03_projects/落合コーポレーション
> claude
> ```
> 起動後、下の「--- プロンプト本文 ---」以降をそのまま貼る。

---

## --- プロンプト本文 ---

あなたは落合コーポレーション案件のエンジニア。**今夜〜明朝（2026-06-09 午前）が締切**の超タイトなタスク。完璧より「明日のMTGで見せられる」を最優先。デモ用モックなので、仮画像・ダミー商品でよい（雰囲気と流れが伝わればOK）。

### ゴール（1行）
**「B2B顧客がログイン → 自分の掛け率（卸）価格を見る → 発注 → 裏で Draft Order／請求書が作られる」という一連の流れを、6/9に画面共有で見せられるモックにする。**

### まず最初に読む（着手前・必須）
1. `requirements/discount-system.md` — 特に **§11（Draft Order方式・実機PASS #D3〜#D11）** と §7（検証結果）。**既存の動くコードの説明がここにある。**
2. `requirements/shopify-tos-research.md` — **§8.5（推奨案: A=Manual Payment 銀行振込 + B=Draft Order。注文方法 a/b）**
3. `demo/demo-plan.md` — §3（デモで見せる範囲・実動/スタブの線引き）、§5（トップ構成案）、§6（ダミー商品）、§7（Shopify環境・admin URL・pw）
4. `requirements/b2b-implementation.md` — 招待制ログイン（顧客番号・初回PWリセット）・Customer metafield 設計
5. `furutani-prebrief.md` — **入口方針 (a)(b)(c) と「(c)完全セルフ購入は Plus 必要」**（デモの正直さの根拠）
6. 既存コード: `shopify/src/` 配下
   - `createDraftOrder.js`（掛け率適用Draft Order作成・priceOverride対応）
   - `discountEngine.js`（顧客×商品区分の掛け率計算・テスト15件）
   - `shopifyClient.js`（Admin API）/ `setup.js`（metafield/metaobject定義）/ `scenarios.js`（5シナリオ実演）/ `probe.js`（疎通）
   - npm scripts: `npm run probe`（疎通）/ `npm run create-draft`

### 背景（このセッションだけで完結するための要点）
- 掛け率の「チェックアウト自動適用」は **Shopify Functions = Plus限定（月36.8万）** で Basic では不可。→ **Draft Order 方式（Basic・実機実証済み）** に確定済み。既存 `shopify/` にそのコードが動く状態である。
- 6/9モックの目的: 先方に「ログイン→卸価格→発注」のセルフ体験イメージを見せ、**入口方針 (a)電話/メール+営業Draft Order / (b)ストアで選んで依頼→営業Draft Order / (c)完全セルフ購入 のどれにするかの判断材料**にしてもらう。
- 決済は**銀行振込（Manual Payment）**。即時カード決済は不要。発注 → Draft Order → Invoice URL → 振込、という流れ。

### ⚠️ 絶対に外さない設計（これを間違えると掛け率が消える）
- **発注ボタンは必ず Draft Order を作成する経路にする**（既存 `createDraftOrder.js` を使う）。**Shopify標準のカート→チェックアウトに流してはいけない。** Basicでは標準チェックアウトの最終支払額に掛け率が自動適用されず、顧客は**正価**を見てしまう。掛け率（卸価格）を担保できるのは Draft Order だけ。

### ⚠️ デモの正直さ（成果物に必ず含める但し書き）
- このモックは見た目こそセルフ(c)風だが、中身は **「表示はセルフ・確定はDraft Order」の Basic 可能なハイブリッド**。
- **本番で完全セルフチェックアウト(c)をやるなら Plus（月36.8万・予算500万に対し過大）が必要**。デモ説明・READMEに「これはBasic可能な形。完全セルフは要Plus」と明記する。スルッとした(c)デモだけ見せて先方が予算外の機能に『これでいい』と言う事故を防ぐ。

### 着手の最初にやる（テーマの曖昧さを実機で解消）
- ドキュメント間でテーマ表記が割れている（`b2b-implementation.md`=Rise / `demo-plan.md`=Dawn）。**まず現在のデモストアに実際に入っているテーマを Shopify admin で確認**し、入っている方で進める。ここで悩んで時間を使わない。

### スコープ（やること）
1. 既存デモストアに、**B2Bログイン → ログイン後に卸価格表示 → 発注ボタン** の流れを作る（Liquid + Customer/Product metafield）。テスト法人顧客（`setup.js` の corp-a 等）でログインして卸価格が見える状態。
2. **発注ボタン → 既存 `createDraftOrder.js` で掛け率適用 Draft Order を生成 → Invoice URL を表示**。
3. ダミー商品・テスト顧客で、通しの動線を画面共有で再現できるようにする。

### スコープ外（やらない）
- 本番商品データ投入・実画像・実コピー（仮でOK）。
- 佐川連携・在庫アラート・コーポサイト連携（demo-plan §3-B/C のスタブ説明でよい）。
- MF連携（Track A の領分）。
- 完全セルフチェックアウトの本実装（Plus必要・スコープ外）。

### 最小デモ可能ライン（ここまで行けば6/9は勝ち）
テスト法人でログイン → 商品で**卸価格が見える** → 発注ボタン → **掛け率適用済み Draft Order が Admin に生成され Invoice URL が出る**。この通しを画面共有で見せられる。

### フォールバック（Liquid改修が間に合わない場合）
- 卸価格表示は最小（1商品 or ログイン後バナー1枚）に削り、**「発注→Draft Order生成→Invoice URL」は既存 `scenarios.js`／Admin画面で実演**する（既存 #D8 等の実績がある）。
- それも厳しければ: フロー図 ＋ ログインUIスタブ ＋ 既存Draft Order実演 で「流れ」を口頭＋画面で説明。demo-plan の方針どおり「ここはこう入る」を見せる形に倒す。

### 環境・認証（値は出力しない）
- 既存 `shopify/`。`.env` に `SHOPIFY_STORE_DOMAIN` / `SHOPIFY_ADMIN_TOKEN` / `SHOPIFY_API_VERSION`（**値は設定済み**）。トークンは会話・コミットに出さない。
- Shopify CLI 導入済み。admin URL・ストアフロント（pw: `eahayl`）は `demo-plan.md` §7 / `CONTEXT.md` §11 参照。
- ⚠️ 注意（`discount-system.md` §11末尾）: 検証は Development ストアで実施。Admin APIトークンの発行経路に「2026/1/1以降 新規レガシーカスタムアプリ作成不可」警告あり。トークンが効かない場合は Dev Dashboard 経由を確認。デモ後はトークン再生成推奨。

### 完了の定義
- ✅ 最小ラインの通し再現、**または** フォールバック状態を明示。
- ✅ `shopify/` に「デモの叩き方・見せ方・但し書き（要Plus範囲）・残課題」を README か手順メモで残す。

### 注意
- このセッションは **Track A（MF実証）とは独立**。並行で別ターミナルで走ってよい。
- 詰まったら憶測で進めず、上記ドキュメント参照 or naru に質問。時間がないからこそ手戻りが致命傷。
