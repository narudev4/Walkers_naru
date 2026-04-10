# 経理データ更新

トリガー: 「経理更新」「財務データ」

## 利用ツール

| ステップ | ツール | 用途 |
|---------|--------|------|
| Step 1 | `google_drive_search` (自作Google MCP) | 経理スプレッドシートのID検索（ID不明時） |
| Step 1 | `google_sheets_get_info` (自作Google MCP) | シート名・構造確認 |
| Step 1 | `google_sheets_read` (自作Google MCP) | 売上・経費データ読み取り |
| Step 2 | `misoca_list_invoices` (Misoca MCP) | 請求書一覧取得（発行・入金状況） |
| Step 2 | `misoca_list_estimates` (Misoca MCP) | 見積書一覧取得 |
| Step 3 | Read (built-in) | `02_finance/` 内の既存月次データ読み込み |
| Step 4 | Edit (built-in) | `02_finance/monthly-summary.md` 更新 |

## 実行手順

1. **Google Sheets取得**: `google_sheets_read` で経理データ（売上・経費）を取得する
   - シートIDが不明な場合は `google_drive_search(query="経理 OR 売上 OR 収支")` で検索
   - `google_sheets_get_info` でシート名・構造を確認してから読み取り
2. **Misoca取得**（並列実行）:
   - `misoca_list_invoices` で請求書一覧（発行状況・入金状況）を取得
   - `misoca_list_estimates` で見積書一覧を取得
3. Read ツールで `02_finance/` 内の既存月次データを確認し、データを集計・分析する
4. Edit ツールで `02_finance/monthly-summary.md` を更新する
5. 異常値や注意点があれば報告する

## 更新先
`02_finance/monthly-summary.md`

## 出力フォーマット

```markdown
## YYYY年MM月 収支サマリー（更新日: YYYY-MM-DD）

### 売上
| 項目 | 金額 | 備考 |
|------|------|------|
| [クライアント/案件名] | ¥XXX,XXX | [状態] |
| **合計** | ¥XXX,XXX | |

### 経費
| 項目 | 金額 | 備考 |
|------|------|------|
| [経費項目] | ¥XXX,XXX | [詳細] |
| **合計** | ¥XXX,XXX | |

### 営業利益: ¥XXX,XXX
```

## ルール
- 金額は日本円表示（¥記号付き）
- 前月比の変動があれば注記する
- 未入金の請求がある場合はアラートを出す
