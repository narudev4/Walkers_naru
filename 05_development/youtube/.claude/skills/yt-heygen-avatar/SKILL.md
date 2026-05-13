---
description: /yt-heygen-avatar — HeyGen改悪対策の手動切替 fallback。通常パイプライン (/yt-produce → heygen-setup.py) では各シーンの音声+配置と一緒に自動切替される。本スキルは「既に作成済みドラフトを後から修正したい」「自動切替が一部シーンで失敗した」ときの **手動 fallback** 用。Claude in Chrome (DOM経由) で巡回操作。
---

# /yt-heygen-avatar — HeyGen アバター一括切替 (手動 fallback)

> **⚠ 通常パイプラインでは自動化済み**: `/yt-produce` 経由で `heygen-setup.py` が走るとき、各シーンの
> 音声+配置の直後にモーション エンジン切替が自動実行される（Section 16 / `switch_motion_engine_avatar_iii`）。
> このスキルを直接叩く必要があるのは以下のケースのみ:
> - 既存ドラフトを後から修正したい（過去に作成済みで自動化前のドラフト）
> - 自動切替が一部シーンで失敗した（progress.json の `motion_engine_failed` リストにあるシーン）
> - パイプラインを通さず Chrome で手動編集中のドラフト

## なぜこのスキルが要るか

HeyGen が改悪され、新規ドラフト作成時に**アバターⅤ**（クレジット消費する有料アバター）が
デフォルトで全シーンに入るようになった。動画生成すると **1シーンあたりクレジットを消費する**。

回避策: 生成前に全シーンを巡回し、右パネル「モーション エンジン」配下のドロップダウンから
**アバターⅢ**（無料）に切り替える。

このスキルはその巡回操作を Claude in Chrome 経由で半自動化する。
（cron 自動化は heygen-setup.py の `switch_motion_engine_avatar_iii` を使う。Playwright CDP のほうが
DnD-kit に対しても locator click が真の mouse event を発火するので確実）

## 前提

- HeyGen エディタが Chrome タブで開いている（`heygen.com` の `create-v4` URL）
- Chrome に **Claude in Chrome 拡張**がインストール・ペアリング済み
- 全シーンの作成（PPTX アップロード）と音声・アバター配置は **完了済み**
  - 未配置のシーンがあると右パネルに「モーション エンジン」が出ない可能性あり
- 動画生成（Generate）は **まだ押していない**

> 既存の `_shared/heygen-setup.py`（CDP Chrome 経由）とは**別の Chrome**を使う可能性が高い。
> Claude in Chrome は naru の通常 Chrome、CDP 版は別ポート 9222 の専用 Chrome。
> 両方で同じドラフトを同時に開くと「The draft is being edited」ロックが出るので、
> 一方だけで作業すること。

## 入力

引数なし。スキル起動後にユーザーに以下を聞く:

| 項目 | 例 | 用途 |
|---|---|---|
| スラッグ | `what-is-make` | 進捗ファイル `projects/{slug}/heygen-avatar-progress.json` の保存先 |
| 開始シーン番号 | `1` | レジューム時に途中から再開 |

スラッグが分からない場合、HeyGen タブの URL や `projects/` 配下の最新ディレクトリから推測してユーザー確認。

## 操作フロー（1 シーンあたり）

```
1. 左パネルまたはタイムラインで シーン N をクリック
   → キャンバスにシーン N が表示される
   → 右パネルがそのシーンのプロパティに切り替わる

2. 右パネル「モーション エンジン」セクションのドロップダウンをクリック
   → 候補リスト（アバターⅠ〜Ⅴ）が展開される

3. リストから「アバター Ⅲ」を選択
   → ドロップダウンが閉じ、選択値が「アバター Ⅲ」になる

4. 選択値を読み取って検証

5. 進捗ファイルに「シーン N 完了」を追記
```

## Claude in Chrome 経由の実装方針

セレクタはハードコードしない（HeyGen UI は頻繁に変わる）。
毎回 `find` / `read_page` / `javascript_tool` で**意味的に**要素を特定する。

### 0. 起動シーケンス（順守）

1. `Read` で `projects/{slug}/heygen-avatar-progress.json` の有無を確認
2. 存在しなければ → 「初回実行。シーン 1 から開始しますか？」と確認
3. 存在すれば → ファイルを読み込み、`status` 値を含めてユーザーに状況提示（「前回 `{status}` で終わっています（completed={len}/{total}, failed={failed}）」）。続けて以下を**続けて**確認（1 メッセージ 1 質問厳守）:
   - 「未処理シーン {min(pending)} から再開しますか？」（`pending = [1..total] \ (completed ∪ failed)`）
   - `failed` が非空なら：「`failed` リスト {failed} もリトライしますか？」（空配列なら質問省略）
4. naru の回答に応じて巡回対象集合 `targets` を確定:
   - resume の場合: `targets = sorted(pending ∪ retry_failed)`（昇順、`retry_failed` は YES なら `failed`、NO なら `[]`）
   - 初回の場合: `targets = [1..total]`
5. 巡回順: `targets` の昇順固定（先頭 / 末尾の入れ替えはしない）

> `pending` の定義から `failed` を除く点が重要: failed を除外しないと Q2「failed もリトライ？」が形骸化する（NO と答えても結局拾われる）。

### 1. 接続確認

```
mcp__Claude_in_Chrome__list_connected_browsers
→ 結果が空 / エラー → 「Claude in Chrome 拡張が未接続です。Chrome を起動して拡張を有効化してください」と報告して停止
→ 該当 deviceId で mcp__Claude_in_Chrome__select_browser
mcp__Claude_in_Chrome__tabs_context_mcp で heygen.com の create-v4 タブを検索
→ 該当タブなし → 「HeyGen ドラフトを Chrome タブで開いてから再実行してください」と報告して停止
→ tabId 確保
```

### 2. シーン総数取得

`javascript_tool` で `[data-scene-item]` 数を数える:

```js
document.querySelectorAll('[data-scene-item]').length
```

### 3. シーン巡回

**ビューポート / screenshot 座標変換（必須）**:

- viewport は 1920×902 (CSS pixel)、screenshot は 1568×737 で取得される
- `computer.left_click` の `coordinate` は **screenshot 座標**
- 変換係数: `RATIO_X = 1568/1920 ≈ 0.8167`, `RATIO_Y = 737/902 ≈ 0.8170`
- DOM の `getBoundingClientRect()` は viewport 座標を返すので、`coordinate` 渡す前に変換する

各シーン番号 N について:

```js
// 視覚順（x昇順）にソートして N-1 番目を視野に入れ、中央座標（viewport）を返す
const items = [...document.querySelectorAll('[data-scene-item]')];
items.sort((a,b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
const t = items[N-1];
t.scrollIntoView({behavior:'instant', block:'nearest', inline:'center'});
const r = t.getBoundingClientRect();
({x: r.left + r.width/2, y: r.top + r.height/2})
```

返ってきた `{x, y}` を screenshot 座標に変換してから `computer.left_click` を呼ぶ:

```
mcp__Claude_in_Chrome__browser_batch actions=[
  { name: "computer", input: { action: "left_click", coordinate: [x * 0.8167, y * 0.8170], tabId } }
]
```

> **DOM `.click()` は使わない** — `data-scene-item` は DnD-kit の sortable div (`role="button"`) で、JS の `.click()` は DnD 層に食われて React に届かない（実機確認済み）。

> 注意: 仮想スクロールのため `document.querySelectorAll('[data-scene-item]')` で全シーンが取れない場合がある。
> 取得個数 < N なら一旦タイムライン領域を右端付近までスクロール（`element.scrollLeft += 大きい値`）してリトライ。

クリック後 **800ms 待機**（右パネル更新待ち）。待機は `computer.wait duration=0.8` または `javascript_tool` で `new Promise(r=>setTimeout(r, 800))` を await。

### 4. ドロップダウン操作（実機確定）

**確定セレクタ**（2026-05-13 実機検証）:

- 「モーション エンジン」ラベル: `div.tw-text-xs.tw-font-medium.tw-leading-4.tw-text-textTitle` でテキスト一致
- ドロップダウン本体: `BUTTON` で `aria-haspopup="menu"`、ラベル親の祖父孫の position（label の `parentElement.parentElement.querySelector('button[aria-haspopup="menu"]')`）。表示テキストは「アバター V」/「アバター IV」/「アバター III」
- 展開後のリスト項目: `role="menuitem"`、テキスト「アバター V (プレミアム)」「アバター IV (プレミアム)」「アバター III」「アバター II」「アバター I」（半角ローマ数字）
- 各項目の説明: 「あなたのように動きます…」（V）／「スクリプトに適応する汎用モーション」（IV）／「リップシンク と 全身モーション」（III）等

**実行フロー**:

1. `mcp__Claude_in_Chrome__find query="モーション エンジンの下にあるアバター選択ドロップダウンボタン"` → ref_id 取得
2. `computer.left_click ref=ref_X` でクリック → ドロップダウン展開
3. **400ms 待機**
4. `mcp__Claude_in_Chrome__find query="展開中のドロップダウン内のアバター III 項目（リップシンクと全身モーション）"` → ref_id 取得
5. `computer.left_click ref=ref_Y` でクリック → 選択完了
6. **500ms 待機**してから検証 §5 へ

> **ref ベースクリックを優先**: `find` が要素を一意特定できる場合は ref で click すれば座標変換不要。座標変換は data-scene-item のようにテキストが識別子になりにくいケース用。

> `mcp__computer-use__*`（OS レベル）は Chrome が read-only tier のため**使用不可**。必ず `mcp__Claude_in_Chrome__browser_batch` 内の `computer` を使う。

### 5. 検証（実機確定）

実機テキストは半角「アバター III」「アバター IV」「アバター V」（半角ローマ数字 I, V, X）。

```js
// 返り値: { ok: bool, value: string }
(() => {
  const lbl = [...document.querySelectorAll('div')].find(el =>
    /^モーション\s*エンジン$/.test((el.textContent || '').trim()) && el.children.length === 0
  );
  if (!lbl) return { ok: false, value: '' };
  const btn = lbl.parentElement?.parentElement?.querySelector('button[aria-haspopup="menu"]');
  const text = (btn?.textContent || '').trim();
  // 「アバター III」「アバター IV」「アバター V」（半角・単語境界）
  const m = text.match(/アバター\s+(III|II|IV|V|I)(?![IV])/);
  if (!m) return { ok: false, value: text };
  return { ok: m[1] === 'III', value: text };
})()
```

判定: `ok === true` を成功。`ok === false` なら `failed` に N を追記、in-memory `consecutive_failures[N]` をインクリメント。

> 半角 III の単語境界は `(?![IV])` の negative lookahead で「IV / VI 等の先頭 III」と区別する（III の直後に I/V が来ないことを要求）。

### 6. 進捗保存（厳密仕様）

**保存先**: `projects/{slug}/heygen-avatar-progress.json`

**書込タイミング**: 各シーンの「検証ステップ完了直後」に**同期上書き**（クラッシュ耐性のため）。途中で書き溜めない。

**スキーマ（固定）**:

```json
{
  "slug": "what-is-make",
  "total": 47,
  "completed": [1, 2, 3, 4, 5],
  "failed": [],
  "status": "running",
  "updated_at": "2026-05-13T10:00:00+09:00"
}
```

| フィールド | 型 | 説明 |
|---|---|---|
| `slug` | string | プロジェクトスラッグ |
| `total` | int | 全シーン数（巡回中は固定） |
| `completed` | int[] | 完了済みシーン番号（昇順）。検証 ○ で追記 |
| `failed` | int[] | 失敗シーン番号（昇順）。検証 × またはクリック失敗で追記 |
| `status` | enum | `running` / `stopped` / `completed`（下記遷移参照） |
| `updated_at` | ISO8601 | 直近上書き時刻（JST） |

**`status` 遷移ルール**:

```
[起動] → running
running → completed   （len(completed) == total かつ failed が空）
running → stopped     （ユーザー中断 / 連続失敗閾値到達 / 例外で停止）
stopped → running     （次回起動時の resume で再開）
completed → running   （ユーザーが手動でやり直し指示）
```

中断検知: Claude Code セッション側で例外発生時に `status="stopped"` で書き戻す。Ctrl+C 等で書込前に死ぬ場合は次回起動時に `running` のまま残る → 起動シーケンス §0 で「前回 running のまま終わっています、resume しますか？」と確認。

**`failed` の扱い**:

- `failed` に入る条件: ドロップダウン操作の失敗（要素非検出含む）または検証 NG。**種別は区別しない**（ログには残すが、配列上は単一の int[]）。
- retry 成功時の書込フロー（**同期、1 ファイル書込で完結**）:
  1. `failed` 配列から該当 N を削除
  2. `completed` 配列に N を昇順挿入（重複させない）
  3. `updated_at` を現在時刻に
  4. `Write` で同期上書き
- retry 失敗時: `failed` に残す（重複追加はしない）。連続失敗回数のカウントは下記参照。

## エラー時の再開ルール

巡回中に詰まったら:

1. 進捗ファイルから次着手集合を再計算（`pending = [1..total] \ (completed ∪ failed)`、`failed` は別配列）
2. 起動シーケンス §0 で resume 確認・failed retry 確認を経て続行

**連続失敗閾値（詳細）**:

各 pass で `targets` の各シーンに対し**最大 3 回まで即時リトライ**する:

- 1 回目失敗 → 即リトライ（同じシーン）。in-memory counter `{N: 1}`
- 2 回目失敗 → 即リトライ。counter `{N: 2}`
- 3 回目失敗 → そのシーンを `failed` に追加、`status="stopped"` に更新し全体停止してユーザー報告
- どこかで成功 → counter リセット、`completed` に追記、次のシーン

つまり「次のシーンへ進む」のは**3 回試行内のいずれかで成功した場合のみ**。3 回全失敗なら即停止。

retry pass（Q2 YES で failed を再度巡回）でも同じく最大 3 回まで即時リトライ。

**連続失敗カウンタの永続化**: progress.json には保存しない（**セッション内メモリのみ**）。
- 理由: 「3 回連続」は同一実行内での連続性を見たい。再起動後は実 UI 状態が変わっているので、再起動で 0 にリセットされるのが望ましい。
- 実装: スキル実行中にメモリ上の dict `{scene_num: count}` で管理。1 回成功すれば該当エントリを 0 にリセット（または削除）。
- 再起動後: failed リスト自体は永続化されるので「過去に失敗したシーン」は分かる。retry 時にこの dict は空からスタート。

> 注: 同等の `heygen-setup.py` 側は「5 回再実行」だがあちらは setup.py 全体の再起動回数、こちらは**同一シーンを連続で叩いた回数**。意味が違うので 3 回採用。

## 既知の罠（実機で踏んだら追記）

| 罠 | 対策 |
|---|---|
| シーン番号誤マッチ（10, 11 が 1 にマッチ） | `[data-scene-item]` のインデックス使用、テキスト一致は使わない |
| DOM `.click()` 無反応 | `find` → `computer.left_click` の座標クリックに切替 |
| 仮想スクロールで一部シーンが取れない | タイムラインを scrollIntoView してから取得 |
| 右パネルが前シーンのまま | シーンクリック後 1〜2 秒待機、`read_page` で現在のシーン番号を確認 |
| 「The draft is being edited」モーダル | 他の Chrome（CDP 版）で同じドラフトを開いていないか確認、開いていれば閉じる |

新しい罠を踏んだら `_shared/heygen-automation-learnings.md` にも追記。

## 使い方（ユーザー向け）

```
naru: /yt-heygen-avatar
Claude: スラッグを教えてください（例: what-is-make）。HeyGen ドラフトは Chrome で開いていますか？
naru: what-is-make。開いてる
Claude: シーン総数を取得しました: 47。シーン 1 から開始します。
[巡回開始 → 完了報告 → 失敗あれば一覧]
```

## 関連スキル・ファイル

- `/yt-heygen` — 動画生成パイプライン本体（CDP Chrome、音声＆アバター配置）
- `_shared/heygen-setup.py` — Phase 1+2 実装
- `_shared/heygen-automation-learnings.md` — HeyGen 自動化の罠集（一次資料）
- 進捗: `projects/{slug}/heygen-avatar-progress.json`
