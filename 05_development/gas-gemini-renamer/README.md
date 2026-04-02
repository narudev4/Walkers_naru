# Gemini議事録 自動リネーマー (Google Apps Script)

Google MeetのGemini自動生成メモのタイトルを、カレンダーのイベント名と照合して自動リネームする。

## セットアップ手順

### 1. Google Apps Script プロジェクト作成

1. [script.google.com](https://script.google.com) にアクセス
2. 「新しいプロジェクト」をクリック
3. プロジェクト名を「Gemini議事録リネーマー」に変更

### 2. コードをコピー

1. デフォルトの `Code.gs` の内容を全て削除
2. `Code.gs` の内容をコピー＆ペースト
3. 保存（Ctrl+S）

### 3. 権限を承認

1. `testDryRun` 関数を選択して実行ボタン（▶）をクリック
2. 「承認が必要です」ダイアログが表示される
3. 「権限を確認」→ Googleアカウントを選択
4. 「詳細」→「(プロジェクト名)に移動」をクリック
5. 必要な権限:
   - Google Drive: ファイルの検索・リネーム
   - Google Calendar: イベントの読み取り
   - Apps Script: トリガー管理

### 4. ドライランで確認

1. `testDryRun` を実行
2. 「実行ログ」（Ctrl+Enter）で照合結果を確認
3. マッチングが正しいことを確認

### 5. 既存メモを一括リネーム

1. `batchRenameAll` を実行
2. ログで結果を確認

### 6. 自動実行トリガーを設定

1. `setupTrigger` を実行
2. 以降、30分ごとに新しいGeminiメモが自動リネームされる

## 関数一覧

| 関数 | 用途 |
|------|------|
| `testDryRun()` | リネームせず照合結果だけ表示（テスト用） |
| `batchRenameAll()` | 未リネームのメモを一括リネーム |
| `setupTrigger()` | 30分おきの自動実行を設定 |
| `removeTrigger()` | 自動実行を停止 |
| `autoRenameGeminiNotes()` | メイン処理（トリガーから呼ばれる） |

## 命名ルール

- **顧客MTG**: `【顧客名】MTG (M/D)` — 例: `【国永紙業 三橋様】MTG (2/16)`
- **社内/その他**: `【イベント名】(M/D)` — 例: `【PABLO】(2/24)`
- **一致なし**: リネームしない（次回の実行で再試行）

## カスタマイズ

`CONFIG` オブジェクトで以下を調整可能:

- `calendars`: チェックするカレンダーIDの追加・削除
- `excludePatterns`: 除外するイベント名パターン
- `matchWindowMinutes`: 時間照合のズレ許容範囲
- `triggerIntervalMinutes`: 自動実行の間隔
- `lookbackDays`: 何日前まで遡って処理するか
