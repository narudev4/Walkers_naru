# 古谷さんへの確認事項

> コード読解（[CODE_REVIEW.md](./CODE_REVIEW.md)）の結果、**コードを読んでもわからない設計判断**が5点見つかりました。引き継ぎMTGは廃止して進める方針ですが、これらは**事前にチャット等で確認**したい内容です。
>
> Slack DM or メールで聞けば10分で済むはず。

---

## Q1. `trend_configs` テーブル（Neon Postgres）は何に使う予定だったか？

`src/lib/db/schema.ts:46-51` に `trend_configs` テーブルが定義されているが、**コード上で参照ゼロ**。
実際の TrendConfig は Google Sheets の Settings タブに保存されている（`src/lib/sheets.ts:165-224`）。

→ Sheets→Postgres移行の途中で止めたのか、それとも別用途で予約したのか。

---

## Q2. Cron スケジュール「6時間おき」と CLAUDE.md / Settings UI の「毎日0時」、どちらが正？

| 場所 | 記述 |
|---|---|
| `vercel.json` | `0 */6 * * *` (6時間おき = 1日4回) |
| `CLAUDE.md` | 「毎日0時にトレンドチェック」 |
| `/settings` 画面の Cron 説明 | 「毎日0時」 |

→ 実装を変えたが他を直してないのか、それとも `vercel.json` 側のミスで本来は毎日0時だったのか。

---

## Q3. `HARD_DEADLINE_MS = 57_000` と `maxDuration = 300` の不整合は意図的？

`src/app/api/articles/[id]/rewrite/route.ts` の rewrite API:
- ルート設定: `maxDuration = 300` (Vercel Pro想定)
- コード内: `HARD_DEADLINE_MS = 57_000` で **57秒で打ち切り**

→ Vercel Hobby (60秒制限) からの移行残骸か、リスクヘッジで意図的に短くしているのか。

---

## Q4. マルチテナント構造（org / user / media / 3ロール）はどこまで利用想定か？

実装は既に**完全なマルチテナントSaaS構造**になっている:
- `organizations` テーブル
- `users` (owner / admin / member の3ロール)
- `media` (組織内の複数メディアサイト)
- `invitations` (招待トークン)

一方、鳳汰さんの動画では「自社で満足に使える」「最終的にSaaS化」と段階的に言っている。

→ **自社（Walkers）内での複数顧客対応**が前提か、それとも**最初から外販SaaS**を視野に入れているか。  
　設計コストの優先度判断に直結する。

---

## Q5. 「Rewrite Doc Link」列（Articles H列）が現状未利用なのは？

- `src/lib/constants.ts` に H 列 = `Rewrite Doc Link` の定義あり
- ただしコード上で書き込みは無し（grep でゼロ件）
- 鳳汰さんの動画では「リライト → Google Docs に出力」のニュアンスがあった

→ Google Docs 連携を着手していて未完なのか、それとも別方針（例: 直接WP更新）に切り替えたのか。

---

## 補足: 今のところ確実なこと（聞かなくてOK）

これらは CODE_REVIEW.md で確認済みなので、確認不要:
- ロールは owner / admin / member の3段（4ロール構想は鳳汰さん側の話で実装は3段）
- businessContext は既にメディア単位で管理されている
- AI SDK / AI Gateway / Workflow / Agent SDK は使っていない（直叩き）
- WordPress 連携は **読み取りのみ**（投稿・更新は未実装）
- Articles テーブルは 13列（CLAUDE.md 記述の 12列は古い）
