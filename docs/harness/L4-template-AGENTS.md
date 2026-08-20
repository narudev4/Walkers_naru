<!--
  L4 開発規約テンプレート。
  配置: 案件の app/AGENTS.md として置く。app/CLAUDE.md は中身を `@AGENTS.md` の1行にして
  Claude（CLAUDE.md）と Codex（AGENTS.md）の両方が同じ規約を読むようにする。
  「スタック」「固有メモ」は project-init / carveout が案件ごとに埋める。
  「規約」部分は全案件共通の定数。古谷マニュアル「本開発フェーズ」準拠。
-->

# {案件} app — 開発規約（L4）

<!-- フレームワークのバージョン警告: 該当スタックのものを残す。訓練データを信じず versioned docs を読む（L1 事実確認） -->
> ⚠️ {例: This is NOT the Next.js you know. APIs may differ from training data — read node_modules/next/dist/docs/ before coding}
> ⚠️ {例: Expo SDK {ver} — read https://docs.expo.dev/versions/v{ver}/ before coding}

## スタック（project-init が埋める）

- フレームワーク: {Next.js App Router / Expo SDK / …}
- 言語: TypeScript
- DB: {Neon Postgres / Supabase / なし}
- ホスティング: {Vercel}
- テスト: {vitest / jest}
- パッケージャー: {lockfile から検出。pnpm-lock→pnpm / package-lock→npm / yarn.lock→yarn}

## コマンド

| 用途 | コマンド |
|---|---|
| 開発 | `{pm} dev` |
| ビルド | `{pm} build` |
| Lint | `{pm} lint` |
| 型チェック | `{pm} typecheck` |
| テスト | `{pm} test` |

## ブランチ・コミット（定数）

- `main` = 本番（**直コミット禁止・PR マージのみ**）/ `develop` = ステージング / `feature/{機能名}` = 作業
- コミット規約: `feat:` / `fix:` / `docs:` / `refactor:` + 日本語サマリ
- 自動デプロイ: `feature/*`→`develop` マージでステージング、`develop`→`main` で本番

## デプロイ（定数）

- デプロイは **GitHub 連携の自動デプロイ**を使う
- ⛔ `vercel --prod --yes` や `.vercel/project.json` 無しの CLI デプロイ禁止（別チーム事故・L2 絶対 NG #5）。手順は `.claude/refs/vercel-deploy.md`
- GitHub リポジトリは **Private** で作成（`gh repo create --private`）

## テスト・検収（定数）

- /goal の完了条件 = 検収シート（テスト自動）の全行 PASS または テスト不可。詳細は真理源スプシ
- **自己採点禁止**: PASS/FAIL は実装者と別の検証サブエージェント（verifier）が独立コンテキストで記入。実装者 ≠ 検証者 ≠ /goal 判定者（Haiku）の3層分離
- コードレビューは Codex（`/codex:review`）、UI 確認は Claude in Chrome（古谷マニュアル: AI 総当たり → 人力の二段構え）
- 本番反映・publish は Claude 独断禁止、必ず naru 承認（L2 絶対 NG #6）

## この app 固有の技術メモ（project-init / 開発中に追記）

- {例: lib/claude.ts はローカル CLI 前提で Vercel で動かない → Anthropic SDK 化が必要}
- {なければ空}
