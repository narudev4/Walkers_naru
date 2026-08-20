---
description: 記事図解作成 → 4K PNG変換 → プレビュー
---

# 記事図解作成 → 4K PNG変換 → プレビュー

トリガー: 「図解」「図解作って」「図を作って」「インフォグラフィック」「PNGに変換」「画像にして」「4K画像にして」

## 入力
$ARGUMENTS

引数は以下のいずれか:
- **記事URL**: 記事を取得して全H2/H3の図解を作成 → PNG変換 → プレビュー
- **スラッグ名**: `ai-dev-flow` のようなプレフィックス（既存HTML群をPNG変換のみ実行）
- **省略時**: ユーザーに確認

オプション:
- `--scale=N` : 解像度スケール倍率（デフォルト: 4 = 4K品質 3200px幅）
- `--png-only` : 既存HTMLのPNG変換のみ（図解作成をスキップ）

## 概要
記事URLから全H2/H3/H4見出しの図解HTMLを生成し、Playwrightで4K PNGに一括変換、2列グリッドのpreview.htmlで一覧表示するまでを一貫実行する。

---

# Part A: 図解HTML作成

## 核心ルール
- **すべての見出し（H2・H3・H4）に図解を作成する** — 漏れなくカバーする
- **H2 = 概要・サマリー図解**、**H3 = 詳細・個別図解**、**H4 = 補足・深掘り図解** という階層で設計する
- 1つの見出しに対して1つのHTMLファイルを生成する
- **幅800px固定・高さはコンテンツ適応** — body幅800pxのみ固定し、高さは自然に伸縮（heightやoverflow:hiddenは設定しない）

## Phase 1: 記事構成の取得・分析

1. **URLが指定された場合**: `curl` + Python でHTMLから本文テキストを抽出する
   ```bash
   curl -s '{URL}' | python3 -c "
   from html.parser import HTMLParser
   import sys
   class E(HTMLParser):
     # h1-h4, p, li のテキストを抽出
   ..."
   ```
2. **テキストが直接指定された場合**: そのまま分析に使う
3. 記事の **見出し構造（H2/H3/H4）** を一覧化する
4. 各見出しの内容を要約し、図解タイプを決定する

## Phase 2: 図解の設計（全見出しカバー）

### 階層設計の原則

| 見出しレベル | 図解の役割 | 設計方針 |
|------------|----------|---------|
| **H2** | その節の**全体像・概要**を俯瞰する | 子H3の内容を要約したサマリー型 |
| **H3** | 個別テーマの**詳細・具体**を説明する | 1つのポイントを深掘りした個別型 |
| **H4** | 個別テーマの**補足・深掘り**を説明する | H3の中の具体例・ケーススタディ・Tips等を図解化 |

### 図解タイプの選定基準

| 記事の内容パターン | 適切な図解タイプ | H2/H3の使い分け |
|-------------------|----------------|----------------|
| プロセス・手順・ステップ | **フロー図**（横一列ステップ） | H2:全体フロー / H3:個別ステップ詳細 |
| 2つの概念の対比 | **比較図**（左右対称） | H2:概要比較 / H3:個別項目の深掘り |
| メリット一覧 | **カード型一覧**（青系） | H2:全メリット概要カード / H3:個別メリット詳細 |
| デメリット一覧 | **カード型一覧**（赤/黄系） | H2:全デメリット概要カード / H3:個別デメリット詳細 |
| ツール・サービスの分類 | **ツール詳細カード** | H2:全ツールマップ / H3:カテゴリ別ツール紹介 |
| 数値・コスト比較 | **バーチャート**（横棒グラフ） | H2:総合比較 / H3:個別項目の数値 |
| リスク・注意点 | **リスクカード**（警告色） | H2:リスク概要 / H3:個別リスク詳細 |
| 必要スキル・知識 | **ナレッジリスト**（縦並び） | H3で使用 |
| 判断基準・選定 | **チェックリスト**（チェックマーク付き） | H3で使用 |
| 複合Q&A・FAQ | **Q&Aサマリー**（複数セクション） | H2で使用 |
| 概念の全体像 | **構造図**（中心 + 周辺要素） | H2で使用 |
| 時系列・タイムライン | **タイムライン図**（横or縦） | 両方で使用 |
| Before/After | **ビフォーアフター図**（左右+VS） | H3で使用 |

### 設計の進め方
1. 全H2/H3/H4見出しを一覧にする
2. 各見出しに最適な図解タイプを割り当てる
3. H2→H3→H4の関係性を確認し、情報の重複を避ける（H2=俯瞰、H3=深掘り、H4=補足・具体例）
4. ユーザーに図解リストを提示し、承認を得る（省略可能な場合はそのまま進む）

## Phase 3: HTML図解の生成

各図解を **自己完結型HTML** として生成する。

**デザイン原則（厳守）:**

```
1. シンプル・フラット — 影・グラデーション・装飾は最小限
2. 白背景 — 記事に挿入するため白ベース（#ffffff）
3. 大きめの文字 — タイトル18px以上、本文12px以上
4. 十分な余白 — 要素間に呼吸を持たせる
5. 色数は最小限 — メイン色1色 + サブ色1色 + グレー系
6. 固定幅 — 横幅720pxで統一（記事幅に合わせる）
7. 絵文字は控えめ — アイコン的に使う程度（1図解あたり最大4個）
8. 情報に直結する要素のみ — 装飾パーツは入れない
```

**共通HTMLテンプレート（幅800px・コンテンツ適応高さ）:**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>{図解タイトル}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:'Hiragino Sans','Noto Sans JP',sans-serif;
  background:#fff;
  width:800px;
  /* 高さは指定しない — コンテンツに応じて自然に伸縮 */
}
/* ヘッダー: グラデーション背景 + バッジ + タイトル */
.header{
  background:linear-gradient(135deg,{メイン色},{サブ色});
  padding:14px 24px;
  display:flex;align-items:center;gap:12px;
}
.badge{
  width:36px;height:36px;background:rgba(255,255,255,.2);
  border-radius:50%;display:flex;align-items:center;justify-content:center;
  color:#fff;font-size:13px;font-weight:700;flex-shrink:0;
}
.header h1{color:#fff;font-size:18px;font-weight:700}
.header .sub{color:rgba(255,255,255,.7);font-size:12px;margin-top:2px}
/* コンテンツエリア */
.content{padding:16px 24px}
/* === 図解固有のスタイル === */
</style>
</head>
<body>
<div class="header">
  <div class="badge">{番号}</div>
  <div><h1>{図解タイトル}</h1><div class="sub">{サブタイトル}</div></div>
</div>
<div class="content">
  <!-- 図解コンテンツ（高さ制限なし — 必要な分だけ使う） -->
</div>
</body>
</html>
```

**セクション別カラーテーマ（ヘッダーグラデーション）:**

| セクション種別 | メイン色 | サブ色 | 用途 |
|-------------|--------|-------|------|
| ステップ・手順 | #1e3a5f | #2563eb | 開発フロー、プロセス系 |
| コスト・費用 | #065f46 | #10b981 | コスト削減、費用比較系 |
| 選定・評価 | #4c1d95 | #8b5cf6 | パートナー選定、判断基準系 |
| リスク・注意 | #7c2d12 | #ea580c | リスク、注意喚起系 |
| 比較・分析 | #1e3a5f | #0ea5e9 | 比較分析、市場調査系 |

**デザイン最適スペーシングシステム（厳守）:**

| 要素 | 値 | 備考 |
|------|-----|------|
| ヘッダー padding | `14px 24px` | gap: 12px |
| バッジ | `36px × 36px` | font-size: 13px |
| コンテンツ padding | `16px 24px` | メインエリア |
| カード padding | `12px` | 情報カード内 |
| グリッド gap | `10px` | カード間・カラム間 |
| セクション margin-bottom | `12px` | セクション間の区切り |
| コールアウト padding | `10px 16px` | 補足・警告メッセージ |
| カードヘッダー gap/margin | `6px` | アイコン＋タイトル間 |
| リストアイテム padding | `10px 12px` | チェックリスト等 |
| 統計カード padding | `8px` | 数値表示カード |
| フロー要素 padding | `10px 6px` | ステップフロー内 |

- フォントサイズ: タイトル18px、見出し12-13px、本文10-11px、補足9px
- **height, max-height, overflow:hidden は使わない**
- 無駄な余白は一切入れない — 各要素間は上記の値を厳守する

## Phase 4: 保存

1. 各HTMLを `output/gui/` に保存する
   - **ファイル命名規則**: `{記事スラッグ}-h{見出しレベル}-{セクション名}.html`
   - 例: `vibe-coding-h2-merits.html` / `vibe-coding-h3-merit1.html` / `vibe-coding-h4-case1.html`
2. ユーザーに **図解一覧表** を提示する:
```
| # | ファイル名 | 見出し | 図解タイプ | H |
|---|----------|-------|----------|---|
| 1 | xxx-h2-overview.html | H2「○○とは」 | 構造図 | H2 |
| 2 | xxx-h3-step1.html | H3「ステップ①」 | フロー図 | H3 |
```
3. **Phase 4完了後、自動的にPart Bに進む**（PNG変換 → プレビュー生成）

---

# Part B: 4K PNG変換 & プレビュー生成

`--png-only` 指定時、またはスラッグ名指定時はここから開始する。

## Phase 5: Playwright環境準備

Playwrightの存在確認。なければ自動セットアップ:
```bash
if [ ! -d /tmp/pw-convert/node_modules/playwright ]; then
  mkdir -p /tmp/pw-convert && cd /tmp/pw-convert
  npm init -y --silent && npm install playwright
  npx playwright install chromium
  node -e "const p=require('./package.json');p.type='module';require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
fi
```

## Phase 6: HTML → PNG 一括変換

以下のNode.jsスクリプトを `/tmp/pw-convert/convert-4k.mjs` に書き出して実行:

**重要:**
- `deviceScaleFactor` で4K品質を実現（800px CSS → 3200px物理ピクセル）
- **高さはコンテンツ適応** — `document.body.scrollHeight` で実際の高さを計測し、`clip` で正確に切り出す

```javascript
import { chromium } from 'playwright';
import { readdirSync } from 'fs';
import { resolve, join, basename } from 'path';

const guiDir = process.argv[2];       // HTML格納ディレクトリ
const outDir = process.argv[3];       // PNG出力ディレクトリ
const prefix = process.argv[4];       // ファイルプレフィックス（スラッグ）
const scaleFactor = parseInt(process.argv[5] || '4'); // デフォルト4x = 4K

const VIEW_WIDTH = 800;

const htmlFiles = readdirSync(guiDir)
  .filter(f => f.startsWith(prefix) && f.endsWith('.html') && !f.includes('preview'))
  .sort();

console.log(`Converting ${htmlFiles.length} files → width ${VIEW_WIDTH * scaleFactor}px @ ${scaleFactor}x (auto height)...`);

const browser = await chromium.launch();

for (const file of htmlFiles) {
  const name = basename(file, '.html');
  const pngPath = join(outDir, `${name}.png`);

  const page = await browser.newPage({
    viewport: { width: VIEW_WIDTH, height: 800 },
    deviceScaleFactor: scaleFactor
  });
  await page.goto(`file://${join(guiDir, file)}`);
  await page.waitForTimeout(600);

  const contentHeight = await page.evaluate(() => document.body.scrollHeight);
  const outW = VIEW_WIDTH * scaleFactor;
  const outH = contentHeight * scaleFactor;

  await page.screenshot({
    path: pngPath,
    type: 'png',
    clip: { x: 0, y: 0, width: VIEW_WIDTH, height: contentHeight }
  });
  console.log(`✓ ${name}.png (${outW}×${outH}px)`);
  await page.close();
}

await browser.close();
console.log(`\nDone! ${htmlFiles.length} PNGs saved to ${outDir}`);
```

実行コマンド:
```bash
node /tmp/pw-convert/convert-4k.mjs "{guiDir}" "{outDir}" "{slug}" {scaleFactor}
```

| scaleFactor | 出力幅 | 品質 | 高さ |
|------------|--------|------|------|
| 2 | 1600px | Full HD | コンテンツ適応 |
| 3 | 2400px | 3K | コンテンツ適応 |
| **4** | **3200px** | **4K（デフォルト）** | **コンテンツ適応** |

## Phase 7: preview.html 生成

PNG出力先ディレクトリに `preview.html` を自動生成する。

**レイアウト:** 2列グリッド + H2セクション別グラデーションヘッダー + ホバーエフェクト付きカード

**テンプレート構造:**
```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>{記事タイトル} — 図解プレビュー（4K）</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Hiragino Sans','Noto Sans JP',sans-serif;background:#f1f5f9;color:#1e293b;padding:32px}
h1{text-align:center;font-size:24px;margin-bottom:8px}
.subtitle{text-align:center;font-size:13px;color:#64748b;margin-bottom:32px}
.section{margin-bottom:40px;max-width:1400px;margin-left:auto;margin-right:auto}
.section-title{font-size:18px;font-weight:700;padding:10px 16px;border-radius:8px;margin-bottom:16px;color:#fff}
/* セクション色はH2の内容に応じて選択（下記パレットから） */
.section-title.c1{background:linear-gradient(135deg,#991b1b,#dc2626)}
.section-title.c2{background:linear-gradient(135deg,#92400e,#d97706)}
.section-title.c3{background:linear-gradient(135deg,#1e3a5f,#2563eb)}
.section-title.c4{background:linear-gradient(135deg,#065f46,#10b981)}
.section-title.c5{background:linear-gradient(135deg,#4c1d95,#8b5cf6)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.card{background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.08);overflow:hidden;transition:transform .2s}
.card:hover{transform:translateY(-2px);box-shadow:0 4px 16px rgba(0,0,0,.12)}
.card img{width:100%;height:auto;display:block}
.card-label{padding:10px 14px;font-size:12px;font-weight:600;color:#475569;border-top:1px solid #e2e8f0}
.info{text-align:center;margin-top:32px;font-size:12px;color:#94a3b8}
</style>
</head>
<body>
<h1>{記事タイトル} — 全{N}枚 図解プレビュー</h1>
<p class="subtitle">4K（幅3200px） / コンテンツ適応高さ / 記事挿入用</p>

<!-- H2セクションごとにグルーピング -->
<div class="section">
  <div class="section-title {色クラス}">H2: {セクション名}</div>
  <div class="grid">
    <div class="card"><img src="{filename}.png" alt="{ラベル}"><div class="card-label">{ラベル}</div></div>
    <!-- ... 同セクションのH3カードも同じgrid内に配置 -->
  </div>
</div>

<p class="info">Generated: {日付} / {N} diagrams / 幅3200px (auto height) / {記事タイトル}</p>
</body>
</html>
```

**セクション色パレット（H2の内容に応じて選択）:**

| クラス | グラデーション | 用途の目安 |
|-------|------------|----------|
| `c1` | 赤系 `#991b1b → #dc2626` | 問題・失敗・リスク系 |
| `c2` | アンバー系 `#92400e → #d97706` | 原因・注意・警告系 |
| `c3` | 青系 `#1e3a5f → #2563eb` | 対策・手順・ステップ系 |
| `c4` | 緑系 `#065f46 → #10b981` | メリット・成功・効果系 |
| `c5` | 紫系 `#4c1d95 → #8b5cf6` | 分類・比較・評価系 |

**生成ルール:**
- HTMLファイル名からH2/H3/H4を判定（`-h2-` → H2、`-h3-` → H3、`-h4-` → H4）
- H2ごとに `<div class="section">` で囲み、グラデーションヘッダーを挿入
- **同じH2に属するH3・H4のカードも同じ `.grid` 内に配置**（H2概要 + H3詳細 + H4補足が2列グリッドで並ぶ）
- カードラベルは `H2 — {タイトル}` / `{H3番号} {タイトル}` / `{H4番号} {タイトル}` 形式
- 見出しテキストは元のHTMLファイルの `<title>` タグから取得
- セクション色はH2の内容テーマに合わせて上記パレットから選択

## Phase 8: ブラウザで開く

```bash
open "{outDir}/preview.html"
```

---

# 図解タイプ別パターン集

### 1. フロー図（横一列ステップ）
用途: プロセス・手順の説明（H2全体フロー / H3個別フロー）
```
.steps { display:flex; align-items:flex-start; justify-content:center; gap:0; margin-bottom:12px }
.step { text-align:center; padding:10px 6px }
.step-circle { width:48px; height:48px; border-radius:50%; border:2px solid #bfdbfe; background:#eff6ff; }
.arrow { width:28px; padding-top:10px } — SVG矢印
```
SVG矢印テンプレート:
```html
<div class="arrow"><svg viewBox="0 0 28 16"><path d="M2 8h20M18 3l4 5-4 5" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
```

### 2. 比較図（左右対称）
用途: 従来 vs 新手法の対比（H2向き）
```
.grid { display:grid; grid-template-columns:1fr 40px 1fr; gap:10px; margin-bottom:12px }
.col { border-radius:10px; padding:12px; border:1.5px solid; }
.col-old { background:#fef2f2 } — 赤系
.col-new { background:#eff6ff } — 青系
.vs span { border-radius:50%; background:#e2e8f0 }
```

### 3. カード型一覧（概要サマリー）
用途: メリット/デメリットの全体俯瞰（H2向き）
```
.cards { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px }
.card { padding:12px; border-radius:10px; text-align:center }
.card-icon { font-size:24px; margin-bottom:4px }
.card-num { font-size:10px; font-weight:700; color:{アクセント色}; letter-spacing:.04em }
.card-title { font-size:13px; font-weight:700; color:#1e293b; line-height:1.4 }
.card-desc { font-size:10px; color:#475569; margin-top:4px }
```
- メリット: `background:#eff6ff; border:1px solid #bfdbfe`、番号色 `#3b82f6`
- デメリット: `background:#fffbeb; border:1px solid #fde68a`、番号色 `#d97706`

### 4. リスクカード（2×2グリッド）
用途: リスク・注意点の列挙（H3向き）
```
.cards { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px }
.card { padding:12px; border-radius:10px; background:#fffbeb; border:1px solid #fde68a }
.card-icon { font-size:20px; margin-bottom:4px }
.card-title { font-size:13px; font-weight:700; color:#92400e }
.card-desc { font-size:10px; color:#78350f; line-height:1.5 }
```
警告コールアウト（底部）:
```
.warn { padding:10px 16px; background:#fef2f2; border:1px solid #fecaca; border-radius:8px }
```

### 5. ナレッジリスト（縦並びリスト）
用途: 必要スキル・知識の列挙（H3向き）
```
.list { display:flex; flex-direction:column; gap:8px; margin-bottom:12px }
.item { display:flex; align-items:center; gap:10px; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px }
.item-icon { width:36px; height:36px; border-radius:8px; background:#eff6ff; border:1px solid #bfdbfe }
.item-title { font-size:13px; font-weight:700; color:#1e293b }
.item-desc { font-size:10px; color:#64748b }
```
底部メッセージ（黄色系）:
```
.bottom { padding:10px 16px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; text-align:center }
.bottom-text { font-size:12px; color:#92400e; font-weight:600 }
```

### 6. チェックリスト
用途: 選定基準・判断ポイント（H3向き）
```
.checks { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px }
.check { display:flex; align-items:flex-start; gap:8px; padding:10px 12px; border-radius:10px; background:#f8fafc; border:1px solid #e2e8f0 }
.check-icon { width:28px; height:28px; border-radius:6px; background:#2563eb; display:flex; align-items:center; justify-content:center; flex-shrink:0 }
.check-title { font-size:14px; font-weight:600; color:#1e293b }
.check-desc { font-size:11px; color:#64748b; line-height:1.4 }
```
SVGチェックマーク:
```html
<svg viewBox="0 0 14 14"><path d="M2 7l3.5 3.5L12 3" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

### 7. ビフォーアフター図（左右 + VS）
用途: 変化の対比（H3向き）
```
.grid { display:grid; grid-template-columns:1fr 40px 1fr; gap:0; align-items:start; margin-bottom:12px }
.col { border-radius:10px; padding:12px; border:1.5px solid }
.col-before { background:#fef2f2; border-color:#fecaca } — 赤系
.col-after { background:#eff6ff; border-color:#bfdbfe } — 青系
.vs { display:flex; align-items:center; justify-content:center }
.vs span { width:32px; height:32px; border-radius:50%; background:#e2e8f0; font-weight:700; font-size:10px }
```
底部コールアウト（緑系）:
```
.bottom { padding:10px 16px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; text-align:center }
.bottom-text { color:#15803d; font-weight:600; font-size:11px }
```

### 8. バーチャート（数値比較）
用途: コスト・期間の定量比較（H2/H3両対応）
```
.bars { display:flex; flex-direction:column; gap:8px; margin-bottom:12px }
.bar-row { display:flex; align-items:center; gap:10px }
.bar-label { width:120px; flex-shrink:0; text-align:right; font-size:11px; font-weight:600 }
.bar-track { flex:1; height:30px; background:#f1f5f9; border-radius:6px; overflow:hidden; position:relative }
.bar-fill { height:100%; border-radius:6px; width:{%}; background:{色} }
.bar-value { font-size:12px; font-weight:700; color:#fff }
.bar-saving { position:absolute; right:8px; top:50%; transform:translateY(-50%); font-size:10px; font-weight:700 }
```

### 9. ツール詳細カード
用途: ツール・サービスのカテゴリ別紹介（H3向き）

**2カード版:** `.cards { display:grid; grid-template-columns:1fr 1fr; gap:10px }`
**3カード版:** `.cards { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px }`

カード構造:
```
.card { padding:12px; border-radius:10px }
.card-icon { font-size:24px; margin-bottom:4px }
.card-name { font-size:14px; font-weight:700; color:#1e293b }
.card-name-en { font-size:10px; font-weight:600; margin-bottom:8px }
.card-desc { font-size:12px; color:#334155; font-weight:600; line-height:1.5 }
.card-features { display:flex; flex-direction:column; gap:4px }
.feature { font-size:10px; color:#475569; padding-left:12px; position:relative }
.feature::before { content:'•'; position:absolute; left:0; color:{アクセント色}; font-weight:700 }
```

**カテゴリ別カラーテーマ:**

| カテゴリ | 背景色 | ボーダー色 | アクセント色 |
|---------|--------|----------|-----------|
| 要件定義系 | #eff6ff | #bfdbfe | #2563eb |
| デザイン系 | #ecfeff | #a5f3fc | #0891b2 |
| コーディング系 | #f0fdf4 | #bbf7d0 | #16a34a |
| AI単体完結系 | #f5f3ff | #ddd6fe | #7c3aed |

### 10. マップ図（カテゴリグリッド）
用途: ツール全体像の俯瞰（H2向き）
```
.cols { display:grid; grid-template-columns:repeat(N, 1fr); gap:10px; margin-bottom:12px }
.col { border-radius:10px; padding:12px; text-align:center }
```

### 11. Q&Aサマリー（複合セクション）
用途: FAQ・よくある質問のまとめ（H2向き）
```
.section { margin-bottom:12px }
.section-title { font-size:13px; font-weight:700; color:#1e293b; padding-bottom:6px; border-bottom:2px solid #e2e8f0 }
```

### 12. タイムライン図（期間比較）
用途: 開発期間・スケジュールの対比（H3向き）
```
.timeline-header { display:flex; justify-content:space-between; margin-bottom:8px }
.row { display:flex; align-items:center; gap:10px; margin-bottom:8px }
.row-label { width:110px; text-align:right; font-size:11px; font-weight:600 }
.row-bar { height:32px; border-radius:6px }
```

---

# カラーパレット（推奨）

| 用途 | 背景色 | ボーダー色 | テキスト色 |
|------|--------|----------|----------|
| ポジティブ（メリット等） | #eff6ff | #bfdbfe | #2563eb |
| ネガティブ（デメリット等） | #fef2f2 | #fecaca | #dc2626 |
| 警告・注意 | #fffbeb | #fde68a | #d97706 |
| 成功・達成 | #f0fdf4 | #bbf7d0 | #16a34a |
| 紫（分類用） | #f5f3ff | #ddd6fe | #7c3aed |
| シアン（分類用） | #ecfeff | #a5f3fc | #0891b2 |
| ニュートラル | #f8fafc | #e2e8f0 | #475569 |
| テキスト主色 | — | — | #1e293b |
| テキスト副色 | — | — | #64748b |

# コールアウト（底部メッセージ）パターン

| 種類 | 背景色 | ボーダー色 | テキスト色 |
|------|--------|----------|----------|
| 注意・警告 | #fef2f2 | #fecaca | #dc2626 |
| 補足・補助 | #fffbeb | #fde68a | #92400e |
| ポジティブ結論 | #f0fdf4 | #bbf7d0 | #15803d |
| 中立的メッセージ | #eff6ff | #bfdbfe | #1d4ed8 |
| グレー注釈 | — | — | #94a3b8（小さく中央寄せ） |

---

# 出力構成

```
output/gui/
├── {slug}-h2-xxx.html       ← 図解HTML（Part A）
├── {slug}-h3-xxx.html
├── {slug}-h4-xxx.html
├── ...
└── {slug}-images/            ← PNG + プレビュー（Part B）
    ├── {slug}-h2-xxx.png
    ├── {slug}-h3-xxx.png
    ├── {slug}-h4-xxx.png
    ├── ...
    └── preview.html
```

# エラーハンドリング

| エラー | 対処 |
|-------|------|
| Playwright未インストール | Phase 5 で自動インストール |
| Chromiumブラウザ未インストール | `npx playwright install chromium` を実行 |
| HTMLファイルが見つからない | ユーザーにスラッグ名を再確認 |
| スクリーンショット失敗 | viewport初期高さを増やして再試行（デフォルト800px） |

# ルール（厳守）

1. **すべてのH2・H3・H4見出しに図解を作成する** — 漏れなくカバーする
2. **H2 = 概要、H3 = 詳細、H4 = 補足・深掘り** — 階層に応じた情報密度で設計する
3. **デザインはシンプルさ最優先** — 読者が3秒で内容を把握できること
4. **白背景のみ** — 記事挿入時に馴染むよう、body背景は必ず#ffffff
5. **自己完結型HTML** — 外部CSS/JS/CDNは一切使わない
6. **幅800px固定・コンテンツ適応高さ** — `body{width:800px}` のみ設定し、高さ・overflow:hiddenは使わない
7. **日本語フォント** — Hiragino Sans / Noto Sans JP
8. **file://で動作** — fetchやXHRは使わない
9. **装飾を入れすぎない** — 影(box-shadow)は最小限、グラデーションは原則不使用
10. **レスポンシブは不要** — スクショ用途なので固定幅でOK
11. **タイトルは必ず入れる** — h1で図解の内容が一目でわかるタイトル
12. **1ファイル1図解** — 複数の図解を1ファイルにまとめない
13. **命名規則を統一** — `{スラッグ}-h{レベル}-{セクション名}.html` 形式
14. **同じ情報の繰り返しを避ける** — H2・H3・H4で情報が重複しないよう設計する
15. **HTML作成後は自動的にPNG変換に進む** — Part A → Part B を一貫実行する
16. **preview.htmlは必ず `open` で開く** — dev serverは使わない。preview_startは不要。`open` コマンドでfile://として直接ブラウザ表示する（静的HTMLのため）
17. **画像はアスペクト比4:3を基準に設計する** — 幅800px × 高さ600pxを目安にコンテンツを配置する
18. **4:3の制限は厳密に守らない** — コンテンツ量に応じて高さは自然に伸縮させ、美しい余白のみを残す（無理に600pxに収めない）
