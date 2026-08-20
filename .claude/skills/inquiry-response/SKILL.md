---
description: HP問い合わせ対応（日程調整メール下書き・確定対応・Notion更新）
---

# HP問い合わせ対応

トリガー: 「問い合わせ対応」「問い合わせ返信」「日調メール」「inquiry」

> **注記（2026-07-10・実験中）**: Phase 1（受信→日程候補→下書き→Notion登録→通知）は GAS で自動化済み（`05_development/gas-webhook-receiver/InquiryDraft.gs`）。本スキルの Phase 1 は GAS 失敗時の**手動フォールバック**。Phase 2（日程確定→MTG設定→scaffold）は引き続き本スキルが主経路。
> GAS 側との仕様差分: ブロック閾値は GAS が2時間（本スキル記載は3時間）、期間は10営業日、候補条件は「naru＋(古谷 or 渡辺)」、CC は masahiro.nagai を含む6名（naru本人はCCに入れない）。手動対応時も GAS 側仕様に合わせること。

引数: $ARGUMENTS（「新規」= Phase 1 / 「確定」= Phase 2 / 会社名 / 空 = 未対応一覧表示）

## 利用ツール

| ステップ | ツール | 用途 |
|----------|--------|------|
| メール検索 | `mcp__google-workspace__search_gmail_messages` | フォーム通知メール検索 |
| メール取得 | `mcp__google-workspace__get_gmail_message_content` | 本文パース |
| カレンダー | `mcp__google-workspace__get_events` | 3カレンダーの予定取得 |
| 下書き作成 | `mcp__google-workspace__draft_gmail_message` | メール下書き |
| 予定作成 | `mcp__google-workspace__manage_event` | MTG予定の登録 |
| Notion 読取 | `mcp__notion__API-query-data-source` | 営業DB検索 |
| Notion 作成 | `mcp__notion__API-post-page` | 営業DBレコード作成 |
| Notion 更新 | `mcp__notion__API-patch-page` | 営業DBレコード更新 |

## 定数

```
SALES_DB_ID    = 2b45e882-f998-8126-9328-fd7d5cff10d0
MEET_URL       = https://meet.google.com/mad-rboj-efw
PHONE          = 050-8893-2652
MAIL_SUBJECT   = 【株式会社Walkers】お問合せありがとうございます。
CC_LIST        = atsushi.watanabe@walker-s.co.jp, daiki.furutani@walker-s.co.jp, naru.hosoya@walker-s.co.jp, ryuichi.ikeda@walker-s.co.jp, rin.nakamura@walker-s.co.jp, quality-management@walker-s.co.jp
SENDER_NAME    = 細谷
CALENDARS:
  - primary                          (naru・必須参加者)
  - daiki.furutani@walker-s.co.jp    (古谷・仕事)
  - fullsrodd@gmail.com              (古谷・個人)
  - atsushi.watanabe@walker-s.co.jp  (渡辺)
GC_ATTENDEES:
  - daiki.furutani@walker-s.co.jp
  - fullsrodd@gmail.com
  - naru.hosoya@walker-s.co.jp
  - atsushi.watanabe@walker-s.co.jp
```

---

## Phase 1: 問い合わせ受信 → 日程調整メール下書き

### Step 1: 問い合わせメール取得・パース

`search_gmail_messages` で検索:
```
query: "subject:【WalkersHP】お問い合わせが届きました from:support@walker-s.co.jp"
```

本文から以下のフィールドを抽出する。フィールドラベルが区切りになっている:
- `お名前` 〜 `貴社名` の間 → **担当者名**
- `貴社名` 〜 `メールアドレス` の間 → **会社名**
- `メールアドレス` 〜 (`電話番号` or `お問い合わせ内容`) の間 → **メールアドレス**
- `電話番号` 〜 `お問い合わせ内容` の間 → **電話番号**（任意フィールド）
- `お問い合わせ内容` 〜 `株式会社Walkers から送信` の間 → **問い合わせ内容**

複数の未対応問い合わせがある場合は一覧を表示し、どれを処理するかユーザーに確認する。

### Step 2: カレンダー空き取得

**CALENDARSの4つのカレンダーを並列で取得する**（1つでも欠けたまま候補を出すことは禁止）:

```
get_events(calendarId="primary", timeMin=開始日T00:00:00+09:00, timeMax=終了日T23:59:59+09:00)
get_events(calendarId="daiki.furutani@walker-s.co.jp", ...)
get_events(calendarId="fullsrodd@gmail.com", ...)
get_events(calendarId="atsushi.watanabe@walker-s.co.jp", ...)
```

取得範囲: ユーザー指定期間。指定がなければ翌営業日から5営業日。

### Step 3: 空き枠計算

各日について以下のルールで空き枠を算出する:

**営業時間**: 11:00〜18:00

**同席者条件（CRITICAL）**: MTGは「naru必須 AND (古谷 or 渡辺のどちらか同席可能)」で成立する。naru（primary）は必須参加者。古谷（daiki.furutani または fullsrodd）と渡辺（atsushi.watanabe）は二者択一でよいため、片方に予定が入っていても、もう片方が空いていれば候補から除外しない。

**古谷の予定判定**: daiki.furutani と fullsrodd は同一人物（古谷）の2カレンダー。**いずれか一方にでも予定があれば「古谷は予定あり（busy）」とみなす**（OR合成。両方に予定がある場合のみbusyとするAND合成ではない）。

**「両方とも予定あり」の判定範囲**: 古谷busyの時間帯と渡辺busyの時間帯の**重複区間（intersection）のみ**をハードブロックとする。例えば古谷13:00〜15:00・渡辺14:00〜16:00なら、重複する14:00〜15:00のみが除外対象で、13:00〜14:00・15:00〜16:00は「どちらか一方のみ予定あり」としてソフトブロック扱いになる。

**ブロック分類**:
| 条件 | 分類 | 処理 |
|------|------|------|
| naru（primary）の予定 duration < 3時間 | ハードブロック | その時間帯を除外 |
| naru（primary）の予定 duration >= 3時間 | ソフトブロック | 候補に含めるが `(※調整可)` をフラグ表示 |
| 古谷（daiki.furutani or fullsrodd、OR合成）と渡辺（atsushi.watanabe）のbusy時間帯が**重複** | ハードブロック | 同席者を確保できないため重複区間のみを除外 |
| 古谷**または**渡辺の**どちらか一方のみ**予定あり（重複なし） | ソフトブロック扱い | 候補に含めるが、空いている方（例: `※渡辺さんのみ同席可`）をフラグ表示 |
| `transparency: "transparent"` | 無視 | ブロックとして扱わない |

**除外日**: 土曜・日曜・祝日

**曜日算出**: イベント API レスポンスの日付文字列から JavaScript の `Date` オブジェクト or `Intl.DateTimeFormat` 相当で曜日を取得する。**絶対に手計算しない**。

**フォーマット**:
- 時刻区切り: `~`（ハイフンやダッシュは使わない）
- 日付例: `6月29日(月) 12:00~14:00, 16:00~18:00`
- 複数時間帯はカンマ区切り

### Step 4: ユーザー確認（CRITICAL）

算出した候補日一覧をテキストで提示し、**必ずユーザーの承認を得てから**次に進む。

提示フォーマット:
```
以下の候補日でよろしいですか？

6月29日(月) 12:00~14:00
6月30日(火) 11:00~16:00
7月1日(水) 11:00~14:00, 16:00~18:00
7月2日(木) 12:00~14:00, 15:00~18:00
7月3日(金) 11:00~13:00, 14:00~16:00

※ 7/1 11:00~14:00 は古谷さんにソフトブロックあり（調整可）
```

ユーザーが修正を指示した場合はその日程を使う。

### Step 5: 下書き作成

**`draft_gmail_message` のみ使用。`send_gmail_message` は絶対禁止。**

パラメータ:
- `to`: 問い合わせ者メールアドレス
- `cc`: CC_LIST（定数参照）
- `subject`: MAIL_SUBJECT（定数参照）
- `thread_id` / `in_reply_to`: ユーザーが指定した場合のみ設定
- `include_signature`: 必ず `false`（`.claude/refs/email-signature.md` 参照。既定値のままだと署名の改行が壊れる）
- `body`: 下記テンプレート

```
{会社名}
{担当者名}様

お世話になっております。
株式会社Walkersの細谷です。

この度はお問合せいただき誠にありがとうございます。

ご相談内容につきまして、
ぜひオンラインにて詳細をお聞かせいただけますと幸いです。

差し支えなければ下記日時よりご都合の良いお時間をご教示いただけないでしょうか？

{候補日一覧}

上記日程でご都合がつかない場合は、以降の日程も対応可能でございますのでお気軽にご相談ください。

何卒よろしくお願いいたします。

───────────────────
【あなたの事業を成功させる強力なパートナー】
株式会社Walkers
Naru Hosoya
Email: naru.hosoya@walker-s.co.jp
URL: https://walker-s.co.jp/
───────────────────

─────────────────
お問い合わせ内容
{問い合わせ内容の引用}
─────────────────
```

### Step 6: Notion 営業DB更新

DB: `プロジェクト(営業)` / ID: `2b45e882-f998-8126-9328-fd7d5cff10d0`

`mcp__notion__API-post-page` で新規レコード作成:

| プロパティ | 型 | 値 |
|-----------|-----|-----|
| `法人名・屋号など` | title | 会社名 |
| `担当者名` | email | 問い合わせ者の**氏名**（メールアドレスではない）。DB上の型は email だが Notion 側にバリデーションは無く、`池田誠` のような日本語氏名をそのまま格納できる（2026-08-03 実測） |
| `日調送信日` | date | 当日（下書き作成日） |
| `PJステータス` | select | `日調中` |
| `営業担当者` | select | `細谷`（新規登録時は naru 固定。他担当への振り分けは naru が Notion 上で行う） |
| `プロジェクト概要` | rich_text | 問い合わせ内容 |
| `リード獲得日` | date | フォーム受信日 |

---

## Phase 2: 日程確定 → MTG設定

### Step 1: 確定日時の確認

ユーザーから確定日時を受け取る（メール本文の転記 or 口頭指示）。
フォーマット例: `7/1(水) 15:00~16:00`

### Step 2: 確定メール下書き作成

**`draft_gmail_message` のみ使用。`send_gmail_message` は絶対禁止。**`include_signature` は必ず `false`（`.claude/refs/email-signature.md` 参照）。

```
{会社名}
{担当者名}様

お世話になっております。
株式会社Walkersの細谷です。

ご連絡ありがとうございます。

{確定日時}
とのこと承知いたしました。

差し支えなければお時間になりましたら下記までお越しいただけますと幸いです。
https://meet.google.com/mad-rboj-efw

なお、緊急のご連絡につきましては、以下の番号までお電話いただけますようお願い申し上げます。
050-8893-2652

何卒よろしくお願いいたします。

───────────────────
【あなたの事業を成功させる強力なパートナー】
株式会社Walkers
Naru Hosoya
Email: naru.hosoya@walker-s.co.jp
URL: https://walker-s.co.jp/
───────────────────
```

スレッド指定: Phase 1 で送信したメールのスレッドに返信する場合、`thread_id` / `in_reply_to` を設定。

### Step 3: Google Calendar イベント作成

`mcp__google-workspace__manage_event` で予定作成:

- **タイトル**: `{会社名}様`
- **日時**: 確定日時
- **参加者**（社内のみ、クライアントは招待しない）:
  - `daiki.furutani@walker-s.co.jp`（古谷さん仕事）
  - `fullsrodd@gmail.com`（古谷さん個人）
  - `naru.hosoya@walker-s.co.jp`（naru）
  - `atsushi.watanabe@walker-s.co.jp`（渡辺さん）
- **説明欄**: Meet URL + 問い合わせ内容（`https://meet.google.com/mad-rboj-efw\n\n【お問い合わせ内容】\n{問い合わせ内容}`）

### Step 4: Notion 営業DB更新

`mcp__notion__API-patch-page` で既存レコードを更新:

| プロパティ | 変更内容 |
|-----------|---------|
| `PJステータス` | `日調中` → `初回mtg前` |
| `次回MTG日` | 確定日 |

事前資料がある場合は Notion ページ内にリンクまたはファイルを格納する。

> **注意（2026-07-03 実測）**: Notion インテグレーショントークンが失効しており API は 401 を返す。再発行されるまで本 Step は「スキップした」と報告し、続く Step 5 に進む（Notion 更新を理由に処理を止めない）。

### Step 5: 案件 scaffold 作成（MTG確定＝案件化のタイミング）

初回MTG が確定したこの時点で、案件の作業場とレジストリ登録を機械的に作る。手順の正は `.claude/refs/context-template.md`。

1. **命名規約チェック**: 案件ディレクトリ名は先頭/末尾スペース禁止・全角英数字禁止・`／ \ : * ? " < > |` 禁止。会社名をそのまま使う（例: `株式会社ハート`）
2. `03_projects/_template/` を `03_projects/{案件名}/` にコピー（既存ディレクトリがある場合はコピーせず、CONTEXT.md の有無だけ確認して無ければ雛形を追加）
3. CONTEXT.md のプレースホルダを置換: 案件ID（ASCII 大文字で採番）・ステータス=`scheduled`・関係者（問い合わせ者名）・商談タイムライン（問い合わせ受領日・MTG確定日時）
4. **パイプラインDB スプシ**（ID: `1tXlCsQGGCNxrmN4HqW2btLpx9YKY0fgzH86wwtXBsGU`）の「案件マスタ」タブに行を追加: 案件ID / 案件名 / ディレクトリパス / エイリアス（社名の略称・呼び方揺れ）/ ステータス=`scheduled` / 次回MTG=確定日時
5. 「実行ログ」タブに scaffold 実施を記録し、ユーザーに案件ID とパスを報告

---

## 運用ルール

### ✅ やること
- 3カレンダー**全て**をチェックしてから空き枠を出す
- 候補日は**ユーザー確認後**に下書き作成
- 曜日は API レスポンスの日付から算出（手計算禁止）
- 下書き作成後、Draft ID をユーザーに報告

### ❌ やらないこと（CRITICAL）
- **`send_gmail_message` の使用 → 絶対禁止**（CLAUDE.md にも明記済み）
- ユーザー確認前の下書き作成
- 片方のカレンダーだけ見て候補を出す
- 曜日の手計算（「6/25 は水曜」のような推論は禁止）
- クライアントを Google Calendar に招待する

---

## エラー対応

| エラー | 原因 | 対処 |
|--------|------|------|
| カレンダー取得失敗 | 権限不足 or カレンダーID変更 | ユーザーに報告、手動で日程確認を依頼 |
| Notion DB 書き込み失敗 | プロパティ名/型の変更 | `API-retrieve-a-database` で DB スキーマを再取得して修正 |
| メール本文パース失敗 | フォーム形式変更 | 生の本文をユーザーに提示し、手動で情報を確認 |
| スレッド紐付け失敗 | thread_id 不一致 | `get_gmail_message_content` で Message-ID を再取得 |
