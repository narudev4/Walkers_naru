# Walkers Skills Plugin

Walkers経営パートナーAIのスキルセットプラグイン。

## 含まれるスキル（27個）

### コンテンツ作成
- `/walkers-skills:create-proposal` — 提案書作成（12セクション構成テンプレート）
- `/walkers-skills:create-slides` — 提案書→PPTXスライド変換
- `/walkers-skills:create-mockup` — Next.js+Tailwindモックアップ作成
- `/walkers-skills:write-article` — 6エージェント連携記事執筆
- `/walkers-skills:write-draft` — 記事下書き生成
- `/walkers-skills:title-gen` — タイトル案生成（5パターン以上）
- `/walkers-skills:meeting-minutes` — 議事録作成

### 営業・経理
- `/walkers-skills:sales-pipeline` — 営業パイプライン更新
- `/walkers-skills:update-finance` — 経理データ更新
- `/walkers-skills:misoca` — 請求書・見積書管理

### スケジュール・タスク
- `/walkers-skills:daily-schedule` — 15分刻み工程表生成
- `/walkers-skills:schedule-adjust` — 日程調整・候補日抽出
- `/walkers-skills:issue-triage` — GitHub Issue + Notionタスク作成
- `/walkers-skills:task-register` — TaskGod重複チェック付き登録

### 調査・分析
- `/walkers-skills:research` — 情報詮索（内部ソース中心）
- `/walkers-skills:trend-check` — トレンド調査
- `/walkers-skills:strategy` — 5エージェント戦略分析
- `/walkers-skills:article-monitor` — 記事更新モニタリング

### システム・管理
- `/walkers-skills:dashboard` — Walkers Dashboard起動
- `/walkers-skills:gui` — 動的HTML GUI生成
- `/walkers-skills:commit` — コミット・プッシュ・PR作成
- `/walkers-skills:gmail-reply` — Gmailスレッド返信
- `/walkers-skills:weekly-report` — 週次レポート生成
- `/walkers-skills:agent-memory` — メモリ保存
- `/walkers-skills:session-checkpoint` — セッション状態保存
- `/walkers-skills:context-manage` — コンテキスト管理
- `/walkers-skills:cleanup-for-sharing` — 共有用クリーンアップ

## エージェントチーム（2チーム）
- `write-article` — 6エージェント記事執筆チーム
- `strategy-analysis` — 5エージェント戦略分析チーム

## インストール

### ローカルマーケットプレイス経由
```bash
/plugin marketplace add ./05_development/walkers-marketplace
/plugin install walkers-skills@walkers-marketplace
```

### 直接インストール（開発用）
```bash
claude --plugin-dir ./05_development/walkers-plugin
```

## ライセンス
Walkers Inc. 社内利用限定
