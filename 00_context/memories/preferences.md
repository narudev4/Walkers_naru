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

## カレンダー運用

Googleカレンダーの商談予定は**社内用**。Walkers側の出席者だけを招待し、クライアントは招待者に入れない（日程はメールで案内し、Meet URLも本文で共有する）。
→ 予定の招待者にクライアントが不在でも「招待漏れ」ではないので、要確認として起票しないこと。

<!-- 発火条件: カレンダー予定の出席者を点検するとき / 廃止条件: naruがクライアントを直接招待する運用に変えたら削除 -->
