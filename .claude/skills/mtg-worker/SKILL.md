---
description: 【凍結】旧 MTG ワーカー。後継の mtg-pipeline も 2026-08-20 に削除済み（MTG自動化は終了）。起動しないこと。
---

# MTG ワーカー（tl;dv 連携）【凍結・バックアップ経路】

> **⚠️ このスキルは 2026-07-03 に凍結された。後継の `mtg-pipeline` も 2026-08-20 に削除された（MTG自動化は終了）。**
> フェーズ判定・アクション表・メールテンプレは mtg-pipeline に移植済み。本ファイルは設計資産の参照用として残す。
> 旧設計の既知の問題（起動する場合は必ず修正すること）:
> - Step 5-A の「カレンダー自動登録（抽出成功時・無確認）」は誤抽出リスクがあるため**必ずユーザー確認を挟む**
> - proposal_queue.jsonl / contract_signals.jsonl には消費者が存在しない（断線）
> - 24時間ウィンドウは取りこぼし構造がある（mtg-pipeline はイベントログ方式で解消済み）

トリガー: 「mtg-worker」「MTGワーカー起動」「tl;dv チェック」

## 概要

tl;dv API をポーリングし、新しく処理完了した議事録を検出。
Walkers の2回MTGフローに沿って、フェーズを自動判定し、ネクストアクションを実行する。

**想定起動方法**:
```bash
claude -p "tl;dv の新規議事録をチェックして Walkers MTG フローのネクストアクションを実行して" --loop 5m
```

## 利用ツール

| ステップ | ツール | 用途 |
|---------|--------|------|
| API通信 | Bash (`curl`) | tl;dv REST API 呼び出し |
| 状態管理 | Read / Write (built-in) | `.ops/meetings_processed.jsonl` の読み書き |
| メール | `mcp__google-workspace__draft_gmail_message` | お礼メール下書き |
| カレンダー | `mcp__google-workspace__manage_event` | 2回目MTG日程登録 |
| シート | `mcp__google-workspace__modify_sheet_values` | 要件・フィードバック記録 |
| 提案書 | Skill (`create-proposal`) | 提案書自動生成（1回目MTG後） |
| モックアップ | Skill (`create-mockup`) | モックアップ自動生成（要望あり時） |

## 設定

### API キー
`credentials/tldv_api_key.txt` に tl;dv API キーを格納（1行目のみ使用）。

### 状態ファイル
`.ops/meetings_processed.jsonl` — 処理済みMTGを1行1JSONで記録:
```jsonl
{"meetingId":"abc123","processedAt":"2026-06-18T10:00:00Z","phase":"first","client":"株式会社テクノ","actions":["email_draft","calendar","sheets"]}
```

## 実行手順

### Step 0: 初期化

1. `credentials/tldv_api_key.txt` を Read して API キーを取得
2. `.ops/meetings_processed.jsonl` を Read して処理済み ID リストを構築
3. キーが未設定（`PASTE_YOUR_TLDV_API_KEY_HERE`）なら警告して終了

### Step 1: tl;dv ポーリング

```bash
curl -s -H "x-api-key: ${TLDV_API_KEY}" \
  "https://pasta.tldv.io/v1alpha1/meetings?page=1&pageSize=10"
```

レスポンスの `results` 配列から:
- `meetings_processed.jsonl` に ID が無いものを「未処理」として抽出
- `happenedAt` が過去24時間以内のものに限定（古い会議は無視）

未処理が 0 件なら「新規議事録なし」とログして終了（次の `/loop` サイクルへ）。

### Step 2: 議事録・ノート取得

未処理の各 meetingId に対して:

```bash
# 議事録
curl -s -H "x-api-key: ${TLDV_API_KEY}" \
  "https://pasta.tldv.io/v1alpha1/meetings/${MEETING_ID}/transcript"

# ノート（構造化サマリー）
curl -s -H "x-api-key: ${TLDV_API_KEY}" \
  "https://pasta.tldv.io/v1alpha1/meetings/${MEETING_ID}/notes"
```

### Step 3: クライアント・案件の特定

以下の情報からクライアントを特定:
1. **invitees のメールドメイン** — `@walker-s.co.jp` 以外 = クライアント側
2. **会議名** — 「〇〇社 MTG」等からクライアント名を抽出
3. **`03_projects/` のディレクトリ名** と照合して案件を特定

特定できない場合:
- ヘッドレス実行時: `.ops/unmatched_meetings.jsonl` に退避して次のサイクルで naru に確認を促す
- 対話実行時: naru に質問

### Step 4: MTG フェーズ判定

**判定ロジック**（優先順位順）:

1. **状態ファイル照合**: 同一クライアントで `phase: "first"` の処理済みレコードがあり、`phase: "second"` が無い → **2回目MTG**
2. **議事録キーワード分析**:
   - 1回目シグナル: 「提案書で改めて」「モックアップをお見せ」「次回までに資料を」「要件をお聞かせ」「どんなものを作りたい」
   - 2回目シグナル: 「提案書の読み合わせ」「見積もり」「お見積り」「契約」「スケジュール感」「いつから始められる」
3. **invitees の初出判定**: このクライアントドメインのメールが `meetings_processed.jsonl` に初登場 → **1回目MTG**

判定不能な場合は `phase: "unknown"` としてログし、お礼メール下書きのみ実行（安全側に倒す）。

### Step 5: アクション実行

#### 5-A: 1回目 MTG 後アクション

| # | アクション | 詳細 | 自動/確認 |
|---|-----------|------|----------|
| 1 | お礼メール下書き | `draft_gmail_message` で下書き保存。宛先=クライアント側 invitees。本文はテンプレ＋MTGサマリー | 下書き（送信は naru） |
| 2 | 2回目MTG日程登録 | 議事録から日時を抽出できれば `manage_event` で登録。抽出不可なら `.ops/pending_actions.jsonl` に「日程調整待ち」記録 | 自動（抽出成功時） |
| 3 | 要件サマリー記録 | 案件のスプレッドシートに要件サマリーを書き込み（スプシIDは `03_projects/{案件}/CLAUDE.md` から取得） | 自動 |
| 4 | 議事録ローカル保存 | `03_projects/{案件}/minutes/{YYYY-MM-DD}_{会議名}/minutes.md` に構造化議事録を保存 | 自動 |
| 5 | 提案書生成キック | 提案書作成の材料（要件・議事録パス）を `.ops/proposal_queue.jsonl` にキューイング。別セッションの `create-proposal` が拾う or naru が手動実行 | キューのみ |

**お礼メールテンプレ（1回目）**:
```
件名: 本日はお時間いただきありがとうございました

{相手の名前}様

お世話になっております。ウォーカーズの細谷です。
本日はお忙しい中、お打ち合わせのお時間をいただきまして誠にありがとうございました。

本日お伺いした内容をもとに、ご提案書{とモックアップ}を作成いたします。
次回のお打ち合わせ{（◯月◯日 ◯時〜）}にてご説明させていただければと存じます。

{日程未確定の場合: 次回のお打ち合わせ日程について、改めてご連絡させていただきます。}

ご不明点やご要望がございましたら、お気軽にお知らせください。
引き続きよろしくお願いいたします。

細谷 成
株式会社ウォーカーズ
```

#### 5-B: 2回目 MTG 後アクション

| # | アクション | 詳細 | 自動/確認 |
|---|-----------|------|----------|
| 1 | お礼メール下書き | 宛先=クライアント側。本文はテンプレ＋決定事項サマリー | 下書き（送信は naru） |
| 2 | フィードバック記録 | 案件スプシにフィードバック・修正点を書き込み | 自動 |
| 3 | 議事録ローカル保存 | `minutes/` に保存 | 自動 |
| 4 | 契約意思検出 | 「契約」「発注」「お願いします」等を検出したら `.ops/contract_signals.jsonl` に記録 | ログのみ |

**お礼メールテンプレ（2回目）**:
```
件名: 本日はお時間いただきありがとうございました

{相手の名前}様

お世話になっております。ウォーカーズの細谷です。
本日はお忙しい中、ご提案内容のご説明の機会をいただきまして誠にありがとうございました。

本日お話しした内容について改めてまとめますと:
{決定事項のサマリー（2-3行）}

{修正・追加対応がある場合: ご指摘いただいた点については、修正のうえ改めてお送りいたします。}
{見積もり送付がある場合: お見積書については、追ってお送りさせていただきます。}

ご質問やご要望がございましたら、お気軽にお知らせください。
引き続きよろしくお願いいたします。

細谷 成
株式会社ウォーカーズ
```

#### 5-C: フェーズ不明時

お礼メール下書き（汎用テンプレ）のみ実行。他のアクションはスキップ。

### Step 6: 状態記録

処理完了後、`.ops/meetings_processed.jsonl` に追記:
```jsonl
{"meetingId":"xxx","processedAt":"2026-06-18T10:00:00Z","phase":"first","client":"株式会社テクノ","meetingName":"テクノ社 1回目MTG","actions":["email_draft","calendar","sheets","minutes_local","proposal_queue"]}
```

処理結果のサマリーをコンソールに出力（`/loop` のログとして残る）。

## エラーハンドリング

| エラー | 対応 |
|--------|------|
| tl;dv API 401/403 | APIキー無効。`.ops/alerts.jsonl` に記録して終了 |
| tl;dv API タイムアウト | 次のサイクルでリトライ（状態ファイル未更新のため自動） |
| クライアント特定失敗 | `unmatched_meetings.jsonl` に退避 |
| Gmail/Calendar MCP エラー | `.ops/failed_actions.jsonl` に記録、次のサイクルでリトライ |
| 案件スプシID未設定 | スプシ書き込みスキップ、ログ出力 |

## 注意事項

- **メール送信は絶対にしない**: `draft_gmail_message`（下書き保存）のみ。`send_gmail_message` は禁止
- **議事録の保存先はローカルのみ**: Google Drive 共有フォルダには保存しない（decisions.md 2026-04-16 参照）
- **API レート**: tl;dv API のレート制限は未公開。5分間隔ポーリングなら問題ないはず
- **24時間制限**: 過去24時間以内の会議のみ処理。古い会議は意図的にスキップ
