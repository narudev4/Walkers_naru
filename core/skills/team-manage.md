# Agent Teams 管理スキル

トリガー: 「チーム」「Agent Teams」「チーム管理」「チーム作成」「チーム一覧」

## 入力
$ARGUMENTS

## 利用ツール

| ステップ | ツール | 用途 |
|---------|--------|------|
| 全操作 | Bash (`curl localhost:8080/api/teams*`) | Agent Teams API呼び出し |
| 事前確認 | Bash (`curl localhost:8080/api/gateway/status`) | サーバー稼働確認 |

## 概要
Agent Teams（PM + メンバーのマルチエージェントチーム）の作成・管理・タスク操作を行う。
テンプレートからチームを作成し、PMがcronでタスクを管理し、メンバーがタスクを実行する。

## 実行手順

### Step 0: サーバー稼働確認
```bash
curl -s localhost:8080/api/gateway/status | python -m json.tool
```
サーバーが停止している場合は `/dashboard` スキルで起動する。

### Step 1: ユーザー意図の判定

入力に応じて以下のいずれかを実行:

| ユーザーの意図 | 操作 |
|--------------|------|
| 「チーム」「一覧」（デフォルト） | → チーム一覧表示 |
| 「チーム作って」「新規チーム」 | → チーム作成 |
| 「PM実行」「PMトリガー」 | → PM手動実行 |
| 「タスク追加」「タスク」 | → タスク操作 |
| 「一時停止」「止めて」 | → チーム一時停止 |
| 「再開」「戻して」 | → チーム再開 |
| 「クローズ」「アーカイブ」 | → チーム終了 |
| 「進捗」「プログレス」 | → 進捗確認 |

---

### 操作: チーム一覧表示
```bash
curl -s localhost:8080/api/teams | python -m json.tool
```
結果をテーブル形式で整理して表示:
- チームID、名前、ステータス（active/paused/archived）
- タスク数、PM最終実行日時

### 操作: テンプレート一覧
```bash
curl -s localhost:8080/api/team-templates | python -m json.tool
```
利用可能なテンプレート:
- `app-dev` — アプリケーション開発チーム
- `hojokin` — 補助金申請チーム
- `sales-proposal` — 営業提案チーム

### 操作: チーム作成
```bash
curl -s -X POST localhost:8080/api/teams \
  -H "Content-Type: application/json" \
  -d '{"templateId": "{テンプレートID}", "projectPath": "{プロジェクトパス}", "deadline": "{締切}", "brief": "{概要}"}'
```
パラメータ:
- `templateId`（必須）: テンプレートID（app-dev / hojokin / sales-proposal）
- `projectPath`: プロジェクトのパス（例: `03_projects/案件名/`）
- `deadline`: 締切日（例: `2026-04-15`）
- `brief`: チームへの概要説明
- `notifySpace`: Google Chat通知先スペースID

### 操作: チーム詳細
```bash
curl -s localhost:8080/api/teams/{team_id} | python -m json.tool
```

### 操作: PM手動実行
```bash
curl -s -X POST localhost:8080/api/teams/{team_id}/pm/run
```
PMがチームのタスク状況を確認し、次のアクションを決定・メンバーにタスクを割り当てる。

### 操作: タスク一覧
```bash
curl -s localhost:8080/api/teams/{team_id}/tasks | python -m json.tool
```
ステータス別（backlog / in-progress / review / done）でタスクを表示。

### 操作: タスク追加
```bash
curl -s -X POST localhost:8080/api/teams/{team_id}/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "{タスクタイトル}", "assignee": "{担当者}", "priority": "medium", "description": "{詳細}"}'
```
パラメータ:
- `title`（必須）: タスクタイトル
- `assignee`: 担当メンバー名
- `priority`: low / medium / high
- `description`: タスクの詳細説明
- `deadline`: タスクの締切

### 操作: チーム一時停止
```bash
curl -s -X POST localhost:8080/api/teams/{team_id}/pause
```
PMのcron実行を停止し、チームを一時停止状態にする。

### 操作: チーム再開
```bash
curl -s -X POST localhost:8080/api/teams/{team_id}/resume
```
一時停止したチームを再開する。

### 操作: チームクローズ（アーカイブ）
```bash
curl -s -X POST localhost:8080/api/teams/{team_id}/close
```
チームをアーカイブ状態にする。**確認必須** — ユーザーに確認してから実行する。

### 操作: 進捗確認
```bash
curl -s localhost:8080/api/teams/{team_id}/progress | python -m json.tool
```
PMが生成したprogress.mdの内容を表示する。

---

## 出力フォーマット

チーム一覧は以下の形式で表示:
```
| チーム | ステータス | タスク (backlog/進行中/完了) | PM最終実行 |
|--------|-----------|---------------------------|-----------|
| {name} | 🟢 active | 3 / 2 / 5               | 2時間前    |
```

## 注意事項
- チームクローズは元に戻せない（新規作成し直し）。必ずユーザーに確認する
- PM実行は非同期。実行開始メッセージが返るが、完了まで数分かかる場合がある
- テンプレートにないカスタムチームを作りたい場合は、最も近いテンプレートで作成してからタスクを手動調整する
