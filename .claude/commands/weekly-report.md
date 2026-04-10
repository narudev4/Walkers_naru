# 週次レポート生成

トリガー: 「週報」「週次レポート」

## 利用するツール

| ソース | ツール | パラメータ例 |
|--------|--------|-------------|
| 仕事カレンダー | `gcal_list_events` | `calendarId="primary"`, `timeMin="週初日T00:00:00"`, `timeMax="週末日T23:59:59"`, `timeZone="Asia/Tokyo"` |
| 個人カレンダー | `gcal_list_events` | `calendarId=` CLAUDE_LOCAL.md「個人カレンダーID」参照, 同上 |
| TaskGod | `list_tasks`（TaskGod MCP） | 全タスク取得→今週完了分をフィルタ |
| 日報 | `Read` ツール | `DAILY.md` から今週分のエントリを読み取り |
| Gmail | `gmail_search_messages` | `q: "after:YYYY/M/D before:YYYY/M/D"` で今週のメール概況 |

> **Note**: GitHub MCP は未導入。タスク集計は TaskGod `list_tasks` + `DAILY.md` で代替する。

## 実行手順

1. **日報読み込み**: `Read` ツールで `DAILY.md` から今週の完了タスク・未完了タスクを集計する
2. **TaskGod取得**: `list_tasks`（TaskGod MCP）で今週完了/未完了のタスクを取得する
3. **カレンダー取得**（並列実行）:
   - `gcal_list_events(calendarId="primary", timeMin="週初日T00:00:00", timeMax="週末日T23:59:59", timeZone="Asia/Tokyo")` で仕事の予定を取得
   - `gcal_list_events(calendarId="<個人カレンダーID>", ...)` で個人の予定を取得（※ CLAUDE_LOCAL.md「個人設定」参照）
4. **Gmail概況**: `gmail_search_messages(q="after:YYYY/M/D before:YYYY/M/D")` で今週のメール傾向を把握
5. 上記を統合し、週次レポートを生成する

## 出力先
`output/digest/YYYY-WXX_weekly-report.md`

## 出力フォーマット

```markdown
# 週次レポート: YYYY年MM月第X週（MM/DD〜MM/DD）

## 今週のハイライト
- [最も重要な成果 3つ]

## 完了タスク
| タスク | カテゴリ | 完了日 |
|--------|---------|--------|
| [タスク名] | [カテゴリ] | MM/DD |

## 未完了・持ち越しタスク
| タスク | カテゴリ | 理由 |
|--------|---------|------|
| [タスク名] | [カテゴリ] | [未完了の理由] |

## KPI進捗
| 指標 | 目標 | 実績 | 達成率 |
|------|------|------|--------|

## 来週の優先事項
1. [優先タスク1]
2. [優先タスク2]
3. [優先タスク3]

## 気づき・改善点
- [フリー記述]
```

## ルール
- データに基づいた客観的な記述を心がける
- 来週の優先事項を必ず提案する
- カレンダーは両方（仕事+個人）を確認してMTG実績をカウントする
