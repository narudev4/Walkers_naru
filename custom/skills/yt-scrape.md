# YouTube AI動画 記事スクレイピング

記事URLから本文テキストをMarkdownで抽出し、台本生成用の素材を準備する。

## 入力

$ARGUMENTS に記事URLが渡される。

- URLの場合: WebFetch で記事ページを取得
- URLなしの場合: ユーザーにURLをヒアリング

## 処理フロー

1. WebFetch で記事ページのHTMLを取得
2. 本文テキストを抽出（ナビ・フッター・サイドバー除外）
3. 見出し構造（h2/h3/h4）を保持してMarkdown化
4. 画像のalt属性も取得（スライド内容の参考にする）
5. メタ情報（title, description, keywords）を抽出
6. `output/youtube/{slug}-article.md` に保存
7. `open` コマンドでファイルを開く

## 抽出対象

| 要素 | 抽出方法 |
|------|---------|
| タイトル | `<title>` or `<h1>` |
| メタ説明 | `<meta name="description">` |
| 本文 | 記事本文エリア（`<article>`, `<main>`, `.entry-content` 等） |
| 見出し | h2 → `##`, h3 → `###`, h4 → `####` |
| リスト | `<ul>/<ol>` → Markdown箇条書き |
| テーブル | `<table>` → Markdownテーブル |
| 画像Alt | `<img alt="">` → `![alt](src)` |
| 公開日 | `<time>` or メタ情報 |

## スラッグ生成ルール

URLからスラッグを自動生成:
- `https://walker-s.co.jp/ai/nocode-vs-vibecoding/` → `nocode-vs-vibecoding`
- `https://walker-s.co.jp/nocode/bubble-review/` → `bubble-review`

## 出力フォーマット

```markdown
---
title: {記事タイトル}
url: {元URL}
slug: {スラッグ}
description: {メタ説明}
date: {公開日}
scraped_at: {取得日時}
---

# {記事タイトル}

{本文Markdown}
```

## 出力先

- `output/youtube/{slug}-article.md`
- 完成後は `open` コマンドでファイルを開く

## 品質チェック

- [ ] タイトルが正しく抽出されているか
- [ ] 見出し構造（h2/h3）がMarkdownに変換されているか
- [ ] 本文が途切れていないか（ページネーション対応）
- [ ] ナビやフッターのテキストが混入していないか
- [ ] テーブルやリストが正しくMarkdown化されているか
