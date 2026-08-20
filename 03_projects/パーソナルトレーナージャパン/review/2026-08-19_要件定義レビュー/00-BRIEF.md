# PTJ 要件定義レビュー・テストケース深掘り 共通ブリーフ（2026-08-19）

> 司令塔（hq）: この Claude セッション（PTJ オーケストレータ）。ワーカーはこのファイルを最初に読む。
> 目的: naru の指示「画面一覧・画面詳細（機能一覧）・工程表（作業一覧／PoCスケジュール／稼働計画）・質問（確認事項／ご質問・ご相談）などの要件定義をレビューし、多モデルのサブエージェントにレビュー・質問させて改善する。そのあと、想定されていない部分まで踏み込んだ詳細テストケースを作る。LINE 通知 URL・リッチメニュー→404 のような不具合も全部改善したい」。

## 1. 案件の前提（事実のみ）

- クライアント: パーソナルトレーナージャパン様（PTJ／心身健康倶楽部）。腰の動作チェック → AI 診断 → トレーニング提案 → 1ヶ月継続支援の PoC アプリ（LINE LIFF + Next.js 16 + Supabase + Vercel）。
- 関係者: 枝光様（トレーナー・監修）、高橋様（PTJ）、古谷大輝（Walkers）、naru（Walkers・PM 兼実装）。
- 利用者は 50〜60 代のジム会員。本文 16px 以上・タップ領域 44px 以上が方針。
- フェーズ: 受託開発マニュアルの「③要件定義（準委任）」。PoC 開始日は本日 8/19 15:00 の定例で決める（案A 8/24 月・案B 8/21 金）。今日の定例資料: `app/docs/2026-08-18_mtg-shiryo-poc-genzaichi.md`。
- 真理源スプシ「【PTJ様】PoC実装」: `1g80dJf88sSjhIP62vRzJF1oVJU0GieszXh25Nn8ZMA4`。**書き込み禁止**（読み取りのみ。改善提案は成果物 md に書き、hq が naru 承認後に反映する）。

## 2. 入力（スナップショットと実装）

### スプシのローカルスナップショット（XLSX エクスポート由来・全行・13:26 JST 時点）
ディレクトリ: `/private/tmp/claude-501/-Users-naru-Walkers-naru-03-projects---------------/6976e4eb-7ddf-4382-bf27-02b3bf6d733c/scratchpad/sheets/`

| ファイル | タブ | 役割 |
|---|---|---|
| 00_index.md | 0_INDEX | 索引・運用ルール |
| 01_project-overview.md | プロジェクト概要 | 前提・現在地 |
| 02_poc-schedule.md | PoCスケジュール | 先方提示用ガント |
| 03_questions-to-client.md | ご質問・ご相談 | 先方との Q&A（W-01〜） |
| 04_walkers-procedure.md | Walkers作業手順 | 内部手順 |
| 05_line-notifications.md | LINE通知一覧 | N-01〜N-12 文言・条件 |
| 06_work-list.md | 作業一覧 | 工程表（内部）。ID 例: S-1, T-6, V-2, X-1 |
| 07_feature-list.md | 機能一覧 | 機能詳細 F-01〜F-52（=「画面詳細」に相当） |
| 08_nfr.md | 非機能要件シート | 19 カテゴリ |
| 09_tech-verification.md | 技術検証結果 | 検証済／未検証 |
| 10_confirmations.md | 確認事項 | 質問事項（内部・#1〜） |
| 11_environment.md | 環境情報 | URL・リポジトリ |
| 12_capacity-plan.md | 稼働計画 | 残稼働と日程 |
| 13_error-states.md | 異常系・状態一覧 | 異常系の網羅表 |
| 14_screen-list.md | 画面一覧 | 全画面と実装状況（要件定義書の1枚目） |
| 15_continuation-flow-19steps.md | シート5 | 継続フロー 19 ステップ（UX 設計の正） |
| 16_ux-audit.md | UX監査（U-3） | UX 監査結果 |
| 17_poc-vs-prod.md | 4-1線引き材料 | PoC／本番の仕分け |
| 18_next-actions.md | NA | MTG ごとの NA |
| 19〜27 | アーカイブ・動画・名簿・診断パターン・カウンセリング質問・LLM方針・Phase8・FB方針・フィードバック | 参考 |

### 実装コード
- リポジトリ: `/Users/naru/Walkers_naru/03_projects/パーソナルトレーナージャパン/app`（独立 git・main・GitHub `narudev4/ptj-poc-ai-trainer`・push で Vercel 本番自動デプロイ）。
- 画面: `app/<route>/page.tsx`（/, consent, profile, counseling, hearing, result, today, plan, weekly, monthly, home, record, more, admin, flow-demo, review）。API: `app/api/**`。ロジック: `lib/**`（notifications.ts / notify-triggers.ts / events.ts / restore.ts / diagnosis/**）。テスト: `tests/**`（vitest 173 件・全通過 13:24）。
- 実装メモ: `app/docs/*.md`（特に `2026-08-17_T-3-test-spec.md`（E2E 仕様と結果）、`2026-08-06_line-kaishubin-final.md`、`2026-08-06_richmenu-draft.md`、`2026-08-18_line-id-recovery.md`、`liff-setup.md`）。
- 本番: https://ptj-poc-ai-trainer.vercel.app 。デモ入口はキー制（`?demo=1` 素通しは廃止）。**本番 DB・本番 LINE への書き込み操作は禁止**（読み取り・curl の GET／認可否定系のみ可）。
- ワーカーは**コードを変更しない**（読み取り専用）。修正が必要なものは成果物に「最小修正案」として書く。hq が集約して実装する。

## 3. hq が既に確定させた所見（重複調査不要・参照可）

- **[High・確定] LIFF ディープリンク 404**: 通知の URL（`https://liff.line.me/2010137019-OCaRjDeQ/today` 等）とリッチメニュー「きょうのトレーニング」をタップすると「ページが見つかりませんでした」。原因は LINE Developers 上の **LIFF エンドポイント URL が `https://ptj-poc-ai-trainer.vercel.app/profile`** になっていること（`curl https://liff.line.me/2010137019-OCaRjDeQ/today` の応答 HTML で実測）。LIFF SDK は「エンドポイントのパス＋liff.state」へ二次遷移する（`@liff/init` の `decodeState`）ため `/profile/today` → 404。
  - hq 対応済み: `next.config.ts` に `/profile/today`→`/today` 等の 307 安全網、`/profile` で liff.state 先行処理、docs 修正（コミット `3d689ff`・本番デプロイ済み）。根本対処（エンドポイント URL を `/` に変更）は naru の手作業待ち。
  - 派生論点（ワーカーで深掘りしてよい）: 現状の `/profile` 着地では「トップ `/` のプラン有無振り分け」が効かない／同意前ユーザーの着地／外部ブラウザで開いた場合／`liff.state` に任意パスを入れられる（open redirect 相当か）／T-3 テスト 4-6「ディープリンク着地」が 📱未実施のまま「開始できる状態」と報告されている点。
- スプシ「機能一覧」F-52 は「実送信確認済み」と書かれているが、着地までの確認はされていなかった（要件定義書の「実装済み」表記の信頼性に関わる）。

## 4. 成果物の置き場と形式

- ディレクトリ: `/Users/naru/Walkers_naru/03_projects/パーソナルトレーナージャパン/review/2026-08-19_要件定義レビュー/`
- ファイル名は担当ごとに指定（各タスク文に記載）。Markdown。**日本語・文末は句点「。」**（箇条書き・表セルも。体言止めのみ例外）。
- 所見は必ず「証拠（スナップショットの行番号 or `file:line` or 実行結果）」を添える。憶測は「未確認」と明示。断定できない所見は「要確認」に格下げする。
- 重大度: Critical / High / Medium / Low（walkers-code-review の定義に準拠）。要件定義文書の不備は「文書所見」、実装の不備は「実装所見」、先方に聞くべきものは「質問」に分ける。
- 完了時: 成果物末尾に「## hq への報告」（3〜10 行の要約＋件数）を書き、SendMessage で hq（このメッセージの from）へ「完了・ファイルパス・件数」を送る。人間には質問しない。判断が必要なものは成果物に「要 naru 判断」として列挙して進める。
