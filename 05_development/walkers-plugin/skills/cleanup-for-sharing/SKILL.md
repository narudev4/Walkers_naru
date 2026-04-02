---
description: 個人データを除去したテンプレート版を作成しzip化
---

# システム共有用クリーンアップ

トリガー: 「共有用にクリーンアップ」「メンバー共有準備」「テンプレート化」

## 入力
共有先・用途: $ARGUMENTS

## 概要
現在のワークスペースを複製し、個人データ・機密情報を除去したテンプレート版を作成 → SETUP.md追加 → zip化 → 一時ファイル削除まで一括実行する。
**元のディレクトリは一切変更しない。**

## フロー

```
① ヒアリング → ② 複製 → ③ クリーンアップ → ④ 残留チェック → ⑤ SETUP.md生成 → ⑥ ユーザー確認 → ⑦ zip化 → ⑧ 一時ファイル削除
```

---

### ① ヒアリング

共有先・用途が不明な場合、以下を確認する:
- 社内メンバー向け / 外部パートナー向け（外部の場合はより厳密にクリーンアップ）
- 汎用テンプレート / 特定メンバー向け

### ② ディレクトリの複製

```bash
rsync -a --exclude='.git' C:/Users/owner/Walkers_full/ C:/Users/owner/Walkers_template_YYYYMMDD/
```

- `.git/` は除外する
- コピー元は絶対に変更しない
- 命名例: `Walkers_template_20260227`（汎用）、`Walkers_onboarding_田中`（特定メンバー向け）

### ③ クリーンアップ

複製したディレクトリ `TDIR` 内で以下を**一括実行**する。

#### Phase A: ファイル削除（bash一括）

```bash
TDIR="C:/Users/owner/Walkers_template_YYYYMMDD"

# ルート直下のスクリーンショットPNG
rm -f "$TDIR"/*.png

# .DS_Store 全削除
find "$TDIR" -name ".DS_Store" -delete

# Playwrightログ
rm -rf "$TDIR"/.playwright-mcp

# credentials/ 配下
rm -rf "$TDIR"/credentials/*

# output/ 配下の成果物（gui-core.js / gui-style.css は保持）
find "$TDIR/output/gui" -type f ! -name "gui-core.js" ! -name "gui-style.css" -delete
rm -rf "$TDIR/output/gui/state" && mkdir -p "$TDIR/output/gui/state"
rm -rf "$TDIR/output/deploy"/* "$TDIR/output/articles"/* "$TDIR/output/trends"/* "$TDIR/output/digest"/* "$TDIR/output/article-monitor"/* "$TDIR/output/temp"/*
rm -f "$TDIR/output"/*.{pdf,docx,png,pptx,xlsx,zip,py,txt,PDF}
rm -rf "$TDIR/output/kamikarte_screenshots" "$TDIR/output/手引き様式"
rm -f "$TDIR/output/issue_gui-save-flow.md" "$TDIR/output/meeting_"*.txt

# 03_projects/ 配下の案件データ（templates/ は保持）
find "$TDIR/03_projects" -mindepth 1 -maxdepth 1 -type d ! -name "templates" -exec rm -rf {} +

# 05_development の認証情報・node_modules
for dir in mcp-google mcp-misoca mcp-misoca-private; do
  rm -f "$TDIR/05_development/$dir/credentials.json" "$TDIR/05_development/$dir/token.json"
  rm -rf "$TDIR/05_development/$dir/node_modules"
done

# 空ディレクトリ確保
mkdir -p "$TDIR"/{output/{trends,digest,articles,article-monitor,temp,deploy,gui/state},03_projects,00_context/portfolio,06_learning,credentials}
```

#### Phase B: ファイル内容の書き換え

| ファイル | 操作 |
|---------|------|
| `.mcp.json` | 実トークン（`ntn_*`, `tg_*`, Bearer値）をプレースホルダーに。絶対パス `/Users/xxx/` → `./` に修正 |
| `.claude/settings.local.json` | `permissions.allow` → 空配列 `[]` |
| `00_context/memories/facts.md` | `# 事実情報・ビジネスデータ\n\n<!-- 売上データ、契約情報、技術スタック等の事実情報を記録 -->` |
| `00_context/memories/decisions.md` | `# 意思決定の記録と理由\n\n<!-- 決定事項、その理由、決定日を記録 -->` |
| `00_context/memories/preferences.md` | `# ユーザーの好み・コミュニケーションスタイル\n\n<!-- コミュニケーションスタイル、作業習慣、ツールの好み等を記録 -->` |
| `04_sales/pipeline.md` | 全商談データ削除 → フォーマットテンプレートのみ（商談テンプレ1件 + リードテーブル + 成果物テーブル） |
| `CLAUDE.md` | 個人パス→`<プロジェクトルートの絶対パス>`、マネージドコネクタUUID削除、接続状態を「要設定」に統一 |
| `.claude/commands/gui.md` | `file:///C:/Users/owner/...` → `file:///<プロジェクトルートの絶対パス>/...` |
| `.claude/commands/dashboard.md` | 絶対パス → `<プロジェクトルート>` |
| `.claude/commands/schedule-adjust.md` | 個人メールアドレス → `<個人Googleアカウント>` |
| `05_development/walkers-dashboard/data.json` | 全データ削除 → 空テンプレートJSON |
| `05_development/walkers-dashboard/server.py` | auto_memoryパス → 空文字列 |
| `05_development/walkers-dashboard/refresh.sh` | auto_mem_path → None |
| `05_development/gas-gemini-renamer/Code.gs` | カレンダーID → プレースホルダー |

#### 残すもの
| 対象 | 理由 |
|------|------|
| `CLAUDE.md` | 業務マニュアル（組織共通） |
| `.claude/commands/` (22ファイル) | スキル定義（組織共通） |
| `.claude/agents/` (2ファイル) | エージェントチーム定義 |
| `00_context/Your-AI-setup.md` | Phase別セットアップマニュアル |
| `05_development/gui-system/` | GUI共通テンプレート（JS/CSS） |
| `05_development/mcp-*/*.js` | 自作MCPソースコード（認証情報なし） |
| `05_development/walkers-dashboard/` | ダッシュボード（データなし） |
| `03_projects/templates/` | 提案書テンプレート |
| `output/gui/gui-core.js`, `gui-style.css` | GUI共通アセット |
| `.gitignore` | Git設定 |
| 全ディレクトリ構造（空フォルダ含む） | 新メンバーが使う骨格 |

### ④ 個人情報残留チェック

Grepツールで以下を**すべて**チェックし、残留なしを確認する:

```
furutanidaiki|fullsrodd|walker-s\.co\.jp|daiki\.furutani
ntn_|tg_iy4sem|Bearer [a-zA-Z0-9]
@gmail\.com|@itochu|@kokuei|@pasona|...（既知の顧客ドメイン）
notion\.so
```

残留があれば修正する。

### ⑤ SETUP.md生成

テンプレートルートに `SETUP.md` を生成する。内容:
1. **前提条件**（Claude Code, Node.js 18+, Git）
2. **Step 1: フォルダ配置**
3. **Step 2: Git初期化**（git init → gh repo create）
4. **Step 3: MCP接続設定**（.mcp.jsonの各プレースホルダーの設定手順）
5. **Step 4: 個人情報の設定**（profile.md, パス修正箇所一覧）
6. **Step 5: 動作確認**（テスト用コマンド）
7. **ディレクトリ構造**（ツリー表示）
8. **利用可能なスキル一覧**（全コマンドの表）

### ⑥ ユーザー確認

以下を表形式で報告し、承認を得る:
1. **削除したファイル一覧**（件数とカテゴリ）
2. **修正したファイル一覧**（何をどう変えたか）
3. **残したファイル一覧**（組織共通資産）
4. **個人情報残留チェック結果**（全項目「残留なし」）

ユーザーが「追加で消して」「これは残して」と言えば対応する。

### ⑦ zip化

```bash
cd C:/Users/owner && zip -r Walkers_template_YYYYMMDD.zip Walkers_template_YYYYMMDD/ -x "*.DS_Store"
```

- zip完了後、**ファイルパスとサイズ**を報告する

### ⑧ 一時ファイル削除

ユーザーから「送った」「消していい」等の確認を得たら:

```bash
rm C:/Users/owner/Walkers_template_YYYYMMDD.zip
rm -rf C:/Users/owner/Walkers_template_YYYYMMDD/
```

確認なしに削除しない。

## ルール
- **元のワークスペースは絶対に変更しない**（複製に対してのみ操作する）
- Phase B（ファイル書き換え）は各ファイルをReadしてからWrite/Editする
- 削除・修正の完了後に必ず⑥でユーザー確認を取る
- `.mcp.json` の全トークンが確実にプレースホルダーになっていること
- APIキー・パスワードが残っていないことを④で最終検証する
- 判断に迷うファイルは削除せずユーザーに確認する
