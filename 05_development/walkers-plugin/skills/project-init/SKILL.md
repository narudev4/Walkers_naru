---
description: 新規案件のディレクトリと L3 CLAUDE.md を雛形から自動生成する。CONTEXT.md・議事録から穴埋めし、手書き CLAUDE.md をゼロにする。app の開発 hooks（コードチェック）も scaffold する。「新規案件作って」「案件初期化」「project-init」で起動。
---

# project-init（新規案件の初期化）

トリガー: 「新規案件」「案件初期化」「project-init」「{社名}の案件を立てる」

新規案件の標準構成を雛形から生成する。**naru が手で CLAUDE.md を書かない**のが目的。

## 標準構成

```
clients/{案件}/            （移行前は 03_projects/{案件}/）
  CLAUDE.md      ← L3。docs/harness/L3-template-CLAUDE.md から生成
  CONTEXT.md     ← 会社背景・一次情報（議事録から生成 or 既存を流用）
  minutes/       ← 議事録
  proposal/      ← 提案書
  mockups/       ← モックアップ
  app/ or repos/ ← 開発リポ（CV 後・carveout が用意）
```

## 実行手順

### Step 1: ヒアリング（最小限）

L3 雛形の穴のうち、AI が資料から取れないものだけ聞く:
1. クライアント正式社名・呼称
2. 現フェーズ（①営業 など）／進め方モード（一人完結 / 分業）
3. 既存資料の所在（議事録 Doc・提案書・スプシ）

### Step 2: 資料から穴埋め材料を収集

- 議事録があれば `mcp__google-workspace__get_doc_as_markdown` 等で読み、関係者・経緯・窓口チャネルを抽出
- 既存スプシがあれば ID を控える（無ければ後で spreadsheet-driven で作成）

### Step 3: ディレクトリと CLAUDE.md 生成【承認必須】

1. `docs/harness/L3-template-CLAUDE.md` を Read
2. 穴（{クライアント名}・{現フェーズ}・{スプシID}・{関係者}・{窓口チャネル}・{固有ルール}）を埋める
3. **生成内容を naru に提示して承認を得る**（推測で確定しない。不明な穴は「要確認」と明示）
4. 承認後、`clients/{案件}/` を作成し CLAUDE.md を書き出す

### Step 4: CONTEXT.md

議事録から会社背景・課題・提案経緯・一次情報リンクを CONTEXT.md に生成（営業フェーズの substance）。詳細フォーマットは meeting-minutes / コンテキスト作成の流れに従う。

### Step 5: 開発 hooks の scaffold（app がある場合）

`docs/harness/hooks/` の `check-after-edit.sh`・`gate-before-commit.sh` を `app/.claude/hooks/` にコピーし、`settings.app.json` を `app/.claude/settings.json` にマージする（コードチェックの自動化）。スタック・パッケージャーは lockfile から検出して L4（app/AGENTS.md）に記入。

## 完了報告

生成したパス一式と、埋められなかった「要確認」の穴を naru に報告する。
