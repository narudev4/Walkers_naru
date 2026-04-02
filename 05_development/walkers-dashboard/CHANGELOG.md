# Walkers Dashboard CHANGELOG

## [v4.3] - 2026-03-14

### 概要
- 共有マシンモード実装（Settingsトグル + Agentsパネル連動バッジ）
- ギャラリーのスキャンをプレビュー確認方式に修正（即時登録→選択式）
- ARCHITECTURE-v4.md に共有マシンモード設計を追記

### 変更内容

#### アーキテクチャ (ARCHITECTURE-v4.md)
- [x] セクション10「共有マシンモード」新規追加
- [x] 設計思想: 全YourAI同一コードベース、Settingsのスイッチ1つで切替
- [x] モード比較表（OFF=個人モード / ON=共有マシン）
- [x] 設定保存形式（config.json内sharedMachineModeオブジェクト）
- [x] UIへの影響（Settings/Agents/全体バッジ）
- [x] 将来拡張: サブエージェント委譲・ステータスAPI・ロードバランシング

#### バックエンド (server.py)
- [x] `GET /api/settings/shared-machine` — 共有マシンモード状態取得
- [x] `PUT /api/settings/shared-machine` — 共有マシンモード更新（enabled/machineName/description）
- [x] config.json読み書きヘルパー（_config_path, _read_config, _write_config）
- [x] `POST /api/gallery/scan-preview` — スキャン結果をプレビュー（保存なし）
- [x] `POST /api/gallery/scan-confirm` — 選択アイテムのみ保存
- [x] 旧`POST /api/gallery/scan`（即時上書き）を廃止

#### フロントエンド (index.html)
- [x] DataLayer: getSharedMachineMode, setSharedMachineMode追加
- [x] DataLayer: scanGallery → scanGalleryPreview + scanGalleryConfirm に分割
- [x] Settingsパネル: 「YourAIモード」セクション追加
  - トグルスイッチ（ON/OFF アニメーション付き）
  - マシン名・説明入力欄（ONの場合のみ表示）
  - ステータスバッジ（共有マシン稼働中 / 個人モード）
- [x] Agentsパネル: 共有マシンモード連動バナー
  - ON → 「🖥 共有マシンとして稼働中」（緑バナー）
  - OFF → 「💻 個人モード — cronはこのPCがオンの間のみ」+ 設定リンク
- [x] ギャラリースキャン: プレビューモーダル方式に変更
  - スキャン → 新規検出分のみチェックボックスで表示
  - 全選択/解除トグル
  - 「選択したアイテムを登録」ボタンで確定
  - 新規なし → 「新規の成果物は見つかりませんでした」

---

## [v4.2] - 2026-03-13

### 概要
- Agentsパネルをv4アーキテクチャに全面リデザイン
- サブエージェント = スキル集合体 + サブ記憶領域 のUI実装
- Heartbeat概念廃止 → cronはサブエージェントの属性に統合

### 変更内容

#### バックエンド (server.py)
- [x] `/api/sub-agents` GET/POST — サブエージェント一覧・作成
- [x] `/api/sub-agents/{id}` PUT/DELETE — 更新・削除
- [x] `/api/sub-agents/{id}/memory` GET — サブ記憶（facts/decisions/preferences）取得
- [x] `/api/sub-agents/{id}/logs` GET — 実行ログ取得
- [x] 作成時にsub-agents/{id}/memories/配下にfacts.md, decisions.md, preferences.md自動生成
- [x] 旧API（/api/heartbeats, /api/agents）はそのまま残存（後方互換）

#### データ (sub-agents.json)
- [x] 新規作成: ARCHITECTURE-v4.md準拠のデータ構造
- [x] skills配列、cron（expression/description/enabled）、memory paths、stats、lastRun

#### フロントエンド (index.html)
- [x] DataLayer: loadSubAgents, createSubAgent, updateSubAgent, deleteSubAgent, getSubAgentMemory, getSubAgentLogs追加
- [x] renderAgents()全面書き換え: メトリクス（サブAgent数/cron稼働中/記憶件数）+ カードグリッド + 実行ログ
- [x] サブエージェントカード: 名前/ステータス/スキルタグ/cron/stats/アクションボタン
- [x] 作成モーダル: 名前・説明・スキル（チェックボックス複数選択）・cron式+説明
- [x] 記憶ビューアモーダル: Facts/Decisions/Preferencesタブ切替で閲覧
- [x] 編集モーダル: 既存値プリフィル付きの編集フォーム
- [x] ログビューアモーダル: サブエージェントID対応に更新
- [x] 旧Heartbeat作成モーダル・Agent登録モーダル → 削除
- [x] HeartbeatCreator/AgentCreator → SubAgentCreator/SubAgentEditor/MemoryViewerに差替

---

## [v4.1] - 2026-03-13

### 概要
- ARCHITECTURE-v4.md 策定（YourAIエコシステム概念を正しく反映）
- 全パネル日本語化（英語残り30箇所を修正）
- 全パネルにヘルプアイコン（?）+ ホバーツールチップ追加・更新

### 変更内容

#### アーキテクチャ (ARCHITECTURE-v4.md)
- [x] v3からの根本的見直し: YourAIエコシステム概念を反映
- [x] サブエージェント = スキル集合体 + サブ記憶領域
- [x] 全YourAIインスタンスは対等（共有マシンを特別扱いしない）
- [x] Machinesパネル廃止 → Agentsパネルとしてサブエージェント管理に集中
- [x] Gallery = 手動登録主体の成果物共有PF
- [x] エージェントチーム ≠ サブエージェント（別概念として明確化）

#### 日本語化 (index.html)
- [x] Pipeline: テーブルヘッダー（Priority→優先度, Client→クライアント, Action→アクション, Deadline→期限）
- [x] Pipeline: ドーナツチャート中央テキスト（deals→案件）
- [x] Skill Hub: カードメタ（phases→セクション, lines→行）
- [x] Skill Hub Preview: phases→セクション, lines→行
- [x] Memory: lines→行
- [x] Projects: "...and N more" → "...他 N 件"
- [x] Agents: ログ空状態（(no logs)→（ログなし））
- [x] Agents: ログタイトル（Logs:→ログ:）
- [x] Toast: Saved→保存しました, Save failed→保存に失敗しました
- [x] Toast: Error→エラー（全箇所）
- [x] Toast: Heartbeat created→定期タスクを作成しました
- [x] Toast: Agent registered→エージェントを登録しました
- [x] Toast: Failed→失敗しました（全箇所）
- [x] Toast: Refreshed→更新しました, Refresh failed→更新に失敗しました
- [x] バリデーション: ID is required→IDは必須です（2箇所）
- [x] Editor: Unsaved changes. Close?→未保存の変更があります。閉じますか？

#### ヘルプアイコン (index.html)
- [x] 全9パネルにヘルプアイコン（?）を実装済み（前セッションから）
- [x] ホバーで説明ツールチップ表示
- [x] Agentsパネルの説明をv4概念に更新（サブエージェント＝スキル集合体＋専用記憶）
- [x] ツールチップ用CSSクラス追加（.help-icon, .help-tooltip）

---

## [v3.0] - 2026-03-11 (前セッション)

### 概要
- Agents + Gallery パネル新規実装
- Google OAuth連携

### 変更内容
- server.py: Agents/Gallery API追加
- index.html: Agents/Galleryパネル実装
- Gallery: 手動登録API (POST /api/gallery) + 削除API (DELETE /api/gallery/{id})
- Gallery: 登録モーダル、作成者必須、日本語UI

### 既知の問題
- Gallery: 手動登録APIの404バグ → v4.1で修正済み（サーバープロセス二重起動が原因）
- Agents: subprocess型の旧アーキテクチャ → v4.1でアーキテクチャ見直し
