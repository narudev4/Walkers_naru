# Walkers 司令塔 (Mission Control) — システム仕様書 v1

作成: 2026-07-16 / 改訂: 2026-07-21(v2 = P1完了実測反映 + Phase2としてAPI/MCP拡張・提案書PDF化・Skills可視化を追加。詳細は §8)
経緯: `00_context/memories/decisions.md` 2026-07-16・2026-07-20 エントリ参照
進行管理スプシ(真理源): `1ZnfhSy1MVSEo55BtcbfSELhuYZoVu9QsYp1tsk4tnkc`(タブ: 工程表 / テーブル設計 / NOAH移植一覧 / 未決事項)
名称は仮。正式名称は未決事項タブ参照

## 1. 目的

人間の仕事を意思決定のみに近づける。そのために:

1. **視覚化** — 案件・タスク・メール・AI実行を1つのダッシュボードに集約(モック承認済み)
2. **自動化** — イベント(MTG録画完了・メール受信等)が起きたら次の成果物(議事録・NA・下書き)が承認手前まで自動で進む
3. **定期実行** — リマインド・消し込み・未対応検知が人手なしで回る

核心の困りごと: MTGで生まれたコンテキスト(議事録・決定事項)が構造化されて保存されず、毎回コピペで再注入している。→ **DBをコンテキストの単一保管庫にする**。

## 2. アーキテクチャ

```
tl;dv ──webhook──→ Cloudflare Tunnel ─┐
                                       ↓
自宅Windows:
  ├─ Next.js アプリ (画面 + /api/cron/* + /api/*/run)
  ├─ PostgreSQL 16 (構造化データ)
  └─ スケジューラ (Windowsタスクスケジューラ → /api/cron/* を叩く)
        │
        ├─ 日次 pg_dump ──→ AWS S3 (バックアップ)
        └─ 逐語録等の生データ ──→ AWS S3 (DBにはキーのみ)

naru ──スマホ/Mac──→ Cloudflare Tunnel (Access認証) ──→ ダッシュボード
ローカルClaude (Mac) ──→ Tailscale/LAN ──→ Postgres 直読み書き (LLM仕事担当)
```

### 設計原則

- **生データはS3、DBは構造化データ+ポインタ** (前回Neon無料枠即枯渇の教訓)
- **LLM不要の決定的処理は cron、LLMが要る仕事はローカルClaude(サブスク定額)**。API従量課金(`@anthropic-ai/sdk`)は使わない
- **セッション記憶に依存しない**: エージェントは毎回DBから最新コンテキストを読み、結果をDBに書いて終了する
- tl;dv は **webhook + ポーリングの二重経路** (NOAH踏襲)
- cron は **`/api/cron/X`(定期) + `/api/X/run`(画面から手動発火)の2ルート構成** (NOAH踏襲)

## 3. DBスキーマ (Postgres)

```sql
-- 案件ハブ
create table projects (
  id               text primary key,          -- 'sense', '1lc' 等 ASCII
  name             text not null,
  stage            text not null,             -- inquiry/scheduled/negotiation/proposal/contracted/dormant/internal
  sub_state        text,
  amount           text,
  next_mtg_at      timestamptz,
  presented_at     date,                      -- リマインド判定の起点
  last_activity_at timestamptz,
  summary          text,
  created_at       timestamptz not null default now()
);

create table stakeholders (
  id                bigint generated always as identity primary key,
  project_id        text not null references projects(id),
  name              text not null,
  role              text,
  email             text,                     -- メール⇔案件の自動紐づけ鍵
  is_decision_maker boolean not null default false
);

-- コンテキストの芯: MTG・議事録
create table meetings (
  id                bigint generated always as identity primary key,
  project_id        text references projects(id),
  held_at           timestamptz not null,
  title             text,
  source            text not null default 'tldv',  -- tldv/manual
  minutes_md        text,                     -- 構造化議事録(DB本体に保存)
  transcript_s3_key text,                     -- 逐語録はS3
  recording_url     text,
  created_at        timestamptz not null default now()
);

create table decisions (
  id          bigint generated always as identity primary key,
  project_id  text references projects(id),   -- null可(横断判断)
  meeting_id  bigint references meetings(id), -- どのMTG発か(出所追跡)
  kind        text not null,                  -- close/review/restore/branch
  title       text not null,
  detail      text,
  options     jsonb,
  status      text not null default 'open',   -- open/decided
  chosen      text,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table tasks (
  id          text primary key,               -- 'NA-0706-001' 形式を継続
  project_id  text references projects(id),
  meeting_id  bigint references meetings(id), -- 出所追跡
  title       text not null,
  owner       text not null,                  -- naru/AI/先方/古谷…
  mode        text not null,                  -- auto/assist/human
  due_date    date,
  status      text not null default '未着手', -- 未着手/AI実行中/承認待ち/着手/ブロック/完了/取消
  close_hint  text,
  created_at  timestamptz not null default now()
);

create table mails (
  id         bigint generated always as identity primary key,
  project_id text references projects(id),    -- null可
  task_id    text references tasks(id),       -- 送信検知→NA消し込みの紐づけ
  gmail_id   text unique,
  kind       text not null,                   -- draft/unattended/sent
  subject    text,
  status     text,
  meta       text,
  created_at timestamptz not null default now()
);

create table documents (
  id            bigint generated always as identity primary key,
  project_id    text not null references projects(id),
  kind          text not null,                -- artifact/event/contract/proposal…
  title         text not null,
  url_or_s3_key text,
  occurred_at   timestamptz
);

-- 運用系 (NOAH踏襲)
create table runs (
  id      bigint generated always as identity primary key,
  loop    text not null,                      -- L1〜L6
  ok      boolean not null,
  message text,
  ran_at  timestamptz not null default now()
);

create table kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
```

### エージェント向けコンテキスト束ね(ビュー相当)

案件について聞かれたら: `projects` + 直近N件の `meetings.minutes_md` + `status='open'` の `decisions` + 未完の `tasks` を束ねて返す。ローカルmd(CONTEXT.md)は「コンテキストはDBにある」というポインタに格下げ。

## 4. NOAH (noah-cockpit) からの移植ファイル一覧

参照スナップショット: `Tsukasa7777777/noah-cockpit` (2026-07-16 sanitized)

| NOAHのファイル | 用途 | 改造点 |
|---|---|---|
| `src/lib/tldv.ts` | tl;dv APIクライアント | ほぼそのまま |
| `src/app/api/tldv-webhook/route.ts` + `api/cron/tldv-poll/` | 議事録二重経路 | 書き込み先を meetings テーブルに |
| `src/lib/gmail.ts` `gmail-check-runner.ts` `gmail-hp.ts` `gmail-lastseen-runner.ts` | Gmail巡回・問い合わせ検知・未対応検知 | 書き込み先を mails/tasks に |
| `src/lib/kv-store.ts` `supabase-rest.ts` | KV・データ層 | PostgREST→`pg`直結に書き換え(自宅Postgresなので) |
| `src/lib/auth.ts` `auth-session.ts` `invite-actions.ts` | 認証(scrypt+セッション) | 一人用に簡素化可。ドメイン制限は維持 |
| cron 2ルート構成 (`/api/cron/X` + `/api/X/run`) | 定期+手動発火 | パターンとして踏襲 |
| `src/lib/sales-status-judge.ts` `sales-status-runner.ts` | ステータス前進判定 | L5リマインドの参考 |

**移植しないもの**: `reply-draft-ai.ts`(Anthropic API直呼び→ローカルClaudeに置換) / members・recruit・gov-enterprise・newbiz・marketing・SNS・SEO各画面(一人用に不要) / Notion同期(mirror不要、DBが正)

## 5. ループ実装マッピング

| ループ | 実装 | LLM | 実行場所 |
|---|---|---|---|
| L1 問い合わせライフサイクル | 既存GAS続投 → 将来 `/api/cron/inquiry` に移設 | Gemini無料枠(分類のみ) | GAS→Windows |
| L2 未対応連絡の探索 | `gmail-lastseen-runner` 移植 | 不要 | cron |
| L3 MTGパイプライン | tldv webhook+poll → meetings書き込み → **議事録構造化・NA抽出はローカルClaudeがDBのキューを処理** | 必要 | cron(取込) + ローカルClaude(構造化) |
| L4 タスク自走 | tasks から mode=auto/assist を取得しローカルClaudeが実行、成果を承認待ちに | 必要 | ローカルClaude |
| L5 リマインド | presented_at/due_date の経過日数評価 → decisions/tasks 起票 | 不要 | cron |
| L6 実行済み消し込み | Gmail送信履歴 × mails.task_id 突合 → 完了推奨起票 | 不要 | cron |

## 6. 工程表

| Phase | 内容 | 完了条件 | 状態(2026-07-21時点) |
|---|---|---|---|
| **P1 土台** | Windows環境構築(Postgres・Node・タスクスケジューラ・S3バックアップ)、スキーマ適用 | スマホから画面が見える + pg_dumpがS3に届く | ✅完了。外部アクセスはTailscale経由(Cloudflare Tunnelは不採用) |
| **P2 読み** | モックのダミーデータ(`lib/data.ts`)をDB読みに置換。既存実データ(パイプラインDB・minutes/)の初期投入 | ダッシュボードが実データを表示 | ✅完了 |
| **P3 取込** | tl;dv二重経路 + Gmail巡回の移植(L2/L3取込部) | MTGをすると meetings に自動で行が増える(project_id自動紐づけ含む) | 🟡一部完了。tl;dv本体は実装済み(W6-1)、残: project_id紐づけ・webhook認証・実キー設定(W8)。Gmailは未着手・要naru OAuth同意(W10) |
| **P4 書き** | 画面からの状態変更(完了にする・承認・タスク追加)を実装 | スマホから承認操作ができる | ✅完了 |
| **P5 定期** | L5リマインド・L6消し込みのcron化 | 提示後7日で自動で判断カードが立つ | ✅完了 |
| **P6 LLM連携** | ローカルClaudeのDBキュー処理(議事録構造化・下書き生成・L4) | MTG→議事録→NA→下書きが承認手前まで無人で進む | ⬜未着手。P3完了後に着手 |
| **P7 運用検証** | 7日間の運用継続(完了の定義) | 「実験中」ラベルを外す | ⬜未着手 |
| **P8 新設** | Skills可視化ダッシュボード(詳細は §8.3) | スキル一覧・詳細画面が表示され最終更新日/トリガー/依存関係が見える | ⬜今回対象 |
| **P9 新設** | 提案書HTML→PDF化フロー(詳細は §8.2) | 編集→PDF化→documents登録がシステム内で完結する | ⬜今回対象 |

各Phaseの終わりにダッシュボードで動作確認 → naruのFB → 次へ。**P-番号順と実施順は独立でよい**(P5がP3より先に完成した前例あり)。今回の推奨着手順: P8(依存ゼロ・即着手可)→P3残(tl;dv、クレデンシャル不要)→P9(要naru合意)→P3残(Gmail、要naru OAuth)。

## 7. 未決事項

真理源は進行管理スプシ「未決事項」タブ。決定済み事項(2026-07-20時点):
- Windows側のNode常駐方式 → **systemd**(`mission-control.service`)。WSL2自体はタスクスケジューラで自動起動
- Cloudflare Tunnel の Access 認証方式 → **不採用に変更**。Tailscaleのみで外部アクセスを完結
- ローカルClaude(Mac)→自宅Windows Postgres の接続経路 → **Tailscale**確定

未決のまま(Phase2分含めスプシ参照):
- 既存パイプラインDBスプシとの併存期間・移行手順
- システム正式名称
- Phase2(P8/P9/P3残)の設計論点13件(§8末尾サマリー参照。詳細は進行管理スプシ「未決事項」タブ)

## 8. Phase2 — API/MCP連携拡張・提案書PDF化・Skills可視化(2026-07-21策定)

naruの構想「P3のようなAPI/MCP連携箇所の拡張」「提案書のHTML作成→PDF化フロー」「skillsの可視化」の3件を、6エージェント並列調査(claude-sessions.html分析・提案書フロー現状・walkers-dashboard v4資産・tl;dv/Gmailクレデンシャル状況・skills一覧・HTML→PDF技術選定)を経て統合したプラン。**全設計とも既存ルール「追加npm依存はpg/@types/pg/tsx/joseの4つだけ」を維持する形で組んだ**(依存追加ゼロ)。

### 8.1 API/MCP連携拡張(P3残 = tl;dv本番接続 + Gmail連携)

- **tl;dv**: `reference/noah/lib/tldv.ts`踏襲の直接REST fetch(`TLDV_API_KEY`)。tl;dv用MCPサーバーは存在しない。project_id紐づけは`meetings.attendees`(tl;dv参加者email)と`stakeholders.email`の完全一致で行い、外れは手動紐づけ画面へ
- **Gmail**: 素の`fetch`でGmail REST API + OAuth2トークンリフレッシュを直書き(SDK追加なし)。**現行の`mcp__google-workspace__*`はMacのlocalhost:8000にバインドされたローカルMCPサーバーで、Windows常駐のNext.jsサーバーからは物理的に到達不可能**。mission-control専用の新規OAuthクライアント(NOAH由来、`GSHEETS_CLIENT_ID/SECRET`共用+新規`GMAIL_REFRESH_TOKEN`)が必要で、naru本人による1回限りのOAuth同意フローが要る
- DDL追加(既存9テーブルへのALTERのみ):
  ```sql
  alter table meetings add column tldv_id text unique, add column attendees jsonb;
  alter table mails add column thread_id text, add column direction text check (direction in ('inbound','outbound')),
    add column from_addr text, add column to_addr text[], add column received_at timestamptz;
  ```
- tl;dv webhook認証: `TLDV_WEBHOOK_SECRET`共有シークレット方式で実装済み(W8-2。header `x-webhook-token` / `Authorization: Bearer` / URLクエリ`?token=`の3経路に暫定対応。tl;dv側の実際の設定UIを見てW8-3で不要な経路を削る想定)

### 8.2 提案書HTML→PDF化フロー(2026-07-21 naru確認を経て再設計)

現行の正式フロー(`create-proposal`/`propose-and-demo`スキル)はGoogle Docsテンプレコピー+find_replaceだが、**実際には直近3件(FUNMAXJAPAN・株式会社陽幸・鯉幟株式会社)がGoogle Docsを経由せずHTML→PDFで非公式運用済み**(未コミット)。この機能は現場の実態をシステム化して回収する位置づけ。

naruの要求: 「HTMLで表示して、プロンプトでの修正と、細かい部分は人間の修正をできるUIにしたい。完了したらcmd+Pでpdf保存」「このコックピットシステムでの作業(メール返信なども)はコンテキスト把握してる前提で作業する」。この**「プロンプトで修正」要求により、単純なcontenteditable編集ではなく、SPEC.md設計原則(LLMが要る仕事はローカルClaude/API従量課金は使わない)に沿った非同期AI編集キューが必要**と判明。naruとの確認の結果: **P6(LLM連携)の最小実装を先にP9の一部として作る**方針で合意。PDF化は**ブラウザ印刷(`cmd+P` + `@media print`)のみ**に確定(Gotenbergは不採用)。

- 保存先: **Postgres text列**(html_content)。理由: ローカルClaudeが既存アーキテクチャ通りTailscale経由でPostgresを直接読み書きできる。Google Driveは別ドキュメントモデルでHTML編集・AI読み書きに不向き
- レビュー動線: **naru一人でレビュー→完成後に上司へ共有**(コメント機能等は作らない)
- 新規テーブル: `proposals`(id/project_id/title/status/latest_version_id) / `proposal_versions`(id/proposal_id/version_no/html_content/amount_text/has_placeholder/created_by/change_note)。**pdf_s3_key/pdf_generated_atは削除**(PDFはブラウザ印刷のみでシステム側に残さないため)
- **新規テーブル `ai_edit_queue`(P6最小実装。汎用キュー、将来の議事録構造化・NA抽出等にも再利用可能)**:
  ```sql
  create table ai_edit_queue (
    id           bigint generated always as identity primary key,
    target_kind  text not null,           -- 'proposal_version' (将来 'meeting_minutes' 等に拡張)
    target_id    text not null,
    prompt       text not null,           -- naruの指示
    status       text not null default 'pending', -- pending/processing/done/error
    result_note  text,
    created_at   timestamptz not null default now(),
    processed_at timestamptz
  );
  ```
- **Mac側常駐ワーカー**(`05_development/mission-control/scripts/ai-edit-worker.py`): `ai_edit_queue`を定期ポーリング(例10秒間隔)→`status='pending'`の行を`processing`に更新→対象の`html_content`+`prompt`を組み立て、`claude -p "..."` をheadless実行(`claude-sessions.html`の`quick_run()`と同じ手法。API従量課金ではなくClaude Codeサブスクセッションを使う)→出力から修正後HTML全体を取り出し`proposal_versions.html_content`を更新、`status='done'`。エラー時は`status='error'`+`result_note`。launchdで常駐化
- 新規画面: `/proposals`(一覧)・`/proposals/[id]`(編集: バージョン履歴サイドバー+HTML表示+「AIに指示」入力欄(送信で`ai_edit_queue`にpending行をINSERT、UIはポーリングで完了を待つ)+人間による直接編集(contenteditable)+`cmd+P`印刷ボタン)・`/proposals/[id]/versions/[n]`(閲覧専用)
- 確定時、印刷したことを示す操作(例:「送付済みにする」ボタン)で`documents(kind='proposal', ...)`へ1行登録(PDFファイル自体は保持しない。url_or_s3_keyはnullまたはproposal_versionへのアプリ内リンク)

### 8.3 Skills可視化ダッシュボード

`05_development/walkers-dashboard/claude-sessions.html`(セッション管理)と同ディレクトリの`refresh.py`/`index.html`(v4のSkillsパネル)のパターンを移植。ただしv4のパスは`.claude/commands/`という旧配置(2026-04-10に`.claude/skills/`へ移行済み)を参照しており要修正。

- `.claude/skills/*/SKILL.md` はMacのローカルファイルのためWindows常駐Postgresから直接読めない。**Mac側の小さなスキャナスクリプトが走査→認証付きAPI経由でmission-controlにPOST→サーバー側がupsert**という設計(既存の`cron-auth.ts`パターンを流用、Postgresクライアントの新規インストール不要)
- 新規テーブル: `skills`(id/category/status/frozen_reason/description/trigger_text/line_count/ref_file_count/has_tool_table/depends_on/last_updated_at/last_updated_source/synced_at/**content**)。任意で`skill_invocations`(呼び出し頻度、v2以降でよい)
  - `content`(SKILL.md全文)はW7-3実装時に追加した列。Windows常駐PostgresがMacの`.claude/skills/`を直接読めない設計上、詳細画面での本文表示にはメタデータと同じ同期経路(Mac側スキャナ→API)で本文自体も運ぶ必要があるため
- 新規画面: `/skills`(一覧・カードグリッド・検索・statusバッジ)・`/skills/[id]`(詳細・Markdownレンダリング・依存関係リスト)
- SKILL.md 57件は`category`/`status`/`depends_on`等の構造化フィールドを持たないため、抽出は「機械的に確実な層」(description/last_updated/行数/ツール表)と「推定・要人手層」(category分類/depends_on grep/frozen状態)に分けて設計。**status(凍結/実験中)は必ずCLAUDE.mdの凍結宣言を正としてマージする**(SKILL.md単体では不整合がある)

### 8.4 IMPLEMENTATION_PLANへの追加タスク番号

W7(Skills可視化)・W8(tl;dv本番接続)・W9(提案書PDF化)・W10(Gmail連携)として`IMPLEMENTATION_PLAN.md`に追記(§本ファイルとは別ファイル)。実施順序は本ファイル§6の推奨着手順に従う。

### 8.5 naru確認が必要な論点(要点。全13件は進行管理スプシ「未決事項」タブが正)

判断確定済み: 実装着手順序(P8→P3残→P9→Gmail)、進行管理スプシへの転記。
未決のまま個別フェーズ着手時に確認: 提案書エディタのUI方式・PDF保存先・レビュー動線・Skills同期トリガー・v4正式廃止/git履歴整理・`.claude/commands/create-proposal.md`整理要否・命名規則統一・P7運用検証範囲・tl;dv webhook署名検証可否・Vercelプロジェクトリンク・Gmail OAuth同意(naru本人実行)。
