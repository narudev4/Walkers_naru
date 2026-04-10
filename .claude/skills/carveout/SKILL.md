---
description: プロジェクトカーブアウト
---

# プロジェクトカーブアウト

トリガー: 「カーブアウト」「独立リポジトリにして」「切り出して」

## 入力
$ARGUMENTS

## 利用ツール

| ステップ | ツール | 用途 |
|---------|--------|------|
| Step 1 | Read / Glob / Grep | Walkers_full内の対象プロジェクトのファイル調査 |
| Step 2 | — | ユーザーへのヒアリング（テキスト） |
| Step 3 | Bash: `mkdir -p` | ディレクトリ構造のscaffold |
| Step 3 | Bash: `cp` | ソースファイルのコピー |
| Step 3 | Write | 設定ファイル・CLAUDE.md・メモリの生成 |
| Step 4 | Bash: `git init` + `git add` + `git commit` | Git初期化・初回コミット |
| Step 5 | Bash: `gh repo create` + `git push` | GitHub連携（GitHubカーブアウト時のみ） |

## 全体フロー

```
① 対象プロジェクト調査 → ② ヒアリング + 構成確認（承認必須） → ③ scaffold + ファイルコピー → ④ ClaudeCode環境整備 → ⑤ Git初期化 → ⑥ 完了報告
```

> **絶対ルール**: ② でユーザーの承認を得るまで ③ に進まない。推測でディレクトリを作り始めない。

---

## Step 1: 対象プロジェクト調査

Walkers_full内の対象プロジェクトに関連するファイルを洗い出す:

1. **`03_projects/{クライアント名}/`** — 企画書・提案書・議事録
2. **`05_development/{プロジェクト名}/`** — ソースコード・設定ファイル
3. **`output/deploy/{プロジェクト名}/`** — デプロイ済みモックアップ
4. **メモリファイル** — `~/.claude/projects/` 配下の当該プロジェクトのメモリディレクトリ内の関連メモリ
5. **MEMORY.md** — 該当プロジェクトに関するエントリ

### 調査コマンド例
```bash
# プロジェクト関連ファイルの検索
find 03_projects/ 05_development/ output/deploy/ -name "*{keyword}*" -type f
# メモリ内の関連情報
grep -rl "{keyword}" ~/.claude/projects/*/memory/
```

---

## Step 2: ヒアリング + 構成確認【承認必須】

ユーザーに以下を確認・提案する:

### 確認事項
1. **プロジェクト名**: リポジトリ名（ディレクトリ名）
2. **カーブアウトパターン**: ローカルのみ or GitHub
3. **技術スタック**: Next.js / Python / Node.js / その他
4. **含めるファイル**: Step 1で洗い出したファイルのうちどれをコピーするか
5. **除外するファイル**: 機密情報・不要ファイル

### 提案する構成

調査結果に基づいて、以下を提案する:

```
■ カーブアウト先
~/プロジェクト名/

■ ディレクトリ構成（案）
プロジェクト名/
├── CLAUDE.md
├── .claude/
│   └── commands/          # 必要なスキル
├── .mcp.json              # MCP設定テンプレート
├── .gitignore
├── .env.example
├── src/                   # ← 技術スタックに応じて変わる
│   └── ...
├── docs/                  # 企画書・提案書等（必要な場合）
└── ...

■ コピーするファイル
- [ファイル一覧]

■ CLAUDE.mdに含める情報
- プロジェクト概要
- クライアント情報
- 技術スタック
- ディレクトリ構造
- 開発ルール
- MCP連携

■ メモリに移植する情報
- [Walkers_fullのメモリから抽出する項目]
```

> **ユーザーの承認を得てから実行に進む。**

---

## Step 3: scaffold + ファイルコピー

### 3-1. ディレクトリ作成

```bash
mkdir -p ~/プロジェクト名
```

### 3-2. 技術スタックに応じたscaffold

| 技術スタック | scaffold内容 |
|------------|-------------|
| **Next.js / React** | `src/app/`, `src/components/`, `src/lib/`, `public/`, `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts` |
| **Python** | `src/`, `tests/`, `config/`, `pyproject.toml` or `requirements.txt` |
| **Node.js API** | `src/routes/`, `src/services/`, `src/middleware/`, `tests/`, `package.json` |
| **GAS (Google Apps Script)** | `src/`, `.clasp.json`, `appsscript.json` |
| **ドキュメント/企画系** | `docs/`, `assets/`, `drafts/`, `references/` |

scaffold時に作るもの:
- **`.gitignore`** — 技術スタックに適した内容（node_modules, .env, __pycache__, .vercel 等）
- **`.env.example`** — 必要な環境変数のキーのみ（値は空）
- **依存管理ファイル** — `package.json` / `pyproject.toml` 等（プロジェクト名・説明入り）

### 3-3. ファイルコピー

Walkers_fullからのコピー（**移動ではない — 元は残す**）:

```bash
cp -r ./05_development/{project}/* ~/プロジェクト名/src/
cp ./03_projects/{client}/*.md ~/プロジェクト名/docs/
```

**コピー時の注意:**
- `credentials/`, `.env`, `.mcp.json` などの機密ファイルはコピーしない
- `node_modules/` はコピーしない（`npm install` で再生成）

---

## Step 4: ClaudeCode環境整備

### 4-1. CLAUDE.md 作成

以下の構成で `~/プロジェクト名/CLAUDE.md` を作成する:

```markdown
# {プロジェクト名}

## プロジェクト概要
- [何を作っているか]
- [誰のためか（クライアント情報）]
- [現在のフェーズ]

## 技術スタック
| 項目 | 技術 |
|------|------|
| ... | ... |

## ディレクトリ構造
| パス | 用途 |
|------|------|
| ... | ... |

## 開発ルール
- [プロジェクト固有のルール]

## 外部ツール連携
- [必要なMCP・API]

## デプロイ
- [デプロイ方法・URL]
```

### 4-2. メモリファイル作成

Walkers_fullのメモリから該当プロジェクトの情報を抽出し、カーブアウト先のメモリに移植する。

メモリの配置先: カーブアウト先のルートに `.claude/` ディレクトリを作成し、その中にメモリを配置。
（ClaudeCodeが自動的に `~/.claude/projects/{パスベースのプロジェクト名}/memory/` を使うが、
初回起動時にコンテキストがあるよう CLAUDE.md 内に主要情報を記載しておく）

### 4-3. スキル（コマンド）作成

プロジェクトで頻繁に使うワークフローがあれば `.claude/commands/` にスキルを作成する。

よくあるスキル:
- `deploy.md` — デプロイ手順
- `test.md` — テスト実行手順
- `review.md` — コードレビュー観点

### 4-4. MCP設定テンプレート

必要な外部ツールがある場合 `.mcp.json` のテンプレートを作成:

```json
{
  "mcpServers": {}
}
```

> **注意**: 実際のAPI キーや認証情報は含めない。`.env.example` にキー名だけ記載する。

---

## Step 5: Git初期化

```bash
cd ~/プロジェクト名
git init
git add .
git commit -m "feat: initial scaffold from Walkers_full carveout"
```

### GitHubカーブアウトの場合（ユーザーが選択した場合のみ）

```bash
gh repo create {プロジェクト名} --private --source=. --push
```

> **注意**: public/private はユーザーに確認してから決める。

---

## Step 6: 完了報告

カーブアウト完了後、ユーザーに以下を伝える:

```
カーブアウトが完了しました。

■ 配置先
~/プロジェクト名/

■ 含まれるファイル
- CLAUDE.md（プロジェクトコンテキスト）
- .claude/commands/（スキル定義）
- .gitignore, .env.example
- src/（ソースコード）
- docs/（ドキュメント）※ある場合

■ ClaudeCodeで開く
cd ~/プロジェクト名 && claude

■ 次にやること
- [ ] .env を .env.example からコピーして値を設定
- [ ] npm install / pip install（依存パッケージ）
- [ ] MCP接続設定（必要な場合）
```

---

## ルール（厳守）

1. **構成をユーザーに承認させてからファイル操作を開始する**（推測で作らない）
2. **ファイルは移動ではなくコピー** — Walkers_full内の元ファイルは残す
3. **機密情報をコピーしない** — `.env`, `credentials/`, APIキーが含まれるファイル
4. **CLAUDE.mdは必ず作る** — ClaudeCodeが自走できる状態にすることがカーブアウトの目的
5. **技術スタックに合ったscaffold** — MDファイルだけでなくディレクトリ構造・設定ファイルも整備する
6. **配置先はユーザーホーム直下** — `~/プロジェクト名/`
7. **GitHubへのpushはユーザーの選択時のみ** — デフォルトはローカルカーブアウト
