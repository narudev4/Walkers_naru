# AI司令塔ダッシュボード新規設計 — 調査メモ（research-first Step 2）

日付: 2026-07-13 / 目的: タスク管理＋案件DB＋メール下書きレビュー＋AI実行管理の一人用ダッシュボード新規設計

## Claude Tag の移植すべきエッセンス（公式ドキュメントより）

1. **「投げる場所」と「作業が見える場所」の分離** — 依頼は1行、進捗はチェックリスト、詳細ログは別画面リンク（2層表示）
2. **タスク＝スレッド（会話単位）** — 各タスクが「依頼文・マイルストーン・進捗・成果物リンク」を1レコードで保持
3. **完了時のアクションボタン** — 「下書きを見る」「承認」「修正指示」に相当するワンクリック操作
4. **着手宣言と完了通知** — 実行中であることが常に見える（沈黙させない）

出典: https://claude.com/docs/claude-tag/overview / https://code.claude.com/docs/en/slack

## claude -p（headless）の重要な制約

- サブスク定額で使える（2026-06-15 に課金分離が一時停止、公式: support.claude.com/en/articles/15036540）。ただし**将来ヘッドレスがサブスク枠外になるリスクは残る**→常駐頻度を絞れる/止められる設計にする
- **`--bare` は使わない**（OAuth を読まず ANTHROPIC_API_KEY 必須＝API従量課金になる）
- **環境変数に ANTHROPIC_API_KEY が残っていると headless が API 課金に流れる事故例あり**（Issue #37686、2日で$1,800）。cron/launchd から叩く際は env を必ず確認
- `--output-format json` で session_id / result を取得、`--resume <session_id>` で継続（同一 cwd 必須）

## 参考OSS

| 用途 | プロジェクト |
|---|---|
| Web UIからセッション起動・管理 | github.com/siteboon/claudecodeui |
| デスクトップGUI（Tauri） | github.com/winfunc/opcode |
| 読み取り専用監視（~/.claude のセッションファイルをパース） | ksred.com のGo+React+SQLite事例、claude-view |
| cron + タスクキューMCP + claude -p ワーカー | blle.co/blog/automated-claude-code-workers |

メール下書き承認キュー専用のOSSは見つからず（自作領域）。ただし**Gmailの下書きフォルダ自体が承認キュー**として機能するので、ダッシュボードは一覧＋プレビューに徹すれば足りる。

## 既存データソース棚卸し（現役のもの）

| データ | 場所 | 更新者 |
|---|---|---|
| 案件マスタ・NA(タスク)・イベントログ・実行ログ | パイプラインDBスプシ `1tXlCsQGGCNxrmN4HqW2btLpx9YKY0fgzH86wwtXBsGU`（5タブ） | mtg-pipeline worker + naru |
| メール下書き | Gmail Drafts（NA成果物リンクに `draft:{ID}` 書式） | 各スキル + GAS |
| HP問い合わせ状態 | Sheets `1MLu7bBsA1tBmqj5lzaOa4DNo3L6FUPOfYNxA6s9yZ6Y`（対応状況/draftId/判定メモ列） | GAS walkers-inquiry-draft-worker |
| 日報 | DAILY.md | daily-schedule + naru |
| 決定記録 | 00_context/memories/decisions.md | 各スキル + naru |

**購読しない（stale/dead）**: 04_sales/pipeline.md・facts.md・monthly-summary.md（5/23で停止）、TaskGod系スキル（MCP未接続で死んでいる）、Notion営業DB（401失効中）

**踏襲すべき既存パターン**: スプシ真理源 → worker がJSONスナップショット出力（表示契約） → server がライブ配信。stale継承を防ぐ設計。
