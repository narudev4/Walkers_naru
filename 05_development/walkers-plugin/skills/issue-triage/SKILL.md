---
description: GitHub Issue+Notionタスクを同時作成
---

# Issue・タスク登録

トリガー: 「Issueにして」「タスク登録して」

## 実行手順

1. ユーザーからタスクの内容・優先度・カテゴリをヒアリングする
2. **GitHub Issue** を作成する（タイトル、本文、ラベル、アサイン）
3. **Notion タスクDB** にも同時登録する（curl経由）

## GitHub Issue作成
- リポジトリ: Walkersのメインリポジトリ
- ラベル: カテゴリに応じて自動付与（strategy / finance / project / sales / dev / learning）
- アサイン: オーナーに自動アサイン

## Notionタスク作成（curl経由）

Notion MCPの`API-post-page`にparentシリアライズの不具合があるため、curlで直接APIを呼び出す。

```bash
curl -s -X POST 'https://api.notion.com/v1/pages' \
  -H "Authorization: Bearer $NOTION_API_KEY" \
  -H 'Notion-Version: 2022-06-28' \
  -H 'Content-Type: application/json' \
  -d '{
    "parent": {"database_id": "<NotionデータベースIDを設定>"},
    "properties": {
      "Task name": {"title": [{"text": {"content": "タスク名"}}]},
      "Status": {"status": {"name": "Not started"}},
      "Priority": {"select": {"name": "High"}},
      "Description": {"rich_text": [{"text": {"content": "説明文。GitHub Issue: #番号"}}]}
    }
  }'
```

## 出力
- GitHub Issue URL
- Notion タスクURL
- 両方のリンクをユーザーに報告
