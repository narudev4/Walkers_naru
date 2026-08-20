# Vercel デプロイルール

> このファイルは Vercel コマンドを使う／デプロイ作業の前に必ず最初に Read する。

## 絶対禁止

**`vercel --yes` / `vercel --prod --yes` は絶対に使わない。**

`.vercel/project.json` が無い状態で `--yes` を付けて実行すると、別チームに新規プロジェクトが**勝手に**作成される事故が起きる。過去に実際に発生済み。

## デプロイ方法（プロジェクト別）

### seo-monitor

GitHub 連携済み。CLI の `vercel` コマンドは使わない。

```bash
git push origin main
```

### その他のプロジェクト（output/deploy/ 配下のモックアップ等）

`vercel` CLI を直接叩く。実行前に必ず `.vercel/project.json` の存在とプロジェクト ID を確認する。

```bash
cd output/deploy/<project-name>
cat .vercel/project.json   # 存在し、想定したプロジェクトなら次へ
vercel --prod
```

<!-- 2026-07-29 修正: 旧記述の `deploy.sh` は全 20 プロジェクトに実体が存在しなかったため CLI 直叩きに改めた -->

### Vercel プラグインについて

`vercel@claude-plugins-official` プラグインは **2026-07-29 に無効化済み**（`~/.claude/settings.json`）。
`/vercel:deploy` 等のスラッシュコマンド・`vercel:*` スキル・Vercel MCP は使えない。デプロイは上記の CLI 直叩きで行う。

## 新規プロジェクトをリンクする場合

対話形式で正しいチーム・プロジェクトを選択する。`--yes` は付けない。

```bash
cd <project-dir>
vercel link
```

## 直接 `vercel` コマンドを叩く場合

実行前に必ず `.vercel/project.json` の存在を確認する。

```bash
cat .vercel/project.json
# 存在し、想定したプロジェクトIDなら実行
```

## トラブル時の対応

- 別チームに作られてしまったプロジェクト → ユーザーに報告し、Vercel ダッシュボードで削除
- ローカル `.vercel/` が壊れている → `rm -rf .vercel && vercel link` で再リンク
