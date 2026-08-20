---
description: Misoca 請求・見積操作
---

# Misoca 請求・見積操作

トリガー: 「ミソカ」「請求書」「見積書」「misoca」

## 前提知識

**必ず先に読むこと**: `05_development/mcp-misoca/KNOWLEDGE.md`
このファイルにAPIの癖・ハマりポイント・データ構造がまとまっている。
新しい発見があれば都度このナレッジファイルに追記すること。

## 2つのMisocaアカウント

| MCP名 | 事業者 | メール | 用途 |
|--------|--------|--------|------|
| `mcp__misoca__` | メイン事業者 | CLAUDE_LOCAL.md「Misocaアカウント（Walkers）」参照 | メイン事業者が発行する請求書・見積書 |
| `mcp__misoca-private__` | サブ事業者 | CLAUDE_LOCAL.md「Misocaアカウント（Blue Impacts）」参照 | サブ事業者が発行する請求書 |

**重要**: 「誰が発行するか」でアカウントを選ぶ。具体的なアカウント情報は CLAUDE_LOCAL.md の「個人設定」セクションを参照。

### Blue Impacts → Walkers 請求時の既知情報
- Walkersの contact_id（Blue Impacts側）: `7955602`
- 登録名が「株式会社スタッフミール」（旧名）のまま → 動作に問題なし

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

### 請求書の発行＋提出（フルフロー）

**Phase 1: Misocaで請求書作成**
1. 発行元を特定 → 正しいMisocaアカウント（`mcp__misoca__` or `mcp__misoca-private__`）を選択
2. `misoca_list_contacts` で取引先一覧を取得し、請求先の contact_id を特定
3. ユーザーに宛先を確認（候補が複数ある場合）
4. 件名・明細・発行日・支払期限をヒアリング
5. **contact_id は contacts の `id` を使う**（contact_group_id ではない）
6. 請求書を作成
7. 作成後、Misoca管理画面からPDFをダウンロード案内: `https://app.misoca.jp/`

**Phase 2: 消費税の確認**
- ユーザーに「税込み / 税なし」を確認する
- 税なしの場合: Misoca作成時に tax_type を指定しないか、PDFエクスポート時に税なし設定で出力
- Misoca上で修正が必要なら、ゴミ箱 → 再作成のフローになる

**Phase 3: Larkフォームで提出（Walkers宛の場合）**
請求先がWalkersの場合、Larkの請求書提出フォームに提出する:
- フォームURL: `https://walker-s.jp.larksuite.com/share/base/form/shrjp766ybnsTxtuc3cdj4mTB7g`
- Playwrightでフォームを自動入力する

**フォームのフィールド:**
| フィールド | 入力内容 |
|-----------|---------|
| お名前（必須） | 発行者名（例: 古谷大輝（合同会社Blue Impacts＆Co.）） |
| プロジェクト名①（必須） | 案件名（例: 19次成果報酬：Artffanders社） |
| プロジェクト①_金額（必須） | 金額（税込み・円） |
| プロジェクト名②〜⑤ | 複数案件がある場合 |
| プロジェクト②〜⑤_金額 | 対応する金額 |
| プロジェクト6件目以降 | 「プロジェクトA：XXXXX円」形式 |
| ご請求金額合計（必須） | 合計金額 |
| 支払期日（必須） | 年/月/日形式（カレンダーUIで選択） |
| 適格請求書発行事業者登録番号（必須） | 登録番号 or 「未発行」 |
| 請求書の添付（必須） | PDFファイルをアップロード |

**Larkフォーム入力手順（Playwright）:**
1. `browser_navigate` でフォームURLを開く
2. 各テキストフィールドを `browser_click` → `browser_type` で入力
3. 支払期日はカレンダーUIを操作（日付入力欄クリック → 月を合わせる → 日をクリック）
4. 適格請求書発行事業者登録番号: Blue Impactsは「未発行」
5. Choose Fileボタンクリック → `browser_file_upload` でPDFアップロード
   - **PDFファイルは `output/` にコピーしてからアップロード**（ブラウザ自動化ツールのファイルアクセス制限回避）
6. **送信前にユーザーに確認を取る**（入力内容をリストで提示）
7. 確認後、送信ボタンをクリック

### 請求書・見積書の作成のみ（提出なし）
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
- Larkフォーム提出時、**送信は必ずユーザー確認後**に行う
- 前回誤送信した場合は、経理担当に修正版を再送した旨を伝えるよう案内する

## エラー時の対応

| エラー | 原因 | 対処 |
|--------|------|------|
| 405 Not Allowed | エンドポイントのパスが間違い | 単数/複数を確認 |
| 400 contact_idは必須 | contact_id 未指定 | contacts一覧から取得して指定 |
| 401 Unauthorized | トークン期限切れ | 自動リフレッシュが動くはず。ダメなら `node auth.js` 再実行を案内 |
| 接続エラー | MCPサーバー未起動 | Codex再起動を案内 |
| Playwrightファイルアクセス拒否 | PDFがallowed roots外 | `output/` にコピーしてからアップロード |
| Larkカレンダーが閉じない | UIの癖 | フォームタイトル等の別要素をクリックして閉じる |

## ナレッジ追記ルール

Misoca APIを使って新しい発見があった場合:
1. `05_development/mcp-misoca/KNOWLEDGE.md` を読む
2. 該当セクションに追記する（なければ新セクション作成）
3. 「未検証・TODO」のチェックも更新する
