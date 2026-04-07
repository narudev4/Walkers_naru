# YouTube AI動画 スライド生成（HeyGen用）

`/yt-script` で生成した台本から、Walkersブランドの PPTX スライドを自動生成する。
スライドは「冒頭3枚 + 本編N枚 + 末尾8枚」の3部構成。（※目次スライドは廃止済み。作成しない。）
## Keynote互換性（CRITICAL）

以下の3点を必ず守ること。違反するとKeynoteでPPTXが開けなくなる／品質が下がる：

1. **すべてのテキストボックスに`auto_size = None`を設定する**（`spAutoFit`がKeynoteを破壊）
2. **スピーカーノート（`notes_slide`）は追加しない**（notesMasterがKeynoteと非互換）
3. **冒頭5枚・CTA8枚は見本PPTXからXMLコピーする**（自前で再現すると位置・サイズ・フォントが微妙にずれる）

HeyGenへの台本入力は手動で行う。

## 冒頭・CTAスライドの生成方法（CRITICAL）

冒頭5枚とCTA8枚は**見本PPTXからXMLレベルでコピーする。自前で再現しない。**
自前で再現すると位置・サイズ・フォントが微妙にずれて品質が下がる。

### 見本PPTX
`output/youtube/_shared/template-slides.pptx`

### コピー対象
- **冒頭5枚**: （※目次スライドは廃止。作成しない。）
  - スライド1: タイトル（見本スライド1からXMLコピー → テキスト差し替え）
  - スライド2: 問題提起（**見本スライド5（チャンネル登録）からXMLコピー → テキスト差し替え**）※文章スライド形式
  - スライド3: 動画の趣旨（**見本スライド5（チャンネル登録）からXMLコピー → テキスト差し替え**）※文章スライド形式
  - スライド4: 自己紹介（見本スライド4からコピー。そのままコピー・変更不要）
  - スライド5: チャンネル登録（見本スライド5からコピー。そのままコピー・変更不要）
- **CTA8枚**: 見本のスライド29-36を**一切変更せず**そのままコピー

### XMLコピーの実装方法

**CRITICAL: 画像リレーションシップのrId衝突問題**
`copy_slide` でXML要素をコピーすると、元スライドの画像rId（例: rId2）が
コピー先でスピーカーノート等の別リレーションと衝突し、画像が表示されなくなる。
**必ず rId の再マッピングを行うこと。**

```python
import copy
from pptx import Presentation
from lxml import etree

NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'

def copy_slide(src_prs, src_idx, dst_prs):
    """見本スライドをXMLレベルでコピーする（画像rId再マッピング付き）"""
    src_slide = src_prs.slides[src_idx]
    slide_layout = dst_prs.slide_layouts[6]  # blank
    dst_slide = dst_prs.slides.add_slide(slide_layout)
    # プレースホルダー除去
    for ph in list(dst_slide.placeholders):
        sp = ph._element
        sp.getparent().remove(sp)

    # Step 1: 画像リレーションを先にコピーし、旧rId→新rIdのマップを作る
    rid_map = {}
    for rel in src_slide.part.rels.values():
        if "image" in rel.reltype:
            new_rel = dst_slide.part.rels.get_or_add(rel.reltype, rel.target_part)
            rid_map[rel.rId] = new_rel.rId

    # Step 2: Shape XMLをコピー
    for shape in src_slide.shapes:
        el = copy.deepcopy(shape._element)
        dst_slide.shapes._spTree.append(el)

    # Step 3: コピーしたXML内の blip embed rId を新しいrIdに書き換える
    for blip in dst_slide._element.iter('{%s}blip' % NS_A):
        old_rId = blip.get('{%s}embed' % NS_R)
        if old_rId and old_rId in rid_map:
            blip.set('{%s}embed' % NS_R, rid_map[old_rId])

    return dst_slide
```

**なぜこの修正が必要か:**
- `dst_slide.part.rels.get_or_add()` で画像を追加すると、新しいrId（例: rId3）が
  割り当てられることがある
- しかしコピーしたXML内の `<a:blip r:embed="rId2">` は旧rIdのまま
- 旧rId2がdst側ではnotesSlide等に割り当て済みだと、画像の代わりにXMLが返る
- `rid_map` で旧→新を追跡し、blip要素を書き換えることで解決

### タイトル差し替え時の注意
- 見本のタイトルShape（Shape 2）は2つのparagraphを持つ
- 1行目: `paragraphs[0].runs[0].text` を差し替え
- 2行目以降: 既存paragraphのruns[0].textを差し替え、足りなければ `add_paragraph()` で追加
- フォントサイズ・太字・色は既存runからコピーする

## 入力

$ARGUMENTS に台本ファイルパスまたはスラッグが渡される。

- パスの場合: そのファイルを読み込む
- スラッグの場合: `output/youtube/{slug}/script.md` を読み込む
- 引数なしの場合: `output/youtube/` 内の最新の `*-script.md` を使用

## 処理フロー

1. 台本MDを読み込む
2. 既存テンプレート `output/slides/generate_heygen_slides.py` を Read で読み込む
3. 台本の内容に合わせてPython生成スクリプトを作成
4. **bash heredoc方式で実行**（`python3 << 'PYEOF'` ... `PYEOF`）※ファイル書き込みだとエンコーディング問題が起きるため
5. `open` コマンドでPPTXを開く

## Walkersブランドカラー（固定）

```python
CHARCOAL = RGBColor(0x2B, 0x32, 0x3B)      # メイン背景
ORANGE = RGBColor(0xE9, 0x82, 0x12)          # アクセント
WHITE = RGBColor(0xFF, 0xFF, 0xFF)           # テキスト（暗い背景）
LIGHT_ACCENT = RGBColor(0xFD, 0xF0, 0xDB)   # ハイライト背景
LIGHT_BG = RGBColor(0xF5, 0xF7, 0xFA)       # 薄い背景
DARK_TEXT = RGBColor(0x33, 0x33, 0x33)       # テキスト（明るい背景）
GRAY_TEXT = RGBColor(0x66, 0x66, 0x66)       # サブテキスト
LIGHT_CHARCOAL = RGBColor(0x3D, 0x47, 0x53)  # カード背景（暗め）
RED_ACCENT = RGBColor(0xE0, 0x3E, 0x3E)     # ネガティブ
GREEN_ACCENT = RGBColor(0x2E, 0x8B, 0x57)   # ポジティブ
BLUE_ACCENT = RGBColor(0x3A, 0x7C, 0xBD)    # 情報
PURPLE_ACCENT = RGBColor(0x7C, 0x3A, 0xED)  # 特徴
```

## スライドサイズ（固定）

```python
SLIDE_WIDTH = Inches(13.333)   # 16:9ワイドスクリーン
SLIDE_HEIGHT = Inches(7.5)
FONT_NAME = "Yu Gothic"
```

## スライド3部構成

### Part 1: 冒頭（5枚・固定構成）

| # | 種類 | 内容 | 生成方式 |
|---|------|------|---------|
| 1 | タイトル | 【実例あり】等 + テーマタイトル + 会社紹介 | 見本スライド1からXMLコピー → テキスト差し替え |
| 2 | 問題提起 | テーマの背景・課題を簡潔に提示 | **文章スライド形式**（後述） |
| 3 | 動画の趣旨 | この動画で何がわかるか + 視聴継続誘導 | **文章スライド形式**（後述） |
| 4 | 自己紹介 | <担当者名>鳳汰の自己紹介（5項目・固定） | 見本スライド4からXMLコピー（変更不要） |
| 5 | チャンネル登録 | 固定テキスト（下記参照） | 見本スライド5からXMLコピー（変更不要） |

※ 目次スライドは廃止。作成しない。

#### 「文章スライド」形式（問題提起・動画の趣旨で使用）

スライド2・3は**チャンネル登録スライド（スライド5）と同じXML構造**で生成する。
装飾（アクセントカラー・アイコン・区切り線・フォントサイズ階層）は一切不要。シンプルが正解。

**仕様:**
- 背景: CHARCOAL全面（Rectangle 1をXMLコピー）
- テキストボックス: チャンネル登録スライドのTextBox 2をXMLコピー → テキストのみ差し替え
- フォント: Yu Gothic / 24pt / 白 / ボールドなし / 中央揃え
- テキストボックスの位置・サイズ: チャンネル登録スライドと完全一致（垂直中央配置）
- 1行あたり20文字前後で改行し、4〜5行以内に収める

**実装:**
```python
# チャンネル登録スライド（見本スライド5）からXMLコピーして生成
def make_text_slide(dst_prs, ref_slide5, lines):
    """文章スライドを生成（問題提起・動画の趣旨用）"""
    slide_layout = dst_prs.slide_layouts[6]  # blank
    slide = dst_prs.slides.add_slide(slide_layout)
    for ph in list(slide.placeholders):
        sp = ph._element
        sp.getparent().remove(sp)
    # 背景とテキストボックスをスライド5からコピー
    for shape in ref_slide5.shapes:
        el = copy.deepcopy(shape._element)
        slide.shapes._spTree.append(el)
    # テキストを差し替え（XMLレベルで全パラグラフ再構築）
    # ... lines配列の各行をパラグラフとして設定
    return slide
```

#### 自己紹介テキスト（固定）
```
・AI・ノーコード専門の開発会社Walkersで事業企画を担当。
・累計100万PV以上のAI・ノーコード専門メディアの編集長。
・アプリ開発の電子書籍を3冊出版し、1冊はAmazonベストセラーを獲得。
・アプリ開発のオンラインスクール「Tech Studio(テックスタジオ)」運営。
・その他多数のAI・ノーコード事業に参画。
```

#### 会社紹介テキスト（固定）
```
・AI・ノーコード専門の開発会社。
・300件以上の開発/制作実績、200件以上の企業様を支援。
・社名にお客様と共に"歩む''という思いを込め、事業を成功に導くための支援を行っている。
```

### Part 2: 本編（N枚・台本に応じて変動）

台本のセクション数に応じて生成。各セクション = セクションタイトルスライド + 解説スライド1〜3枚。

| 種類 | レイアウト |
|------|----------|
| セクションタイトル | 全面CHARCOAL + 番号(ORANGE) + タイトル(WHITE) |
| 解説（カード型） | ヘッダーバー + カード2〜3枚横並び |
| 解説（テーブル型） | ヘッダーバー + テーブル |
| 解説（比較型） | ヘッダーバー + 左右対比カード |
| 解説（フロー型） | ヘッダーバー + ステップカード横並び |

### Part 3: 末尾CTA（8枚・固定）

テキストスライドと画像スライドが交互に並ぶ構成。
画像は `output/youtube/_shared/cta-images/` に保存済みのものを使用。

| # | 種類 | 内容 | 画像ファイル |
|---|------|------|------------|
| N+1 | テキスト | 「AI×ノーコード×補助金で平均80%以上の費用削減、従来の1/3以下の期間」 | なし |
| N+2 | 画像 | 実績紹介画像① | `cta-images/cta-slide23-img1.png` |
| N+3 | 画像 | 実績紹介画像② | `cta-images/cta-slide24-img1.png` |
| N+4 | 画像 | 実績紹介画像③ | `cta-images/cta-slide25-img1.jpg` |
| N+5 | テキスト | 「事業を成功に導くためのアプリ・システム開発、0→100の包括的な支援、概要欄よりお問い合わせ」 | なし |
| N+6 | 画像 | お問い合わせ導線画像 | `cta-images/cta-slide27-img1.png` |
| N+7 | テキスト | 「10個の質問で開発費用見積もり、個人情報不要」 | なし |
| N+8 | 画像 | エンディング画像 | `cta-images/cta-slide29-img1.png` |

#### CTA画像の挿入方法（CRITICAL: アスペクト比を必ず保持すること）

**画像を全画面に引き伸ばしてはいけない。** 見本PPTXの位置・サイズを正確に再現する。

見本: `<YOUR_PATH>

```python
from PIL import Image
from pptx.util import Inches, Emu

# 画像のオリジナルサイズを取得してアスペクト比を計算
img = Image.open(img_path)
aspect = img.width / img.height

# 見本から取得した位置・サイズ（EMU値）を使用
# もし見本がない場合は、幅を基準にアスペクト比から高さを計算し中央配置
target_width = Inches(10)  # 適切な幅を設定
correct_height = int(target_width * (img.height / img.width))
center_left = int((12192000 - target_width) / 2)
center_top = int((6858000 - correct_height) / 2)

slide.shapes.add_picture(img_path, center_left, center_top, target_width, correct_height)
```

見本の正確なEMU値:
| 画像 | left | top | width | height |
|------|------|-----|-------|--------|
| cta-slide23-img1.png | 3153286 | 538516 | 5872728 | 5780969 |
| cta-slide24-img1.png | 642538 | 1013972 | 10894225 | 4830056 |
| cta-slide25-img1.jpg | 1483467 | 757053 | 9212368 | 5343894 |
| cta-slide27-img1.png | 923131 | 849708 | 10332967 | 4689677 |
| cta-slide29-img1.png | 1008657 | 675281 | 10161870 | 4400235 |

※ cta-slide27とcta-slide29は見本から取得したEMU値ではアスペクト比がずれていたため、オリジナル画像のアスペクト比で高さを再計算した値を使用する

#### CTAスピーカーノート（固定・台本テキスト）

末尾の画像スライドにもナレーションがある。以下をスピーカーノートに埋め込む:

```python
# スライドN+1（費用削減実績）
"さて、では最後に宣伝なんですけども、アプリ開発研究所ではAI・ノーコード・補助金の活用で平均80%以上の費用削減を実現し、従来の1/3以下の期間での開発を行っております。"

# スライドN+2（実績画像①）
"具体的にはですね、従来のプログラミング開発だと2700万円かかっていたところを、AIやノーコードといった最新技術を使うことによって、900万円にまで削減し、さらに補助金を活用することによって、300万円にまで削減しています。"

# スライドN+3（実績画像②）
"また、開発期間においても、従来の1/3以内のスピードを実現しています。"

# スライドN+4（実績画像③）
"また、Walkersではただただ開発を行うだけでなく、事業の0→1の部分である事業計画書の作成やコンセプト設計、そして開発した後のマーケティングや内製化支援まで、0→100の包括的な支援を提供しています。"

# スライドN+5（お問い合わせ誘導）
"とにかくですね、アプリ開発研究所ではただただシステムを開発するのではなく、事業を成功に導くためのアプリ・システム開発、0→100の包括的な支援を行っております。\n無料相談を実施しておりますので、お気軽に概要欄よりお問い合わせください。"

# スライドN+6（CTA画像）
"概要欄にある「無料相談はこちらから」よりお問い合わせすることができます。"

# スライドN+7（シミュレーター誘導）
"またたった10個の質問に答えるだけで開発費用を見積もれるシミュレーターも用意しておりますので、是非概要欄よりお見積もりしてみてください。\n個人情報の入力は一切必要ございません。"

# スライドN+8（エンディング画像）
"概要欄にある「1分で開発費用の見積もりシミュレーション」よりAIやノーコードを用いた場合の開発費用を見積もることができます。\n今回の動画は以上になります。ご清聴ありがとうございました。"

# スライドN+7
"たった10個の質問に答えるだけで、開発費用を\n見積もれるシミュレーターも用意しているので、\nぜひ概要欄よりお見積もりしてみてください。\n\n※個人情報の入力は必要ありません"
```

## 共通コンポーネント関数（テンプレートから継承）

以下の関数は `generate_heygen_slides.py` から流用する:

- `set_font()` - フォント設定
- `add_textbox()` - テキストボックス追加
- `add_multiline_textbox()` - 複数行テキストボックス追加
- `add_shape_bg()` - 背景矩形追加
- `add_footer()` - フッターバー追加
- `add_section_header()` - セクションヘッダー追加
- `add_section_title_slide()` - セクション遷移スライド追加
- `add_card()` - カード型コンポーネント追加
- `add_bullet_list()` - 箇条書きリスト追加
- `add_table()` - テーブル追加

## フッターテキスト

```python
FOOTER_TEXT = "{動画タイトルの短縮版} | アプリ開発研究所"
```

## スピーカーノート

各スライドにスピーカーノート（台本テキスト）を埋め込む:

```python
slide.notes_slide.notes_text_frame.text = "台本テキスト..."
```

これによりHeyGenで「Use speaker notes as your script」を選んだときに自動で台本が入る。

## 実行時の注意事項

### エンコーディング問題の回避（CRITICAL）
Pythonスクリプトをファイルに書き込んで実行すると、日本語のエンコーディングエラーが発生する場合がある。
**必ず bash heredoc 方式で実行すること:**

```bash
python3 << 'PYEOF'
# スクリプト内容
PYEOF
```

これにより、ファイルエンコーディングの問題を完全に回避できる。

## 出力先

- PPTX: `output/youtube/{slug}/slides.pptx`
- 完成後は `open` コマンドでPPTXを開く

## 品質チェック

- [ ] 冒頭5枚が正しい構成になっているか（タイトル→問題提起→動画の趣旨→自己紹介→チャンネル登録。目次は不要）
- [ ] 問題提起・動画の趣旨スライドが「文章スライド形式」になっているか（チャンネル登録と同じシンプルな白テキスト中央配置。装飾不要）
- [ ] 本編のスライド枚数が台本のセクション数と一致しているか
- [ ] 末尾8枚が正しい構成になっているか（テキスト→画像→画像→画像→テキスト→画像→テキスト→画像）
- [ ] CTA画像が正しく挿入されているか
- [ ] **CTA画像のblip rIdが実際の画像パーツを指しているか**（生成後にPythonで `shape.image.blob` が読めるか検証。notesSlideを指していたら `copy_slide` のrId再マッピング漏れ）
- [ ] Walkersブランドカラーが正しく適用されているか
- [ ] フッターが本編スライド（セクションタイトル以外）に入っているか
- [ ] スピーカーノートは追加していないか（Keynote非互換のため禁止）
- [ ] 冒頭5枚・CTA8枚が見本PPTXからXMLコピーされているか（自前再現禁止）
- [ ] テーブル・カードのテキストが切れていないか
- [ ] python3で実行してエラーが出ないか
- [ ] Keynoteで正常に開けるか

## 生成後の自動検証（CRITICAL — 必ず実行）

PPTX生成後、`open`で開く**前**に以下のPythonスクリプトを実行し、画像リンクの健全性を検証する。
FAILが1つでもあればPPTXを修正してからユーザーに渡すこと。

```python
# 検証スクリプト（PPTX生成後に毎回実行）
from pptx import Presentation
prs = Presentation("output/youtube/{slug}/slides.pptx")
total = len(prs.slides)
errors = []
for i, slide in enumerate(prs.slides):
    for shape in slide.shapes:
        if shape.shape_type == 13:  # PICTURE
            try:
                blob_size = len(shape.image.blob)
                if blob_size < 100:
                    errors.append(f"Slide {i+1}: image blob too small ({blob_size} bytes)")
                else:
                    print(f"Slide {i+1}: image OK ({blob_size} bytes)")
            except Exception as e:
                errors.append(f"Slide {i+1}: BROKEN image - {e}")
if errors:
    print("\n*** FAIL: 以下のスライドで画像が壊れています ***")
    for e in errors:
        print(f"  {e}")
    print("\n修正方法: 壊れたPicture shapeを削除し、add_picture()で再挿入する")
else:
    print(f"\nAll {total} slides verified. No broken images.")
```

**FAILした場合の自動修復手順:**
1. 壊れたPicture shapeの `_element` を `getparent().remove()` で削除
2. `slide.shapes.add_picture(img_path, Emu(left), Emu(top), Emu(width), Emu(height))` で再挿入
3. 再度検証スクリプトを実行してPASS確認
