---
description: 補助金申請管理
---

# 補助金申請管理

補助金申請案件の確認・更新・管理を行います。

## データソース
- マスターデータ: `03_projects/hojokin-system/master.json`
- クライアント別: `03_projects/hojokin-system/clients/{id}.json`
- ワークフロー定義: `03_projects/hojokin-system/workflow.md`
- チェックリスト: `03_projects/hojokin-system/checklists/`
- テンプレート: `03_projects/hojokin-system/templates/monozukuri.md`
- フェーズ別手順: `03_projects/hojokin-system/workflow/`

## 実行手順

1. まず `03_projects/hojokin-system/master.json` を読んで全体像を把握する
2. ユーザーの指示に応じて以下を実行:

### 全体確認（「補助金の状況は？」「22次の進捗は？」）
- master.json のclientIndexからフェーズ一覧を表示
- 締切が近い案件をハイライト
- 未完了チェックリスト項目数を集計

### 特定クライアント確認（「クロアの進捗は？」）
- 該当 clients/{id}.json を読む
- 現フェーズ、未完了チェックリスト、未準備書類を報告
- 次にすべきアクションを提案

### チェックリスト更新（「クロアの説明会動画視聴をチェック」）
- clients/{id}.json のchecklist内の該当項目をtrue/falseに更新
- タイムラインにイベント追加
- master.json のlastUpdatedを更新

### フェーズ移行（「テン・テンをレビューフェーズに進めて」）
- clients/{id}.json の phase を更新
- master.json の clientIndex のphaseも更新
- タイムラインにフェーズ移行イベント追加

### 書類ステータス更新（「クロアの見積書を作成中に変更」）
- clients/{id}.json の documents 内の該当書類のstatusを更新

### 新規クライアント登録
- clients/{id}.json を新規作成
- master.json の clientIndex と rounds に追加

### GUIビュー表示
- Next.js GUIを起動: `/dashboard` スキルを使って `hojokin-system` サーバーを起動
- または `output/deploy/hojokin-system/data/clients.json` にデータを同期してGUIに反映

## 表示フォーマット

### 全体サマリー
```
📊 補助金申請管理 — {date}

■ 22次（締切: 2026/4/15）
  🔵 事業計画書作成: テン・テン / Deli Wash / Retemper
  🟡 情報収集: LIBEO / コダワリ
  ⚪ 契約: コネクトイノベーション

■ 19次（採択済）
  🟢 交付申請: クロア（締切: 4/1）

■ 20次（採択済）
  🟣 実績報告: 上野園芸社（締切: 6/30）

⚠️ 直近の締切
  クロア — 交付申請 あと14日
  22次全体 — 申請締切 あと28日
```

## 注意事項
- ファイル更新時は必ず lastUpdated を現在日付に更新する
- master.json と clients/{id}.json のphaseは常に同期させる
- GUIの data/clients.json は別ファイルなので、必要時に同期スクリプトを実行する
