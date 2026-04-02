# Misoca 請求・見積操作

トリガー: 「ミソカ」「請求書」「見積書」「misoca」

## 前提知識

**必ず先に読むこと**: `05_development/mcp-misoca/KNOWLEDGE.md`
このファイルにAPIの癖・ハマりポイント・データ構造がまとまっている。
新しい発見があれば都度このナレッジファイルに追記すること。

## 利用可能なツール

| ツール | 用途 |
|--------|------|
| `misoca_list_invoices` | 請求書一覧 |
| `misoca_get_invoice` | 請求書詳細 |
| `misoca_create_invoice` | 請求書作成（contact_id必須） |
| `misoca_invoice_status` | ステータス変更（submit/pay/trash等） |
| `misoca_list_estimates` | 見積書一覧 |
| `misoca_get_estimate` | 見積書詳細 |
| `misoca_create_estimate` | 見積書作成（contact_id必須） |
| `misoca_list_contacts` | 取引先（送付先）一覧 |
| `misoca_list_contact_groups` | 取引先グループ一覧 |
| `misoca_list_items` | 登録済み品目一覧 |
| `misoca_get_me` | ユーザー情報 |

## 実行フロー

### 請求書・見積書の作成時
1. まず `misoca_list_contacts` で取引先一覧を取得
2. ユーザーに宛先を確認（候補が複数ある場合）
3. 件名・明細・発行日・支払期限をヒアリング
4. **contact_id は contacts の `id` を使う**（contact_group_id ではない）
5. 作成後、Misoca管理画面のURLを案内: `https://app.misoca.jp/`

### 請求書一覧の確認時
1. `misoca_list_invoices` で取得
2. 未入金・未送付のものがあればハイライトして報告
3. データが多い場合はGUIテーブルで表示を検討

### ステータス変更時
1. 対象の請求書IDを特定
2. アクションを確認（送付済み/入金済み/ゴミ箱等）
3. **実行前にユーザーに確認を取る**（取り消しはできるが念のため）

## 重要な注意点

- 金額は文字列で返る（`"772000.0"`）→ 表示時にフォーマットする
- contact_id は必須。わからなければ先に contacts を取得する
- items の単位フィールドは `unit_name`（`unit` ではない）
- ボディはフラット構造（ネストしない）
- テスト作成したものは削除を案内する
- **新しいAPIの挙動を発見したら `KNOWLEDGE.md` に追記する**

## エラー時の対応

| エラー | 原因 | 対処 |
|--------|------|------|
| 405 Not Allowed | エンドポイントのパスが間違い | 単数/複数を確認 |
| 400 contact_idは必須 | contact_id 未指定 | contacts一覧から取得して指定 |
| 401 Unauthorized | トークン期限切れ | 自動リフレッシュが動くはず。ダメなら `node auth.js` 再実行を案内 |
| 接続エラー | MCPサーバー未起動 | Claude Code再起動を案内 |

## ナレッジ追記ルール

Misoca APIを使って新しい発見があった場合:
1. `05_development/mcp-misoca/KNOWLEDGE.md` を読む
2. 該当セクションに追記する（なければ新セクション作成）
3. 「未検証・TODO」のチェックも更新する
