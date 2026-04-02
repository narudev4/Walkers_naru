# python-pptx: auto_size=None は必須（Keynote互換性）

## 問題
python-pptxでテキストボックスを作成する際、`text_frame.auto_size = None`を設定しないと、XMLに`<a:spAutoFit/>`要素が残り、**KeynoteでPPTXが「ファイルフォーマットが無効です」エラーで開けなくなる**。

## 原因
python-pptxのデフォルトではテキストボックスに`spAutoFit`（テキストに合わせて図形サイズを自動調整）が設定される。PowerPointはこれを処理できるが、Keynoteは処理できない。

## 対策
**すべてのテキストボックスに`auto_size = None`を設定すること。**

```python
txBox = slide.shapes.add_textbox(left, top, width, height)
txBox.text_frame.word_wrap = True
txBox.text_frame.auto_size = None  # CRITICAL: Keynote互換性のため必須
```

## 発生日
- 2026-03-26（vibecoding-impossible動画制作時に2回発生）

---

## 追加: notes_slide（スピーカーノート）もKeynoteを破壊する

### 問題
python-pptxの`slide.notes_slide.notes_text_frame.text`でスピーカーノートを追加すると、KeynoteでPPTXが開けなくなる。

### 原因
python-pptxが生成するnotesMasterのXML構造がKeynoteと互換性がない。

### 対策
**スピーカーノートは追加しない。** HeyGenへのスクリプト入力は手動または別の方法で行う。

### 発生日
- 2026-03-26（vibecoding-impossible動画制作時）
