---
description: データをブラウザで表示・編集可能な自己完結型HTMLを動的生成
---

# GUI表示・編集

トリガー: 「GUIで見せて」「ブラウザで編集」「可視化して」「ダッシュボード」「GUIで」

## 入力
$ARGUMENTS

## 概要
ユーザーのリクエストに応じて、データをファイル/MCP等から取得し、
ブラウザで表示・編集可能な自己完結型HTMLを動的に生成する。
ユーザーがGUI上でデータを変更すると、JSONファイルとしてローカルに保存される。
そのJSONをAIが読むことで、変更内容を把握できる。

## 実行手順

### Phase 1: 既存の変更を取り込む

1. `output/gui/state/` ディレクトリに対象のstate JSONファイルがあるか確認する
2. 存在する場合、JSONを読み込み、`changes` 配列を確認する
3. 変更がある場合、ユーザーに表示して反映するか確認する:
   - 「ブラウザで以下の変更がありました:」
   - 各変更を箇条書きで表示
   - 「元のファイルに反映しますか？」
4. 承認されたら、対応するソースファイル（例: `04_sales/pipeline.md`）を更新する
5. state JSONの `changes` 配列をクリアする

### Phase 2: 可視化タイプを特定

ユーザーのリクエストから適切な表示形式を判断する:

| キーワード | タイプ | データソース |
|-----------|--------|-------------|
| パイプライン / 営業 | kanban | `04_sales/pipeline.md` |
| スケジュール / 予定 / 日報 | calendar/table | DAILY.md + Google Calendar |
| 経理 / 財務 / 売上 | chart + metric | `02_finance/` + Google Sheets + Misoca |
| 案件 / プロジェクト {名} | card + timeline | `03_projects/{名}/` + Google Docs |
| タスク / Issue | table | GitHub Issues + Notion |
| 汎用データ | table / card | ユーザーが指定したデータ |

不明な場合はユーザーにヒアリングする。

### Phase 3: データ収集

対象データソースからデータを取得する:
- ローカルファイル: Read ツールで読み込み
- Gmail: `gmail_search_messages` / `gmail_read_message`
- Google Calendar: `gcal_list_events` / `gcal_get_event`
- Google Sheets: `google_sheets_read` / `google_sheets_get_info` でスプレッドシートデータ取得（シートIDが不明な場合は `google_drive_search` で検索）
- Google Docs: `google_docs_get` でドキュメント取得（ドキュメントIDが不明な場合は `google_drive_search` で検索）
- Notion: MCP ツール（`API-post-search`, `API-query-data-source` 等）
- GitHub: MCP ツール（`list_issues` 等）
- Misoca: `misoca_list_invoices` / `misoca_list_estimates` 等

### Phase 4: HTML生成

**gui-core.js / gui-style.css の Read は不要。** 外部ファイルとして `output/gui/` に配置済み。

以下の構造で軽量HTMLファイルを生成する（データ＋レンダリングロジックのみ）:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{タイトル} - Walkers</title>
<link rel="stylesheet" href="gui-style.css">
<style>
/* ページ固有のスタイルのみ（必要な場合） */
</style>
</head>
<body>
<main class="wg-main" id="app"></main>
<script src="gui-core.js"></script>
<script>
// データを直接埋め込み
const DATA = { /* 取得したデータをJSON形式で埋め込み */ };

// WalkersGUI インスタンス生成
const gui = new WalkersGUI('{stateFileId}', { data: DATA });
document.getElementById('wg-page-title').textContent = '{タイトル}';

// ページ固有のレンダリングロジック
function render() {
  // タイプに応じたUI構築コード
}
render();
</script>
</body>
</html>
```

**重要ルール:**
- **共通CSS/JSはReadせず外部参照**（`href="gui-style.css"` / `src="gui-core.js"`）
- ページ固有のスタイルのみ `<style>` タグに記述
- データは `const DATA = {...}` としてJavaScript内に埋め込み
- 編集可能フィールドは `gui.updateData(path, value)` で変更追跡
- セレクトボックスは `gui.createSelect()` で生成
- テキスト編集は `contentEditable` + blur イベントで追跡
- ドラッグ&ドロップはHTML5 Drag and Drop APIで実装
- file:// プロトコルで完全に動作すること
- 参考実装: `output/gui/pipeline.html`

### Phase 5: 保存・表示

1. HTMLを `output/gui/{name}.html` に Write で保存する
2. Bashツールで `start "" "C:/Users/owner/Walkers_full/output/gui/{name}.html"` を実行してブラウザで自動的に開く
3. ユーザーに以下を伝える:
   - 「ブラウザで開きました」
   - URL: `file:///C:/Users/owner/Walkers_full/output/gui/{name}.html`
   - 「データを編集できます。編集後は右上の『保存』ボタンをクリックしてください」
   - 「Chromeの場合: 初回のみ保存先を選択 → `output/gui/state/` フォルダを選んでください」
   - 「保存後、こちらに戻って『変更を取り込んで』と伝えてください」

### Phase 6: 変更の取り込み（ユーザーが戻ってきた時）

ユーザーが「変更を取り込んで」「更新して」「反映して」と言った場合:

1. `output/gui/state/{name}.state.json` を Read で読む
2. 見つからない場合、`~/Downloads/{name}.state.json` も確認する
3. `_meta.savedVia` を確認:
   - `fileSystemAccess`: ファイルが直接存在
   - `download`: Downloads フォルダから読み込み
   - `clipboard`: ユーザーにペーストを依頼、テキストをJSON.parseする
4. `changes` 配列の各項目をユーザーに表示:
   - `path`: 変更箇所
   - `oldValue` → `newValue`: 変更内容
5. ユーザーの承認後、対応するソースファイルを更新する
6. `00_context/memories/` も必要に応じて更新する

## コンポーネントパターン

### カンバンボード（kanban）
- ステータス別のカラム表示
- カードのドラッグ&ドロップでステータス変更
- カード内のフィールド直接編集
- メトリクス表示（案件数、優先度高の数等）
- 参考実装: `output/gui/pipeline.html`

### データテーブル（table）
- ソート可能カラム
- セル直接編集（contentEditable）
- 行の追加・削除ボタン
- フィルタ機能

### チャート（chart）
- SVGまたはCanvasで描画（CDN不要）
- 棒グラフ、折れ線グラフ、円グラフ
- データポイントのホバーツールチップ
- データ値の直接編集

### カレンダー（calendar）
- CSS Gridベースの週次/月次ビュー
- イベントの色分け
- イベントクリックで詳細表示

### カード（card）
- プロジェクト概要表示
- ステータスバッジ
- タイムライン表示
- メモ・コメント編集

## ファイル命名規則

- HTML: `output/gui/{name}.html`
- State JSON: `output/gui/state/{name}.state.json`
- name例: `pipeline`, `schedule`, `finance`, `project-kuniei`, `tasks`

## 注意事項
- データ量が大きい場合は、主要な情報のみをGUIに含め、詳細は折りたたみにする
- 全てのテキストは日本語で表示する
- レスポンシブ対応にする（モバイルでも閲覧可能）
- 印刷にも対応する（@media print でボタン等を非表示）
- file://プロトコルで動作するため、fetch()やXHRは使わない
