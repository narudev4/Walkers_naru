# walkers-seo-monitor 既存コード読解レポート

> 調査日: 2026-06-03
> 対象: `/Users/naru/Walkers_naru/05_development/walkers-seo-monitor/` (branch: main / HEAD)
> 調査範囲: `src/` 全 55 ファイル + `vercel.json` + `package.json` + `CLAUDE.md`
> 重要前提: **CLAUDE.md の記述は実装より古い**。CLAUDE.md は「JWT (jose) + 単一 AUTH_USER/AUTH_PASSWORD」「Google Sheets を DB として使用」と書いているが、実装は既に **Neon Postgres によるマルチテナント (org / user / media / invitation)** に進化済み。古谷さんに引き継ぐ前にこの差分を本人にも確認した方がよい。

---

## 1. アーキテクチャ概観

```
┌─────────────────────────────────────────────────────────────┐
│ Browser (Next.js 16 App Router, React 19, Tailwind v4)      │
│   /login /signup            ← 認証                         │
│   /(authenticated)/                                          │
│     ├ /                     ← ダッシュボード (記事一覧)    │
│     ├ /articles/new         ← 単体登録 / バルクインポート │
│     ├ /articles/[id]        ← 記事詳細 + Trend + Rewrite  │
│     ├ /media                ← メディア（サイト）管理       │
│     ├ /settings             ← TrendConfig / BizContext     │
│     └ /settings/members     ← メンバー / 招待管理          │
└─────────────────────────────────────────────────────────────┘
                              │
                  middleware.ts (JWT 検証 + CRON_SECRET 検証)
                  ├ x-user-id  ヘッダ注入
                  ├ x-org-id   ヘッダ注入
                  └ x-media-id ヘッダ注入（Cookie 由来）
                              │
┌─────────────────────────────────────────────────────────────┐
│ Next.js API Routes  (Node.js runtime / maxDuration=300s)     │
└─────────────────────────────────────────────────────────────┘
           │                              │
           ▼                              ▼
  ┌──────────────────────┐    ┌────────────────────────────────┐
  │ Neon Postgres        │    │ Google Sheets per Media         │
  │ (drizzle-orm)        │    │ (1 spreadsheet = 1 site の記事DB)│
  │ - organizations      │    │ Articles タブ: 13 列            │
  │ - users (bcrypt)     │    │ Settings タブ: TrendConfig 行   │
  │ - media              │    └────────────────────────────────┘
  │ - invitations        │                  │
  │ - trend_configs (※未使用)               │
  └──────────────────────┘                  │
                              ┌─────────────┴─────────────┐
                              ▼                           ▼
                  ┌──────────────────┐         ┌────────────────────┐
                  │ LLM Provider     │         │ Google CSE         │
                  │ (claude/openai/  │         │ (CustomSearch API) │
                  │  gemini)         │         └────────────────────┘
                  └──────────────────┘
                              ▲
                  ┌───────────┴───────────┐
                  │ Vercel Cron 6h おき   │
                  │ /api/cron/trend-check │
                  └───────────────────────┘
```

重要：認証は CLAUDE.md の言う「JWT + AUTH_USER/AUTH_PASSWORD」ではなく、**Neon Postgres + bcrypt + 組織 (org) ベースのマルチテナント**。サインアップ画面で組織が作れる SaaS 構造になっている。

---

## 2. lib/ モジュール責務一覧

| ファイル | 責務 | 公開関数 / 主要型 |
|---|---|---|
| `src/lib/types.ts` | ドメイン型定義（Article / TrendAnalysis / RewriteDraft / TrendConfig） | `Article` `TrendAnalysis` `RewriteDraft` `ChangeSummaryItem` `TrendConfig` `DEFAULT_TREND_CONFIG` `BulkImportArticle` |
| `src/lib/constants.ts` | Google Sheets の列マッピング | `SHEET_COLUMNS` (13 列定義) `SHEET_HEADER` `SHEET_NAME='Articles'` `PRIORITY_ORDER` |
| `src/lib/llm.ts` | マルチ LLM 抽象化 + プロンプト生成 + Agentic ループ | `analyzeKeywordTrends` `generateRewrite` `getCurrentProvider` `generateBusinessContextDraft` `agenticAnalyze` `buildAnalysisPrompt` `buildRewritePrompt` `TREND_ANALYSIS_PROMPT` `REWRITE_PROMPT` |
| `src/lib/sheets.ts` | Google Sheets CRUD + TrendConfig 永続化 | `getArticles` `getArticle` `addArticle` `addArticlesBulk` `updateArticle` `deleteArticle` `ensureSheetHeaders` `getTrendConfig` `saveTrendConfig` |
| `src/lib/google-auth.ts` | Google API クライアント生成（OAuth 優先・SA フォールバック） | `getOAuth2Client` `getSheetsClient` `getSearchClient` `getSearchCx` `getSheetId` `getAuthMethod` |
| `src/lib/trend-analyzer.ts` | トレンドチェックのオーケストレーション + バッチ処理 | `searchWeb` `checkArticleTrend` `checkArticleTrendAgentic` `checkAllArticles` `resetCseCircuit` + サーキットブレーカー（CSE quota）|
| `src/lib/metadata-fetcher.ts` | 記事 URL の HTML をフェッチ → 本文 / タイトル / noindex 抽出 | `fetchMetadata` |
| `src/lib/sitemap-crawler.ts` | WP REST → サイトマップ → RSS の順で記事 URL 一括取得 | `crawlMedia` |
| `src/lib/auth.ts` | JWT（jose）の発行・検証 + Cookie 管理 + bcrypt | `createToken` `verifyToken` `setAuthCookie` `getAuthCookie` `clearAuthCookie` `setMediaCookie` `getMediaCookie` `hashPassword` `verifyUserPassword` |
| `src/lib/tenant.ts` | テナント文脈（org/user/media）の取り出しと Spreadsheet ID 解決 | `getTenantContext` `getUserContext` `getSpreadsheetId` |
| `src/lib/db/index.ts` | Neon Postgres 接続（drizzle-orm/neon-http） | `db` (Proxy 経由 lazy init) `getDb` |
| `src/lib/db/schema.ts` | DB スキーマ（4 テーブル + 未使用 1 テーブル） | `organizations` `users` `media` `invitations` `trendConfigs(※未使用)` |

### 2.1 LLM の呼び分けポイント（重要）

`src/lib/llm.ts:15-39` の `getConfig()` が環境変数 `LLM_PROVIDER` で分岐。実体は `callLLM(prompt, maxTokens, timeoutMs)` でラップされ、内部で `claude / openai / gemini` のいずれかを呼ぶ。

- 既定値: `claude` + model `claude-sonnet-4-20250514`（cutoff 2025-05、現行 4.7 比で古い）
- 共通タイムアウト: `LLM_TIMEOUT_MS = 45_000`（45 秒）
- すべてのプロンプトは「JSON のみを出力してください」で締めて `extractJSON()` で `{...}` を抽出（深さカウントで対応括弧探索）。失敗時は defaults でフォールバック。

「マルチ LLM 抽象化」と言いつつ、**SDK を使うのは Claude のみ**で OpenAI/Gemini は素の fetch。プロンプトキャッシュ等のプロバイダ固有機能はゼロ。

### 2.2 Sheets 読み書きパターン

- 13 列固定スキーマを `SHEET_COLUMNS` で index 管理（`src/lib/constants.ts:1-15`）
- 「行番号 ≒ 記事 ID」: `parseRow(row, index)` で `id = index + 1` を割り当て、`updateArticle(id)` は `row = id + 1` を直接更新。**シートの行を物理削除すると ID がズレて壊れる**ため、削除は `deleteArticle` でソフト削除（`notes='[DELETED]'`、`status='paused'`）に限定（`src/lib/sheets.ts:159-161`）。
- `getTrendConfig` は **Settings タブ A:B の key/value 行から型推論で復元**（`src/lib/sheets.ts:165-195`）。新規 key を `TrendConfig` 型に増やすと、Settings タブの過去行は無視されて defaults が使われる。

### 2.3 Trend Analysis JSON のスキーマ実装

- JSON 文字列として `Articles!J` 列に格納（`SHEET_COLUMNS.TREND_ANALYSIS_JSON = 9`）
- `parseRow()` で `JSON.parse`、失敗時は `trendAnalysis: null`（`src/lib/sheets.ts:7-13`）
- 形は `src/lib/types.ts:18-44` の `TrendAnalysis`。LLM 応答の欠損フィールドは `analyzeKeywordTrends()` 内で defaults をスプレッドして埋める（`src/lib/llm.ts:400-420`）

---

## 3. API エンドポイント一覧

| メソッド | ルート | 役割 | 認証 / テナント |
|---|---|---|---|
| POST | `/api/auth/login` | bcrypt 検証 → JWT 発行 → Cookie | Public |
| POST | `/api/auth/signup` | 組織新規作成 or 招待トークンで参加 → JWT | Public |
| POST | `/api/auth/logout` | Cookie クリア | JWT |
| GET | `/api/auth/google` | Google OAuth へリダイレクト（Spreadsheet スコープ） | Public |
| GET | `/api/auth/google/callback` | refresh_token を取得し `/settings?refresh_token=...` に渡す | Public |
| GET | `/api/auth/invite/[token]` | 招待トークン検証 → 招待情報返却 | Public |
| GET | `/api/articles` | 現在選択中メディアのスプシから全記事取得 | JWT + media |
| POST | `/api/articles` | 単体記事追加 | JWT + media |
| GET | `/api/articles/[id]` | 記事 1 件取得（row N+1 を直接読む） | JWT + media |
| PATCH | `/api/articles/[id]` | 記事更新（許可フィールドホワイトリスト適用） | JWT + media |
| DELETE | `/api/articles/[id]` | ソフト削除 | JWT + media |
| POST | `/api/articles/bulk-import` | サイトクロール or 選択済み記事の一括登録 | JWT + media |
| POST | `/api/articles/[id]/rewrite` | リライト案生成 (maxDuration 300s, HARD_DEADLINE 57s) | JWT + media |
| POST | `/api/trend-check` | 単体 or 全件のトレンドチェック（SSE 対応）| JWT + media |
| GET | `/api/cron/trend-check` | **全テナントの全メディア**をループしてチェック | CRON_SECRET |
| POST | `/api/fetch-metadata` | URL のメタ情報取得（登録画面の自動補完用） | JWT |
| POST | `/api/prompt-preview` | 実際に LLM に投げる前のプロンプト確認（記事 ID + type） | JWT + media |
| GET | `/api/settings` | システム状態（LLM/Auth/Cron/Search 設定）の表示 | JWT |
| GET | `/api/settings/trend-config` | メディア別の TrendConfig 取得 | JWT + media |
| PUT | `/api/settings/trend-config` | clamp/validate 付き保存 | JWT + media |
| POST | `/api/settings/generate-context` | businessContext のたたき台を LLM 生成 | JWT + media |
| GET | `/api/media` | 自 org の全メディア一覧 | JWT |
| POST | `/api/media` | メディア新規作成（org+spreadsheetId が unique）| JWT |
| PATCH | `/api/media/[id]` | メディア更新（org 一致チェック） | JWT |
| DELETE | `/api/media/[id]` | メディア削除 | JWT |
| GET | `/api/org/members` | 同 org のメンバー一覧 | JWT |
| PATCH | `/api/org/members` | memberId のロール変更（owner/admin のみ） | JWT |
| DELETE | `/api/org/members?memberId=` | メンバー削除（owner/admin のみ・自分は不可） | JWT |
| GET | `/api/org/invitations` | 保留中の招待一覧 | JWT |
| POST | `/api/org/invitations` | 招待トークン（randomBytes 32 + 7 日有効） | JWT |
| DELETE | `/api/org/invitations?id=` | 招待取り消し | JWT |

### 3.1 vercel.json の重要事項

- Cron: `/api/cron/trend-check`、`0 */6 * * *`（**6 時間おき**。CLAUDE.md と Settings UI には「毎日 0 時」と書いてあるが実装は 6 時間おき。**3 箇所の記述が全部食い違っている**）

---

## 4. 画面構成

```
RootLayout (src/app/layout.tsx)
├ /login (src/app/login/page.tsx)
│  └ email/password フォーム → JWT Cookie
├ /signup (src/app/signup/page.tsx)
│  └ invite_token があれば既存 org 参加、なければ org 新規作成
└ /(authenticated)/layout.tsx (Sidebar + main)
   ├ Sidebar (固定 w-56, MediaSelector + ナビ + FuruyaLogo)
   │  └ MediaSelector: cookie `seo-monitor-media` で選択中メディア管理
   ├ / (DashboardPage)
   │  ├ MetricsBar / ArticleTable
   │  └ トレンドチェック実行（SSE で進捗ストリーミング）
   ├ /articles/new
   │  ├ SingleArticleForm（自動メタデータ取得 + 登録）
   │  └ BulkImporter（WP REST → サイトマップ → RSS の順で取得 → チェックボックス選択）
   ├ /articles/[id]
   │  ├ Article ヘッダ + PriorityBadge + StatusBadge + noindex 警告
   │  ├ TrendEditor（factCheck / marketChanges / keywordShift / competitors / rewriteSuggestions の手動編集）
   │  ├ AI Agent ログ（agenticAnalyze の step を時系列で展示）
   │  ├ プロンプトプレビュー（analysis / rewrite）
   │  └ RewritePanel（変更一覧 / Diff 切替、セクション単位コピー）
   ├ /media
   │  └ 一覧 + 新規作成（name / spreadsheetId / siteUrl）+ 削除
   ├ /settings
   │  ├ SystemStatusSection（GET /api/settings）
   │  ├ TrendConfigSection（全項目スライダー/数値編集 + Agentic ON/OFF）
   │  ├ BusinessContextSection（LLM 生成 + 手編集 textarea）
   │  ├ GoogleOAuthSection（refresh_token 取得補助）
   │  └ 環境変数ガイド + Cron ガイド + Sheets カラム表
   └ /settings/members
      ├ メンバー一覧（owner/admin/member のロール選択）
      └ 招待リンク生成（メール + ロール → /signup?invite=token）
```

主要コンポーネント:

- `src/components/Sidebar.tsx`（217 行・派手な FuruyaLogo アニメーション付き）
- `src/components/MediaSelector.tsx`（cookie ベース選択、router.refresh で SSR 反映）
- `src/components/MetricsBar.tsx` / `ArticleTable.tsx` / `PriorityBadge.tsx` / `StatusBadge.tsx`
- `src/components/TrendEditor.tsx`（416 行・各セクション add/remove/edit を全部手動実装）
- `src/components/RewritePanel.tsx`（変更一覧 / Diff の 2 表示モード、セクション単位コピー対応）
- `src/components/DiffView.tsx`

---

## 5. データフロー詳細

### 5-A. トレンド分析の流れ

```
[Dashboard] handleTrendCheck (stream=true)
  → POST /api/trend-check { stream: true, forceAll }
    src/app/api/trend-check/route.ts:69-99
    └ checkAllArticles(spreadsheetId, { timeBudgetMs: 280_000, onProgress })
        src/lib/trend-analyzer.ts:221-375
        ├ getArticles + getTrendConfig (Promise.all)
        ├ active = status='active' && notes!=='[DELETED]' をフィルタ
        ├ intervalDays（デフォルト 7）以内のチェック済みをスキップ
        ├ lastCheckDate 昇順ソート（最古優先）
        └ Promise.allSettled で CONCURRENCY=2 並列バッチ
            └ checkArticleTrend or checkArticleTrendAgentic（90s / 60s タイムアウト）
                └ fetchMetadata（記事本文取得・5s タイムアウト）
                └ agenticAnalyze (src/lib/llm.ts:585-751)
                    ├ Step 1: GENERATE_QUERIES_PROMPT で検索クエリ自律生成
                    ├ Loop (maxIterations=2):
                    │  ├ Promise.allSettled で searchWeb 並列実行（CSE）
                    │  │   └ サーキットブレーカー（quota 検出 or 2連続失敗で開）
                    │  ├ analyzeKeywordTrends（TREND_ANALYSIS_PROMPT）
                    │  └ 自己評価 EVALUATE_ANALYSIS_PROMPT → 不十分なら追加 query
                    └ AgentStep[] と analysis を返却
            └ updateArticle で priority / trendAnalysis / lastCheckDate 反映
        → onProgress イベントを SSE で送出（start / progress / done）
[Client] data: ... を逐次パースして UI 更新
```

シングル記事:

```
[Article Detail] handleTrendCheck
  → POST /api/trend-check { articleId }
    src/app/api/trend-check/route.ts:17-62
    ├ agentEnabled=true → checkArticleTrendAgentic → _agentMeta.steps を返却
    └ agentEnabled=false → checkArticleTrend → 旧パターン（KW × {年}）
  → priority !== 'NONE' なら自動で handleGenerateRewrite を呼ぶ（連鎖実行）
```

### 5-B. リライト生成の流れ

```
[Article Detail] handleGenerateRewrite(analysis)
  → POST /api/articles/[id]/rewrite { trendAnalysis }
    src/app/api/articles/[id]/rewrite/route.ts:14-100
    ├ getArticle で記事取得
    ├ analysis = body.trendAnalysis ?? article.trendAnalysis
    ├ fetchMetadata（5s タイムアウト→失敗ならタイトルのみ）
    ├ HARD_DEADLINE_MS=57_000 から残り時間を計算
    │   ※ maxDuration=300 だがコメントには「Vercel Pro: 300 秒」
    │   実装上は 57 秒で打ち切り想定（Hobby 互換の残骸？）
    ├ generateRewrite (src/lib/llm.ts:423-438)
    │   └ buildRewritePrompt → callLLM
    │       └ REWRITE_PROMPT で「変更箇所のみ」JSON を生成
    │           → changeSummary: { section, changeType, originalText, newText }[]
    └ updateArticle { lastUpdateDate } で更新タイムスタンプ保存
  → RewritePanel が変更一覧 / Diff の 2 モードで表示
```

ポイント:
- リライトは **「変更があるセクションだけ」をセクション単位で返す**（全文書き換えではない）
- `rewrittenContent` は後方互換のため空文字で返るのが新形式（`src/lib/types.ts:76-78`）

---

## 6. HEARING_QUESTIONS.md とコードの突合

### 6-A. コードで既に答えが出ている項目

#### §E STEP7 入稿・公開 — WordPress 連携方式
- **読み取り方向のみ実装済み**: `src/lib/sitemap-crawler.ts` は WP REST API (`/wp-json/wp/v2/posts`) → サイトマップ → RSS の順で **記事一覧取得のみ**。書き込み（投稿・更新）は未実装。
- 「鳳汰さんが言っていた MCP」「独自プラグイン」は **コード上に痕跡なし** → 公開フェーズ実装はゼロ、新規設計が必要。

#### §H STEP10 リライト・改善 — 既存実装
- **rewriteSuggestions の UI**: `TrendEditor` (`src/components/TrendEditor.tsx`) が `factCheck / marketChanges / keywordShift / competitorContent / rewriteSuggestions` の **5 セクション全部を手動 add/edit/remove 可能** にしている。すでに鳳汰さんが「どう載せるか」と聞いている部分は実装済み。
- **リライト草稿の管理**: 既存 H 列（Rewrite Doc Link）には **何も自動で書き込まれていない**。コード検索しても `rewriteDocLink` への代入は無し。Google Docs 出力は未実装。
- **粒度**: セクション単位（`ChangeSummaryItem.section + changeType` で `revised/added/deleted` を返す）。全文書き換えは旧形式互換のため空文字を返す（`src/lib/llm.ts:432-437`）。

#### §J-3 アカウント・権限
- **3 ロール実装済み**（4 ロールではない）: `users.role` ENUM = `owner | admin | member`（`src/lib/db/schema.ts:17`）
- **権限境界**: `/api/org/members` PATCH/DELETE で `owner/admin` のみ可、自分は変更不可（`src/app/api/org/members/route.ts:39-50, 82-94`）
- **ストラテジスト / 編集者 / ライター / 監修者の区別はゼロ**。鳳汰さんが想定する 4 ロールは未実装。

#### §J-4 認証
- **bcrypt + 自前 JWT (jose)**。Clerk/Auth0/Vercel ログイン等は使っていない（`src/lib/auth.ts:77-89`）
- Google Workspace 連携は OAuth でやっているが、これは **Sheets アクセスのため** であってユーザーログインには使われていない

#### §J-5 データモデル
- **businessContext は Workspace 単位（メディア単位）に既に格上げ済み**。Settings タブに格納（`src/lib/sheets.ts:165-195`）。鳳汰さんが「昇格させる方針でよいか」と聞いているのは **既に完了している**。
- **Articles の列構造は 13 列**（CLAUDE.md は 12 列と書いてあるが古い。L 列 `Published Date` の後に M 列 `Noindex` が追加されている `src/lib/constants.ts:1-15`）。C 列は `Keywords`、H 列は `Rewrite Doc Link`、I 列は `Notes`。
- **noindex は実装済み**: `metadata-fetcher.ts:53-56` で `<meta name="robots">` から検出 → Articles M 列に保存 → 記事詳細でバッジ表示。
- **WP 側ステータスとの同期は無し**（独立管理）

#### §J-6 既存スキル群との関係
- 現在は **コード単独で完結**。`/title-gen` `/create-diagrams` `/fact-check` 等のスキルとの統合点は **コード上に一切なし**。

#### §K-2 分析/評価
- **「分析」（analyzeKeywordTrends）と「評価」（agenticAnalyze の自己評価 EVALUATE_ANALYSIS_PROMPT）は別物として実装済み**。`src/lib/llm.ts:536-576` がメタ評価プロンプト。LLM が `qualityScore 1-10` を返す。

#### §K-3 リライト機能
- **「AI が提案 → 人がレビュー」モデル**で確定（`TrendEditor` が手編集可能、`RewritePanel` はコピー出力のみで自動公開機能なし）
- ABテストは未実装

#### §L 技術スタック
- フロントエンド: Next.js 16.1.6 (App Router) + React 19.2.3（package.json）
- DB: **Neon Postgres**（CLAUDE.md の Sheets-only から変わっている）
- AI 実行基盤: **AI SDK / AI Gateway / Workflow は不使用**。Anthropic SDK 直叩き + OpenAI/Gemini は fetch。
- ジョブ: Vercel Cron `0 */6 * * *`（vercel.json）
- Agent SDK: **使っていない**。`agenticAnalyze` は llm.ts に self-rolled 実装（クエリ生成 → 検索 → 分析 → 自己評価 → 追加検索のループ）

#### §H 対象選定の自動化
- **既存実装は 1 基準のみ**: `checkIntervalDays`（最終チェックから N 日経過）でフィルタ（`src/lib/trend-analyzer.ts:243-251`）。
- 「10〜20 位 / CTR 低 / 離脱率高 / 公開 6 ヶ月以上」の **4 基準スコアリングは未実装**（GSC 連携が無いので不可能）

### 6-B. コードでは未実装 / 該当無しの項目 — 鳳汰さんへのヒアリング必要

| セクション | 状況 |
|---|---|
| **§A STEP3 SERP・競合分析** | 競合 URL の H2/H3 抽出、ラッコ連携、Ahrefs 連携、PAA 取得、カニバリ検知 ─ **全て未実装**。`competitorContent.newCompetitors` は LLM が CSE 検索結果から推測しているだけ |
| **§B STEP4 記事構成設計** | タイトル生成・H2/H3 階層 UI・FAQ・構造化データ・内部リンク提案・CTA 配置・監修者 ─ **全て未実装** |
| **§C STEP5 執筆** | AI 執筆ルール（「1 見出し 1 主張」等）・出典 URL 事前リスト・図解連携 ─ **全て未実装**。リライト生成のみ存在 |
| **§D STEP6 校正・編集** | 表記揺れ・薬機法・レビューフロー・customPrompt の Workspace 昇格 ─ 未実装。`customAnalysisPrompt` / `customRewritePrompt` は **存在するがメディア単位**（Settings タブ）に既に置かれている |
| **§E** WordPress への **書き込み** | 未実装（読み取りのみ） |
| **§F STEP8 公開後初動** | GSC URL 送信・インデックス確認・SNS 拡散 ─ 未実装 |
| **§G STEP9 効果測定** | GSC / GA4 / Clarity / Ahrefs ─ 全て未実装。Quick Wins 検出 (`mcp__gsc__detect_quick_wins`) も統合なし |
| **§I STEP11 ナレッジ蓄積** | 勝ち負けパターン抽出・マルチサイト横展開・プロンプト自己改善 ─ 未実装 |
| **§J-1 既存プロト統合方針** | コードからは判断不能（鳳汰さんと古谷さんの間で要確認） |
| **§J-2 SaaS 化境界** | **マルチテナント構造は既に完成**しているが、課金 / プラン制は未実装 |
| **§J-3 ロール詳細**（ライター / ストラテジスト / 監修者） | 未実装（owner/admin/member の 3 段のみ） |
| **§K-1 一括作成** | 一括 **インポート**（既存 URL 取得）はあるが、**KW からの一括執筆**は未実装 |

---

## 7. コードを読んで判明した追加論点（負債・制約）

### 論点 1: ドキュメントとコードの大幅な乖離
- **現状**: CLAUDE.md の認証説明（「AUTH_USER / AUTH_PASSWORD で単一ユーザー」）、Sheets DB only の主張、12 列の Articles テーブル、Cron スケジュール「0 0 \* \* \*」── **すべて実装と不一致**。実装は Neon Postgres + bcrypt + 3 ロール、13 列、6h Cron。
- **将来の課題**: 引き継ぎ時に CLAUDE.md を読んで実装を誤認する事故が必ず起きる。
- **対応案**: 引き継ぎ初日に CLAUDE.md を全面書き換え（Neon 化、ロール、列、Cron、認証方式）。

### 論点 2: 記事 ID が「Sheets の行番号」と密結合
- **現状**: `parseRow(row, index)` で `id = index + 1`、`updateArticle(id)` は `row = id + 1` で直接 `A${rowNum}:M${rowNum}` を更新（`src/lib/sheets.ts:81-92, 142-156`）。
- **将来の課題**: ユーザーが Sheets を直接編集して行を物理削除すると **記事 ID の全シフト** が発生し、`trendAnalysis.articleId` も含めて全データが破綻する。
- **対応案**: 削除 = ソフト削除（`notes='[DELETED]'`）と運用ルール化されているが、UI からは普通の「削除」ボタンに見える。Neon 移行か UUID 列追加が中長期的解。

### 論点 3: Vercel Cron が **全テナント全メディアを 1 リクエストで処理**
- **現状**: `/api/cron/trend-check` は `db.select().from(media)` で全テナントの全メディアを取り出し、`perMediaBudget = max(30_000, floor(280_000 / mediaCount))` で時間を分配（`src/app/api/cron/trend-check/route.ts:33-54`）。
- **将来の課題**: メディア数が増えると 1 メディア当たり 30s しか取れず、エージェンティック 1 イテレーション分も回らない。「SaaS化」の最初のスケール制約。
- **対応案**: Vercel Queues / Workflow / Cron を「メディア ID ごとに 1 ジョブ」にファンアウト。`maxDuration=300` の制約をリクエスト分割で回避する。

### 論点 4: LLM タイムアウト設計の二重実装
- **現状**: `llm.ts` 内で `LLM_TIMEOUT_MS=45_000` と `withTimeout()`、`trend-analyzer.ts` 内で `ARTICLE_TIMEOUT=90_000/60_000`、`agenticAnalyze` 内で `Date.now() + 280_000` deadline、`rewrite/route.ts` で `HARD_DEADLINE_MS=57_000`。**4 箇所で別々のタイマー**。
- **将来の課題**: 「設定画面で 16384 トークンに上げたら全部タイムアウトになる」のような問題が再現しにくい。`HARD_DEADLINE_MS=57_000` は明らかに Hobby 互換の残骸（コメントには 300 秒と書いてある）。
- **対応案**: タイムアウト戦略を1ヶ所に集約。`maxDuration=300` と整合を取る。

### 論点 5: Google CSE 依存 + サーキットブレーカー
- **現状**: トレンド分析は **Google Custom Search** に依存。1 日 100 クエリ無料、超過は不可。`searchWeb()` で `Quota exceeded` を検知すると即座にサーキット OPEN → 残り検索は全て **「AI の知識ベースで分析」というプレースホルダ文字列**に置換される（`src/lib/trend-analyzer.ts:10-87`）。
- **将来の課題**: サーキット OPEN 時のトレンド分析は **LLM の pre-training cutoff の世界観**で動く → 分析品質が静かに劣化する。ユーザーには通知されない。
- **対応案**: SerpAPI / Tavily / Bing 等の代替検索を切替可能に。サーキット OPEN を UI に表示。

### 論点 6: `trend_configs` テーブルは定義されているが完全未使用
- **現状**: `src/lib/db/schema.ts:46-51` に `trend_configs` テーブル定義あるが、コードで参照ゼロ（`grep` で確認）。TrendConfig は実際には **Sheets の Settings タブ**に保存されている（`src/lib/sheets.ts:197-224`）。
- **将来の課題**: 「Sheets 依存を減らす」方針に切り替えるなら、この空のテーブルが移行先として使える。逆に CLAUDE.md 上は「Sheets だけ」と書いてあるので混乱の元。
- **対応案**: 移行方針が決まるまで `trend_configs` は削除するか docs にメモを残す。

### 論点 7: businessContext は 1 メディアにつき 1 つ
- **現状**: `TrendConfig.businessContext: string`（`src/lib/types.ts:96`）。Settings タブの 1 行。LLM 生成も 1 つ（`/api/settings/generate-context`）。
- **将来の課題**: 1 メディアの中で「顧問先 A 案件」「顧問先 B 案件」を分ける運用は今のままだと不可能。マルチコンテキスト化は中規模リファクタリング。
- **対応案**: いまは新規 media を作って分けてもらう運用で乗り切るしかない。Workspace 概念を導入するなら DB 設計から見直し。

### 論点 8: 招待トークン経由のメール送信は無し
- **現状**: `/api/org/invitations` POST は **DB に招待を作って `/signup?invite=token` URL を返すだけ**。メール送信なし（`src/app/api/org/invitations/route.ts:67-86`）。UI 上に URL を表示してユーザーに **手動でコピペ送信させる**。
- **将来の課題**: SaaS としてはここで離脱が出る。Resend / SendGrid / SES 連携が必要。
- **対応案**: フェーズ毎に: (a) Resend 統合（簡易）、(b) Workspace 招待にメンバー登録通知も同梱。

### 論点 9: noindex 検出が記事フェッチ時に固定値で保存される
- **現状**: `fetchMetadata()` で取った noindex フラグが `Articles!M` 列に保存され、UI で警告バッジ。トレンドチェック実行時にのみ再評価される（`src/lib/trend-analyzer.ts:99-132`）。
- **将来の課題**: ユーザーが WP 側で noindex を外しても、次のトレンドチェックが来るまで反映されない。
- **対応案**: 軽量再フェッチ用の dedicated エンドポイント or 記事詳細を開く度に再評価。

### 論点 10: customAnalysisPrompt / customRewritePrompt は UI から編集できない
- **現状**: `TrendConfig` に既に存在し（`src/lib/types.ts:97-98`）、API は対応（`/api/settings/trend-config` PUT で保存可、`src/app/api/settings/trend-config/route.ts:34-35`）、`buildAnalysisPrompt` / `buildRewritePrompt` で `{{currentDate}}` `{{articleTitle}}` 等のテンプレ変数も処理済み。**ただし設定 UI に編集 textarea が無い**（`src/app/(authenticated)/settings/page.tsx` を確認した限り）。
- **将来の課題**: API では受けるのでスプシで直接編集すると動くが、UI を期待する利用者は気づけない。
- **対応案**: 設定画面に textarea を追加する（30 行作業）。

---

## 8. 引き継ぎ時に古谷さんに確認したい質問（コードを読んでも分からないこと）

1. **`trend_configs` テーブル（Neon）は何に使う予定だったか？**
   - 定義だけあって完全未使用。Sheets Settings タブを Postgres に移す途中で止めた？

2. **Cron スケジュール「6 時間おき」と CLAUDE.md / Settings UI の「毎日 0 時」が食い違っているがどちらが正？**
   - 本番 (`vercel.json`) は `0 */6 * * *` だが、UI 表示と CLAUDE.md は `0 0 * * *`。意図的に変更したのか、不整合を放置したのか。

3. **`HARD_DEADLINE_MS=57_000` (rewrite/route.ts) と `maxDuration=300` の不整合は意図的？**
   - Hobby → Pro 移行の名残か、それともリスクヘッジで意図的に短くしてあるのか。

4. **マルチテナント化（Neon + 3 ロール + media 概念）はどこまで利用想定か？**
   - 自社（Walkers）内で複数顧客の SEO を見る前提か、それとも SaaS として外販を見ているか。設計コストの優先度判断に直結する。

5. **「Rewrite Doc Link」列（H 列）が現状未利用なのは、Google Docs 連携を未着手で止めたのか、それとも別方針に切り替えたのか？**

---

## 補足: 参考ファイル絶対パス一覧

| 用途 | 絶対パス |
|---|---|
| ライブラリ層 | `/Users/naru/Walkers_naru/05_development/walkers-seo-monitor/src/lib/` |
| API 層 | `/Users/naru/Walkers_naru/05_development/walkers-seo-monitor/src/app/api/` |
| UI 層 | `/Users/naru/Walkers_naru/05_development/walkers-seo-monitor/src/app/(authenticated)/` |
| 主要コンポ | `/Users/naru/Walkers_naru/05_development/walkers-seo-monitor/src/components/` |
| DB スキーマ | `/Users/naru/Walkers_naru/05_development/walkers-seo-monitor/src/lib/db/schema.ts` |
| Cron 設定 | `/Users/naru/Walkers_naru/05_development/walkers-seo-monitor/vercel.json` |
| プロジェクト指示書 | `/Users/naru/Walkers_naru/05_development/walkers-seo-monitor/CLAUDE.md`（**実装と乖離あり、要更新**）|
| 行ベース ID 設計の核 | `/Users/naru/Walkers_naru/05_development/walkers-seo-monitor/src/lib/sheets.ts:81-92` |
| Agentic ループの核 | `/Users/naru/Walkers_naru/05_development/walkers-seo-monitor/src/lib/llm.ts:585-751` |
| Cron 全テナント走査 | `/Users/naru/Walkers_naru/05_development/walkers-seo-monitor/src/app/api/cron/trend-check/route.ts:22-54` |
