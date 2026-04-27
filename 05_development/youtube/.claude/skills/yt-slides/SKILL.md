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
- スラッグの場合: `projects/{slug}/script.md` を読み込む
- 引数なしの場合: `projects/` 内の最新プロジェクトを使用

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

Claudeが台本から生成するJSONの構造。`projects/{slug}/slides.json` に出力する。

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

### カードの文字量ルール（CRITICAL — 視認性を守る鉄則）

エンジンはカード内の文字数に応じてフォントを自動縮小するが、限界がある。
**文字が多いと読めないスライドになる。** 以下を厳守すること。

| ルール | 基準 | NG例 |
|--------|------|------|
| 1アイテムの文字数 | **最大15文字**（改行含めず） | ❌「Excel・Googleスプレッドシートをデータベースとして利用」(24文字) |
| アイテム内の`\n`改行 | **禁止** | ❌「社内に蓄積したデータを\n活用して即開発開始」 |
| 1カードあたりアイテム数 | **最大3個** | ❌ 4個以上のリスト |
| 1カードの合計文字数 | **最大40文字** | ❌ 50文字超のカード |
| カード枚数 | **2〜3枚**（エンジン制約） | ❌ 4枚以上（描画崩壊） |

**正しい書き方（キーワード型）:**
```json
{
  "label": "特徴",
  "items": ["環境構築がほぼ不要", "公式ツールチェーン", "TS環境まで自動構築"],
  "color": ""
}
```

**間違った書き方（文章型）:**
```json
{
  "label": "使い慣れたツールをそのまま活用",
  "items": [
    "Excel・Googleスプレッドシートを\nデータベースとして利用",
    "シートを接続するだけで\nアプリに内容が反映",
    "特別なDB知識不要で\n迅速にアプリ開発を開始できる"
  ],
  "color": ""
}
```

**原則: スライドは「読む」ものではなく「見る」もの。キーワードだけ載せ、詳細はナレーションで伝える。**

## 処理フロー

1. 台本を読み、`slides.json` を生成 → `projects/{slug}/slides.json`
2. エンジンでPPTX生成:

```bash
python3 _shared/yt_slide_engine.py \
  --json projects/{slug}/slides.json \
  --verify --open
```

3. `--verify` が PASS であることを確認
4. ユーザーにPPTXを確認してもらう

### エンジンオプション

- `--verify`: 生成後に画像blobの健全性を自動検証
- `--open`: 検証OK後にPPTXを開く
- `--output`: 出力パス指定（省略時: `projects/{slug}/slides.pptx`）
- `--template`: テンプレート指定（省略時: `_shared/template-slides.pptx`）

## 品質チェック

- [ ] `--verify` が All verified, No broken images を返す
- [ ] 冒頭5枚の構成（title → text x2 → intro → subscribe）
- [ ] 本編スライド数が台本セクションと一致
- [ ] CTA 8枚が末尾にある
