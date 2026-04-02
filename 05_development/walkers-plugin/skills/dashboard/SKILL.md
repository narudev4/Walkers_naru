---
description: Walkers Dashboardをlocalhost:8080で起動・アクセス案内
---

# Walkers Dashboard 起動

トリガー: 「ダッシュボード」「ダッシュボード立ち上げて」「ダッシュボード開いて」「管理画面」

## 入力
$ARGUMENTS

## 概要
Walkers Dashboard（OpenClaw風ローカル管理画面）を起動し、ブラウザからアクセスできるようにする。
スキル・メモリ・パイプライン・案件・出力ファイル・設定を一覧・編集できるSPAダッシュボード。

## 実行手順

### Step 1: サーバー状態確認

1. `netstat -ano | grep :8080` （Windows）または `lsof -i :8080 -t`（macOS）でポート8080の使用状況を確認する
2. すでにプロセスが存在する場合 → **起動済み**として Step 3 へスキップ
3. プロセスが存在しない場合 → Step 2 へ

### Step 2: サーバー起動

1. まず `data.json` を最新化する:
   ```bash
   cd C:/Users/owner/Walkers_full/05_development/walkers-dashboard && bash refresh.sh
   ```
2. サーバーをバックグラウンドで起動する:
   ```bash
   cd C:/Users/owner/Walkers_full/05_development/walkers-dashboard && python server.py > C:/Users/owner/Walkers_full/output/walkers-dash.log 2>&1 &
   ```
3. 1秒待ってから `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/` で起動確認する
4. 200が返れば成功、そうでなければ `output/walkers-dash.log` を確認してエラーを報告する

### Step 3: ユーザーへの案内

以下のメッセージを伝える:

```
Walkers Dashboard 起動しました 🚀

🌐 http://127.0.0.1:8080

【パネル一覧】
- Skills — スキル一覧・編集
- Memory — 長期記憶の閲覧・編集
- Pipeline — 営業パイプライン（カンバン）
- Projects — 案件ファイルツリー
- Outputs — GUI出力一覧
- Settings — MCP接続・Git情報

停止するときは「ダッシュボード止めて」と言ってください。
```

**ブラウザは自動で開かない**（`open` コマンド禁止）

### Step 4: 停止（ユーザーが「止めて」「停止」と言った場合のみ）

1. `netstat -ano | grep :8080` でPIDを取得（Windows）または `lsof -i :8080 -t`（macOS）
2. `taskkill /PID <PID> /F`（Windows）または `kill <PID>`（macOS）で停止
3. 「ダッシュボードを停止しました」と伝える

## 注意事項
- ブラウザを `open` コマンドで開かないこと
- Playwrightでブラウザを開かないこと
- サーバーは手動起動のみ（LaunchAgent等は使わない）
- ポートが競合している場合は既存プロセスを報告し、ユーザーに判断を仰ぐ
