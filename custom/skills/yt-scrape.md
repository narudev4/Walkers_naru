# YouTube AI動画 記事スクレイピング

記事URLから本文テキストをMarkdownで抽出し、台本生成用の素材を準備する。

## 入力

$ARGUMENTS に記事URLが渡される。

- URLの場合: Chrome DevTools MCP で記事ページを取得
- URLなしの場合: ユーザーにURLをヒアリング

## 処理フロー

1. `mcp__chrome-devtools__navigate_page` で記事URLに遷移（JSレンダリング完了を待つ）
2. `mcp__chrome-devtools__evaluate_script` で本文HTMLを取得:
   ```js
   document.querySelector('.post_content, main, article, .entry-content').innerHTML
   ```
3. 取得したHTMLを `/tmp/yt-scrape-temp.html` に保存（Write）
4. MarkItDown でMarkdown変換:
   ```bash
   /Users/naru/.pyenv/versions/3.13.0/bin/python3 -c "from markitdown import MarkItDown; md = MarkItDown(); r = md.convert('/tmp/yt-scrape-temp.html'); print(r.text_content)"
   ```
5. メタ情報は `evaluate_script` で個別取得:
   ```js
   JSON.stringify({
     title: document.title,
     description: document.querySelector('meta[name="description"]')?.content || '',
     keywords: document.querySelector('meta[name="keywords"]')?.content || '',
     date: document.querySelector('time')?.dateTime || ''
   })
   ```
6. Markdown出力を整形（frontmatter追加、ナビ残骸があれば除去）
7. `projects/{slug}/article.md` に保存
8. `/tmp/yt-scrape-temp.html` を削除
9. `open` コマンドでファイルを開く

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

## 依存関係

- Chrome DevTools MCP（`.mcp.json` で設定済み）
- MarkItDown: `pip3 install 'markitdown[all]'`

## 出力先

- `projects/{slug}/article.md`
- 完成後は `open` コマンドでファイルを開く

## 品質チェック

- [ ] タイトルが正しく抽出されているか
- [ ] 見出し構造（h2/h3）がMarkdownに変換されているか
- [ ] 本文が途切れていないか（ページネーション対応）
- [ ] ナビやフッターのテキストが混入していないか
- [ ] テーブルやリストが正しくMarkdown化されているか
