# Walkers Dashboard v4 アーキテクチャ設計書

**バージョン**: v4.1
**作成日**: 2026-03-12
**最終更新**: 2026-03-20（実装状態との突き合わせ反映）
**前版**: v3 → v4 全面改訂（YourAIエコシステム概念を反映）
**ステータス**: Phase 1〜5 実装完了、Phase 6 運用テスト中

---

## 0. v3からの根本的な変更点

v3は「ローカルPC上のダッシュボード」として設計されていた。
v4ではWalkersの本質である **YourAIエコシステム** を正しく反映する。

| 項目 | v3（誤り） | v4（正しい） |
|------|----------|------------|
| サブエージェント | CLIのsubprocess起動 | **スキル集合体 + サブ記憶領域** |
| Heartbeat/cron | サブエージェントとは別の概念 | **サブエージェントを定期実行する仕組み** |
| マシン管理 | 概念なし | **Settingsの「共有マシンモード」トグルで実現（全YourAI対等、同一コードベース）** |
| ダッシュボード | ローカル完結 | **各YourAIインスタンスの管理画面 + 共有レイヤーへのアクセス** |
| Gallery | 自動スキャンが主 | **手動登録が主、スキャンは補助** |
| エージェントチーム | サブエージェントと混同 | **別概念（一時的なワークフロー）** |

---

## 1. YourAIエコシステムとは

### 1.1 YourAIの定義

**YourAI = メンバー個人に配布されるAI経営管理ファイルシステム**

```
YourAI (= Walkers_○○)
├── CLAUDE.md              ← AIの業務マニュアル
├── DAILY.md               ← 日報
├── 00_context/            ← プロフィール・記憶
│   ├── memories/          ← メイン記憶領域（facts / preferences / decisions）
│   └── Your-AI-setup.md   ← セットアップマニュアル
├── 01_strategy/           ← 事業戦略
├── 02_finance/            ← 経理
├── 03_projects/           ← 案件データ
├── 04_sales/              ← 営業
├── 05_development/        ← 開発・ツール
├── 06_learning/           ← 学習メモ
├── .claude/
│   ├── commands/          ← スキル定義（29+）
│   └── agents/            ← エージェントチーム定義
├── credentials/           ← 認証情報（.gitignore）
└── output/                ← AI出力
```

### 1.2 エコシステム全体像

**全YourAIインスタンスは対等。違いは「常時稼働かどうか」だけ。**

```
┌─────────────────────────────────────────────────────────────┐
│  YourAI インスタンス群（全て同じ構造・同じ機能）               │
│                                                              │
│  Walkers_full     Walkers_tanaka   Walkers_sato   Walkers_  │
│  （古谷谷/個人PC） （田中/個人PC）  （佐藤/個人PC）  shared   │
│  ├── スキル        ├── スキル       ├── スキル      ├── スキル│
│  ├── メイン記憶     ├── メイン記憶   ├── メイン記憶  ├── メイン│
│  ├── サブAgent     ├── サブAgent   ├── サブAgent  ├── サブ  │
│  ├── ダッシュボード  ├── ダッシュ     ├── ダッシュ    ├── ダッシ│
│  │                 │               │              │        │
│  │ ⏻ PCオフで停止  │ ⏻ PCオフで停止 │ ⏻ PCオフで停止│ ⏻ 常時 │
│  └─────────────────┴───────────────┴──────────────┘ 稼働   │
│                                                     ↓ cronが│
│                                                     回せる  │
└──────┬──────────────────────┬──────────────────┬─────────────┘
       │                      │                  │
       ▼                      ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│  共有レイヤー（Google Sheets）                                │
│                                                              │
│  Skill Hub  ← 各YourAIのスキルを共有                         │
│  Gallery    ← 各メンバーの成果物を共有                        │
│  サブAgent実行ログ・ステータス同期                             │
└─────────────────────────────────────────────────────────────┘
```

**ポイント**: 共有マシンも個人PCも同じYourAI。どれでもチャット・手動スキル実行が可能。
常時稼働してるマシンだけがcronを回せる——それだけの違い。

### 1.3 テンプレート配布の仕組み

```
Walkers_full（マスター）
  → /cleanup-for-sharing スキルでテンプレート化
    → Walkers_template_YYYYMMDD.zip
      → 新メンバーに配布
        → Walkers_新メンバー名 として展開
          → Your-AI-setup.md に従いPhase 1〜6でセットアップ
```

---

## 2. 核心概念の定義

### 2.1 スキル（Skill）

**単一の業務を自動化するコマンド。**

- 定義場所: `.claude/commands/*.md`
- 例: `/trend-check`, `/sales-pipeline`, `/meeting-minutes`
- 特徴: ステートレス（実行のたびに独立）、記憶を持たない

### 2.2 エージェントチーム（Agent Team）

**複数の役割が連携する一時的なワークフロー。**

- 定義場所: `.claude/agents/*.md`
- 例: 記事執筆チーム（6役割）、戦略分析チーム（5役割）
- 特徴: 呼ばれたら動いて、終わったら消える。専用記憶なし
- スキルから起動される（`/write-article` → 記事執筆チーム）

### 2.3 サブエージェント（Sub-Agent）★新概念

**プロンプト + スキル権限 + サブ記憶領域 のセット。特定の業務ドメインに特化した「分身」。**

cron実行時に**登録されたプロンプト**がClaude CLIに送信され、Claudeが利用可能なスキルの中から必要なものを自律的に選択・実行する。

```
サブエージェント: 営業支援エージェント
├── プロンプト: "営業パイプラインの最新データを確認し、進捗に変化があれば報告してください"
├── スキル権限: [/sales-pipeline, /research, /trend-check, /create-proposal]
├── サブ記憶領域:
│   ├── facts.md        ← このエージェント固有の知識・学習結果
│   ├── decisions.md    ← 過去の判断履歴
│   └── preferences.md  ← 振る舞い設定
├── cron: 毎週月曜 9:00
└── 実行マシン: 共有マシンA
```

**エージェントチームとの違い:**

| | エージェントチーム | サブエージェント |
|---|---|---|
| 性質 | 一時的なワークフロー | 恒久的な役割 |
| 記憶 | なし | 専用記憶領域を持つ |
| 起動 | スキルから手動呼び出し | cron定期実行 or 手動 |
| 例え | プロジェクトチーム | 部署 |
| 蓄積 | なし（毎回ゼロから） | 実行のたびに記憶が蓄積 |

### 2.4 マシン（Machine）

**YourAIが稼働するマシン。全マシンにYourAIが入っており、機能は同じ。**

| | 個人PC | 共有マシン |
|---|---|---|
| YourAI | Walkers_○○ | Walkers_shared |
| チャット・手動スキル実行 | ✅ | ✅ |
| サブエージェント定義 | ✅ | ✅ |
| cron定期実行 | △（PCオフで停止） | ✅（常時稼働） |
| メンバーがアクセス | 本人のみ | 全メンバー |

**唯一の違いは「常時稼働かどうか」。** 仕組み・構造・使い方は全て同じ。
個人PCでもcronは設定できる——ただしPC閉じたら止まるだけ。

### 2.5 cron

**サブエージェントを定期実行するスケジューリング。**

- cron はサブエージェントに紐づく属性（独立した概念ではない）
- 「毎朝9時にトレンドチェック」= サブエージェントのcron設定
- 実行場所 = そのYourAIが動いているマシン（どのマシンでも可、常時稼働なら確実に回る）

---

## 3. ダッシュボードの再設計

### 3.1 パネル構成

| パネル | 概要 | YourAIでの位置づけ |
|--------|------|-------------------|
| **Skills** | スキル一覧・編集 | 自分のYourAI内のスキル管理 |
| **Memory** | 記憶の閲覧・編集 | 自分のYourAI内のメイン記憶 |
| **Pipeline** | 営業パイプライン | 自分のYourAI内の営業データ |
| **Projects** | 案件ファイルツリー | 自分のYourAI内の案件管理 |
| **Outputs** | GUI出力一覧 | 自分のYourAI内の出力物 |
| **Skill Hub** | スキル共有 | **YourAI間の共有** |
| **Gallery** | 成果物共有 | **YourAI間の共有** |
| **Agents** | サブエージェント・cron管理 | **このYourAI上のサブエージェント** |
| **Machines** | 共有マシン管理・リモートチャット | **YourAI間の共有**（マシン一覧・ステータス・リモートチャット） |
| **Settings** | 設定 | 自分のYourAI内の設定（共有マシンモード・Google Chat Bot等） |

### 3.2 Agents パネル（旧 Agents パネルを再設計）

**このYourAI上のサブエージェントを管理するパネル。**
どのYourAIインスタンスでも同じUIが表示される（自分のサブエージェント一覧）。

#### 概念図

```
Agents パネル（= このYourAIのサブエージェント管理）
│
├── サブエージェント一覧
│   ├── トレンド監視エージェント
│   │   ├── スキル: /trend-check, /article-monitor
│   │   ├── 記憶: 45件の知識、最終更新 3/12
│   │   ├── cron: 平日毎朝 9:00
│   │   └── 最終実行: 3/12 09:01 ✓
│   │
│   ├── 営業支援エージェント
│   │   ├── スキル: /sales-pipeline, /research, /trend-check
│   │   ├── 記憶: 12件の知識、最終更新 3/11
│   │   ├── cron: 毎週月曜 9:00
│   │   └── 最終実行: 3/11 09:03 ✓
│   │
│   └── + サブエージェントを追加
│
└── 実行ログ
    └── 時系列でサブエージェントの実行結果を表示
```

※ マシン管理は不要（各YourAIは自分のマシン上で動くだけ）

#### データ構造

**sub-agents.json**（このYourAI上のサブエージェント管理）:
```json
{
  "subAgents": [
    {
      "id": "trend-watcher",
      "name": "トレンド監視エージェント",
      "description": "市場トレンドを定期チェックし、記憶に蓄積する",
      "prompt": "今日のIT・AI業界のトレンドを調べて、重要なニュースがあれば記憶に保存してください。前回の実行結果と比較して変化があれば報告してください。",
      "skills": ["trend-check", "article-monitor"],
      "memory": {
        "path": "sub-agents/trend-watcher/memories/",
        "facts": "sub-agents/trend-watcher/memories/facts.md",
        "decisions": "sub-agents/trend-watcher/memories/decisions.md",
        "preferences": "sub-agents/trend-watcher/memories/preferences.md"
      },
      "cron": {
        "expression": "0 9 * * 1-5",
        "description": "平日毎朝9時",
        "enabled": true
      },
      "lastRun": {
        "timestamp": "2026-03-12T09:01:00",
        "status": "success",
        "duration": 120,
        "summary": "3件の新トレンドを検出、記憶に保存"
      },
      "stats": {
        "totalRuns": 45,
        "successRate": 0.98,
        "memoryEntries": 128
      },
      "createdAt": "2026-02-01T00:00:00"
    },
    {
      "id": "sales-support",
      "name": "営業支援エージェント",
      "description": "営業データの定期更新と提案準備",
      "prompt": "営業パイプラインの最新データを確認し、進捗に変化があれば報告してください。新規案件の市場調査も行い、重要な発見があれば記憶に保存してください。",
      "skills": ["sales-pipeline", "research", "trend-check", "create-proposal"],
      "memory": {
        "path": "sub-agents/sales-support/memories/",
        "facts": "sub-agents/sales-support/memories/facts.md",
        "decisions": "sub-agents/sales-support/memories/decisions.md",
        "preferences": "sub-agents/sales-support/memories/preferences.md"
      },
      "cron": {
        "expression": "0 9 * * 1",
        "description": "毎週月曜9時",
        "enabled": true
      },
      "lastRun": null,
      "stats": {
        "totalRuns": 0,
        "successRate": 0,
        "memoryEntries": 0
      },
      "createdAt": "2026-03-12T00:00:00"
    }
  ]
}
```

※ `machine` フィールドは不要（サブエージェントはこのYourAI上で実行される）

#### API設計

**サブエージェント管理:**
| エンドポイント | メソッド | 機能 |
|--------------|---------|------|
| `/api/sub-agents` | GET | サブエージェント一覧 |
| `/api/sub-agents` | POST | サブエージェント作成 |
| `/api/sub-agents/{id}` | GET | 詳細（記憶・実行履歴含む） |
| `/api/sub-agents/{id}` | PUT | 更新（スキル追加/削除、cron変更等） |
| `/api/sub-agents/{id}` | DELETE | 削除 |
| `/api/sub-agents/{id}/run` | POST | 手動実行 |
| `/api/sub-agents/{id}/memory` | GET | サブ記憶の内容取得 |
| `/api/sub-agents/{id}/memory` | PUT | サブ記憶の更新 |
| `/api/sub-agents/{id}/logs` | GET | 実行ログ取得 |

#### UI設計

```
┌──────────────────────────────────────────────────────────┐
│  エージェント                                      ⓘ     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ 2        │  │ 1        │  │ 128      │              │
│  │ サブAgent │  │ cron稼働中│  │ 記憶件数  │  [+ 追加]   │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                          │
│  ── サブエージェント ──────────────────────────────────── │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │ トレンド監視エージェント               ● cron稼働中│    │
│  │                                                   │    │
│  │ スキル: /trend-check  /article-monitor            │    │
│  │ cron: 平日毎朝9時                                 │    │
│  │ 記憶: 128件 │ 成功率: 98% │ 最終実行: 今朝 9:01  │    │
│  │                                                   │    │
│  │ [記憶を見る] [ログ] [手動実行] [編集] [停止]       │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 営業支援エージェント                      ● 未実行│    │
│  │                                                   │    │
│  │ スキル: /sales-pipeline  /research  /trend-check  │    │
│  │         /create-proposal                          │    │
│  │ cron: 毎週月曜9時                                 │    │
│  │ 記憶: 0件 │ 成功率: - │ 最終実行: なし            │    │
│  │                                                   │    │
│  │ [記憶を見る] [ログ] [手動実行] [編集] [停止]       │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ── 実行ログ ────────────────────────────────────────── │
│  3/12 09:01  トレンド監視  ✓ 成功  3件検出 (120秒)      │
│  3/11 09:03  トレンド監視  ✓ 成功  1件検出 (95秒)       │
│  3/10 09:02  トレンド監視  ✓ 成功  0件 (80秒)           │
│  3/10 09:00  営業支援      ✗ 失敗  タイムアウト          │
└──────────────────────────────────────────────────────────┘
```

#### サブエージェント作成モーダル

```
┌─────────────────────────────────────────┐
│  サブエージェントを作成                   │
│                                          │
│  名前 *                                  │
│  [                                    ]  │
│                                          │
│  説明                                    │
│  [                                    ]  │
│                                          │
│  スキル（複数選択）*                      │
│  ☑ /trend-check    ☑ /article-monitor   │
│  ☐ /sales-pipeline ☐ /research          │
│  ☐ /create-proposal ☐ /weekly-report    │
│  ...                                     │
│                                          │
│  cron スケジュール                        │
│  [0 9 * * 1-5          ] 平日毎朝9時     │
│                                          │
│  [作成]  [キャンセル]                     │
└─────────────────────────────────────────┘
```

### 3.3 Gallery パネル（修正済み概念）

**手動登録が主体の成果物共有プラットフォーム。**

- 各メンバーが自分のYourAIから成果物を登録
- 「誰が何を作ったか」が全メンバーに見える
- 作成者（creator）は必須フィールド
- スキャンは補助機能（ローカルのファイル検出を助ける）
- Google Sheetsを共有DB、ローカルJSONをキャッシュ

### 3.4 Skill Hub パネル（概念整理）

**各YourAIのスキルを共有するハブ。**

- メンバーAが便利なスキルを作る → Skill Hubに公開
- メンバーBがSkill Hubからインストール → 自分のYourAIに追加
- Google Sheetsを共有レジストリとして使用

---

## 4. ファイルシステム拡張

サブエージェントのサブ記憶領域を格納するため、YourAIのディレクトリ構造を拡張する。

```
Walkers_○○/
├── （既存構造はそのまま）
│
└── sub-agents/                          ← 新規
    ├── trend-watcher/
    │   ├── config.json                  ← スキル割当・cron設定
    │   ├── memories/
    │   │   ├── facts.md                 ← このエージェント固有の知識
    │   │   ├── decisions.md             ← 過去の判断履歴
    │   │   └── preferences.md           ← 振る舞い設定
    │   └── logs/
    │       └── 2026-03-12.log           ← 実行ログ（日付別）
    │
    └── sales-support/
        ├── config.json
        ├── memories/
        │   ├── facts.md
        │   ├── decisions.md
        │   └── preferences.md
        ├── artifacts/                     ← サブエージェントの出力成果物
        │   └── 2026-03-20_145615.md       （レポート・分析結果等）
        └── logs/
            └── ...
```

**sub-agents/{name}/config.json:**
```json
{
  "id": "trend-watcher",
  "name": "トレンド監視エージェント",
  "description": "市場トレンドを定期チェックし、記憶に蓄積する",
  "skills": ["trend-check", "article-monitor"],
  "cron": "0 9 * * 1-5",
  "machine": "shared-pc-01",
  "enabled": true,
  "createdAt": "2026-02-01T00:00:00"
}
```

---

## 5. YourAI間のデータ同期

### 5.1 共有レイヤーの役割

各YourAIインスタンスは独立して動作するが、Skill Hub・Gallery・実行ログは
Google Sheets経由で全インスタンス間で共有される。

```
Walkers_full                    Walkers_tanaka
┌──────────────┐               ┌──────────────┐
│ サブAgent実行 │               │ サブAgent実行 │
│ ├── ログ保存  │               │ ├── ログ保存  │
│ ├── 記憶蓄積  │               │ ├── 記憶蓄積  │
│ └── Sheets同期│──→  共有  ←──│ └── Sheets同期│
└──────────────┘    Google     └──────────────┘
                    Sheets
                  ┌────────┐
                  │Skill Hub│ ← スキル共有
                  │Gallery  │ ← 成果物共有
                  │実行ログ │ ← 各YourAIの実行状況
                  └────────┘
```

### 5.2 エージェント実行モデル

#### 5つの起動パターン

| # | パターン | トリガー | 実行主体 |
|---|---------|---------|---------|
| ① | サブエージェントcron | server.py cronエンジン | サブエージェント（登録済みプロンプト） |
| ② | メインエージェントcron | server.py cronエンジン | メインエージェント（HEARTBEAT相当） |
| ③ | ユーザー→サブ直接 | MCP `call_sub_agent` ツール | サブエージェント（カスタムプロンプト） |
| ④ | メイン→サブ委譲 | メインがMCP `call_sub_agent` を呼ぶ | サブエージェント |
| ⑤ | リモートチャット | embed/chat or Google Chat | メインエージェント（gateway chat） |

#### MCPツールサーバー（メイン↔サブ通信）

`mcp-sub-agents.py` — server.pyのHTTP APIを叩くstdio MCPサーバー:

| ツール | 機能 |
|--------|------|
| `list_sub_agents` | サブエージェント一覧（状態・記憶・統計） |
| `call_sub_agent(id, prompt)` | サブに委譲（カスタムプロンプト対応） |
| `read_sub_agent_memory(id, type)` | サブ記憶の読み取り |
| `get_sub_agent_logs(id)` | 実行ログ確認 |

`.mcp.json` に登録済み → Claude CLIが自動的にツールとして認識。

#### メインエージェントcron

`config.json` の `mainAgent` セクション:
```json
{
  "mainAgent": {
    "cron": { "expression": "55 8 * * 1-5", "enabled": true },
    "prompt": "今日のスケジュールを確認し、サブエージェントに委譲..."
  }
}
```

メインcronが先に走って全体を俯瞰、サブcronが後から個別タスクを実行。
**上司が朝イチで方針出して、部下がそれぞれ動く**構造。

#### サブエージェント実行フロー

```
1. cronがトリガー or MCPツール経由で呼び出し
2. sub-agents.json からprompt・skills・memoryを読み込み
3. プロンプトをClaude CLIに送信（CLAUDECODE env除外で独立セッション）
   - Claude が必要に応じてスキルを選択・実行（スキル = 権限セット）
   - 実行中に得た知見をサブ記憶領域に蓄積
4. 実行ログを sub-agents/{id}/logs/{date}.log に保存
5. 結果をCloud APIに同期（他YourAIからも参照可能）
6. Google Chat経由の場合は自動返信
```

**キーコンセプト**: スキルは「使っていいスキルの権限セット」。
実際にどのスキルを使うかは **プロンプトの内容とClaude自身の判断** に委ねる。

### 5.3 Gateway + リモートチャット

**Gateway = server.py自体が常駐Gatewayとして機能**

```
┌──────────────────────────────────────────────────────────┐
│  Gateway (server.py)                                      │
│                                                           │
│  ┌─────────────────┐  ┌──────────────────┐              │
│  │ HTTP Server      │  │ Cron Engine      │              │
│  │ (port 8080)      │  │ (background)     │              │
│  │ · Dashboard UI   │  │ · サブAgent cron │              │
│  │ · API endpoints  │  │ · メインAgent cron│              │
│  │ · Gateway chat   │  │ · cron式評価      │              │
│  │ · Main Agent API │  │ · Claude CLI実行 │              │
│  └────────┬────────┘  └────────┬─────────┘              │
│           │                     │                         │
│  ┌────────▼─────────────────────▼─────────┐              │
│  │ Cloud Heartbeat + Command Polling       │              │
│  │ · 60秒ごとにVercelへheartbeat送信       │              │
│  │ · 15秒ごとにpending commandsをpoll    │              │
│  │ · コマンド受信→ローカルで実行→結果返送 │              │
│  │ · Google Chat返信（自動トークンリフレッシュ） │        │
│  └────────────────────────────────────────┘              │
│                                                           │
│  ┌────────────────────────────────────────┐              │
│  │ MCP Sub-Agents Server (stdio)          │              │
│  │ · list / call / memory / logs          │              │
│  │ · Claude CLIから自動接続               │              │
│  └────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────┐
│  Cloud API (Vercel)                                       │
│                                                           │
│  /api/gateway/{machineId}              ← コマンド送信     │
│  /api/gateway/{machineId}/{cmdId}      ← 結果取得         │
│  /api/gateway/poll                     ← マシンがpoll     │
│  /api/webhooks/google-chat             ← Google Chat Bot  │
│  /api/webhooks/google-chat/reply       ← 返信処理         │
│  /embed/chat                           ← リモートチャットUI│
└──────────────────────────────────────────────────────────┘

リモートチャット入口:
├── embed/chat（ブラウザ）→ 同じgateway_commandsフロー
├── Google Chat Bot → Webhook → gateway_commands → 自動返信
└── 将来: Slack / Discord 等も同じパターンで追加可能
```

**リモートチャットの流れ:**
1. ユーザーがVercel embed/chat UIからメッセージ送信
2. Cloud APIがgateway_commandsテーブルにpending保存
3. ローカルGatewayの定期pollがコマンド取得
4. ローカルでClaude CLIを実行
5. 結果をCloud APIに返送
6. embed/chatがpollingで結果を取得・表示

### 5.5 Google Chat Bot統合

**サービスアカウント認証方式でGoogle Chat Botを実現。**

ユーザーがスマホのGoogle Chatからメッセージを送ると、Webhook経由でCloud APIに到達し、
ローカルGatewayが`claude -p`で処理、結果をGoogle Chat APIで返信する。

#### アーキテクチャ

```
ユーザー（スマホ Google Chat）
    │
    ▼
Google Chat Bot（Webhook）
    │
    ▼
Cloud API (Vercel)  /api/webhooks/google-chat
    │
    ├── gateway_commandsテーブルにpending保存（source: 'google-chat'）
    │
    ▼ (poll 15秒)
gateway-service.py → server.py /api/gateway/chat
    │
    ├── Claude CLI実行（claude -p）
    │
    ▼ 完了
server.py → Google Chat API（サービスアカウントOAuth）
    ├── 処理中メッセージをPATCHで結果に置き換え
    └── or 新規メッセージをPOST
```

#### セッション管理

- **スレッドベースのセッション継続**: 同じGoogle Chatスレッドからの返信は同じClaude CLIセッションを `--resume` で再開
- **cronスレッドセッション**: cron実行結果がGoogle Chat spaceに通知 → そのスレッドへの返信でcronセッションを引き継ぎ（フォローアップ会話が可能）
- **セッション永続化**: `chat_sessions.json` にセッションID・履歴を保存、再起動時に復元
- **セッションクリーンアップ**: 10分ごとに50件超の古いセッションを自動パージ
- **重複排除**: 5秒ウィンドウ内の同一プロンプトは重複実行しない

#### cron通知

サブエージェントのcron実行完了時、結果をGoogle Chat spaceに自動通知する。
通知先は `config.json` の `cronNotifySpace` で指定。

```json
{
  "cronNotifySpace": "spaces/89bERSAAAAE"
}
```

通知されたメッセージのスレッドに返信すると、そのcron実行のClaude CLIセッションが
自動的に再開され、結果に対するフォローアップ質問が可能。

#### 設定

Settings パネルの「Google Chat Bot」セクションで設定:
- サービスアカウントJSON の貼り付け・保存
- 接続テスト（トークン取得確認）
- 設定クリア

config.json に保存:
```json
{
  "googleChatBot": {
    "serviceAccountJson": { ... }
  },
  "cronNotifySpace": "spaces/XXXXX"
}
```

### 5.4 常時稼働化

```
gateway-service.py
├── --install     → Windows Task Schedulerにタスク登録
│                   （ログオン時 + ブート時自動起動）
├── --uninstall   → タスク削除
├── --status      → タスク状態確認
└── (引数なし)    → フォアグラウンド実行
    ├── server.py をsubprocess起動
    ├── クラッシュ検知 → 自動再起動（バックオフ付き）
    ├── ヘルスチェック（30秒間隔）
    └── Cloud APIコマンドpolling（15秒間隔）
```

**ポイント**: 実行はあくまでローカル（そのYourAI上）。共有されるのはログとステータスだけ。

---

## 6. LLMコスト設計

| 実行パターン | LLM | コスト |
|------------|-----|-------|
| サブエージェントcron実行 | Claude Code Max (scheduled-tasks) | **$0** |
| ダッシュボード手動操作 | Claude Code Max | **$0** |
| LLM不要の処理（データ取得等） | なし | **$0** |

**契約リソース:**
- 各YourAIインスタンスにつき: Claude Max 1アカウント
- 常時稼働マシンも個人PCも同じ契約構造

---

## 7. セキュリティ

- サブエージェントのサブ記憶は各YourAI内に閉じる（他メンバーからは見えない）
- Gallery/Skill Hubの共有データはGoogle Sheetsのアクセス制御に準拠
- credentials/ は各YourAIで個別管理（.gitignore）
- 共有レイヤーへの書き込みはYourAIのオーナー認証付き

---

## 8. 実装フェーズ

### Phase 1: Agents パネル再設計（UI + ローカルJSON）✅ 完了
- 旧Agentsパネル（subprocess型）をサブエージェント管理UIに置き換え
- sub-agents.json 作成
- sub-agents/ ディレクトリ構造作成
- サブエージェント一覧・作成モーダル（スキル選択+cron+プロンプト設定）のUI

### Phase 2: サブエージェントの記憶管理 ✅ 完了
- サブ記憶領域の CRUD API
- 記憶ビューア（モーダル、Facts/Decisions/Preferencesタブ）
- スキル割り当てUI（チェックボックス選択）

### Phase 3: Gallery 修正 ✅ 完了
- 手動登録フローの完成（iframe化 + Vercel embed）
- Neon DB + Cloud API（当初Google Sheets → 進化）
- 作成者を必須にし、全カードで目立たせる

### Phase 4: 共有レイヤー ✅ 完了
- Skill Hub / Gallery / Machines を Neon DB + Cloud API で共有化
- 各パネルをVercel embedページとしてiframe配信
- サブエージェント実行ログのローカル保存 + Cloud同期基盤

### Phase 5: cron実行エンジン + Gateway ✅ 完了
- server.py内蔵のcronエンジン（OpenClaw準拠）
- プロンプトフィールド追加（サブエージェントの核心）
- Claude CLI（`claude -p`）によるサブエージェント実行
- Gateway endpoints（/api/gateway/chat, /api/gateway/status）
- Cloud API gateway relay（完全双方向ループ）
  - 往路: Vercel → poll → gateway-service.py → local server `/api/gateway/chat`
  - 復路: gateway-service.py が `relay_results_to_cloud()` で5秒ごとにローカル結果をチェック → Vercel PUT で結果返却
  - タイムアウト: 15分で自動失敗マーク
- gateway-service.py（Windows Task Scheduler連携、自動再起動）
- リモートチャットUI（/embed/chat）— 結果リレー含む完全E2E

### Phase 5.5: Google Chat Bot統合 ✅ 完了
- サービスアカウント認証によるGoogle Chat API接続
- Webhook → Cloud API → gateway poll → Claude CLI → 自動返信の完全E2E
- スレッドベースのセッション管理（`--resume` でコンテキスト引き継ぎ）
- cron実行結果のGoogle Chat space通知 + スレッド返信でフォローアップ可能
- 処理中メッセージをPATCHで結果に置き換えるUX改善
- chat_sessions.jsonによるセッション永続化・自動クリーンアップ
- 重複プロンプト排除（5秒ウィンドウ）
- Settingsパネル: Google Chat Bot設定UI（SA JSON保存・テスト・クリア）
- CLAUDE.mdにリモート実行モード仕様を追記（音声入力誤変換対応等）

### Phase 6: 統合テスト + 本番展開 🔄 進行中
- 全API テスト
- テンプレート化してメンバーに配布
- 実運用テスト
- 常時稼働Gatewayの安定性検証
- サブエージェント実運用（3体稼働中: ほげほげ, cron-experiment-test, gchat-analyzer）

---

## 9. 旧v3からの移行

| v3コンポーネント | v4での扱い | 状態 |
|----------------|-----------|------|
| heartbeats.json | → sub-agents.json のcronフィールドに統合 | ✅ 移行完了（heartbeats.jsonは残存するが未使用） |
| agents.json | → sub-agents.json に置き換え | ✅ 移行完了（agents.jsonは残存するが未使用） |
| Heartbeat UI | → Agents パネル内のサブエージェントcron表示に統合 | ✅ 完了 |
| Sub-Agent UI（subprocess） | → Agents パネル内のサブエージェント管理に置き換え | ✅ 完了 |
| Gallery（自動スキャン主体） | → Gallery（手動登録主体 + scan-preview/confirm方式）に修正 | ✅ 完了 |
| Machines パネル（検討中だった） | → 当初は不要としたが、**Cloud API経由のマシン管理・リモートチャット機能として維持**。共有マシンモードのトグルはSettingsに、マシン一覧とリモートチャットはMachinesパネルに分離 | ✅ 維持・拡張 |

> **Note**: heartbeats.json, agents.json はファイルとして残存しているが、v4ではsub-agents.jsonが正。
> 後方互換のため旧APIも一部残しているが、新規開発では使用しない。

---

## 10. 共有マシンモード

### 10.1 設計思想

**全YourAIは同じコードベース。「共有マシンモード」をONにするだけで共有マシンになる。**

- 別インストール不要——Settingsパネルのスイッチ1つで切り替え
- 個人PCもスイッチONにすれば共有マシンとして使える（ただしPC閉じたら止まる）
- 常時稼働マシンでONにするのが推奨運用

### 10.2 モードの違い

| | 共有マシンモード OFF（デフォルト） | 共有マシンモード ON |
|---|---|---|
| 対象 | 個人PC（メンバーの通常利用） | 常時稼働サーバー |
| cron定期実行 | △ 設定可能だがPC閉じたら停止 | ✅ 常時稼働前提で確実に実行 |
| サブエージェント | 自分用のみ | 自分用 + 他YourAIからの委譲も受付可 |
| ダッシュボード表示 | 通常UI | 「🖥 共有マシンモード」バッジ表示 |
| 他YourAIからの参照 | 不可 | Google Sheets経由で実行ステータスを共有 |
| 管理API公開 | なし | 将来的にステータスAPI公開（Phase 5+） |

### 10.3 設定の保存

**`dashboard-config.json`** に保存（既存の設定ファイルを拡張）:
```json
{
  "sharedMachineMode": {
    "enabled": false,
    "machineName": "",
    "description": ""
  }
}
```

### 10.4 UIへの影響

**Settings パネル:**
- 「YourAI モード」セクションを追加
- 共有マシンモードのON/OFFトグル
- ONの場合: マシン名・説明の入力欄を表示

**Agents パネル:**
- 共有マシンモードON → ヘッダーに「🖥 共有マシンとして稼働中」バッジ
- cronの「次回実行」表示が「常時稼働のため確実に実行」に変化

**ダッシュボード全体:**
- 共有マシンモードON → サイドバーまたはヘッダーに小さなバッジ表示

### 10.5 将来拡張（Phase 5+）

- 個人YourAIから「この共有マシンで実行して」とサブエージェントを委譲する機能
- 共有マシンのステータスAPIを公開（稼働状態・実行キュー・リソース状況）
- 複数共有マシンのロードバランシング

---

## 11. オープンクエスチョン

| # | 論点 | 対応時期 | 現状（2026-03-20） |
|---|------|---------|-------------------|
| 1 | ~~サブエージェントの実行エンジン~~ → **server.py内蔵cronで解決** | ✅ 実装済み | ✅ 3体のサブエージェントが毎日実行中 |
| 2 | サブ記憶のYourAI間同期方式（Google Sheets / Git / オンデマンド） | Phase 4 | ⚠️ **未実装** — サブ記憶はローカルのみ。共有レイヤーは実行ログのCloud同期のみ |
| 3 | ~~Webhook公開方法~~ → **Cloud API relay方式で解決**（ポート公開不要） | ✅ 実装済み | ✅ Google Chat Bot統合まで完了 |
| 4 | APIキー月額予算・モデル選択 | 運用後判断 | 未着手（現在はClaude Code Max $200/月で全て賄う） |
| 5 | 複数YourAI間のサブエージェント定義の共有の可否 | 運用後判断 | 未着手（現在はWalkers_fullのみ運用中） |
| 6 | 共有マシン間のサブエージェント委譲プロトコル | Phase 5+ | 未着手 |
| 7 | Claude Code Agent Teams のリモート実行統合 | Phase 7 | 未着手（§12参照） |

---

## 12. Claude Code Agent Teams 統合

### 12.1 Agent Teamsとは

Claude Code v2.1.32 で追加された実験的機能。
複数の**独立したClaude Codeインスタンス**が共有タスクリスト + エージェント間メッセージングで自律連携する。

- 有効化: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- 公式ドキュメント: https://code.claude.com/docs/en/agent-teams
- 詳細リサーチ: `output/agent-teams-research.md`

**Subagentsとの決定的な違い（公式定義）:**

| | Subagents | Agent Teams |
|---|---|---|
| 実行環境 | 親セッション内 | 完全に独立した複数のClaude Codeプロセス |
| 通信 | 親にresultを返すのみ | **Teammate同士が直接メッセージング** |
| 調整 | 親が全てコントロール | **共有タスクリスト + 自己調整** |
| コスト | 低（結果のみが親に返る） | 高（通常の**約7倍**） |
| 用途 | 集中作業（結果だけが重要） | 複雑な共同作業（議論・相互検証が必要） |

### 12.2 Walkersの3つの実行レイヤー（明確な使い分け）

| レイヤー | 概念 | 性質 | 用途 | コスト |
|---------|------|------|------|-------|
| **サブエージェント** | 恒久的な役割（部署） | 永続的・記憶蓄積・cron定期実行 | 日常の定型業務 | 低 |
| **Subagents（公式）** | 一時的なワーカー | セッション内subprocess・使い捨て | 単発の委譲・並列調査 | 低 |
| **Agent Teams** | 一時的なプロジェクトチーム | 独立プロセス・相互通信・共有タスク | プロジェクト級の大型タスク | **高（7倍）** |

**日常業務の9割はサブエージェント or Subagentsで十分。**
Agent Teamsは「プロジェクト」と呼べる規模のタスクにのみ使う。

### 12.3 Agent Teams 起動判断基準

**起動すべき場面:**

| パターン | 例 | なぜTeamsか |
|---------|---|-----------|
| **プロダクト開発** | フロント・バック・インフラ・テストを並行開発 | 各自が独立した領域を持ち、相互に依存関係を調整 |
| **補助金申請** | 事業計画書・技術資料・財務計画・チェックリストを並行作成 | 独立ドキュメントの並行作成 + 最後に整合性確認 |
| **戦略分析** | 問いの設計・市場調査・定量分析・戦略設計・批判的レビュー | 多視点の調査 + 相互に反証・検証 |
| **記事執筆** | リサーチャー3名・構成・編集長・ライター | 並行リサーチ + 編集長の品質ゲート |
| **競合仮説の検証** | 5人が異なる仮説を調査 + 相互に反証 | 1人だとアンカリングバイアスが発生 |

**起動すべきでない場面:**
- 逐次的なタスク（前のステップの完了を待つ必要がある）
- 同じファイルを複数人が編集する作業
- ルーチンタスク（コスト効率悪い）
- 小さなタスク（調整コスト > 実行コスト）

### 12.4 チーム定義方式

**Agent Teamsは事前定義ファイルを持たない。実行時に自然言語で指示する。**

Walkersではスキルファイル（`.claude/commands/*.md`）にチーム起動プロンプトを直接埋め込む方式を採用。
スキルファイル全体がAgent Teams起動プロンプトとして機能する。

```
ユーザー: /strategy
  ↓
Claude: .claude/commands/strategy.md を読む
  ↓
Claude: ファイル内容をAgent Teams起動プロンプトとして使用
  ↓
Claude: Agent Team作成（5人のteammateをspawn）
  ↓
Agent Team: 共有タスクリスト + 相互通信で協調実行
  ↓
完了: 最終成果を 01_strategy/ に保存
```

**Skill → Agent Teams の変換:**

| Before（現状） | After（Agent Teams対応） |
|---------------|------------------------|
| `.claude/commands/strategy.md`（概要説明） | チーム起動プロンプト（全体がspawn指示） |
| `.claude/agents/write-article.md`（エージェント定義） | 不要（スキルに統合） |

**スキルファイルの構造（Agent Teams対応版）:**
```markdown
---
name: strategy
description: 戦略分析Agent Teamsを起動する
---

Create an agent team for strategic analysis with 5 teammates:

**Teammate 1: Question Designer**
Structure the analysis questions in MECE format.
...

**Teammate 2: Market Researcher**
Investigate market size, trends, and competitors using WebSearch.
...

All teammates use Sonnet model.
Have them communicate directly to challenge each other's findings.
Save the final report to `01_strategy/{date}_{theme}_strategy.md`.
```

### 12.5 リモート実行統合（Phase 7）

現在のGateway（`/api/gateway/chat`）は `claude -p`（ワンショット実行）で動作する。
Agent Teamsは**対話セッションの持続**が前提のため、Persistent Session Managerが必要。

```
┌─ リモート (Google Chat / embed/chat) ─────────────────────┐
│  「3人チームで競合分析して」                                  │
│  「セキュリティ担当に追加指示: JWT周りも見て」                  │
└────────────┬──────────────────────────────────────────────┘
             ▼
┌─ Cloud API (Vercel) ──────────────────────────────────────┐
│  /api/gateway/team         ← チーム作成コマンド             │
│  /api/gateway/team/message ← チームへの追加指示             │
│  /api/gateway/team/status  ← チーム進捗取得                │
└────────────┬──────────────────────────────────────────────┘
             ▼ (poll)
┌─ session-manager.py ─────────────────────────────────────┐
│  claude（対話モード）                                       │
│  env: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1              │
│  PTY/ConPTY 経由で stdin/stdout パイプ接続                 │
│                                                            │
│  ┌─ Agent Team (in-process) ─────────────────────────┐   │
│  │  Leader → Teammate 1, 2, 3...                      │   │
│  │  共有タスクリスト: ~/.claude/tasks/{team}/          │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  監視: タスクリスト読取 → 進捗JSON → Cloud返却             │
│  注入: リモートからの追加指示 → stdin                       │
│  検知: 完了 or タイムアウト → クリーンアップ                │
└────────────────────────────────────────────────────────────┘
```

**技術的課題:**

| 課題 | 対策案 |
|------|--------|
| PTYエミュレーション（Windows） | `pywinpty` で ConPTY ラップ |
| 出力境界の検出 | プロンプト待ちパターン（`❯` 等）を正規表現検出 |
| チーム完了の検知 | `~/.claude/tasks/{team}/` 監視 + stdout idle検知 |
| セッション寿命管理 | 最大30分 + 手動延長API |

### 12.6 実装フェーズ

**Phase 7a**: ローカル実験 + スキルファイル変換
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` をsettings.jsonに設定
- ローカルで手動実験（3人チームでのレビュー等）
- `/write-article`, `/strategy` をAgent Teams起動プロンプト形式に変換

**Phase 7b**: Persistent Session Manager基盤
- `session_manager.py` 新規作成
- PTY/ConPTY経由で `claude` を対話モード起動
- stdin書き込み / stdout読み取りのラッパー
- 出力境界検出

**Phase 7c**: リモート操作対応
- `/api/gateway/team` エンドポイント追加（server.py + Cloud API）
- Google Chat / embed/chat からのチーム操作
- 途中指示の注入 + 進捗のリアルタイム中継

**前提条件:**
- Claude Code v2.1.32 以降
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- Windows: `pywinpty`
