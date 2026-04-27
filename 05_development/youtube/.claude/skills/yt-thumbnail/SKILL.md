---
description: YouTube AI動画 サムネイル生成
---

# YouTube AI動画 サムネイル生成

動画タイトルからYouTubeサムネイル画像（1280×720 PNG）を自動生成する。

## 入力

$ARGUMENTS にタイトルまたはスラッグが渡される。

- タイトルの場合: そのタイトルでサムネイル生成
- スラッグの場合: `projects/{slug}/script.md` からタイトルを取得
- 引数なしの場合: `projects/` 内の最新の `*-script.md` からタイトルを取得

## 処理フロー

1. タイトルを取得
2. タイトルを2〜3行のキャッチコピーに分割
3. python-pptxでサムネイル用PPTX（1枚）を生成
4. soffice（LibreOffice）でPNG変換
5. 必要に応じてFFmpegで1280×720にリサイズ
6. 完成画像をFinderで開く

## Walkersサムネイルデザイン仕様

### サイズ
- 1280 × 720 px（YouTube推奨）
- PPTX: Inches(13.333) × Inches(7.5) → PNG変換

### レイアウト

```
┌─────────────────────────────────┐
│                                 │
│   [キャッチコピー 1行目]         │
│   [キャッチコピー 2行目]         │  ← 左寄せ、太字
│   [キャッチコピー 3行目]         │
│                                 │
│                    ┌──────┐     │
│                    │ 人物 │     │  ← 右下に人物画像（あれば）
│                    │ 写真 │     │
│                    └──────┘     │
│  [ロゴ/チャンネル名]             │  ← 左下
└─────────────────────────────────┘
```

### カラー

| 要素 | 色 |
|-----|---|
| 背景 | CHARCOAL (#2B323B) |
| キャッチコピー | WHITE (#FFFFFF) |
| 強調ワード | ORANGE (#E98212) で囲みor下線 |
| サブテキスト | LIGHT_ACCENT (#FDF0DB) |

### フォント

| 要素 | フォント | サイズ | ウェイト |
|-----|---------|-------|---------|
| キャッチコピー | Yu Gothic | 60pt〜80pt | Bold |
| サブテキスト | Yu Gothic | 28pt〜36pt | Regular |
| チャンネル名 | Yu Gothic | 20pt | Regular |

### キャッチコピー変換ルール

タイトルをそのまま使わず、サムネイル用に変換する:

| 元タイトル | サムネイルコピー |
|----------|---------------|
| 「ノーコード vs バイブコーディング 徹底比較」 | 「結局どっち？」「ノーコード vs」「バイブコーディング」 |
| 「AI開発の落とし穴5選」 | 「知らないと損する」「AI開発の」「落とし穴5選」 |

変換ルール:
1. 疑問形 or 煽り文を1行目に
2. メインキーワードを2-3行目に
3. 1行あたり最大10文字
4. ORANGEで強調するワードを1つ選ぶ

## 人物画像（オプション）

`assets/thumbnail-avatar.png` が存在する場合、右下に配置する。
なければテキストのみのサムネイルを生成。

## 生成コード（Python）

```python
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
import subprocess

def generate_thumbnail(title, slug, highlight_word=None):
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    slide = prs.slides.add_slide(prs.slide_layouts[6])  # Blank

    # 背景
    bg = slide.background.fill
    bg.solid()
    bg.fore_color.rgb = RGBColor(0x2B, 0x32, 0x3B)

    # キャッチコピー（左寄せ）
    # ... テキストボックス追加

    # 保存 & 変換
    pptx_path = f"projects/{slug}/thumbnail.pptx"
    prs.save(pptx_path)

    # LibreOfficeでPNG変換
    subprocess.run([
        "soffice", "--headless", "--convert-to", "png",
        "--outdir", "projects/", pptx_path
    ])
```

## 出力先

- PPTX: `projects/{slug}/thumbnail.pptx`
- PNG: `projects/{slug}/thumbnail.png`
- 完成後は `open` コマンドでPNG画像を開く

## 品質チェック

- [ ] 画像サイズが1280×720以上か
- [ ] テキストがスマホでも読めるサイズか（60pt以上）
- [ ] ブランドカラーが正しく適用されているか
- [ ] 強調ワードがORANGEでハイライトされているか
- [ ] 文字が画像の端で切れていないか
