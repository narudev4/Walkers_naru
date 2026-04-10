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
    { "type": "title", "tag": "YouTube AI動画", "title": "...", "subtitle": "【...】",
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
- [ ] 本編スライド数が台本セクションと一致
- [ ] CTA 8枚が末尾にある
