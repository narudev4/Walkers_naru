# SEOモニター 作業一覧

> **目的**: SEOモニター（[walkers-seo-monitor](https://github.com/full999/walkers-seo-monitor)）の引き継ぎ〜開発を、フェーズ・タスク・日付で追跡する作業計画。
> **フォーマット参考**: [工程表スプレッドシート](https://docs.google.com/spreadsheets/d/1FJz2LMJBYZO3N21dowStvLsgebPXLBuVagwVfDK7pJ4/edit?gid=0#gid=0) の「作業一覧」タブに準拠 + 日付列を追加。
> **本番URL（デモ）**: https://seo-monitor-ochre.vercel.app
> **リポジトリ**: https://github.com/full999/walkers-seo-monitor （ローカル: `05_development/walkers-seo-monitor/`）
> **Sheets版**: https://docs.google.com/spreadsheets/d/1EFZAUAM-hf1OJHDAbDOdGINOhAhgac9q814yKWYHAuY/edit （マスター）
> **担当**: なるなる（古谷さんから引き継ぎ）
>
> ⚠️ 既存実装は**動くデモ**。鳳汰さんのヒアリングを通して仕様を詰めて、デモ→本番品質に育てていくのが本プロジェクトの本筋。
>
> ステータス凡例: `🔲 未着手` `⏳ 着手中` `✅ 完了` `⏸ 保留` `❌ 中止`

---

## Phase 0: 引き継ぎ・現状把握

| # | フェーズ | タスク | 作業内容 | 予定日 | 完了日 | ステータス | 担当 | メモ |
|---|---|---|---|---|---|---|---|---|
| 0-1 | Phase 0 | 動画から要件サマリ | 鳳汰計画動画の文字起こし→CONTEXT.md化 | 2026-05-27 | 2026-05-27 | ✅ 完了 | なるなる | `source/video-and-transcript/` |
| 0-2 | Phase 0 | SEO制作フローの取得 | seo-workflow-gules.vercel.app から11フェーズ92工程を抜出→WORKFLOW.md化 | 2026-05-27 | 2026-05-27 | ✅ 完了 | なるなる | `WORKFLOW.md` |
| 0-3 | Phase 0 | 古谷スプシ「記事モニターDB」解析 | シート1/2/Articles/Settings 全タブを読み構造を把握 | 2026-06-02 | 2026-06-02 | ✅ 完了 | なるなる | CONTEXT.md §9 |
| 0-4 | Phase 0 | 03_projects へカーブアウト | 05_development/seo-monitor から移動 + シンボリックリンク整備 | 2026-06-02 | 2026-06-02 | ✅ 完了 | なるなる | この `03_projects/SEOモニター/` |
| 0-5 | Phase 0 | HEARING_QUESTIONS 作成 | STEP3以降の鳳汰ヒアリング項目 100+ を整理 | 2026-06-02 | 2026-06-02 | ✅ 完了 | なるなる | `HEARING_QUESTIONS.md` |
| 0-6 | Phase 0 | GitHubリポジトリ把握 | walkers-seo-monitor の構造・CLAUDE.md・依存把握 | 2026-06-02 | 2026-06-02 | ✅ 完了 | なるなる | Next.js 16 + Sheets DB + マルチLLM |
| 0-7 | Phase 0 | リポジトリのローカル取得 | `gh repo clone full999/walkers-seo-monitor` → `05_development/walkers-seo-monitor` | 2026-06-03 | 2026-06-03 | ✅ 完了 | なるなる | クローン済 |
| 0-8 | Phase 0 | コラボレーター権限取得 | full999/walkers-seo-monitor の Write 権限を取得 | TBD | — | 🔲 未着手 | 古谷→なるなる | invite 依頼（PR出すまでは Read で可）|
| 0-9 | Phase 0 | Vercelプロジェクト権限取得 | seo-monitor (チーム fullsrodd-gmailcoms-projects) のメンバー権限 | TBD | — | 🔲 未着手 | 古谷→なるなる | デプロイ条件: マージコミットが `full999` 名義 |
| 0-10 | Phase 0 | 環境変数の引き継ぎ | `.env.local` 用にすべての API キーを取得 | TBD | — | 🔲 未着手 | 古谷→なるなる | AUTH_*, GOOGLE_*, ANTHROPIC_*, CRON_SECRET など |
| 0-11 | Phase 0 | 記事モニターDB編集権限 | スプレッドシート ID `1-ZRDmk_...` の編集権 | — | — | ✅ 完了 | なるなる | 既に閲覧可（編集要確認） |
| 0-12 | Phase 0 | ローカル起動確認 | `npm install` → `npm run dev` で localhost:3000 起動確認 | 2026-06-03 | — | ⏳ 着手中 | なるなる | 0-10 の環境変数が揃い次第本格起動 |
| 0-13 | Phase 0 | コード読解・実装把握 | `src/` 全体を読んで現状機能を整理（trend-analyzer / llm / sheets / sitemap-crawler 等） | 2026-06-03 | — | ⏳ 着手中 | なるなる | ヒアリング前に必要 |
| 0-14 | Phase 0 | 鳳汰スケジュール提案 → 古谷さんに報告 | こちら主導でヒアリング日程を切り、古谷さんには結果を報告する形に | TBD | — | 🔲 未着手 | なるなる | 引き継ぎMTGは廃止 |
| 0-15 | Phase 0 | 鳳汰ヒアリング #1（SEO実務・最優先） | HEARING_SEO_PRACTICE.md §3 / §4 / §A1（SERP分析・構成設計・SEO哲学）を優先で深掘り | TBD | — | 🔲 未着手 | なるなる+鳳汰 | 0-13 / 0-25 後 |
| 0-16 | Phase 0 | 鳳汰ヒアリング #2（残STEP） | HEARING_SEO_PRACTICE.md §1/§2/§5-§11 を順次（残時間あれば §A2 経営判断）| TBD | — | 🔲 未着手 | なるなる+鳳汰 | 0-15 後 |
| 0-17 | Phase 0 | コード読解レポート作成 | src/全体読解 → CODE_REVIEW.md 作成（10論点・実装乖離・既存実装範囲整理） | 2026-06-03 | 2026-06-03 | ✅ 完了 | なるなる | CODE_REVIEW.md |
| 0-18 | Phase 0 | HEARING_QUESTIONS v2 化 | コード読解結果を踏まえ、確定済み項目を削除し本当に聞くべき項目に絞り込み | 2026-06-03 | 2026-06-03 | ✅ 完了 | なるなる | HEARING_QUESTIONS.v1.md にv1保存 |
| 0-19 | Phase 0 | FURUYA_QUESTIONS 作成 | コードを読んでも分からない5点を独立化 | 2026-06-03 | 2026-06-03 | ✅ 完了 | なるなる | FURUYA_QUESTIONS.md |
| 0-20 | Phase 0 | 古谷さんに5点質問送信 | FURUYA_QUESTIONS.md の5点を Slack DM or メール | TBD | — | 🔲 未着手 | なるなる | 鳳汰ヒアリング前に欲しい |
| 0-21 | Phase 0 | CLAUDE.md 書き換え | 既存リポジトリの CLAUDE.md が実装と乖離（認証/DB/列数/Cron全部）→ 全面書き換え | TBD | — | 🔲 未着手 | なるなる | CODE_REVIEW.md §7 論点1 |
| 0-22 | Phase 0 | キックオフMTG文字起こし取得 | 鳳汰×古谷×なる のキックオフMTG Doc を取り込み | 2026-06-03 | 2026-06-03 | ✅ 完了 | なるなる | Google Doc |
| 0-23 | Phase 0 | KICKOFF_MTG_SUMMARY.md 作成 | 文字起こしから決定事項/議論中/未触の論点を整理 | 2026-06-03 | 2026-06-03 | ✅ 完了 | なるなる | KICKOFF_MTG_SUMMARY.md |
| 0-24 | Phase 0 | HEARING_SEO_PRACTICE.md 作成 | WORKFLOW.md 11フェーズ × MTGサマリで「鳳汰さんSEO実務」を質問化 | 2026-06-03 | 2026-06-03 | ✅ 完了 | なるなる | HEARING_SEO_PRACTICE.md |
| 0-25 | Phase 0 | 鳳汰さんに資料3点共有 + MTG日程調整 | KICKOFF_MTG_SUMMARY.md / HEARING_SEO_PRACTICE.md / CONTEXT.md を共有し、ヒアリングMTG設定 | TBD | — | 🔲 未着手 | なるなる | Slack DM or Google Calendar |

---

## Phase 1: 要件定義・スコープ確定

| # | フェーズ | タスク | 作業内容 | 予定日 | 完了日 | ステータス | 担当 | メモ |
|---|---|---|---|---|---|---|---|---|
| 1-1 | Phase 1 | ヒアリング結果の反映 | CONTEXT.md にヒアリング結果を統合 | TBD | — | 🔲 未着手 | なるなる | 0-14, 0-15 後 |
| 1-2 | Phase 1 | REQUIREMENTS.md 作成 | 機能要件・非機能要件・優先度を確定 | TBD | — | 🔲 未着手 | なるなる | — |
| 1-3 | Phase 1 | MVPスコープ確定 | 「自社で満足に使える」の達成条件を定義 | TBD | — | 🔲 未着手 | なるなる+鳳汰 | シート2の方針反映 |
| 1-4 | Phase 1 | SaaS化マイルストーン | MVP→社内ベータ→SaaSの境界を引く | TBD | — | 🔲 未着手 | なるなる+鳳汰 | — |
| 1-5 | Phase 1 | 既存スキル流用範囲確定 | `/title-gen` `/create-diagrams` `/fact-check` `/article-monitor` 等 | TBD | — | 🔲 未着手 | なるなる | — |

---

## Phase 2: アーキテクチャ・データモデル設計

| # | フェーズ | タスク | 作業内容 | 予定日 | 完了日 | ステータス | 担当 | メモ |
|---|---|---|---|---|---|---|---|---|
| 2-1 | Phase 2 | データストア戦略の見直し | **Postgres は既に稼働中**（org/user/media/invitations）。残課題: `trend_configs` 未使用テーブル、Sheets 行番号=ID 密結合 | TBD | — | 🔲 未着手 | なるなる | CODE_REVIEW §7 論点2/6 |
| 2-2 | Phase 2 | マルチWorkspaceデータモデル | 既存 businessContext を Workspace 単位に昇格、テナント分離方針 | TBD | — | 🔲 未着手 | なるなる | — |
| 2-3 | Phase 2 | 戦略の二層構造（メディア × 記事）| メディア戦略 / 記事戦略 のテーブル設計 | TBD | — | 🔲 未着手 | なるなる | CONTEXT.md §9-3 |
| 2-4 | Phase 2 | 4ロール権限モデル設計 | オーナー / ストラテジスト / 編集者 / ライターの権限マトリクス | TBD | — | 🔲 未着手 | なるなる | CONTEXT.md §9-4 |
| 2-5 | Phase 2 | 記事ステータス遷移設計 | 公開中 / noindex / 限定公開 / 非公開 / 下書き の状態機械 | TBD | — | 🔲 未着手 | なるなる | — |
| 2-6 | Phase 2 | LLM抽象化レイヤ拡張 | 既存 `src/lib/llm.ts` の AI Gateway / Agent SDK 化検討 | TBD | — | 🔲 未着手 | なるなる | — |
| 2-7 | Phase 2 | Cron→Workflow移行判断 | 既存 Vercel Cron → durable Workflow (WDK) への移行可否 | TBD | — | 🔲 未着手 | なるなる | — |
| 2-8 | Phase 2 | API設計 v1 | 既存エンドポイント棚卸し→拡張案 | TBD | — | 🔲 未着手 | なるなる | — |

---

## Phase 3: WordPress連携・公開機能

| # | フェーズ | タスク | 作業内容 | 予定日 | 完了日 | ステータス | 担当 | メモ |
|---|---|---|---|---|---|---|---|---|
| 3-1 | Phase 3 | WP連携方式選定 | REST API / 自作MCP / プラグイン のいずれか | TBD | — | 🔲 未着手 | なるなる+鳳汰 | HEARING_QUESTIONS §E |
| 3-2 | Phase 3 | 構造化データ自動付与 | Article / FAQ / HowTo / BreadcrumbList | TBD | — | 🔲 未着手 | なるなる | — |
| 3-3 | Phase 3 | OGP・canonical・パンくず | 自動生成ロジック | TBD | — | 🔲 未着手 | なるなる | — |
| 3-4 | Phase 3 | 入稿フロー（下書き→公開） | 認証・権限チェック・ロールバック | TBD | — | 🔲 未着手 | なるなる | — |

---

## Phase 4: モニタリング機能拡張（既存 Trend Analysis の発展）

| # | フェーズ | タスク | 作業内容 | 予定日 | 完了日 | ステータス | 担当 | メモ |
|---|---|---|---|---|---|---|---|---|
| 4-1 | Phase 4 | GSC連携 | mcp__gsc__detect_quick_wins の内蔵 / Quick Wins 検出 | TBD | — | 🔲 未着手 | なるなる | — |
| 4-2 | Phase 4 | GA4連携 | セッション・CV・ランディングページ別計測 | TBD | — | 🔲 未着手 | なるなる | — |
| 4-3 | Phase 4 | SERP定点観測 | 競合記事の更新監視（既存 marketChanges 拡張）| TBD | — | 🔲 未着手 | なるなる | — |
| 4-4 | Phase 4 | 順位計測 | KW別順位の時系列保存・通知 | TBD | — | 🔲 未着手 | なるなる | Ahrefs vs 自前実装 |
| 4-5 | Phase 4 | 初動レポ自動化 | 公開3日目の初動レポ生成・通知 | TBD | — | 🔲 未着手 | なるなる | — |

---

## Phase 5: リライト・改善機能（既存 rewriteSuggestions の発展）

| # | フェーズ | タスク | 作業内容 | 予定日 | 完了日 | ステータス | 担当 | メモ |
|---|---|---|---|---|---|---|---|---|
| 5-1 | Phase 5 | リライトUI拡張 | factCheck / marketChanges / keywordShift / competitorContent の4分類UI | TBD | — | 🔲 未着手 | なるなる | 既存 RewritePanel.tsx ベース |
| 5-2 | Phase 5 | Google Docs連動 | Rewrite Doc Link 列を実運用化（既存H列） | TBD | — | 🔲 未着手 | なるなる | — |
| 5-3 | Phase 5 | 効果計測フロー | リライト前後の30/90日比較 | TBD | — | 🔲 未着手 | なるなる | — |
| 5-4 | Phase 5 | カニバリ統廃合判定 | `/article-monitor` ロジック移植 | TBD | — | 🔲 未着手 | なるなる | — |

---

## Phase 6: マルチサイト・SaaS化基盤

| # | フェーズ | タスク | 作業内容 | 予定日 | 完了日 | ステータス | 担当 | メモ |
|---|---|---|---|---|---|---|---|---|
| 6-1 | Phase 6 | Workspace隔離 | データ分離（行レベル or テナントDB） | TBD | — | 🔲 未着手 | なるなる | — |
| 6-2 | Phase 6 | 認証基盤刷新 | JWT → Clerk / Sign in with Vercel など | TBD | — | 🔲 未着手 | なるなる+鳳汰 | — |
| 6-3 | Phase 6 | 課金モデル実装 | Stripe連携・プラン設計 | TBD | — | 🔲 未着手 | なるなる+鳳汰 | — |
| 6-4 | Phase 6 | ナレッジ横展開 | Workspace間のテンプレ/勝ちパターン共有 | TBD | — | 🔲 未着手 | なるなる | — |

---

## Phase 7: ナレッジ蓄積・型化

| # | フェーズ | タスク | 作業内容 | 予定日 | 完了日 | ステータス | 担当 | メモ |
|---|---|---|---|---|---|---|---|---|
| 7-1 | Phase 7 | 勝ち負けパターン抽出 | 公開記事のパフォーマンス分析→共通要素抽出 | TBD | — | 🔲 未着手 | なるなる | — |
| 7-2 | Phase 7 | テンプレ・スタイルガイド更新 | 自動反映フロー | TBD | — | 🔲 未着手 | なるなる | — |
| 7-3 | Phase 7 | プロンプト自己改善 | empirical-prompt-tuning ループ | TBD | — | 🔲 未着手 | なるなる | — |

---

## バックログ（未割当）

| # | 内容 | 起票日 | メモ |
|---|---|---|---|
| BL-1 | 既存 Articles シート 13列のうち未運用 C/H/I 列の運用判断 | 2026-06-02 | CONTEXT.md §9-6 |
| BL-2 | 一括記事生成機能（KW→記事の新規一括執筆。既存の一括インポートは「URL取り込み」のみ）| 2026-06-02 | HEARING_QUESTIONS §K-6 |
| BL-3 | 分析/評価機能の詳細仕様（古谷スプシ シート2 空白）→ 自己評価ループは既に実装あり | 2026-06-02 | CONTEXT.md §9-9 / 部分確定 |
| BL-4 | 監修者・外注ライターの扱い（ロール別 or フラグ） | 2026-06-02 | HEARING_QUESTIONS §J-1 |
| BL-5 | 法務チェック（薬機法・景表法・金商法）の業種別ON/OFF | 2026-06-02 | HEARING_QUESTIONS §D |
| BL-6 | 記事ID と Sheets 行番号の密結合解消（UUID 列追加 or DB移行） | 2026-06-03 | CODE_REVIEW §7 論点2 |
| BL-7 | Cron スケールアウト（Vercel Queues / Workflow でメディア毎ファンアウト）| 2026-06-03 | CODE_REVIEW §7 論点3 |
| BL-8 | LLM タイムアウト戦略の一元化（4箇所に分散）| 2026-06-03 | CODE_REVIEW §7 論点4 |
| BL-9 | Google CSE 代替検索（SerpAPI / Tavily / Bing 切替可能化）+ サーキットOPEN UI 表示 | 2026-06-03 | CODE_REVIEW §7 論点5 |
| BL-10 | 招待メール送信（Resend / SES 連携。現状は URL 手動コピペ運用） | 2026-06-03 | CODE_REVIEW §7 論点8 |
| BL-11 | noindex 即時再評価エンドポイント（現状はCron時のみ更新）| 2026-06-03 | CODE_REVIEW §7 論点9 |
| BL-12 | `customAnalysisPrompt` / `customRewritePrompt` の UI textarea 追加（30行作業） | 2026-06-03 | CODE_REVIEW §7 論点10 |
| BL-13 | businessContext のマルチコンテキスト化（1メディア内で複数文脈）| 2026-06-03 | CODE_REVIEW §7 論点7 / 鳳汰判断後 |
| BL-14 | 3ロール → 4ロール拡張（ストラテジスト/編集者/ライター追加）| 2026-06-03 | CONTEXT §9-4 / 鳳汰判断後 |
| BL-15 | 記事ステータス拡張（active/paused → 鳳汰構想の5種）| 2026-06-03 | CONTEXT §9-5 / 鳳汰判断後 |

---

## 進捗サマリ

| Phase | 全タスク | 完了 | 進捗率 |
|---|---|---|---|
| Phase 0 | 25 | 14 | 56% |
| Phase 1 | 5 | 0 | 0% |
| Phase 2 | 8 | 0 | 0% |
| Phase 3 | 4 | 0 | 0% |
| Phase 4 | 5 | 0 | 0% |
| Phase 5 | 4 | 0 | 0% |
| Phase 6 | 4 | 0 | 0% |
| Phase 7 | 3 | 0 | 0% |
| **合計** | **58** | **14** | **24%** |

---

## 運用ルール

1. **タスク追加時**: フェーズ末尾に追加。番号は `フェーズ番号-連番`。修正タスクは `-T` 接尾辞（例: `3-T`）
2. **日付記入**: `予定日` は着手前に入れる。`完了日` は実際にDONEした日。
3. **ステータス更新**: 着手したら `⏳`、完了で `✅`、ブロックされたら `⏸` + メモに理由
4. **未割当の論点**: 「バックログ」に起票、後でフェーズに割り当てる
5. **進捗サマリ**: 任意のタイミングで再集計
