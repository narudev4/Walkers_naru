---
description: 記事図解スライド化（図解→4K PNG→PPTX→Googleスライド）
---

# 記事図解スライド化（図解→4K PNG→PPTX→Googleスライド）

トリガー: 「記事スライド」「図解スライド」「記事をスライドに」「図解してスライド化」「記事プレゼン」

## 入力
$ARGUMENTS

引数は以下のいずれか:
- **記事URL**: 記事を取得 → 全見出しの図解作成 → 4K PNG変換 → PPTX生成 → Google Driveアップロード
- **スラッグ名**: 既存PNG群からPPTX生成のみ実行（`--pptx-only`）
- **省略時**: ユーザーに確認

オプション:
- `--scale=N` : 解像度スケール倍率（デフォルト: 4 = 4K品質 3200px幅）
- `--pptx-only` : 既存PNG群からPPTX生成→アップロードのみ
- `--no-upload` : Google Driveアップロードをスキップ（ローカルPPTXのみ）

## 概要
記事URLから全H2/H3/H4見出しの図解HTMLを生成し、4K PNGに一括変換、セクション区切り付きPPTXを生成し、Google Driveにアップロードしてスライドとして開くまでを一貫実行する。

## 全体フロー

```
Phase 1: 記事取得・構成分析
Phase 2: 図解HTML生成（/create-diagrams の Part A）
Phase 3: 4K PNG変換（/create-diagrams の Part B）
Phase 4: PPTX生成（セクション区切り＋図解スライド）
Phase 5: Google Driveアップロード → Googleスライドとして開く
```

---

# Phase 1〜3: 図解作成・PNG変換

**`/create-diagrams` スキルを内部的に実行する。**

1. 記事URLから `curl` + Python でHTMLから本文テキストを抽出
2. 全H2/H3/H4見出しを一覧化し、各見出しに最適な図解タイプを割り当て
3. 各見出しに対して自己完結型HTMLを `output/gui/` に生成
4. Playwrightで4K PNG（幅3200px）に一括変換
5. `output/gui/{slug}-images/` にPNG群を保存
6. `preview.html` を生成して `open` で表示

**`/create-diagrams` のルール・デザイン原則・図解タイプ・カラーパレットはすべてそのまま適用する。**

ここまでで以下が完成:
- `output/gui/{slug}-h2-xxx.html` — 図解HTML群
- `output/gui/{slug}-images/{slug}-h2-xxx.png` — 4K PNG群
- `output/gui/{slug}-images/preview.html` — プレビュー

---

# Phase 4: PPTX生成

## 環境準備

```bash
cd /tmp && npm list pptxgenjs 2>/dev/null || npm install pptxgenjs
```

## スライド構成

| スライド種別 | 内容 | 枚数 |
|------------|------|------|
| タイトルスライド | 記事タイトル・サブタイトル・URL | 1枚 |
| セクション区切り | H2見出しごとに1枚（番号・タイトル・配下スライド数） | H2の数 |
| 図解スライド | 各PNG画像を1スライド1枚で配置 | 図解の数 |
| クロージングスライド | Walkers情報・CTA | 1枚 |

## カラーパレット

```
NAVY    = "1E2761"  // ダークスライド背景
ICE     = "CADCFC"  // サブテキスト
WHITE   = "FFFFFF"  // メインテキスト
DARK    = "0F172A"  // セクション区切り背景
GRAY    = "64748b"  // 注釈テキスト
LIGHT   = "F1F5F9"  // 図解スライド背景
```

## セクション色（H2の内容に応じて選択）

| 種別 | カラーコード | 用途 |
|------|-----------|------|
| 青系 | `2563EB` | 手順・ステップ・概要系 |
| 緑系 | `10B981` | メリット・成功・ノーコード系 |
| 赤系 | `DC2626` | リスク・注意・セキュリティ系 |
| 紫系 | `8B5CF6` | 比較・分析・評価系 |
| アンバー系 | `D97706` | 原因・注意・警告系 |

## PptxGenJSスクリプト構造

```javascript
const pptxgen = require("pptxgenjs");
const path = require("path");
const fs = require("fs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "Walkers AI";
pres.title = "{記事タイトル}";

const imgDir = "{PNG出力ディレクトリの絶対パス}";

// PNG画像の寸法取得（PNGヘッダからwidth/height読み取り）
function getImageDims(imgPath) {
  const buf = fs.readFileSync(imgPath);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// --- タイトルスライド ---
// NAVY背景、アクセントライン、記事タイトル、サブタイトル

// --- セクションごとにループ ---
// sections = [{ title, number, color, images: [{file, label}] }]
for (const section of sections) {
  // セクション区切りスライド: DARK背景、番号、アクセントライン、タイトル
  // 図解スライド: LIGHT背景、PNG画像をアスペクト比維持で中央配置
  for (const img of section.images) {
    const dims = getImageDims(path.join(imgDir, img.file));
    const aspectRatio = dims.width / dims.height;
    // スライド(10" x 5.625")内に収まるよう計算
    // slide.addImage({ path, x, y, w, h })
  }
}

// --- クロージングスライド ---
// NAVY背景、Walkers情報、CTA

pres.writeFile({ fileName: outputPath });
```

## 画像配置のルール

1. **アスペクト比を維持** — 横幅 or 縦幅のどちらかがスライドに収まるよう計算
2. **中央配置** — 余白が均等になるよう x, y を算出
3. **マージン0.3"** — スライド端から最低0.3"の余白
4. **背景色 F1F5F9** — 図解の白背景と区別するための薄いグレー

## タイトルスライドのデザイン

```
背景: NAVY (1E2761)
アクセントライン: 0.8" x 1.6" → w:1.2" h:0.06" 色:ACCENT
タイトル: 40pt Arial Black 白 太字
サブタイトル: 18pt Arial ICE色
フッター: 12pt Arial GRAY色
```

## セクション区切りスライドのデザイン

```
背景: DARK (0F172A)
番号: 48pt Arial Black ACCENT色
アクセントライン: 0.8" → w:0.8" h:0.05" 色:ACCENT
タイトル: 32pt Arial 白 太字
スライド数: 12pt Arial GRAY色（"{N} slides"）
```

## クロージングスライドのデザイン

```
背景: NAVY (1E2761)
社名: 36pt Arial Black 白 太字
アクセントライン
メッセージ: 18pt Arial ICE色
URL: 14pt Arial GRAY色
```

## 出力

```bash
# PPTXを保存
output/slides/{slug}-diagrams.pptx

# 保存後にopen
open "output/slides/{slug}-diagrams.pptx"
```

---

# Phase 5: Google Driveアップロード

## 手順

1. **Playwright** でGoogle Drive（`https://drive.google.com/drive/my-drive`）を開く
2. 「新規」ボタン → 「ファイルをアップロード」をクリック
3. `browser_file_upload` でPPTXファイルを指定
4. アップロード完了（100%）を確認
5. アップロードダイアログを閉じる
6. Google Driveで検索してファイルを見つける
7. ダブルクリックでGoogleスライドとして開く
8. ユーザーにGoogleスライドのURLを報告

## Playwrightフロー

```javascript
// Step 1: Google Drive を開く
browser_navigate("https://drive.google.com/drive/my-drive")

// Step 2: 新規 → ファイルをアップロード
browser_click("新規ボタン")
browser_click("ファイルをアップロード")

// Step 3: ファイル選択
browser_file_upload(["/absolute/path/to/{slug}-diagrams.pptx"])

// Step 4: アップロード完了待ち（100%表示を確認）
browser_wait_for({ time: 5 })  // または進捗バーが100%になるまで

// Step 5: ダイアログを閉じる
browser_click("閉じる")

// Step 6: 検索してファイルを開く
browser_navigate("https://drive.google.com/drive/search?q={slug}")
browser_wait_for({ time: 3 })

// Step 7: ダブルクリックで開く
browser_click(ファイルのgridcell, { doubleClick: true })

// Step 8: URLを取得して報告
// 新しいタブに "https://docs.google.com/presentation/d/{ID}/edit" が開く
```

## `--no-upload` 指定時

Phase 5をスキップし、ローカルのPPTXを `open` コマンドで開くだけにする。

---

# 出力構成

```
output/gui/
├── {slug}-h2-xxx.html           ← 図解HTML（Phase 2）
├── {slug}-h3-xxx.html
├── {slug}-h4-xxx.html
├── ...
└── {slug}-images/                ← PNG + プレビュー（Phase 3）
    ├── {slug}-h2-xxx.png
    ├── {slug}-h3-xxx.png
    ├── {slug}-h4-xxx.png
    ├── ...
    └── preview.html

output/slides/
└── {slug}-diagrams.pptx          ← PPTX（Phase 4）
```

---

# エラーハンドリング

| エラー | 対処 |
|-------|------|
| 記事取得失敗 | URLを再確認、curl のUser-Agentを変更して再試行 |
| Playwright未インストール | `/tmp/pw-convert/` に自動セットアップ |
| pptxgenjs未インストール | `/tmp/` に自動 `npm install` |
| Google Drive未ログイン | ユーザーにログインを依頼 |
| アップロード失敗 | 3回までリトライ、それでも失敗したらローカルPPTXのみ |
| ファイルが検索に出ない | アップロード直後は数秒待って再検索 |

---

# ルール（厳守）

1. **図解作成は `/create-diagrams` のルールをすべて継承する** — デザイン原則・パターン集・カラーパレットはそのまま適用
2. **全H2/H3/H4見出しに図解を作成** — 漏れなくカバー
3. **PPTXはPptxGenJS（Node.js）で生成** — python-pptxは使わない
4. **1スライド1図解** — 複数の図解を1スライドにまとめない
5. **H2ごとにセクション区切りスライドを挿入** — ダークスライドでセクション名と番号を表示
6. **画像はアスペクト比維持で中央配置** — 歪み禁止
7. **Google Driveアップロードは Playwright browser_file_upload で行う** — MCP経由ではない
8. **PPTXが完成したらGoogleスライドのURLをユーザーに報告する**
9. **`--no-upload` 指定時はローカルのみ** — Google Drive操作をスキップ
10. **PptxGenJSの共通ピットフォールに注意** — `#`付き色コード禁止、オプションオブジェクト再利用禁止
