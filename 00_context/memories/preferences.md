# ユーザーの好み・コミュニケーションスタイル

<!-- コミュニケーションスタイル、作業習慣、ツールの好み等を記録 -->

## MDプレビュー

「〇〇.md見せて」と言われたら、Claudeデスクトップのプレビュー機能でMarkdownをHTML表示する。

```bash
# 変換
/usr/bin/python3 /tmp/md2html.py <mdファイルパス> > /tmp/preview.html

# 配信（launch.jsonの lp-preview: python3 http.server 8091 -d /tmp）
preview_start name=lp-preview
preview_eval → window.location.href = 'http://localhost:8091/preview.html'
```

- 変換スクリプト: `/tmp/md2html.py`（なければ再作成）
- ダークテーマ、コードブロック・テーブル・リスト対応
