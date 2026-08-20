# 司令塔 実装プラン v1.2 (Sonnet実装用)

対象読者: **実装担当エージェント(Sonnet)**。このファイルだけで作業できるように書いてある。
改訂: v1.1 = Haikuレビュアー2体の指摘を反映。v1.2(2026-07-21) = W0〜W6完走・Windows実機構築(P1)完了を受け、Phase2(W7〜W10)を追加。SPEC.md §8参照
仕様の正: [SPEC.md](./SPEC.md)(このプランと矛盾したらSPECが正。ただし作業単位はこのプランに従う)
進行管理スプシ: `1ZnfhSy1MVSEo55BtcbfSELhuYZoVu9QsYp1tsk4tnkc`

## W7〜W10 実装場所についての注記(v1.2)

W0〜W6は `/Users/naru/Walkers_naru/output/deploy/walkers-mission-control`(Mac、独自git repo)で実装し、その後 tarball 転送で自宅Windows実機(`/home/naru/mission-control/walkers-mission-control`, WSL2, `mission-control.service` で常時稼働中)に反映した。W7以降も同じ二段構え(**Mac側で実装・検証 → 完了後にnaruの確認を経てWindows実機へ反映**)を踏襲する。Windows実機は稼働中の本番環境なので、実装フェーズでは直接触らない。反映方法(tarball再転送 / git経由か)はW7完了時に別途検討する。

## 0. 前提事実(確認済み・2026-07-17時点)

| 項目 | 値 |
|---|---|
| 作業ディレクトリ | `/Users/naru/Walkers_naru/output/deploy/walkers-mission-control`(承認済みモックUI。**ここを実システムに育てる**) |
| git | 親リポジトリ(Walkers_naru)からは `output/` ごと **gitignore済み** → このディレクトリに自前の git repo を作る(W0-1) |
| Node | v22.19.0 |
| Docker | CLIあり(`/usr/local/bin/docker`)、**デーモンは停止中** → `open -a Docker` で起動が必要 |
| psql / pg_dump | **ローカル未インストール** → DB操作は全て `docker compose exec db psql ...` 経由で行う |
| Next.js | 16.2.10 (App Router, Turbopack) / React 19.2.4 / Tailwind v4 |
| 既存の依存 | next/react/react-domのみ。**追加してよい依存は `pg` `@types/pg` `tsx` `jose` の4つだけ** |
| NOAH参照コード | `/Users/naru/Walkers_naru/05_development/mission-control/reference/noah/` (読み取り専用。importせずコピーして改造) |

## 1. 絶対ルール(全タスク共通)

1. **UIデザインを変えない**。globals.css のテーマ変数・フォント・配色・レイアウトは触らない。データの取得元だけを差し替える
2. **Vercelへのデプロイはしない**(naruが判断する)。`vercel` コマンド自体を実行しない
3. 秘密情報(パスワード・APIキー)は `.env.local` のみに書く。`.env.local` は git にコミットしない(`.gitignore` に含める)。コード内にハードコード禁止
4. `reference/noah/` 配下は**読み取り専用**。編集・削除・直接import禁止
5. 親リポジトリ(`/Users/naru/Walkers_naru`)側のファイルは一切変更しない
6. スキーマ変更・依存追加(上記4つ以外)・プランにない機能追加は**やらずに報告**する
7. 各タスクの終わりに必ず: `npm run build` が通る → `git add -A && git commit -m "W?-?: 内容"` → `PLAN_PROGRESS.md` に1行追記(形式: `2026-07-17 W0-1 done: メモ`)
8. **詰まったら止まる**: 同じエラーで2回リトライして解決しなければ、`PLAN_PROGRESS.md` に `[BLOCKED] W?-? 理由` を書いて作業を終了し報告する。推測で設計判断をしない

## 2. タスク一覧

実行順は W0-1 から番号順。前のタスクが `done` でないタスクには着手しない。

---

### W0-1: git初期化

- `cd /Users/naru/Walkers_naru/output/deploy/walkers-mission-control`
- `.gitignore` に以下が含まれることを確認、なければ追記: `node_modules/` `.next/` `.env.local` `.vercel/` `db-data/`
- `git init && git add -A && git commit -m "W0-1: initial commit (approved mockup)"`
- **完了条件**: `git log --oneline` に1コミットある。`git check-ignore .env.local` が成功する(引数を出力する)

### W0-2: ローカルPostgres起動(Docker)

- `open -a Docker` を実行し、`docker info` が成功するまで10秒間隔で待つ(最大2分。起動しなければ [BLOCKED])
- リポジトリ直下に `docker-compose.yml` を新規作成:

```yaml
services:
  db:
    image: postgres:16
    container_name: mission-control-db
    environment:
      POSTGRES_USER: mission
      POSTGRES_PASSWORD: dev-only-password
      POSTGRES_DB: mission
    ports:
      - "55432:5432"
    volumes:
      - ./db-data:/var/lib/postgresql/data
```

- `docker compose up -d`
- **完了条件**: `docker compose exec db psql -U mission -d mission -c "select 1"` が `1` を返す

### W0-3: 環境変数と依存

- `npm i pg jose && npm i -D @types/pg tsx`
- `.env.local` を作成:

```
DATABASE_URL=postgres://mission:dev-only-password@localhost:55432/mission
SESSION_SECRET=<`openssl rand -hex 32` の出力に置き換える>
MC_PASSWORD=<`openssl rand -base64 12` の出力に置き換える>
CRON_SECRET=<`openssl rand -hex 16` の出力に置き換える>
```

- `.env.example` を作成(同じキーで値は `changeme`。こちらはコミットする)
- **完了条件**: `npm run build` が通る。`git status` で `.env.local` が untracked に**現れない**(ignoreされている)

### W1-1: スキーマ適用

- `db/schema.sql` を新規作成。内容は **SPEC.md §3 のDDLを一字一句そのまま**転記(9テーブル: projects, stakeholders, meetings, decisions, tasks, mails, documents, runs, kv)
- 適用: `docker compose exec -T db psql -U mission -d mission < db/schema.sql`
- **完了条件**: `docker compose exec db psql -U mission -d mission -c "\dt"` に9テーブル表示

### W1-2: シードデータ投入

- `scripts/seed.ts` を新規作成。**配列データはseed.tsファイル内に直接持たせて自己完結させる**(`src/lib/data.ts` の配列を丸ごとコピーして貼り付ける。data.tsをimportしない——W3-6でdata.ts側の配列は消えるため)。seed.tsはP3で実データ流入が始まるまでの長期フィクスチャとして保守する
- 実行: `npx tsx scripts/seed.ts`(`.env.local` は `process.loadEnvFile(".env.local")` で読む)
- 変換ルール:
  - **冪等性**: 冒頭で `truncate projects, stakeholders, meetings, decisions, tasks, mails, documents, runs cascade;` してから入れ直す(kvは触らない)
  - **data.tsの日付文字列は全てJST(日本時刻)を想定**する。`"7/14 09:12"` / `"6/22"` → **2026年**として `2026-07-14T09:12:00+09:00` / `2026-06-22` に変換する共通関数を書き、タイムゾーン付きISO8601文字列のままINSERTする
  - `PROJECTS` → projects(**18行**) + `stakeholders`(contact列から1行ずつ生成。role='先方担当者'。stakeholders配列を持つ2件はそちらを使う。**emailはデータに存在しないので全行NULLのまま**)
  - `DECISIONS` → decisions。`kind` はそのまま。`links`/`quote` はDDLに列がないので **`options` (jsonb) に `{links, quote, quoteSrc, primary, secondary}` を丸ごと入れる**
  - `NAS` → tasks。`id` はそのまま(`NA-0706-001`形式)
  - `MAILS` → mails。`kind`はそのまま。`gmail_id` は `mock-m1` 等でよい。`preview`/`to`/`cc`/`origin` は `meta` 列に入りきらないので **subjectとmetaのみ入れ、残りは捨てる**(モック専用データのため)
  - `PROJECT_DOCS` → kind が `minutes`/`recording` のものは **meetings** に(minutes_md=title、held_at=date変換、source='manual')、`artifact`/`event` のものは **documents** に
  - `RUNNER_LOGS` → runs(`loop`, `ok`, `message`=text, `ran_at`=time変換)
- **完了条件**: `docker compose exec db psql -U mission -d mission -c "select (select count(*) from projects), (select count(*) from decisions), (select count(*) from tasks), (select count(*) from mails), (select count(*) from runs), (select count(*) from meetings), (select count(*) from documents);"` が `18 | 17 | 18 | 6 | 5 | 4 | 5` を返す(meetings 4行=senseのminutes/recording、documents 5行=senseのartifact/event 2行+koinoboriのevent 3行)。2回連続実行してもエラーにならない(冪等)

### W2-1: データ層 (db.ts / repo.ts)

- `src/lib/db.ts`: `pg` の `Pool` シングルトン。`process.env.DATABASE_URL` 使用。`export async function query<T>(sql: string, params?: unknown[]): Promise<T[]>`
- `src/lib/repo.ts`: 以下の読み取り関数を実装。**戻り値の型は既存 `src/lib/data.ts` の型をそのままimportして使う**(UIを変えないため)。DBのsnake_case → 型のcamelCaseへのマッピングはSQLの `as` で行う:
  - `getProjects(): Promise<Project[]>`(stage順は現UIと同じ配列順になるようソート不要・id順でよい)
  - `getProject(id): Promise<Project | null>`(stakeholders・truthLinksは当面 stakeholders テーブルをjoinして詰める。truthLinksはW1-2で入れていないので常に undefined でよい)
  - `getDecisions(): Promise<Decision[]>`(options jsonb から links/quote/primary/secondary を復元)
  - `getNas(): Promise<Na[]>`(`overdue` は `due_date < current_date and status not in ('完了','取消')` で計算)
  - `getMails(): Promise<Mail[]>`(捨てた列は空文字で埋める)
  - `getDocs(projectId): Promise<ProjectDoc[]>`(meetings と documents をUNIONして日付降順)
  - `getRuns(limit): Promise<RunnerLog[]>`(`time` は `ran_at` から `new Date(ranAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })` で `M/D HH:MM` 形式に整形して返す)
- `LOOPS` はDBに入れない(設定値のため)。`data.ts` に残す
- **完了条件**: `scripts/smoke.ts` を作り全関数を呼んで件数をconsole出力、`npx tsx scripts/smoke.ts` が `projects=18 decisions=17 nas=18 mails=6 docs(sense)=6 runs=5` を出す(`docs(sense)=6` は `getDocs("sense")` の戻り配列の長さ=senseのmeetings 4件+documents 2件のUNION)。加えて各関数の先頭1件を `console.dir` し、フィールド名がdata.tsの型(camelCase)と一致していることを目視確認する

### W3-1: Sidebar の「直近の動き」をDB化

- `Sidebar.tsx` は `"use client"` なので直接DBを読めない。`src/app/layout.tsx` は "use client" が無いserver componentなので、**layoutの関数を async にして** `const recentRuns = await getRuns(4);` を取得し、`<Sidebar recentRuns={recentRuns}>` とpropsで渡す形に変更(layoutに `force-dynamic` は書かない。DBアクセスにより自動的に動的になる)
- `Sidebar.tsx` の `RUNNER_LOGS` importを削除し、propsを使う
- **完了条件**: `npm run dev` でサイドバーに同じ4件が表示される(`npm run build` も通る)

### W3-2: today ページのDB化

- `src/app/today/page.tsx` の `DECISIONS` importを `await getDecisions()` に置換。ファイル先頭に `export const dynamic = "force-dynamic";` を追加
- 集計タイル(5/4/4/4)は決め打ちをやめ `items.length` から算出
- **完了条件**: `/today` の表示がシードデータで従前と同一(グループ数・件数・文言)

### W3-3: projects 一覧・詳細のDB化

- `src/app/projects/page.tsx`: `PROJECTS`→`getProjects()`。`force-dynamic` 追加
- `src/app/projects/[id]/page.tsx`: `generateStaticParams` を**削除**し、`getProject(id)`・`getNas()`・`getMails()`・`getDocs(id)`・`getDecisions()` に置換(この画面のフィルタはDB側でなくJSでよい)。`force-dynamic` 追加
- **完了条件**: `/projects` と `/projects/sense` `/projects/1lc` が従前どおり表示

### W3-4: tasks ページのDB化

- `src/app/tasks/page.tsx` はclientコンポーネント(担当フィルタ)。**server wrapper方式**にする: `page.tsx` をserver componentにして `getNas()` を取得し、既存のclient部分を `TasksClient.tsx` に切り出してpropsで渡す
- **完了条件**: `/tasks` のフィルタ動作が従前どおり

### W3-5: mail・agents ページのDB化

- `mail/page.tsx`(client): W3-4と同じserver wrapper方式で `getMails()`。client部分の切り出し先は `src/app/mail/MailClient.tsx` と命名
- `agents/page.tsx`: `RUNNER_LOGS`→`getRuns(20)`。`LOOPS` はdata.tsのまま
- **完了条件**: 両画面が従前どおり表示

### W3-6: ダミーデータ削除

- `src/lib/data.ts` から `PROJECTS/DECISIONS/MAILS/NAS/PROJECT_DOCS/RUNNER_LOGS` の**配列本体を削除**(型・`STAGE_LABEL`・`LOOPS` は残す)。seed.ts はW1-2で自己完結済みなので影響なし(確認だけする)
- **完了条件**: `grep -rn "PROJECTS\b" src/ | grep -v repo` でUIからの参照が0件。`npm run build` 通過。全5画面を目視で従前どおり確認

### W4-1: タスク追加を実DB書き込みに

- `src/lib/actions.ts` を新規作成(`"use server"`)。`addTask(formData)`: tasks へ INSERT。ID採番は `NA-<MMDD>-<3桁連番>`。**MMDDはJSTの今日**(`to_char(now() at time zone 'Asia/Tokyo', 'MMDD')`)を使い、`select id from tasks where id like 'NA-<MMDD>-%'` の連番最大+1(該当なしなら001)。書き込み後 `revalidatePath("/tasks")` と `revalidatePath("/projects/[id]", "page")`
- `AddTask.tsx` のフォームsubmitをこのserver actionに接続(モーダルの見た目は変えない)
- **完了条件**: 画面からタスク追加→ `/tasks` に表示され、DBに行がある

### W4-2: 「完了にする」を実装

- `actions.ts` に `closeDecision(id)`: decisions.status='decided', decided_at=now()。options内にtask参照があれば該当taskをstatus='完了'に
- today の `CloseRow` / `DecisionCard` の primaryボタンを接続。実行後はカードが消える(`revalidatePath("/today")`)
- **完了条件**: 「完了の確認」5件のうち1件を閉じる→リロード後も消えている。`select status from decisions where ...` で 'decided'

### W4-3: タスクのステータス変更

- **先に型を拡張**: `src/lib/data.ts` の `Na["status"]` union に `"完了" | "取消"` を追加する(現状は5値のみでDB側の想定と不一致のため。この型変更はUIに影響しない)
- `actions.ts` に `updateTaskStatus(id, status)`(許可値: 未着手/AI実行中/着手/承認待ち/ブロック/完了/取消)
- tasks 画面の各行にステータス変更のセレクト(既存Chipの見た目を流用した最小限のUI)を付ける
- **完了条件**: 変更がDBに反映され、リロード後も保持

### W5-1: runs/kv ヘルパーとcron共通パターン

- `src/lib/ops.ts`: `logRun(loop, ok, message)`(runsへINSERT) / `kvGet(key)` / `kvSet(key, value)`
- `src/lib/cron-auth.ts`: リクエストヘッダ `Authorization: Bearer <CRON_SECRET>` を検証する関数
- **完了条件**: smoke.tsに `logRun("TEST", true, "hello")` を足して実行→runsに行が増える→その行をDELETEして戻す

### W5-2: L5 リマインド cron

- `src/app/api/cron/remind/route.ts`(GET, cron-auth必須) と `src/app/api/remind/run/route.ts`(POST, ログイン不要・cron-auth必須。中身は同じ関数を呼ぶ)
- ロジック(`src/lib/remind.ts`):
  - 対象: `projects.presented_at is not null` かつ `presented_at <= current_date - 7` かつ stage='proposal'
  - 冪等ガード: 同じ project_id で `decisions(kind='branch', status='open')` に title が `'<案件名> の出口判断'` の行が**既にあればskip**
  - 起票: decisions へ INSERT(kind='branch', title=`'<案件名> の出口判断'`, detail=`'提示後N日。受注/失注/追わないを決める'`)
  - 最後に `logRun("L5", true, "対象X件 / 起票Y件")`
- **完了条件**: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/remind/run` で **proposal 5案件**(toppan/wi2/jre/siesta/entre)ぶんの判断カードが立つ。**2回目の実行では起票0件**(冪等)。runsに2行

### W5-3: L6 消し込み cron

- `src/app/api/cron/sweep/route.ts` + `src/app/api/sweep/run/route.ts`
- ロジック(`src/lib/sweep.ts`): `mails.kind='sent' and task_id is not null` × 該当taskが未完了 → decisions(kind='close', title=`'<task.title> は送信済み'`, detail=閉じる提案) 起票。冪等ガードは W5-2 と同型(同project・kind='close'・同titleのopen行があればskip)。`logRun("L6", ...)`
- シードに sent データがないため、検証は `scripts/test-sweep.ts` として自動化する: ①mails へ `kind='sent', task_id='NA-0706-005'` をINSERT → ②sweep関数を直接2回呼ぶ → ③decisions(close)が1件だけ増えたことをassert → ④finallyでテスト行(mailsのテスト行と起票されたdecision)をDELETE
- **完了条件**: `npx tsx scripts/test-sweep.ts` が PASS を出力し、実行後のDBにテストデータが残っていない

### W5-4: 簡易ログイン(公開前の必須ガード)

- `reference/noah/lib/auth-session.ts` / `session-cookie.ts` を**参考に**(コピー改造)、`jose` でHS256署名のセッションcookie実装
- `/login` ページ(パスワード1欄のみ、`MC_PASSWORD` と照合)。`src/app/(protected)/` レイアウトグループを作り、既存の全画面をその配下に移動、レイアウトでcookie検証→未ログインは `redirect("/login")`
- 画面の見た目は既存のトンマナ(globals.cssの変数)を流用した最小フォーム
- **完了条件**: 未ログインで `/today` →`/login` にリダイレクト。正しいパスワードでログイン→全画面が見える。`npm run build` 通過

### W6-1: tl;dv 取込スキャフォールド

- `reference/noah/lib/tldv.ts` を `src/lib/tldv.ts` にコピーする。**tl;dv APIを叩く関数(一覧取得・transcript取得など)はそのまま残し、Supabase/KVへ保存している箇所だけを削って**、新設の `ingestTldvMeeting(payload)` 関数(db.ts経由で meetings へINSERT)に置き換える(`TLDV_API_KEY` 未設定なら何もせず `{skipped: true}` を返す)
- `src/app/api/tldv-webhook/route.ts`(参考: reference/noah/api/tldv-webhook)と `src/app/api/cron/tldv-poll/route.ts` を作成。webhook受信→meetings へ INSERT(project_id は null 可。紐づけは後続фェーズ)
- APIキーが無い環境なので**実通信のテストはしない**。ユニット的にhandlerへ模擬payloadをPOSTして meetings に行が入ることだけ確認
- **完了条件**: 模擬payloadで meetings +1行。`TLDV_API_KEY` 未設定でビルド・起動が壊れない

### W6-2: Gmail取込の準備メモ(実装しない)

- `docs/W6-gmail-notes.md` に、reference/noah の gmail 系**6ファイル**(gmail.ts / gmail-check-runner.ts / gmail-check-store.ts / gmail-hp.ts / gmail-lastseen-runner.ts / gmail-lastseen-store.ts)の構造(何がどのenvとスコープを要求するか、どの関数を meetings/mails 書き込みに差し替えるか)を読んで箇条書きにする。**コードは書かない**(OAuth設定はnaruと行うため)
- **完了条件**: メモが存在し、必要なenv一覧(GMAIL_*)が列挙されている

---

## Phase2タスク(W7〜W10、2026-07-21追加)

実施順序: **W7 → W8 → W9 → W10**(クレデンシャル待ちが少ない順。詳細根拠はSPEC.md §6・§8)。前タスクが `done` でないタスクには着手しない、という原則は継続。

### W7-1: skillsテーブル追加 + 同期API

- `db/schema.sql` に `skills` テーブルを追記(SPEC.md §8.3のDDL。列: id/category/status/frozen_reason/description/trigger_text/line_count/ref_file_count/has_tool_table/depends_on/last_updated_at/last_updated_source/synced_at)。適用は既存パターン(`docker compose exec -T db psql ... < db/schema.sql`、既存テーブルとの重複防止に `create table if not exists` を使う)
- `src/app/api/skills/sync/route.ts`(POST)を新規作成。`cron-auth.ts` の認証パターンを流用(`Authorization: Bearer <CRON_SECRET>`)。リクエストボディはスキルのJSON配列を受け取り、`id` をキーにupsert
- **完了条件**: 模擬JSON配列をPOSTして `skills` テーブルに行が入る。認証ヘッダなしでは401

### W7-2: Mac側スキャナスクリプト

- `05_development/mission-control/scripts/skills-sync.py` を新規作成(Python標準ライブラリのみ、`walkers-dashboard/refresh.py` のメタデータ抽出ロジックを踏襲するが参照パスは `.claude/skills/{name}/SKILL.md` に修正)
- 抽出項目: フロントマターdescription、トリガー文字列(3パターンの正規表現)、`git log -1 --format=%ad`(未追跡ファイルはmtimeフォールバック、`last_updated_source`に記録)、行数、`## 利用ツール`表の有無、付随ファイル数
- category/status/depends_on はヒューリスティック抽出(手動棚卸しの余地を残す)。**status算出はCLAUDE.mdの「凍結済み」節の宣言を必ず優先**し、SKILL.md内の注記と食い違えばCLAUDE.md側を採用する
- 抽出結果をJSONにまとめ、W7-1のAPIエンドポイントへPOST(Mac→Windows実機はTailscale経由URLを想定。実行時のURLは `.env` 等ではなくスクリプト引数で渡す)
- **完了条件**: スクリプト実行で57件前後のスキルが同期される。冪等(2回実行してもエラーにならない)

### W7-3: /skills 画面

- `/skills`(一覧): カテゴリ別カードグリッド(walkers-dashboard `renderSkills()` パターン踏襲)、statusバッジ(active/frozen/experimental)、クライアントサイド検索
- `/skills/[id]`(詳細): SKILL.md本文の軽量Markdown変換表示、メタデータパネル、depends_on(誤検知を含みうる旨を明記した簡易リスト表示)
- **完了条件**: `/skills` でカード一覧が表示され、検索・詳細遷移が動作する

### W8-1: tl;dv project_id紐づけ

- `meetings` テーブルに `tldv_id text unique`・`attendees jsonb` を追加(ALTER)
- `src/lib/tldv.ts` の取込処理で、`attendees` のemailを `stakeholders.email` と完全一致でJOINし `project_id` を決定。ヒットしなければnullのまま
- `/today` または新規セクションに「未紐づけMTG」一覧+手動紐づけドロップダウンを追加
- **完了条件**: 模擬payload(attendees付き)取込で該当stakeholderがいれば project_id が自動セットされる。いない場合は未紐づけ一覧に出る

### W8-2: tl;dv webhook認証

- 現状無認証(TODOコメントのみ)の `src/app/api/tldv-webhook/route.ts` に認証を実装。tl;dv側が署名/シークレット検証をサポートするか要調査(未確認)。サポートが無ければ「webhook URLをランダムパスセグメントにする」+ Cloudflare Access等の代替防御をnaruと相談
- **完了条件**: 認証なしのリクエストを拒否する。正しい認証情報では従来どおり動作する

### W8-3: 実キー設定・実webhook登録(naru + 実機作業。コード変更なし)

- `TLDV_API_KEY` をWindows実機の `.env` に設定(値は既存 `credentials/tldv_api_key.txt` と同じ)
- tl;dv管理画面からTailscale経由の実webhook URLを登録し、実際のMTGで自動取込を確認
- **完了条件**: 実MTG後に `meetings` に行が自動で増える

### W9-1: proposals/proposal_versions/ai_edit_queueテーブル追加

- `db/schema.sql` にSPEC.md §8.2(2026-07-21再設計版)のDDLを追記して適用(`proposals`/`proposal_versions`/`ai_edit_queue`の3テーブル。`proposal_versions`に`pdf_s3_key`/`pdf_generated_at`は**含めない**、PDFはブラウザ印刷のみでシステム側に保持しないため)
- **完了条件**: `\dt` で3テーブルが増える

### W9-2: /proposals 画面(人間による直接編集+印刷)

- `/proposals`(一覧): 案件別・ステータス別カード、`has_placeholder=true` の警告バッジ
- `/proposals/[id]`(編集): バージョン履歴サイドバー + HTML表示(contenteditable)/HTMLソースtextarea切替 + 改訂版作成ボタン + `window.print()`を呼ぶ「印刷/PDF保存」ボタン(`@media print`で不要なUI要素を非表示にするCSSを追加。globals.cssのテーマ変数自体は変更しない)
- `/proposals/[id]/versions/[n]`(閲覧専用プレビュー)
- 「送付済みにする」ボタン: `documents(kind='proposal', project_id, title, url_or_s3_key=null, occurred_at=now())` へ1行登録し、案件詳細画面のタイムラインに乗せる
- **完了条件**: 3画面が表示され、下書き作成→改訂版作成→印刷→送付済み登録の一連が動作する

### W9-3: AI編集キュー(P6最小実装) — DB+API

- `ai_edit_queue`テーブル(W9-1で追加済み)へのINSERT用server action(`requestAiEdit(proposalVersionId, prompt)`)を実装: `target_kind='proposal_version'`, `target_id`, `prompt`, `status='pending'`でINSERT
- ポーリング用API(`GET /api/proposals/[id]/ai-edit-status`)または既存のserver actionでのポーリング読み取りで、`ai_edit_queue`の該当行の`status`を返す
- `/proposals/[id]`編集画面に「AIに指示」入力欄+送信ボタンを追加。送信後は3秒間隔でポーリングし、`status='done'`になったら`proposal_versions.html_content`を再取得して画面を更新。`status='error'`なら`result_note`をエラー表示
- **完了条件**: 画面から指示を送信→`ai_edit_queue`に`pending`行が入る→(W9-4のワーカーが処理した後)画面が自動更新される

### W9-4: Mac側常駐ワーカー(ai-edit-worker.py)

- `05_development/mission-control/scripts/ai-edit-worker.py` を新規作成(親リポジトリ側。W7-2と同じ例外パスとして扱う。Python標準ライブラリ+DB接続が必要なため`psycopg2`等が要るならこのスクリプト限定の依存として許容——**mission-control本体(Next.js)の依存追加ルールの対象外**、その旨をPLAN_PROGRESS.mdに明記すること)
- ロジック: `ai_edit_queue`を10秒間隔でポーリング → `status='pending'`の行を`processing`に更新 → 対象の`proposal_versions.html_content`を取得 → プロンプトとHTMLを組み立てて`claude -p "..."`をheadless実行(`walkers-dashboard/claude_session_hub.py`の`quick_run()`と同種のsubprocess呼び出し。API従量課金ではなくClaude Codeサブスクセッションを使う設計であることに注意)→ 出力から修正後HTML全体を抽出し`proposal_versions.html_content`をUPDATE、`status='done'`に更新。抽出に失敗したりclaudeコマンドがエラー終了した場合は`status='error'`+`result_note`
- launchdでの常駐化は今回のタスクスコープ外(手動起動での動作確認まででよい)。動作確認: モック行をINSERT→ワーカーを1回実行→html_contentが更新されstatus='done'になることを確認
- **完了条件**: モックのpending行に対してワーカーを実行すると、Claude Codeが実際にHTMLを修正しDBに書き戻す。エラー時(不正なtarget_id等)はstatus='error'になる

### W10-1: Gmail OAuthクライアント設定(naru実行。コード変更なし)

- naru本人による1回限りのOAuth同意フロー(`GSHEETS_CLIENT_ID/SECRET`共用可否確認 + 新規`GMAIL_REFRESH_TOKEN`, scope=`gmail.readonly`)
- **完了条件**: `GMAIL_REFRESH_TOKEN` 等が `.env` に設定される

### W10-2: Gmail連携実装

- `mails` テーブルに `thread_id`/`direction`/`from_addr`/`to_addr`/`received_at` を追加(ALTER)
- `reference/noah/lib/gmail*.ts` を素の `fetch` で書き直し(SDK追加なし)、書き込み先を `mails`/`tasks` に
- **完了条件**: Gmail実データを巡回し `mails` に行が入る

## Phase3候補タスク(W11、2026-08-17追加)

### W11: 承認インボックス — スマホから成果物を確認してGOを出す(起票のみ・naru承認済み)

- 背景: minorun365/html-share のインボックス機能を見た naru の要望「タスクが loop で上がってきて、成果物(HTML)を理解して、AI に GO を出す」(2026-08-17)。html-share 自体は導入しない(AWS凍結中・context-view と同機能の二の舞回避)。借りるのは設計パターンのみ
- 位置づけ: P4(スマホから承認操作)は完成済みのため、足りないのは次の2点
  1. 承認待ちアイテムに**成果物のHTMLプレビュー**を添付して一覧表示する(承認前に中身を理解できる状態にする)
  2. **GO 操作が実行体に届く経路**: 承認 → `ai_edit_queue` または `tasks(mode=auto)` に行が入り、W9-4 の Mac 側ワーカー(`claude -p` headless)が拾って実行する
- 前提: W9-3/W9-4(P6最小=AI編集キュー+ワーカー)の完了。**W9 完了前に着手しない**
- タスク分解(W11-1〜)は着手時に行う

### W10-3: L2/L6実データ確認

- 未対応検知(L2)・送信検知(L6拡張)がGmail実データで動作することを確認
- **完了条件**: 実メールで未対応検知・送信済み消し込みが発生する

---

## 3. SPECフェーズとの対応

| プラン | SPEC工程表 |
|---|---|
| W0〜W1 | P1の一部(ローカル版。Windows実機セットアップはnaruと別途) |
| W2〜W3 | P2 読み |
| W4 | P4 書き |
| W5-1〜3 | P5 定期 |
| W5-4 | P1のTunnel公開の前提 |
| W6 | P3 取込(スキャフォールドまで) |
| W7 | P8 新設(Skills可視化) |
| W8 | P3 取込の残り(tl;dv本番接続) |
| W9 | P9 新設(提案書HTML→PDF化) |
| W10 | P3 取込の残り(Gmail連携) |
| 対象外 | P6 LLM連携 / P7 運用検証 |
