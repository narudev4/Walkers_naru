---
description: YouTube AI動画 スライド生成（HeyGen用）
---

# YouTube AI動画 スライド生成

`/yt-script` の台本からWalkersブランドのPPTXスライドを生成する。
JSONを単一ソースとし、エンジン（`yt_slide_engine.py`）でPPTXに変換する。

```
台本(script.md) → slides.json生成 → エンジンでPPTX生成
```

## 入力

$ARGUMENTS に台本ファイルパスまたはスラッグが渡される。

- パスの場合: そのファイルを読み込む
- スラッグの場合: `output/youtube/{slug}/script.md` を読み込む
- 引数なしの場合: `output/youtube/` 内の最新プロジェクトを使用

## スライド3部構成

### Part 1: 冒頭（5枚・固定構成）

| # | type | 内容 | 生成方式 |
|---|------|------|---------|
| 1 | title | タグ + タイトル + 会社紹介 | テンプレートXMLコピー → テキスト差し替え |
| 2 | text | 問題提起 | テンプレートXMLコピー → テキスト差し替え |
| 3 | text | 動画の趣旨 | テンプレートXMLコピー → テキスト差し替え |
| 4 | intro | 自己紹介（固定） | テンプレートXMLコピー |
| 5 | subscribe | チャンネル登録（固定） | テンプレートXMLコピー |

#### 冒頭3枚の台本抽出ルール（厳守）

独自に要約・短縮・再構成しない。台本の該当行をそのまま拾う。

**共通の表記変換（スライド1〜3に適用）**
- 台本のカタカナ技術用語は**英語表記に変換**する
  - 例: クロードコード→`Claude Code`、リアクトネイティブ→`React Native`、アイフォン→`iPhone`、アンドロイド→`Android`

**スライド1（title）**
- 現状、機械ルール化は難しい。ユーザー手修正前提。たたき台としては以下:
  - `tag` = `【意外と知らない】`（固定、案件別に変える場合はユーザー指示）
  - `title` = 台本タイトル案を元に**記事風SEOタイトルへ再構成**（カタカナ→英語、補足を括弧で、末尾「〜まとめ」系）
  - `subtitle` = 空
  - `company` = `株式会社Walkers\n\n・AI・ノーコード専門の開発会社。\n・300件以上の開発/制作実績、200件以上の企業様を支援。\n・社名にお客様と共に"歩む"という思いを込め、事業を成功に導くための支援を行っている。`

**スライド2（text・問題提起）**
- 台本【スライド2】本文中の **「」で括られた疑問文のみ**を抽出
- 疑問文以外の補足（「というのも…」等）は**入れない**
- **疑問文を自然な口語に短縮**（例: 「クロードコードってネイティブアプリも作れるんですか？」→「Claude Codeでネイティブアプリは作れるの？」）
- 「」で括った状態で `lines` に入れ、2行程度に改行整形（1行20文字前後）

**スライド3（text・動画の趣旨）**
- **結論行を冒頭**に配置: 台本【スライド3】本文冒頭の「結論から言うと〜」一文を短縮（例: `Claude Codeでネイティブアプリ開発は十分可能！`）
- 続いて `【本動画の内容】` 見出し（角括弧付き）
- 続いて `① / ② / ③ / ④` の箇条書き（各項目もカタカナ→英語変換）
- 構成: `{結論行}\n\n【本動画の内容】\n① ...\n② ...\n③ ...\n④ ...`

### Part 2: 本編（N枚・台本に応じて変動）

| type | 用途 |
|------|------|
| section | セクションタイトル（全面CHARCOAL + 番号 + タイトル） |
| cards | カード2〜3枚横並び（最も使用頻度高い） |
| table | テーブル（比較表・一覧） |
| comparison | 左右対比カード |
| flow | ステップ横並びフロー |

### Part 3: CTA（8枚・固定）

テンプレートPPTXの末尾8枚をそのままXMLコピー。内容変更不可。

| type | 内容 |
|------|------|
| cta-text | 費用削減実績 |
| cta-image | 実績紹介画像 x3 |
| cta-text | お問い合わせ誘導 |
| cta-image | お問い合わせ導線画像 |
| cta-text | シミュレーター誘導 |
| cta-image | エンディング画像 |

## JSONスキーマ

Claudeが台本から生成するJSONの構造。`output/youtube/{slug}/slides.json` に出力する。

```json
{
  "meta": {
    "slug": "video-slug",
    "title": "動画タイトル",
    "footer": "動画タイトル短縮版 | アプリ開発研究所"
  },
  "slides": [
    { "type": "title", "tag": "【意外と知らない】", "title": "（台本のタイトル案をそのまま1行で）", "subtitle": "",
      "company": "AI・ノーコード専門の開発会社Walkersで事業企画を担当。\n累計100万PV以上のノーコード・AI専門メディアを運営。" },
    { "type": "text", "lines": "1行目\n2行目\n..." },
    { "type": "intro" },
    { "type": "subscribe" },
    { "type": "section", "num": "01", "title": "セクション名" },
    { "type": "cards", "num": "①", "header": "ヘッダー",
      "cards": [{ "label": "ラベル", "items": ["項目1", "項目2"], "color": "" }] },
    { "type": "table", "num": "01", "header": "ヘッダー",
      "columns": ["#", "項目", "判定"], "rows": [["1", "...", "yes"]] },
    { "type": "comparison", "num": "01", "header": "ヘッダー",
      "left": { "label": "...", "items": ["..."], "color": "" },
      "right": { "label": "...", "items": ["..."], "color": "alt1" } },
    { "type": "flow", "num": "01", "header": "ヘッダー",
      "steps": [{ "label": "STEP 1", "items": ["..."], "color": "" }] },
    { "type": "cta-text", "text": "..." },
    { "type": "cta-image", "src": "cta-images/cta-slide31-img1.png", "label": "..." }
  ]
}
```

**カードカラー**: `""` (orange), `"alt1"` (blue), `"alt2"` (green), `"alt3"` (purple), `"negative"` (red)

**textスライド**: 1行20文字前後、4〜5行以内。

**`style: "hero"`（冒頭2,3枚専用）**: `text` に `"style": "hero"` を指定すると、CHARCOAL全面背景＋白Bold太字センタリングで描画する。冒頭スライド2（問題提起）とスライド3（動画の趣旨）に必須。本編の `text` サマリーには付けない。
- `lines` に `【本動画の内容】` が含まれる場合は「結論 + 見出し + ①〜④」レイアウトで描画
- 含まれない場合は単純センタリングで描画

## 処理フロー

1. 台本を読み、`slides.json` を生成 → `output/youtube/{slug}/slides.json`
2. エンジンでPPTX生成:

```bash
python3 05_development/youtube/yt_slide_engine.py \
  --json output/youtube/{slug}/slides.json \
  --verify --open
```

3. `--verify` が PASS であることを確認
4. ユーザーにPPTXを確認してもらう

### エンジンオプション

- `--verify`: 生成後に画像blobの健全性を自動検証
- `--open`: 検証OK後にPPTXを開く
- `--output`: 出力パス指定（省略時: `output/youtube/{slug}/slides.pptx`）
- `--template`: テンプレート指定（省略時: `05_development/youtube/template-slides.pptx`）

## 品質チェック

- [ ] `--verify` が All verified, No broken images を返す
- [ ] 冒頭5枚の構成（title → text x2 → intro → subscribe）
- [ ] スライド1 `title` が台本の `**タイトル案**:` と一致（独自短縮・再構成なし）
- [ ] スライド2 `lines` が台本の「」疑問文のみ（補足説明の混入なし）
- [ ] スライド3 `lines` に本動画内容①〜④ + 「結論から言うと〜」結論行あり
- [ ] 本編スライド数が台本セクションと一致
- [ ] CTA 8枚が末尾にある
