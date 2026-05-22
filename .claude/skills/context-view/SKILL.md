---
description: ローカルの Markdown コンテキストを HTML 化し、S3 view bucket (walkers-context-view) に公開する。CloudFront 経由でスマホ Safari から閲覧可能。
---

# context-view

スマホからの閲覧用に HTML ビューを生成・公開する。`sync-up` 末尾で自動呼出されるが、単独でも実行可。

## トリガー

- 「ビュー更新」「HTML 生成」「context view」
- 「スマホで見たい」と言われた時
- `sync-up` 末尾 (自動)

## 実行手順

1. `bash 05_development/scripts/sync/context-view.sh` を実行
2. 出力: `output/context-view/` 配下に HTML + index.html + style.css
3. デフォルトで S3 (`walkers-context-view`) にアップロード
4. CloudFront URL は CloudWatch / IaC の output から取得

## オプション

| フラグ | 用途 |
|---|---|
| `--local` | 生成のみ、S3 アップロードしない |
| `--open` | 生成後にブラウザ起動 (macOS: `open`、Linux: `xdg-open`) |

## index.html の構成

- ヘッダー: 最終更新タイムスタンプ
- クイックリンク: DAILY, decisions, facts, preferences
- 進行中プロジェクト: `03_projects/` 直下のディレクトリを列挙
- 全ドキュメント: 全 .md を再帰列挙

## 依存

- `pandoc` (Markdown → HTML): `brew install pandoc`
- `rclone` (S3 アップロード時のみ)

## 関連

- `/sync-up`: 末尾で自動呼出
- `/aws-bootstrap`: 初回の S3/CloudFront 構築
