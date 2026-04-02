---
description: Google Sheets+Misocaから経理データを取得・集計・更新
---

# 経理データ更新

トリガー: 「経理更新」「財務データ」

## 実行手順

1. `google_sheets_read` で **Google Sheets** から経理データ（売上・経費）を取得する（シートIDが不明な場合は `google_drive_search` で検索）
2. **Misoca** から請求書・見積書データを取得する（`misoca_list_invoices` / `misoca_list_estimates`）
3. データを集計・分析する
4. `02_finance/monthly-summary.md` を更新する
5. 異常値や注意点があれば報告する

## 取得するデータ
- Google Sheets（`google_sheets_read` / `google_sheets_get_info`）: 月次売上データ・月次経費データ
- Misoca: 請求書一覧（発行状況・入金状況）
- Misoca: 見積書一覧
- ローカル: `02_finance/` 内の月次データ

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
