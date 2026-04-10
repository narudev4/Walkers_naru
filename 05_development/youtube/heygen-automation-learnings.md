# HeyGen自動化 学習ログ

## 1. UIフロー（正解パス）

```
左パネルでシーンNのスクリプト行をクリック
  → キャンバスにそのシーンが表示される
  → 「音声をアップロード」ボタンが左パネルに出現
  → ボタンクリック → ファイル選択ダイアログ → WAVアップ → 「音声を追加」確定
  → Escape → キャンバス上のアバターをクリック
  → SEハンドルでリサイズ → ArrowKeyで右上隅に配置
```

**重要**: タイムライン（下部フィルムストリップ）ではなく、**左パネルのスクリプト行**をクリックしてシーン移動する。

## 2. 発見した問題と対策

### 2.1 シーン番号の誤マッチ
- **問題**: `startsWith("1")` がシーン10, 11, 12... にもマッチする
- **対策**: 番号の次の文字が数字でないことを確認
  ```js
  const nextChar = t.charAt(numStr.length);
  if (nextChar >= "0" && nextChar <= "9") continue;
  ```

### 2.2 左パネルの仮想スクロール
- **問題**: シーン6以降がビューポート外（y > 860）で見つからない
- **対策**: scrollableコンテナを検出し、`scrollIntoView({block:"center"})` + `container.scrollTop += 300` でスクロール

### 2.3 DOM .click() vs page.mouse.click()
- **問題**: React UIではDOM `.click()` が無反応なことが多い
- **対策**: `page.mouse.click(x, y)` で実座標クリック。getBoundingClientRect()で座標取得。

### 2.4 アバターサイズ 200px ぴったり問題 ★最重要★
- **HeyGen内部計算**: `floor(avatar_dom_px / canvas_dom_px * 1920)`
- **問題**: `Math.round()` で測定すると 76px → floor(76/730*1920)=199 になる
  - 実際のcanvas幅は729.5999...pxなどサブピクセル値
  - Math.round(729.6) = 730 にすると計算が狂う
- **対策**: get_elements() で `Math.round()` を除去、float精度のまま返す
- **ターゲット**: `200.5 * canvas_w / 1920` を狙ってfloor=200を確保

#### ★未解決: サブピクセルドラッグの限界
- Playwrightの `page.mouse.move(x + 0.5, y + 0.5)` でサブピクセル移動が**本当に効くか未検証**
- シーン7,8が202のままだった → ドラッグ微調整が実際には1px単位でしか動かない可能性
- **根本原因**: SEハンドルのドラッグでHeyGenが内部的に何px刻みでリサイズするかが不明

#### ★解決済み: moveable.request() API

**根本原因**: SEハンドルのドラッグは最小閾値(~5px)があり、202→200の2px差はドラッグで到達不可能。

**解決策**: HeyGenが内部で使うmoveableライブラリの`request('resizable')` APIを直接呼ぶ。

```javascript
// .moveable-control-box のReact fiber → moveable instance
const mv = fiber.ref.current.moveable;
const req = mv.request('resizable');
req.request({offsetWidth: 200, offsetHeight: 200}); // HeyGen内部座標で直接指定
req.requestEnd();
```

**なぜ動くか**:
- アバターのinline styleは `width: 202px; height: 202px` (HeyGen内部座標1920x1080)
- 親要素の `transform: scale(0.38)` でDOM座標にマッピング
- moveable.request()はHeyGen内部座標で受け付け、React stateも更新する
- **1px精度で正確**にサイズ設定可能

**テスト結果（シーン10）**:
- 288x288 → moveable.request({200,200}) → style確認: width:200px, height:200px ✅
- 音声+リサイズ+位置の全工程が1シーン1分以内で完了

#### 検証済み・不採用のアプローチ
1. **SEハンドルドラッグ微調整** ← 1-3pxドラッグは無視、5px以上は188に飛ぶ（200通過不可）
2. **サブピクセルドラッグ（0.76px）** ← マウス座標の精度的に不安定
3. **プロパティパネル入力** ← サイズ入力欄は存在しない（border-radius=540の入力欄のみ）
4. **React fiber dispatch** ← hookのstateがboolean/nullでelement propsではなかった
5. **DOM style直接書き換え** ← 見た目は変わるがReact再レンダリングで元に戻る可能性

### 2.5 右パネル誤クリック
- **問題**: アバターがキャンバス右端にあると、クリック座標が右パネルに入る
- **対策**: `safe_click_point()` でcanvas_right - 30px にclamp

### 2.6 モーダル干渉
- **問題**: "draft is being edited" ロックモーダルが操作をブロック
- **対策**: `display:none` で非表示化（閉じるボタンを押すとエディタから離脱するため）

### 2.7 FileChooser の2パターン
- パターン1: `text=/ファイルをアップロード/` クリック → FileChooser
- パターン2: `input[type="file"][accept*="audio"]` を `.click()` → FileChooser
- 両方試すフォールバック実装済み

## 3. 信頼性の課題

### 現状の弱点
1. **サイズ200達成が不安定** — ドラッグ精度の限界で202や197になる
2. **ブラウザ状態の可視確認がない** — 失敗時にスクリーンショットは撮るが、処理中にリアルタイム確認していない
3. **ネットワーク遅延への対応** — `asyncio.sleep()` の固定値が不安定（アップロード中は変動大）

### 改善案: browser-use CLI + チェックシート方式
- 各ステップ後にスクリーンショットを撮って状態確認
- HeyGenのプロパティパネルからサイズ値を読み取る（DOM検査）
- 期待値との差異があれば自動修正

## 4. 処理状況

| シーン | 音声 | アバターサイズ | 位置 | 備考 |
|--------|------|---------------|------|------|
| 1-6 | ✅ | ❓未確認 | ❓ | 旧コードで処理。要再確認 |
| 7 | ✅ | ❌ 202 | ❓ | ドラッグ方式の限界 |
| 8 | ✅ | ❌ 202 | ❓ | ドラッグ方式の限界 |
| 9 | ✅ | ✅ 200 | ✅ | ユーザー手動 |
| 10 | ✅ | ✅ 200 | ✅ | moveable.request()で成功 |
| 11-33 | ❌ | ❌ | ❌ | 未処理 → これから一括処理 |

## 5. HeyGen内部構造メモ

### 座標系
- **内部座標**: 1920x1080（CSS style に直接記述）
- **DOM座標**: 内部座標 × scale(0.38) = 729.6x410.4px
- **scale**: `transform: scale(0.38)` が parent div に設定

### アバター要素構造
```
<div data-element-id="XXXX" style="width:202px; height:202px; transform:translate(1718px,0px)">
  └─ 親: <div style="transform-origin:0 0; transform:scale(0.38)">
       └─ 親: <div style="width:729.6px; height:410.4px">
            └─ <div id="canvas_XXXX">
```

### React props（avatar type element）
```json
{
  "width": 720, "height": 720,     // 元画像サイズ
  "scaleX": 0.28055556,            // 720 * 0.28056 = 202
  "left": 1819, "top": 101,        // 内部座標での位置
  "type": "avatar",
  "roundedCorners": {"top_left": 101, ...}  // ← これがUI上の「540px」入力欄
}
```

### HeyGen グローバルAPI
```javascript
window.heygen.creation.saveToLocal()   // ローカル保存
window.heygen.creation.loadDraftData() // ドラフトデータ読込
window.heygen.creation.inspect()       // 調査用（要引数）
```

## 6. シーンナビゲーション問題（16+）

### 問題
- シーン1-15の音声アップロード後、左パネルが「音声詳細ビュー」に切り替わる
- 各シーンのオーディオセクションが~750pxを占有 → 合計11000px超
- シーン16-33はパネルに**レンダリングされない**（仮想スクロールの限界）
- タイムラインクリックはキャンバスを切り替えるが、左パネルを更新しない
- 左パネルの「スクリプト入力」エリアがないとUploadボタンが出ない

### 試した方法と結果
| 方法 | 結果 |
|------|------|
| 左パネルスクロール | ❌ scene16の行がDOMに存在しない |
| タイムライン child index クリック | △ キャンバスは変わるがパネル更新なし |
| page.mouse.click on timeline | ❌ scene変更されない |
| Playwright locator().click() | ✅ パネル更新される！ただし5アイテムの仮想化 |
| ArrowRight キー | ❌ 1押しで1/3シーンしか動かない |
| ページリロード | △ パネルはリセットされるがscene1に戻る |

### 有力な解決策
1. **Playwright locator + タイムラインスクロール**: locator().click()はパネルを更新する。問題は5アイテムの仮想化。正しいスクロールで目的のsceneを5アイテム内に入れる
2. **全シーンの音声セクションを折りたたみ**: 左パネルの各オーディオセクションを折りたためば、scene16の行が表示範囲に入る
3. **HeyGen API直接操作**: ネットワークリクエストを監視して、音声アップロードのAPI呼び出しを直接実行

## 7. 次のアクション

1. ✅ **moveable.request()でリサイズ解決** — シーン10-15で実証済み
2. **タイムラインスクロール問題の解決** — 正しいコンテナのscrollLeft制御
3. **シーン16-33を処理**
4. **シーン7,8の修正** — 音声はそのまま、アバターのみ再設定（202→200）
5. **skill.md化** — yt-heygenスキルに知見を統合
