---
description: 日次スケジュール生成
---

# 日次スケジュール生成

トリガー: 「おはよう」「今日の予定は？」

## 利用するツール

| ソース | ツール | パラメータ例 |
|--------|--------|-------------|
| 仕事カレンダー | `gcal_list_events` | `calendarId="primary"`, `timeMin="YYYY-MM-DDT00:00:00"`, `timeMax="YYYY-MM-DDT23:59:59"`, `timeZone="Asia/Tokyo"` |
| 個人カレンダー | `gcal_list_events` | `calendarId=` CLAUDE_LOCAL.md「個人カレンダーID」参照, 同上 |
| TaskGod | `list_tasks`（TaskGod MCP） | フィルタ: 未完了タスク |
| 日報 | `Read` ツール | `DAILY.md` の直近エントリを読み取り |

> **Note**: GitHub MCP は未導入。タスク取得は TaskGod `list_tasks` で代替する。

## 実行手順

1. **カレンダー取得**（並列実行）
   - `gcal_list_events(calendarId="primary", timeMin="今日T00:00:00", timeMax="今日T23:59:59", timeZone="Asia/Tokyo")` で仕事の予定を取得
   - `gcal_list_events(calendarId="<個人カレンダーID>", timeMin="今日T00:00:00", timeMax="今日T23:59:59", timeZone="Asia/Tokyo")` で個人の予定を取得（※ 個人カレンダーIDは CLAUDE_LOCAL.md の「個人設定」セクションを参照）
2. **タスク取得**: TaskGod MCP の `list_tasks` で未完了タスクを取得する
3. **日報確認**: `Read` ツールで `DAILY.md` の直近エントリを読み、未完了・持ち越しタスクを抽出する
4. 上記を統合し、15分刻みの工程表を生成する

## 出力フォーマット

`DAILY.md` に以下の形式で追記する：

```markdown
## YYYY-MM-DD（曜日）

### 今日の工程表
| 時間 | タスク | カテゴリ | 優先度 |
|------|--------|---------|--------|
| 09:00-09:15 | メール・Slack確認 | 共通 | 高 |
| ...  | ...    | ...     | ...    |

### 今日のポイント
- 最重要タスク: [名前]
- 締切のあるタスク: [名前（期日）]
- 持ち越しタスク: [名前]
```

## ルール
- 会議・予定は**両方のカレンダー**の時間をそのまま反映する（片方だけ見ない）
- `transparency: "transparent"` の予定（リマインダー等）は工程表に含めるが、ブロック扱いしない
- TaskGodタスクは優先度に基づいて適切な時間帯に配置する
- 持ち越しタスクは優先的に午前中に配置する
- 休憩時間（12:00-13:00）は確保する
