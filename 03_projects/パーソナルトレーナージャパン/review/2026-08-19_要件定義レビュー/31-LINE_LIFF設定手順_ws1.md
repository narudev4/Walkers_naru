# PTJ LINE 公式アカウント／LIFF 設定・運用手順書（実態ベース・WS1・2026-08-19）

作成: ws1-manual（Walkers 側 AI ワーカー）。位置づけ: `app/docs/liff-setup.md`（雛形）・`app/docs/2026-08-06_richmenu-draft.md`（下書き）を置き換える**実態ベースの設定手順**。コード・docs・作業一覧・実測から逆抽出した。
**秘密値（トークン・パスワード・キー）は本書に一切書かない**（環境変数名のみ）。`credentials/` は読んでいない。本番への書き込み操作は行っていない（GET と `vercel env ls`（名前のみ表示）だけ）。
証拠の書き方: `file:line`（app リポジトリ相対）／`06:行N`（作業一覧スナップショット）／「実測 8/19」（本書作成時に curl 等で確認）。

---

## 0. 実測サマリ（2026-08-19 14 時台）

| 確認 | 結果 | コマンド／根拠 |
|---|---|---|
| LIFF エンドポイント URL | **まだ `/profile`**（`liff.line.me/2010137019-OCaRjDeQ/today` の応答 HTML に `ptj-poc-ai-trainer.vercel.app/profile?liff.state=%2Ftoday`）。根本対処（`/` へ変更）は未実施。 | `curl -sL https://liff.line.me/2010137019-OCaRjDeQ/today \| grep -o 'ptj-poc-ai-trainer[^"'"'"' <]*'` |
| 安全網（307） | 効いている。`/profile/today?liff.state=x` → `307 /today?liff.state=x`。 | `curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}" "https://ptj-poc-ai-trainer.vercel.app/profile/today?liff.state=x"` |
| 本番の LIFF ID | `2010137019-OCaRjDeQ`（バンドル `/_next/static/chunks/26t-irtj_ccoe.js` に埋め込み）。 | 本番 HTML → chunk を grep。 |
| cron の認可 | 無認証で 401（fail closed）。 | `curl -s -o /dev/null -w "%{http_code}" https://ptj-poc-ai-trainer.vercel.app/api/cron/notify` |
| セキュリティヘッダー | `x-frame-options: DENY` ／ `x-content-type-options: nosniff` ／ `referrer-policy: strict-origin-when-cross-origin`。 | `curl -sI https://ptj-poc-ai-trainer.vercel.app/` |
| Vercel 環境変数（名前のみ） | Production に 11 個: `DEMO_KEY`・`REVIEW_TOKEN`・`TRAINER_LINE_USER_ID`・`LINE_CHANNEL_ACCESS_TOKEN`・`CRON_SECRET`・`ADMIN_PASSWORD`・`SUPABASE_SECRET_KEY`・`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`・`NEXT_PUBLIC_SUPABASE_URL`・`FEEDBACK_GAS_URL`・`NEXT_PUBLIC_LIFF_ID`（これだけ Preview にも）。**無いもの**: `NOTIFY_DRY_RUN`（無し＝実送信・正しい）・`POC_END_DATE`（無し＝終了日なし・W-02 待ちで正しい）・`ANTHROPIC_API_KEY`（無し。X-9 で必要になる）。 | `vercel env ls`（app ディレクトリ・`.vercel/project.json` = `ptj-poc-ai-trainer`）。 |
| ローカル `.env.local` の変数名 | 12 個（上記 11 のうち `FEEDBACK_GAS_URL` を除く 10 ＋ `NOTIFY_DRY_RUN` ＋ `ANTHROPIC_API_KEY`）。 | `grep -o '^[A-Z_]*=' .env.local`（名前のみ）。 |

---

## 1. 全体像（登場するもの・ID）

```
[利用者の LINE]
   │ 友だち追加 ──→ LINE 公式アカウント「心身健康倶楽部（PoC）」@465hirdn ── あいさつ N-01（OA 側で自動）
   │ リッチメニュー ─→ https://liff.line.me/2010137019-OCaRjDeQ(/today)
   │ 通知の URL ────→ 同上（/hearing /today /weekly /plan /monthly /home）
   ▼
[LIFF]  LINE ログインチャネル 2010137019 ／ LIFF アプリ 2010137019-OCaRjDeQ
   │ エンドポイント URL: https://ptj-poc-ai-trainer.vercel.app/  ← あるべき値（現在は /profile）
   ▼
[アプリ] Next.js on Vercel（project: ptj-poc-ai-trainer・team: nalus-projects）
   │ liff.getProfile().userId → /api/users → Supabase users.line_user_id
   │ 毎日 20:00 JST cron /api/cron/notify → 判定（lib/notify-triggers.ts）→ push
   │ 即時 /api/alert（痛み・危険信号・相談）→ TRAINER_LINE_USER_ID へ push
   │ /api/admin/message（一言）→ 利用者へ N-08
   ▼
[Messaging API] チャネル 2010999270（同じプロバイダー「パーソナルトレーナージャパン」配下）
   │ LINE_CHANNEL_ACCESS_TOKEN（長期）で https://api.line.me/v2/bot/message/push
   ▼
[Supabase] project ref qliivochibjwcovhrmzw（users / events / trainer_messages / video_review_answers ＋ user_summary）
```

| もの | 値・名前 | 根拠 |
|---|---|---|
| プロバイダー | パーソナルトレーナージャパン（LINE ログインチャネルと Messaging API チャネルを同居させる。**userId はプロバイダー単位**なので、別プロバイダーに bot を作ると LIFF で取れた userId へ push できない）。 | `docs/2026-08-06_richmenu-draft.md:27-30`、`06:行49`。 |
| LINE ログインチャネル | チャネル ID `2010137019`。LIFF アプリ ID `2010137019-OCaRjDeQ`（本番 `NEXT_PUBLIC_LIFF_ID` と一致・実測 8/19）。 | BRIEF §3、実測。 |
| Messaging API チャネル | チャネル ID `2010999270`。 | `06:行49`（T-1）。 |
| LINE 公式アカウント | 「心身健康倶楽部（PoC）」`@465hirdn`。アイコンは枝光様 YouTube アバター（8/17 手動設定）。 | `06:行36`・`06:行13`。 |
| リッチメニュー | ID `richmenu-ca99c6fd…`（全ユーザー既定）。画像 `docs/assets/richmenu-v1.png`。**左 2/3「きょうのトレーニング」→ `/today` 直行、右 1/3「アプリをひらく」**。 | `06:行50`（T-2）。 |
| Vercel | project `ptj-poc-ai-trainer`（`.vercel/project.json`: `prj_ormEWeeOc0BIeEGfbe369ihh4jG5` / `team_jWDjd7e4JXVCyaPCT5NCuicL`）。本番 URL `https://ptj-poc-ai-trainer.vercel.app`。cron `0 11 * * *`（UTC）＝ JST 20:00。 | `.vercel/project.json`、`vercel.json`。 |
| Supabase | project ref `qliivochibjwcovhrmzw`（東京・PostgreSQL 17）。`users.line_user_id text unique`（`db/schema.sql:17`）。 | `11:行18`、`db/schema.sql`。 |
| ローカル開発 | `pnpm dev`（`next dev --webpack --port 3400`）。 | `package.json:6`。 |

---

## 2. 設定項目一覧（項目／あるべき値／現在値／確認方法／間違えたときの症状）

「現在値」はコード・docs・実測から分かる範囲。**画面でしか見えないものは「未確認」**と書いた（naru の LINE Developers／OA Manager での確認が必要）。

### 2-1. LINE Developers — LINE ログインチャネル 2010137019（LIFF）

| 項目 | あるべき値 | 現在値 | 確認方法 | 間違えたときの症状 |
|---|---|---|---|---|
| LIFF エンドポイント URL | `https://ptj-poc-ai-trainer.vercel.app/`（**ルート**。末尾スラッシュのみ）。 | **`/profile`（実測 8/19・未修正）**。 | LINE Developers → プロバイダー → ログインチャネル → LIFF タブ → 該当アプリ。または `curl -sL https://liff.line.me/2010137019-OCaRjDeQ/today` の応答に `vercel.app/?liff.state=` が含まれること。 | `/profile/today` に着地して 404（安全網の 307 で `/today` へ戻るが、トップ `/` のプラン有無振り分けは効かない）。`lib/notifications.ts:292-297`・`next.config.ts:24-30`。 |
| LIFF アプリ ID | `2010137019-OCaRjDeQ`。 | 一致（本番バンドル実測）。 | 本番 HTML → chunk を grep、または `vercel env ls` で `NEXT_PUBLIC_LIFF_ID` の存在確認（値は `vercel env pull` でのみ）。 | 未設定: `lib/liff.ts:11-13` が standalone 扱い（LINE 名取得不可・`line_user_id` 保存されず通知が届かない）。通知リンクも付かない（`lib/notifications.ts:320-321`）。 |
| サイズ | Full。 | 未確認（docs は Full）。 | LIFF タブ。 | Tall/Compact だと動画・フォームが窮屈。 |
| Scope | `profile`・`openid`。 | 未確認（docs）。 | LIFF タブ。 | `profile` 無し → `liff.getProfile()` 失敗 → 表示名・userId が取れない。 |
| ボットリンク機能（友だち追加オプション） | 推奨: On（normal）— LIFF ログイン時に「心身健康倶楽部（PoC）」の友だち追加を促す。 | 未確認。 | LIFF タブ。 | Off でも動くが、友だち追加前の利用者には push が届かない（未友だち・ブロック時の LINE 側の応答コードは未確認）。 |
| Messaging API チャネルとの紐づけ（同一プロバイダー） | 同じプロバイダー「パーソナルトレーナージャパン」。 | 一致（T-1 で実機登録→push 成功・`06:行49`）。 | LINE Developers のプロバイダー配下に 2 チャネルが並ぶこと。 | 別プロバイダー: userId が食い違い、全通知が push 失敗（400 "invalid user id" 等）。 |

### 2-2. LINE Developers — Messaging API チャネル 2010999270

| 項目 | あるべき値 | 現在値 | 確認方法 | 間違えたときの症状 |
|---|---|---|---|---|
| チャネルアクセストークン（長期） | 発行済みの値を Vercel `LINE_CHANNEL_ACCESS_TOKEN` に設定。 | 設定あり（Vercel・13 日前）。 | Messaging API 設定タブ。トークン検証は `curl -H "Authorization: Bearer $TOKEN" https://api.line.me/v2/bot/info`（200）。 | 未設定 → 常に dry-run で `ok:true`（`lib/line.ts:21-23`）＝**届いていないのに成功に見える**。失効 → push 401 → cron が `push-failed:401` を skipped に積む。 |
| Webhook | PoC では未使用（OFF）。 | 未確認（docs は未使用）。 | Messaging API 設定タブ。 | ON でも実害なし。ただし友だち追加イベントは受けていないので「友だち追加時刻」はアプリに無い（N-11 は `users.created_at` 基準・`lib/notify-triggers.ts:320-326`）。 |
| 「あなたのユーザーID」 | トレーナー通知の宛先候補（naru・枝光様）。 | Vercel `TRAINER_LINE_USER_ID` は **naru 宛**（`06:行49`・`06:行73`）。 | チャネル基本設定の下部。 | 未設定 → トレーナー通知が dry-run で `ok:true`（`lib/line.ts:93-95`）＝**痛み申告が誰にも届かないのに画面は成功表示**。 |
| 応答メッセージ／あいさつ（Developers 側の切替） | OA Manager 側で管理（下記）。 | — | — | — |

### 2-3. LINE Official Account Manager（@465hirdn）

| 項目 | あるべき値 | 現在値 | 確認方法 | 間違えたときの症状 |
|---|---|---|---|---|
| あいさつメッセージ | ON。文面は N-01 修正版（「まずは 5 分ほどの動作チェックから…」。スプシ原文の「または」は誤記）。 | 設定済み（`06:行13`「あいさつ（N-01 修正版）差し替え」）。文面の最終形は未確認。 | 設定 → 応答設定／あいさつメッセージ。 | OFF → 友だち追加後に何も来ず、入口が分からない（テスト 1-1 📱未実施）。 |
| 応答設定 | チャット ON／自動応答（応答メッセージ）OFF。 | 設定済み（`06:行13`）。 | 設定 → 応答設定。 | 自動応答 ON → 相談の返事が定型文で返り、枝光様の手動返信と競合。 |
| リッチメニュー | 既定表示 ON。構成: 左 2/3「きょうのトレーニング」→ `https://liff.line.me/2010137019-OCaRjDeQ/today`、右 1/3「アプリをひらく」→ `https://liff.line.me/2010137019-OCaRjDeQ`。 | 設定済み（Messaging API で登録・全ユーザー既定・`06:行50`）。 | OA Manager → リッチメニュー（API 登録分は「Messaging API で作成」と表示される場合あり）。または `curl -H "Authorization: Bearer $TOKEN" https://api.line.me/v2/bot/user/all/richmenu`（`richMenuId` が返る）。 | 未既定 → メニュー無し。リンク先が `/today` の場合はエンドポイントが `/` でないと 404（§0）。 |
| 料金プラン | PoC 人数 ≤10 名なら コミュニケーション（無料・200 通/月）、それ以上ならライト（月 5,000 円・5,000 通）。 | **無料プラン**（`06:行77`・2026-08-18 naru 確定）。 | 設定 → 利用と請求 → 月間メッセージ通数。 | 200 通到達 → push が 429 で失敗（`push-failed:429`）→ 月末までリマインド停止。 |
| アイコン | 枝光様 YouTube アバター。 | 設定済み（8/17）。 | プロフィール。 | — |
| 名義・認証 | 「心身健康倶楽部（PoC）」。未認証アカウントで可。 | 未認証（推定・未確認）。 | 設定 → アカウント設定。 | — |

### 2-4. Vercel（project ptj-poc-ai-trainer）

| 環境変数 | あるべき値 | 現在値（8/19 `vercel env ls`） | 参照箇所 | 間違えたときの症状 |
|---|---|---|---|---|
| `NEXT_PUBLIC_LIFF_ID` | `2010137019-OCaRjDeQ`。 | あり（Production・Preview）。値も一致（実測）。 | `lib/liff.ts:10`・`lib/notifications.ts:320`・`app/page.tsx:23`・`app/profile/page.tsx:68`。 | 上記 2-1。 |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API 長期トークン。 | あり。 | `lib/line.ts:22,41`。 | 未設定＝dry-run（成功に見える）。 |
| `TRAINER_LINE_USER_ID` | 運用者の LINE userId（当面 naru・安定後 枝光様）。 | あり（naru 宛）。 | `lib/line.ts:91`。 | 未設定＝dry-run。誤り＝他人に管理者通知。 |
| `CRON_SECRET` | 任意の長い文字列。**Vercel Cron はこの値を `Authorization: Bearer` で自動送信する**。 | あり。 | `app/api/cron/notify/route.ts:23-29`。 | 未設定 → 401（fail closed）で cron が何もしない＝**全定期通知が静かに止まる**。 |
| `NOTIFY_DRY_RUN` | **設定しない**（=実送信）。テスト時のみ `1`。 | 無し（正しい）。 | `lib/line.ts:22`。 | `1` が残ると全通知が送られず `ok:true` のログだけ残る（テスト 8-3）。 |
| `POC_END_DATE` | W-02 確定後に `YYYY-MM-DD`（JST）。未確定の間は**設定しない**。 | 無し（正しい）。 | `lib/poc-config.ts:20-28`。 | 過去日を入れると `ended` で全通知停止（テスト 8-6）。書式違いは無視（警告ログのみ）。 |
| `NEXT_PUBLIC_SUPABASE_URL`／`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase の URL／publishable key。 | あり。 | `lib/events.ts:32-33`・`lib/supabase-server.ts:14`。 | イベントが送れず記録が消える（キュー再送はする）。 |
| `SUPABASE_SECRET_KEY` | secret key（サーバー専用）。 | あり。 | `lib/supabase-server.ts:15`。 | cron・admin・alert・users が 500。 |
| `ADMIN_PASSWORD` | 管理画面パスワード（T-5 で枝光様へ共有方法を決める）。 | あり。 | `lib/review-server.ts:29-31`。 | 未設定＝管理 API 全部 401。 |
| `DEMO_KEY`／`REVIEW_TOKEN` | デモ入口・/review 用。 | あり。 | `lib/review-server.ts:17-27`。 | 未設定＝該当経路 404。 |
| `FEEDBACK_GAS_URL` | GAS の URL。 | あり（57 日前）。 | `app/api/feedback/route.ts`。 | フィードバックが GAS に届かない（画面は成功表示）。 |
| `ANTHROPIC_API_KEY` | X-9（月次 AI 総評・9/17）実装時に必要。 | **無し**（ローカル `.env.local` にのみ存在）。 | 現状コード未参照（`@anthropic-ai/sdk` は依存のみ・`lib/diagnosis/engine.ts:20-25` は TODO）。 | X-9 実装後にキー未設定で 500。**作業一覧 X-9 備考「API キーは設定済み」は Vercel には当てはまらない**（要訂正）。 |
| `AI_NARRATIVE` | 設定しない。 | 無し。 | `lib/diagnosis/engine.ts:22`（TODO フック）。 | — |
| Cron（`vercel.json`） | `/api/cron/notify` を `0 11 * * *`（UTC）＝ JST 20:00。 | 設定どおり。 | Vercel → Project → Settings → Cron Jobs に表示・実行ログ。 | Production デプロイにしか付かない。スケジュール変更は再デプロイが必要。 |
| デプロイ経路 | `git push origin main` → 自動デプロイ（BRIEF §2）。`vercel --prod` も可（`11:行10`）。**`--yes` 禁止**。 | — | `.vercel/project.json` の存在確認後。 | 別チームに新規プロジェクトが作られる事故（`.claude/refs/vercel-deploy.md`）。 |

### 2-5. Supabase（qliivochibjwcovhrmzw）

| 項目 | あるべき値 | 現在値 | 確認方法 | 症状 |
|---|---|---|---|---|
| `users.line_user_id unique` | 制約あり（再登録の衝突を 23505 で検知して既存 ID を返す・X-1）。 | あり（`db/schema.sql:17`）。 | SQL Editor: `\d users` 相当（Table editor で unique 表示）。 | 制約が無いと同一 LINE ユーザーが 2 行になり、旧行に通知が行き続ける。 |
| `users.is_demo` | デモ経路は `true`（cron・集計から除外）。 | 列あり（`db/schema.sql:20`）。 | `select count(*) from users where is_demo;` | 実利用者が `true` だと通知ゼロ・集計から消える（`lib/notify-triggers.ts:380`）。 |
| `events(type='notify')` | 送信ログ（重複ガード・レート制限の根拠）。 | 稼働（8/7〜実績）。 | `select client_date, payload->>'code', payload->>'ok', payload->>'dryRun' from events where type='notify' order by created_at desc limit 50;` | ログが消えると once:true の通知が再送される。 |
| RLS | anon は users/trainer_messages 読めない。 | 検証済み（テスト 6-6）。 | anon キーで REST GET → 401/403。 | 漏えい。 |

---

## 3. PoC 開始前チェックリスト（18 項目）

凡例: 🖥=curl／CLI で確認可（値不要）、🔑=秘密値が要る（naru）、📱=LINE 実機（naru）、🌐=管理画面で目視（naru）。

| # | 項目 | 手順・コマンド | 期待結果 | 現状（8/19） |
|---|---|---|---|---|
| 1 | LIFF エンドポイント URL がルート | 🖥 `curl -sL https://liff.line.me/2010137019-OCaRjDeQ/today \| grep -o 'ptj-poc-ai-trainer.vercel.app[^"'"'"' <]*'` | `ptj-poc-ai-trainer.vercel.app/?liff.state=%2Ftoday` を含む（`/profile?` ではない）。 | ❌ `/profile`（要 naru 修正: LINE Developers → LIFF → エンドポイント URL を `https://ptj-poc-ai-trainer.vercel.app/` に）。 |
| 2 | 安全網の 307 が生きている。 | 🖥 `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://ptj-poc-ai-trainer.vercel.app/profile/today"` | `307 https://ptj-poc-ai-trainer.vercel.app/today`。 | ✅。 |
| 3 | リッチメニュー「きょうのトレーニング」→ /today が開く | 📱 実機でタップ。 | 「きょうのトレーニング」画面（プラン無しなら初回誘導）。 | ⏳（テスト 1-2・4-6 未実施）。#1 修正後に実施。 |
| 4 | 通知の URL から該当画面が開く | 📱 直近の N-04／N-05 のリンクをタップ。 | `/today`／`/weekly` が LIFF 内で開く。 | ⏳（同上）。 |
| 5 | 本番の LIFF ID が一致 | 🖥 本番 HTML の chunk を grep（§0）。または 🔑 `vercel env pull` で `NEXT_PUBLIC_LIFF_ID`。 | `2010137019-OCaRjDeQ`。 | ✅。 |
| 6 | Vercel 環境変数の顔ぶれ | 🖥 `cd app && cat .vercel/project.json && vercel env ls` | §0 の 11 個がある。`NOTIFY_DRY_RUN` が**無い**。`POC_END_DATE` は W-02 確定まで無い。 | ✅。 |
| 7 | cron が無認証を拒否 | 🖥 `curl -s -o /dev/null -w "%{http_code}\n" https://ptj-poc-ai-trainer.vercel.app/api/cron/notify` | `401`。 | ✅。 |
| 8 | cron が毎晩動いている。 | 🌐 Vercel → Project → Cron Jobs → 直近実行が前日 20:00 JST 前後・200。または Functions ログで `/api/cron/notify`。**手動 GET は実送信されるので開始後は叩かない**（同日重複ガードはあるが 20:00 前に届く）。 | 200 のレスポンスに `today`／`sent`／`skipped`。 | ✅（8/7〜8/16 実績・テスト 4-7）。 |
| 9 | 実送信モード | 🔑 Supabase: `select payload->>'dryRun', count(*) from events where type='notify' and created_at > now() - interval '7 days' group by 1;` | `false` のみ。 | ✅（テスト 8-3）。 |
| 10 | トレーナー通知の宛先 | 🔑 `TRAINER_LINE_USER_ID` が誰の userId か（naru か枝光様か）を決めて記録。切替手順は §5-1。 | 開始時点の宛先が運用手順（X-8）に明記されている。 | ⚠ naru 宛のまま（資料§6「当面は細谷が受けて転送」と整合。枝光様へは未周知の可能性）。 |
| 11 | 痛み申告 → トレーナー通知が実際に届く | 📱🔑 デモキー経由のユーザーで痛み申告 → `TRAINER_LINE_USER_ID` の LINE に N-10 が届く。 | 届く（本文に部位・24 時間以内のお願い・管理画面 URL）。 | ✅ 8/6 実機。開始直前に再確認推奨。 |
| 12 | 料金プランと残通数 | 🌐 OA Manager → 利用と請求 → 今月の送信数。参加人数（W-01）×15〜20 通/月で試算。 | 上限に対して余裕がある。10 名超ならライトへ切替済み。 | ⚠ 無料プラン。8/19 定例で相談（X-12）。 |
| 13 | あいさつメッセージ・応答設定 | 🌐 OA Manager → 応答設定: あいさつ ON（N-01 修正版）／チャット ON／応答メッセージ OFF。 | 設定どおり。 | ✅（`06:行13`）。文面の最終形は目視推奨。 |
| 14 | 友だち追加 → あいさつ受信 → 「はじめる」 | 📱 別アカウントで QR から友だち追加。 | N-01 が届き、リッチメニューが表示される。 | ⏳（テスト 1-1）。 |
| 15 | LINE 未連携ユーザーがいないか | 🔑 `select id, display_name, created_at from users where is_demo=false and line_user_id is null;` | 0 件（いれば外部ブラウザ登録・旧デモ経由の疑い。§4）。 | 要確認。 |
| 16 | 管理画面のパスワードと使い方 1 枚 | 🔑 `/admin` に `ADMIN_PASSWORD` で入れる。T-5（0.5h）を作成し共有方法を決める。 | 枝光様が開ける状態。 | ⏳ T-5 未着手（`06:行53`）。 |
| 17 | 案内紙の QR が LIFF URL を指す。 | 🌐 `docs/assets/T-4_annai_A5.pdf` の QR を読み取る。 | `https://liff.line.me/2010137019-OCaRjDeQ` または OA 友だち追加 URL。 | 要確認（PDF は作成済み・`06:行52`）。 |
| 18 | セキュリティヘッダー・not-found | 🖥 `curl -sI https://ptj-poc-ai-trainer.vercel.app/ \| grep -i "x-frame\|nosniff\|referrer"`；`curl -s -o /dev/null -w "%{http_code}" https://ptj-poc-ai-trainer.vercel.app/no-such-page` | 3 ヘッダーあり／404。 | ✅ ヘッダー実測。 |

---

## 4. トラブルシュート表（症状 → 原因候補 → 確認 → 対処）

| 症状 | 原因候補（可能性の高い順） | 確認 | 対処 |
|---|---|---|---|
| 通知の URL・リッチメニューを押すと「ページが見つかりませんでした」（404） | ① LIFF エンドポイント URL が `/profile` 等ルート以外（`/profile/today` に着地）。② 安全網の 307 が効かないパス（`APP_ROUTES` 外・`next.config.ts:5-21`）。③ 外部ブラウザで開いた。 | §3-1 の curl。`next.config.ts` の `APP_ROUTES` に該当ルートがあるか。 | ① エンドポイントを `https://ptj-poc-ai-trainer.vercel.app/` に変更（LINE Developers）。② `APP_ROUTES` に追加して再デプロイ。③ 案内紙・通知文言は「LINE の中で開く」前提（テスト 8-12）。 |
| 利用者に通知が 1 通も届かない。 | ① `users.line_user_id` が null（外部ブラウザ登録・旧デモ経由・旧実装の再登録）。② `is_demo=true`。③ ブロック／友だち解除（push 失敗）。④ `NOTIFY_DRY_RUN=1` が残っている。⑤ トークン失効（push 401）。⑥ `POC_END_DATE` が過去日（`ended`）。⑦ `CRON_SECRET` 未設定で cron が 401。⑧ プランの曜日が解釈不能（`normalizeWeekday` が null）。 | ① `select line_user_id, is_demo from users where id='<ID>';`。③⑤ Vercel Functions ログの `skipped[].reason` = `push-failed:<コード>`（ブロック時のコードは未確認・LINE 側仕様。テスト仕様書 8-10 は push-failed で検知する前提）／`push-failed:401`。④⑥⑦ `vercel env ls`。⑧ `select payload->'days' from events where type='plan' and user_id='<ID>' order by created_at desc limit 1;` | ① `docs/2026-08-18_line-id-recovery.md` の付け替え SQL（旧被害のみ。X-1 後は発生しない）。② `is_demo` は作成時に確定・後から変えられない設計（`app/api/users/route.ts:31-41`）→ 再登録を案内。③ 再友だち追加を案内。④ env 削除→再デプロイ。⑤ トークン再発行→env 更新→再デプロイ。⑥ env 修正。⑦ env 追加。⑧ /result でプラン再設定（テスト 8-9）。 |
| 通知が「届かない日がある」 | ① 1 日 1 通の上限（`lib/notify-triggers.ts:393-409`）。トレーナー一言 N-08 を送った日は夜のリマインドが飛ばない（テスト 8-7）。② `once:true` の通知（N-02・N-07・N-11・N-12）は生涯 1 回。③ 当日に training/skip の記録があると N-03/N-04 は出ない（`:284`）。 | Vercel ログの `skipped[].reason` = `daily-cap`／`already-sent`。 | 仕様。枝光様に「一言を送った日はリマインドが出ません」と周知（T-5 に記載）。 |
| N-03（日中リマインド）が来ない。 | 仕様: cron は 20:00 の 1 本のみで `slot=evening`。N-03 は `slot=day` でしか候補にならない（`lib/notify-triggers.ts:288-292`・`app/api/cron/notify/route.ts:39`）。 | `vercel.json` に cron が 1 本しか無い。 | X-4 残件①（存廃を naru 判断）。残すなら日中 cron を追加（`?slot=day`）。落とすなら仕様書から N-03 を外す。 |
| トレーナー（枝光様）に痛み・危険信号・相談の通知が来ない。 | ① `TRAINER_LINE_USER_ID` が naru の ID（設計どおり当面は細谷が転送）。② 未設定（dry-run で `ok:true`）。③ レート制限 429（同一利用者 1 時間 6 回・`app/api/alert/route.ts:113-128`）。④ `unknown user`（404・users 行が無い）。 | ① 誰の ID か（§3-10）。②④ Vercel ログ `[LINE DRY-RUN trainer]`／`unknown user`。③ 429 ログ。 | ① 切替手順 §5-1。② env 設定→再デプロイ。③ 想定内（連打）。④ 通常フローでは起きない（`syncUser` が先に users を作る）。 |
| 「無料枠を超えました」／月の途中で通知が止まる。 | 200 通/月到達（`push-failed:429`）。10 名で上限付近・15 名で確実に超過（`06:行77`）。 | OA Manager の月間通数。Vercel ログの 429。 | ライトプランへ切替（OA Manager → 利用と請求。数分・PTJ 様負担の合意が要る＝8/19 定例）。応急: 参加人数を絞る／頻度を落とす（非推奨）。 |
| cron が動いていない。 | ① Vercel Cron の実行失敗（デプロイ直後・Hobby 制限等）。② `CRON_SECRET` 未設定→401。③ Supabase 障害→500。④ events が 20,000 行を超えた（`route.ts:54` の `limit(20000)`。PoC 規模では到達しない）。 | Vercel → Cron Jobs の履歴／Functions ログ。 | ② env。③ Supabase ステータス確認・翌日再判定（失敗分はログを残さないので翌日に再送される・`route.ts:91-98`）。④ 期間絞り込みの最小修正（§6）。 |
| 機種変更・ブラウザデータ削除の後に通知が途切れた。 | 旧実装（8/18 以前）の再登録で `line_user_id` が旧行に残った。 | `select id, line_user_id, display_name, created_at from users order by created_at desc;` で同名 2 行。 | `docs/2026-08-18_line-id-recovery.md` の SQL。X-1 以後は `/api/users` が既存 ID を返すので再発しない（`app/api/users/route.ts:45-66`）。 |
| 通知の呼びかけが「お客様」になる。 | `users.display_name` が null（LIFF プロフィール未取得＝外部ブラウザ・standalone、または登録フォーム未完了）。 | `select display_name, line_user_id from users where id='<ID>';` | LINE 内で開き直して /profile まで進めてもらう（`app/profile/page.tsx:50-57` で `syncUser`）。 |
| 友だち追加したのに、あいさつが来ない。 | OA のあいさつメッセージ OFF／文面未設定。 | OA Manager → 応答設定。 | ON にする（N-01 修正版）。アプリ側は N-01 を送らない（`lib/notifications.ts:84` delivery `line-official`）。 |
| リッチメニューが出ない。 | ① 既定リッチメニュー未設定（API 登録のみで既定化されていない）。② 画像サイズ不一致で登録失敗。 | `curl -H "Authorization: Bearer $TOKEN" https://api.line.me/v2/bot/user/all/richmenu`。 | `POST /v2/bot/user/all/richmenu/{richMenuId}` で既定化（T-2 で実施済み）。 |
| 週次サマリー（N-05）の曜日が想定とずれる。 | 起算日＝**最初の diagnosis の日**（`lib/notify-triggers.ts:193-197`）。再登録で旧行の diagnosis が引き継がれた場合は旧起算日。 | `select client_date from events where user_id='<ID>' and type='diagnosis' order by created_at limit 1;` | 仕様。説明で吸収（起算日から 7 日ごとの最終日の夜）。 |
| PoC 終了案内（N-12）が来ない／来た後も通知が来る。 | `POC_END_DATE` 未設定（終了なし）／設定日を過ぎると全停止（`lib/poc-config.ts`）。 | `vercel env ls`。 | W-02 確定後に `YYYY-MM-DD` を設定→再デプロイ。過去日は入れない（テスト 8-6）。 |
| 管理画面から一言を送ったが届かない。 | 相手の `line_user_id` が null（X-5 で「LINE 未連携」表示あり）。 | 画面の警告表示／`lineLinked:false`（`app/api/admin/message/route.ts:54-72`）。 | 相手に LINE 内で開き直してもらう。 |

---

## 5. 運用手順（開始前後）

### 5-1. トレーナー通知の宛先を naru → 枝光様に切り替える

1. 枝光様に「心身健康倶楽部（PoC）」を友だち追加していただく（既に追加済みなら不要）。
2. 枝光様の LINE userId を取得する。取り方は 2 通り。(a) 枝光様が LIFF で登録すると `users.line_user_id` に入る（`select line_user_id from users where display_name='<表示名>';`）。(b) Messaging API チャネルの管理者本人なら「あなたのユーザーID」欄。
3. Vercel → Settings → Environment Variables → `TRAINER_LINE_USER_ID` を更新（Production）→ 再デプロイ。
4. デモキー経由のユーザーで痛み申告を 1 回行い、枝光様の LINE に N-10 が届くことを確認（§3-11）。
5. 切替日を運用手順（X-8）と「環境情報」タブ 12 行目に記録する。

### 5-2. LIFF エンドポイント URL の修正（naru・5 分）

1. LINE Developers → プロバイダー「パーソナルトレーナージャパン」→ LINE ログインチャネル 2010137019 → LIFF タブ → `2010137019-OCaRjDeQ` → 編集。
2. エンドポイント URL を `https://ptj-poc-ai-trainer.vercel.app/` に変更して保存。
3. §3-1 の curl で `?liff.state=%2Ftoday` に変わったことを確認（反映は即時〜数分）。
4. 📱 リッチメニュー「きょうのトレーニング」と通知リンクで `/today` が開くことを確認（テスト 1-2・4-6 を ✅ に）。
5. 安全網（`next.config.ts` の 307）はそのまま残してよい（別環境での取り違えに備える）。

### 5-3. 料金プランの切替（PTJ 様の OA・数分）

1. OA Manager → 設定 → 利用と請求 → プラン変更 → ライトプラン。支払い方法の登録が必要（PTJ 様）。
2. 切替後、月間通数の上限が 5,000 に変わることを確認。

### 5-4. 日次・週次の見方（O-1／O-2 の材料）

- 日次: Vercel Functions ログで `/api/cron/notify` の 200 レスポンス（`sent`／`skipped`）。`push-failed:4xx` はブロック・友だち解除の疑い（コードは未確認）、`push-failed:429` は通数上限、`no-line-user-id` は未連携。
- 週次: `/api/admin/summary`（`x-admin-password` 必須）で登録者数・実施率・相談件数。未連携者は §3-15 の SQL。
- 手動で cron を叩くと本番送信になる。検証したいときは `NOTIFY_DRY_RUN=1` を付けたローカルで `curl "http://localhost:3400/api/cron/notify?secret=$CRON_SECRET"`（`app/api/cron/notify/route.ts:13-14`）。

---

## 6. 所見（文書所見・実装所見）と最小修正案

| # | 種別 | 重大度 | 内容 | 証拠 | 最小修正案 |
|---|---|---|---|---|---|
| L-1 | 実装（設定） | High（hq 既知・確定） | LIFF エンドポイント URL が `/profile` のまま（8/19 14 時台も未修正）。 | §0 実測。 | §5-2（naru 手作業）。修正後に本書 §3-1〜4 を ✅ にする。 |
| L-2 | 文書 | Medium | `docs/prerequisites.md:50` が「エンドポイント URL を `https://<vercel-domain>/hearing` に更新」と指示しており、`liff-setup.md:16`（ルート必須）と**矛盾**。この手順を踏むと 404 が再発する。 | `docs/prerequisites.md:49-51`。 | 該当行を「`https://ptj-poc-ai-trainer.vercel.app/`（ルート）。理由は liff-setup.md 参照」に書き換える。または prerequisites.md 全体を「2026-05 時点の初期手順（現行は liff-setup.md）」と冒頭注記。 |
| L-3 | 文書 | Medium | `docs/2026-08-06_richmenu-draft.md` の構成（左「アプリをひらく」・右「相談する」テキスト送信）と、実装済みのリッチメニュー（左 2/3「きょうのトレーニング」→/today・右 1/3「アプリをひらく」・`06:行50`）が違う。「相談する」ボタンは実装されておらず、トークに落とす導線が無い。 | `docs/2026-08-06_richmenu-draft.md:8-11` vs `06:行50`。 | draft の冒頭に「【2026-08-06 実装は T-2 の構成に変更】」と追記し、実装構成を本書 §1 から転記。「相談する」を落とした判断（アプリ内 /weekly の相談＋N-09 で代替）を 1 行残す。 |
| L-4 | 文書 | Medium | 作業一覧 X-9 備考「API キーは設定済み」だが、Vercel Production に `ANTHROPIC_API_KEY` は無い（ローカルのみ）。9/17 の実装時に本番で 500 になる。 | `vercel env ls`（8/19）・`06:行74`。 | X-9 の備考を「ローカルのみ設定・Vercel は実装時に追加」に訂正。X-9 のチェック項目に env 追加を入れる。 |
| L-5 | 文書 | Medium | `.env.example` が無く、必要な環境変数の一覧はコード grep でしか分からない。`liff-setup.md:21-23` は `NEXT_PUBLIC_LIFF_ID` しか挙げていない。 | `ls .env*` → `.env.local` のみ。 | `.env.example` を追加（本書 §2-4 の 15 名＋1 行コメント。値は空）。hq が実装枠で。 |
| L-6 | 実装 | Low | 「利用者宛は 1 日 1 通・夜 20 時まで」（W-07 既定値）は cron 側だけで守られる。トレーナー一言（N-08）は時間帯・回数の制限なしに即時 push され、同日 2 通目になり得る。 | `app/api/admin/message/route.ts:56-70`（時間帯判定なし）、`lib/notify-triggers.ts:354-357,393-409`（cap は cron 内）。 | 仕様として明文化（W-07 の回答文・T-5 に「トレーナーからの一言は別枠」）。実装するなら `/api/admin/message` に JST 20 時以降は「保存のみ・push は翌日 cron に委ねる」分岐（要 naru 判断）。 |
| L-7 | 実装 | Low | N-03（日中リマインド）は本番で決して発火しない（cron が evening のみ）。「LINE通知一覧」タブでは現役の通知として先方に見せている。 | `app/api/cron/notify/route.ts:39`・`vercel.json`。 | X-4 残件①。落とすなら「LINE通知一覧」N-03 行に「PoC では送信しない」注記、残すなら `vercel.json` に `0 1 * * *`（JST 10:00・`?slot=day`）を追加（要 naru 判断・通数増）。 |
| L-8 | 実装 | Low | `TRAINER_LINE_USER_ID` が naru 宛のまま開始する前提が、先方には W-05 の質問文（「枝光様へ即時に LINE 通知」）としてしか伝わっていない。資料§6 の「当面は細谷が受けて転送」を先方合意にする必要がある。 | `06:行49,73`・資料§6・`03:行25`。 | 30-質問棚卸し §3 の W-05 after 文で報告型に。切替手順は §5-1。 |
| L-9 | 文書 | Low | 「技術検証結果」タブ 9 行目「LINE 通知の配信 ⚠ 未検証」・8 行目「データの永続化 ⚠ 未検証」が S-1〜S-5 完了後も更新されていない。 | `09:行14-15`。 | 「○ 検証済み（2026-08-06 実送信・Supabase 接続）。本開発での扱い: 同構成」に更新（hq が naru 承認後）。 |
| L-10 | 実装 | Low | `/api/cron/notify` は events を全期間 `limit(20000)` で読む。PoC 規模では問題ないが、増えると古い notify ログが切れて `once:true` の再送・重複ガード漏れが起きうる。 | `app/api/cron/notify/route.ts:51-54`。 | 本番送り。最小修正は `.gte('created_at', <起算日の最古 − 1 日>)` か、notify ログだけ別クエリで全件取得。 |
| L-11 | 文書 | Low | LIFF の「サイズ・Scope・ボットリンク機能」と OA の「あいさつ文の最終形・認証状態」はコード・docs から確認できず**未確認**。 | 本書 §2-1・2-3。 | naru が §3 の 🌐 項目を 1 回だけ目視し、本書の「未確認」を埋める。 |

## 要 naru 判断

1. L-6（N-08 の時間帯・回数制限を仕様で明文化するか、実装するか）。
2. L-7（N-03 の存廃＝X-4 残件①）。
3. §5-1 の切替時期（枝光様へ直接通知にする条件）。
4. §3-12（料金プラン）は 8/19 定例の結果で埋める。

## hq への報告

- 成果物: `review/2026-08-19_要件定義レビュー/31-LINE_LIFF設定手順_ws1.md`。
- 内容: 全体像 1 図＋ID 表／設定項目一覧 5 系統（LIFF 6 項目・Messaging API 4・OA 6・Vercel 16・Supabase 4）／開始前チェックリスト 18 項目（うち curl だけで通るもの 7・naru の実機・管理画面 11）／トラブルシュート 14 症状／運用手順 4（宛先切替・エンドポイント修正・プラン切替・日次週次の見方）。
- 実測（8/19 14 時台）: LIFF エンドポイントは**まだ `/profile`**（安全網の 307 は稼働）、本番 LIFF ID 一致、cron 無認証 401、セキュリティヘッダー 3 種あり、Vercel env は 11 名（`NOTIFY_DRY_RUN`／`POC_END_DATE` 無し＝正常、`ANTHROPIC_API_KEY` 無し）。
- 所見 11 件: High 1（L-1・hq 既知）／Medium 4（prerequisites.md の `/hearing` 指示・リッチメニュー draft と実装の乖離・X-9「API キー設定済み」の誤り・`.env.example` 無し）／Low 6。各件に最小修正案。要 naru 判断 4 点。
- 秘密値の記載なし。本番書き込みなし。コード変更なし。
