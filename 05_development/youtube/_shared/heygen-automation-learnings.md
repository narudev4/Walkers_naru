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

> ⚠ **2026-05-07 訂正**: 当初「左パネルのスクリプト行をクリック」が正解とされていたが、
> Section 14 の白紙シーン誤生成事故を受けて **タイムライン経由 (`click_scene_by_timeline`)
> が主軸**に変更。Playwright `locator().click()` ならタイムライン経由でも左パネルは
> 正しく更新される（下記検証結果の ✅ 行が根拠）。以下は当時の調査ログとして残す。

### 問題
- シーン1-15の音声アップロード後、左パネルが「音声詳細ビュー」に切り替わる
- 各シーンのオーディオセクションが~750pxを占有 → 合計11000px超
- シーン16-33はパネルに**レンダリングされない**（仮想スクロールの限界）
- タイムラインクリックはキャンバスを切り替えるが、左パネルを更新しない（page.mouse.click 限定の罠）
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

## 8. Phase 0 Playwright CDP化（2026-04-23）

### 背景
- 旧 `phase_0_upload_pptx_bu()` は browser-use CLI の state-text マッチング依存で、Shadow DOM / モーダル遷移 / 言語切替に弱く `what-is-framer` で失敗（[4/6] Speaker notes 未検出）
- Phase 1+2 はすでに Playwright CDP で安定稼働していたため、Phase 0 を同じ流儀に統一

### 決定版: `phase_0_upload_pptx_cdp()`
全工程を Playwright CDP の単一ドライバに統一。`browser-use` CLI 依存コード（`_bu_run` / `_bu_find_index` / `phase_0_upload_pptx_bu`）を削除。

#### 主要セレクタ（実測で確定）
| ステップ | セレクタ | 備考 |
|---------|---------|------|
| PPTX上げ | `input[type="file"][accept*="pptx"]` → `set_input_files()` | FileChooser 回避・ファイル直挿し |
| 設定UI出現待ち | `[role="switch"], button:has-text("Use speaker notes"), button:has-text("スピーカー")` | これが出るまで最大60秒 |
| トグルOFF | `[role="switch"][aria-checked="true"]` | `aria-checked=false` 化を確認 |
| Speaker notes | `button:has-text("Use speaker notes as your script")` | 英UI・日UI両方のorで拾う |
| No Avatarカード | `button:has-text("No Avatar"), button:has-text("Add avatar"), button:has-text("アバターを追加")` | 右パネル展開のトリガ |
| My Avatarsタブ | `button:has-text("My Avatars"), button:has-text("自分のアバター")` | **既にactiveなら押さない**（判定必須） |
| アバターカード | `img[alt*="本番用"][alt*="山口鳳汰"][alt*="背景リアル"][alt*="スーツ見える"]` | 多属性含有で他verと区別 |
| クリック対象 | imgの祖先 `xpath=ancestor::div[contains(@class,"cursor-pointer")][1]` | 実クリッカブルな親カード |
| Create Video | `button:has-text("Create Video"), button:has-text("動画を作成")` | `is_disabled()` チェック必須 |
| エディタ到達 | `page.wait_for_url(lambda url: "create-v4" in url)` | 最大90秒 |

### 踏んだ罠と対策

#### 8.1 「本番用」アバターが類似名と衝突
お気に入りに以下3つが共存:
- `本番用：山口鳳汰(背景リアル&スーツ見えるver)` ← **狙い**
- `山口鳳汰(背景リアル&スーツ見える&顔を書くver)`
- `山口鳳汰(背景リアル&スーツ見える&顔の動きのみ)`

**対策**: `[alt*="本番用"][alt*="山口鳳汰"][alt*="背景リアル"][alt*="スーツ見える"]` の多段属性含有セレクタで一意特定。`本番用` プレフィックス有無で区別する。

#### 8.2 My Avatars タブを既にactiveなのに再クリック
タブが既に選択状態でも `my_tab.click()` を無条件に呼ぶと副作用（スクロールリセット・パネル再描画）で後続の `count()` が 0 に落ちる。

**対策**: `aria-selected` / `data-state=active` / `aria-pressed` / class に `active` / `borderBottomWidth !== '0px'` のいずれかで判定し、非アクティブ時のみクリック。

#### 8.3 `count()` の即時 0 問題
タブ切替直後に `await page.locator('img[alt*="本番用"]').first.count()` を呼ぶと、パネル再レンダリング中で 0 が返ることがある（固定 sleep では不安定）。

**対策**: `locator.wait_for(state="attached", timeout=15_000)` で明示待機。失敗時は `page.screenshot()` + パネル内 img alt 一覧を print するデバッグ出力を残す。

#### 8.4 `page.goto()` で SPA 内ナビを壊さない
Phase 0 は既に開いている HeyGen タブを再利用する設計。`ppt-to-video` 以外にいる場合のみ `goto()` し、それ以外はそのタブを使う。既存タブの中途状態をリセットしたい時だけ手動で reload する。

### 成果
- `what-is-framer` で Phase 0 が全6ステップ完走、`create-v4/47a4443f...` URL 到達を確認（2026-04-23）
- browser-use CLI 依存削除で、Phase 0 と Phase 1+2 が同じ `connect_over_cdp` ロジックに統一
- 非標準CDPポート時は `HEYGEN_CDP_URL=http://localhost:<port>` で指定可能

## 9. シーン1アクティブ状態罠 & scrollTopリセット削除（2026-04-23）

### 9.1 create-v4 遷移直後、シーン1行は「番号 span が消えた展開状態」

- Phase 0 完了 → `create-v4/...` に遷移した瞬間、**シーン1はアクティブ**で右パネルに「シーン1」が表示され、左パネルのシーン1行は展開プレースホルダ化している
- このとき左パネル左端の番号 span は **2〜47 しか DOM に存在しない**（`textContent === "1"` の span が描画されない）
- `click_next_unprocessed_script(page, expected_num=1)` の span 検索が永遠にヒットせず、末端までスクロールして「シーン1未検出」で失敗
- DOM 検証で確認: reload 後 `left-edge number spans = [2, 3, ..., 47]`、`_read_right_panel_scene_num() = 1`、`"音声をアップロード"` ボタンが `x=68, y=162` で可視

### 9.2 対策: 既アクティブ判定で early-return

`click_next_unprocessed_script` 冒頭に追加:
```python
if expected_num is not None:
    current = await _read_right_panel_scene_num(page)
    if current == expected_num:
        print(f"  [nav] シーン{expected_num}は既にアクティブ — スキップ", flush=True)
        return True, expected_num
```

**なぜ sister 関数 `click_scene_script` では発生していなかったか**: そちらは L471-474 に「番号="1" かつ y<220 かつ "音声をアップロード" テキスト」という active 状態フォールバックが組まれていた。`click_next_unprocessed_script` にはこれがなかった。

### 9.3 scrollTop=0 リセットは単調処理では無駄

- main ループは `range(START_SCENE, end+1)` の**単調増加のみ**で、後戻りしない
- 各 nav 呼び出しで scrollTop=0 に戻すと、既に処理済みのシーン位置を再スクロールすることになり ~0.6〜1s の純粋な無駄
- 既存の「span 見つからなければ 400px 下スクロール」フォールバックで十分カバーできる
- 削除した結果: 47 シーンで ~30〜50s 短縮、動作変化なし

### 9.4 教訓

- **アクティブ判定は右パネル読取が一次情報**。左パネルの DOM 構造（span 有無）はアクティブ状態で変わるので、左パネルだけ見て判断すると詰む
- **sister 関数の違いを比較する**。同じ UI 操作をする関数が複数あり、片方だけにフォールバックが入っているケースは「過去に誰かが踏んだ罠の痕跡」。差分から仕様を逆引きする
- **"末端までスクロール" は誤判定のサイン**。探索対象が「そこにある前提」ではないかを疑う

## 10. nav 速度最適化 α+β（2026-04-28）

### 10.1 背景
ユーザーが nav のスクロール時間を体感し「scroll が遅い、辞めたい」とリクエスト。検証で「scroll-free な click は React の actionability check 制約で不可」と判明したため、scroll は残しつつ周辺の固定 wait と scroll behavior を圧縮した。

### 10.2 効果
scene 20→30 の 11 シーン処理で **約 22 秒/シーン**（最適化前は約 42 秒/シーン）。**約 50% 短縮**。

### 10.3 変更箇所
| 関数 | 変更内容 |
|------|---------|
| `click_scene_by_timeline` | α: `scroll_into_view_if_needed()` を JS の `el.scrollIntoView({behavior: 'instant', block: 'nearest', inline: 'center'})` に置換（smooth → instant）／ β: sleep 0.3→0.05、2.0→0.5、0.6→0.2 |
| `click_next_unprocessed_script` | β: sleep 0.3→0.1、ポーリング間隔 0.4→0.15、0.5→0.15 |
| `click_scene_script` | β: `if scroll_try == 0: scrollTop = 0` を **削除**（main loop は単調増加で戻る必要なし。9.3 と同じ理屈の click_scene_script 版未対応箇所）／ sleep 2.5→0.5、0.3→0.1 |

### 10.4 検証済み・不採用のアプローチ
| 案 | 結果 |
|----|------|
| Playwright `click(force=True)` | scroll 自体は Playwright が auto-scroll するため消えない |
| `el.click()` (DOM API) | scroll は消えるが React click handler が発火せずシーン未切替 |
| `dispatchEvent(MouseEvent)` | scroll が起きる |

→ React の actionability 制約を回避できないため、scroll-free 化は断念。代わりに scroll を instant 化＋wait 圧縮で約半分にした。

### 10.5 教訓
- **「scroll が遅い」の真因は scroll 距離より scroll の behavior（smooth）と前後の固定 wait**。爆速 instant に変えるだけで体感が大きく変わる
- **scroll を消す ≠ scroll behavior を変える**。後者の方が現実的に効く
- **sleep 値はキリよく短くするより、UI が安定する最小値を実機で探る**。今回は polling 間隔 0.15s が安定上限

## 11. ナビゲーション検証エラーは「同じコマンドで再実行すれば必ず通る」（2026-04-29）

### 11.1 現象（claudecode-entrepreneur 28シーン処理時）
- シーン1〜10は完全成功
- シーン11ナビ時に `⚠ HeyGenシーン10 ≠ scene_num=11 — ずれ懸念で中断` が発火して停止
- **`HEYGEN_START=11` で1回目再実行 → 同じ場所で同じエラーで停止**
- **`HEYGEN_START=11` で2回目再実行 → スルッと通って残り18シーン全部成功**

ログ証拠（成功時の最終サマリ）:
```
完了済み合計: 28/28
失敗シーン: [11, 11]   ← 1回目と2回目の失敗が記録されているが、3回目で全シーン処理済み
```

### 11.2 原因（推定）
- `click_next_unprocessed_script` の `_read_right_panel_scene_num()` が前シーン(=10)を返す
- HeyGen側の右パネル更新が遅延することがあり、ナビゲーション検証関数が「シーン番号がずれている」と誤判定する
- ブラウザを再操作（再実行）すると、HeyGenの内部state機械が次シーンに進んでいるため通る
- 終盤（シーン27, 28）でも `[nav] click_scene_script失敗 → タイムラインクリックにフォールバック` が走ったが、フォールバックが正しく機能して全シーン処理完了

### 11.3 鉄則: 1回目失敗でユーザーに相談するな、再実行しろ
**過去の SKILL.md / CLAUDE.md には「同じ場所で詰まる場合のみユーザーに相談」と書いてあったが、これは弱すぎる規約。**
今回のように1回目と2回目が同じエラーでも、再実行で勝手に通るケースが実証された。

**現行の運用ルール（SKILL.md / CLAUDE.md と同期）:**
- `HEYGEN_START=N` で **最大5回再実行**（カウント起点: `HEYGEN_START=N` を叩いて失敗した回数）
- **5回試しても同じ場所で詰まる場合のみ** ユーザーに報告
- 1〜4回目の失敗で立ち止まってユーザーに「ブラウザで手動操作してください」と頼むのは時間の無駄

※ 本セクション初稿（2026-04-29）には「3回連続で報告」と記載していたが、後に「最大5回」へ統一（2026-04-29 追記）。実例（11.1）は2回目で抜けたが、安全マージンを見て5回まで許容する運用に揃えた。

### 11.4 教訓
- **HeyGen の UI state は再実行で「自分で進む」性質がある**。中途半端な状態で停止しても、もう一度叩けば次に進める
- **失敗シーンログの重複（[11, 11]）は失敗ではなく "リトライの履歴"**。最終 `完了済み合計: N/N` だけ見れば良い
- **既知の中断条件は「コードのバグ」ではなく「再実行で抜けるための保険」**。むやみに条件を緩めると別の場所で破綻する

## 12. heygen-bgm-setup.py の罠（2026-05-07）

`_shared/heygen-bgm-setup.py`（BGM 自動設定: Volume 1% + Loop ON）の実装中に踏んだ罠。

### 12.1 「Upload processing」の長い待ち時間 → wait_for_upload_completion の race condition

**症状**: アップロード後すぐに `find_my_music_track` を叩いていて、まだ processing 状態の track を「成功した」と誤検出してクリック → 何も起きない。

**原因**:
- HeyGen の音楽アップロードは **30秒以上** processing 状態が続くケースがある
- アップロード直後は **まだ processing UI すら出ていない** こともあり、「track 無し」を「アップ失敗」と誤認しがち
- その間にスクリプトが先走って次の処理へ行くと、context menu が開かない／クリック対象がずれる

**対策**: 3 フェーズで待つ
- **Phase A**: アップロード直後、`is_upload_processing()` で processing UI が**出るまで** 10秒待機（出始めを保証）
- **Phase B**: processing UI が**消えるまで** 最大 180秒待機
- **Phase C**: track 出現確認後にさらに 5秒安定化待機（DOM がフラついて click 対象がずれるのを防ぐ）

### 12.2 timeline 下部 audio bar の右クリック target_x（z-index overlay）

**症状**: `find_audio_bar_position` が返した座標で右クリックしても context menu が開かない。

**原因**: timeline 下部、左側 (x=20-540 程度) に「シーンを追加」 button (`tw-size-10`, 40x40) が overlay されており、bar より z-index が高い。bar 検出 (tw-cursor-pointer + width 最大) 自体は正しくても、クリック座標が button 領域に重なると button にヒットして bar への右クリックにならない。

**probe ログ（elementFromPoint）**:
```
(500,931): <button> ''  cls='tw-flex tw-size-10 tw-cursor-pointer ...'   ← button overlay
(600,931): <div>    'Audiio____.wav'  cls='tw-z-10 tw-flex ...'         ← bar 本体
(800,931): <div>    'Audiio____.wav'  cls='tw-z-10 tw-flex ...'
(1000,931): <div>   'Audiio____.wav'  cls='tw-z-10 tw-flex ...'
```

**対策**: `target_x = Math.max(600, Math.min(1500, bar.x + 350))`
- 初版は `Math.max(500, ...)` だったが (500,931) はまだ button 領域。600 まで上げて bar div (`tw-z-10 tw-flex`) に確実に着地させる。
- bar.x は画面外まで伸びる (例: x=-3941, w=6184) ことがあるので、`bar.x + 350` ではなく **絶対座標 600 を最低値に固定** することが重要。

### 12.3 教訓
- HeyGen のアップロード系は「処理開始の確認」と「処理完了の確認」を分けて待つ。即時ポーリングは race condition を生む
- timeline 下部は他の操作 button (シーン追加・分割等) が overlay している。クリック座標は **DOM の幾何学だけでなく z-index も考慮**する必要があり、必ず `elementFromPoint` で実際にヒットする要素を probe してから採用すること

## 13. アバター選択後の Create Video モーダル詰まり問題（2026-05-07）

### 13.1 現象
- Phase 0 の `[5/6] アバター選択 → ✓ アバター選択完了` までは進む
- `[6/6] Create Video` ボタンクリックで `Locator.click: Timeout 30000ms exceeded`
- エラー詳細に `<div data-state="open" class="tw-fixed tw-inset-0 tw-stack-dialog tw-bg-black/60 ... tw-backdrop-blur-sm"> intercepts pointer events`
- 5回連続で同じ場所で詰まる（Section 11 の「再実行で抜ける」性質も効かない）

### 13.2 原因
- HeyGen UI 変更（2026-05 頃）: アバターカードを 1 回クリックすると **拡大モーダル**（アバター詳細モーダル）が開く設計に変わった
- 旧仕様: 1 クリックで「選択確定」→ Create Video ボタンが押せる状態
- 新仕様: 1 クリックで「拡大モーダル展開」→ モーダルが Create Video ボタンを覆う → 2 回目操作が必要
- スクリプトはアバター選択 click() 後にすぐ Create Video を押そうとするが、拡大モーダルがオーバーレイになって阻害

### 13.3 解決策（実証済み・2026-05-07・訂正済み）
**アバター選択完了後に「拡大モーダル内のアバターカード」を再クリックして選択を確定する**。

⚠️ **当初 ESC でモーダルを閉じる方法を試したが、ESC は「キャンセル相当」で選択未確定のままになる罠あり**（[5/6] の click() は「拡大モーダル展開」だけで選択確定ではない）。ESC 後 Create Video は押せるが、HeyGen 側は「アバターなし」状態でビデオ作成を始める → **エディタにはアバターなし・デフォルト英語ボイス（Annie - Lifelike）・PPTX のシーン分解が中途半端（5 シーンだけ・後半は空）な状態**になる。

```python
# アバター選択後（Phase 0 の [5/6] 直後）
await locator.click()  # 1回目: 拡大モーダル展開（選択は未確定）
await asyncio.sleep(0.5)
# 拡大モーダル内のアバター img は alt="山口鳳汰(背景リアル&スーツ見えるver)" 形式
# (Phase 0 一覧画面の "本番用：..." プレフィックス付きとは異なる)
expanded_avatar = page.locator('img[alt*="山口鳳汰"][alt*="背景リアル"]').last
await expanded_avatar.click()  # 2回目: 拡大モーダル内のアバター再クリック = 選択確定
await asyncio.sleep(1.5)
# その後 [6/6] Create Video → 正しくアバター付きエディタが作られる
```

### 13.4 検証済み・不採用のアプローチ
1. **ESC でモーダル閉じる** ← Create Video は押せるが選択確定されず、結果アバターなしエディタ。**最重要罠**
2. **Phase 0 一覧画面のセレクタ `img[alt*="本番用"][alt*="山口鳳汰"][alt*="背景リアル"][alt*="スーツ見える"]` を拡大モーダル内に流用** ← 拡大モーダル内の alt は `"山口鳳汰(背景リアル&スーツ見えるver)"` で `本番用` プレフィックスが消えるためヒットしない。`[alt*="山口鳳汰"][alt*="背景リアル"]` に緩めること
3. **CDP Chrome 再起動でクリーン化** ← UI 変更自体は永続なので無効
4. **HEYGEN_START 系統 5 回リトライ** ← UI 変更由来で再実行では抜けない（Section 11 とは性質が違う）

### 13.5 教訓
- **「ESC でモーダル閉じる」≠「選択確定」**。UI のモーダルは「キャンセル」「確定」が別経路の場合があり、ESC 後の状態を「選択完了」と誤認するのは危険。Section 8.1 の「タブ状態判定」とは性質が違う
- **アバター選択のような「選択確定操作」は単発 click() で済まない**。設計思想が「1クリック=ハイライト/展開、2クリック=確定」に変わったケース
- **拡大モーダル内のアバター img の alt は一覧画面と異なる**（`本番用` プレフィックスが消える）。セレクタを `[alt*="山口鳳汰"][alt*="背景リアル"]` に緩める必要
- **「アバターなしエディタ」の症状**: 右パネル「アバターなし」「アバターを追加」表示・ボイスが Annie - Lifelike デフォルト・タイムラインに 5 シーンしか出ない（PPTX 変換も中途半端）。これが見えたら ESC ミス由来と判定して即 Phase 0 やり直し
- **スクリプト未対応の UI 変更は、Playwright で手動接続して挙動を観察→対策を入れる**サイクルが最速

## 14. シーンナビは「画面下タイムライン」が正解 — 左パネル経由は白紙シーン誤生成事故（2026-05-07）

### 14.1 現象
`claudecode-security-failure`（43シーン）処理中、シーン3 の音声アップ前にタイムライン上の
シーン数が 43 → 44 に増加。「scene03 スクリプトなし」の白紙シーンが Add scene 由来で挿入され、
以降のシーン番号がズレて全工程が破綻する。シーン6, 23 など特定の位置で再現的に発生。

### 14.2 原因
左パネル経由のナビ `click_scene_script` が以下のパスで Add scene を誤クリックしていた:

1. シーンN行は音声プレビュー UI（`scene{NN}.wav 00:00 / 00:25` 形式）で描画され、内部に再生 `<button>` を含む
2. 過去に「+ シーンを追加」誤クリック防止のため defensive filter を追加
   ```js
   if (d.querySelector("button")) continue;  // ← この1行が根本原因
   ```
3. このフィルターが**シーンN行自身**まで除外する（再生ボタンを内包しているため）
4. 「見つからない」と判断 → `scrollTop += 400` で下にスクロール
5. スクロール後の画面で y≈800 にある「+ シーンを追加」周辺の別要素（テキストが `numStr` で始まる div）を誤検出
6. その座標を `page.mouse.click(x, y)` → Add scene 発火 → 白紙シーン挿入

**皮肉な構造**: 「Add scene を防ぐためのガード」が「シーン行そのもの」を弾いた結果、「Add scene」を踏む。

### 14.3 解決策（実証済み・2026-05-07）
**メインループのナビを画面下タイムライン経由 `click_scene_by_timeline` に切り替え**:

```python
# heygen-setup.py main loop
print(f"  [nav] シーン{scene_num}に移動...", flush=True)
ok, _scene_id = await click_scene_by_timeline(page, scene_num)
if not ok:
    # フォールバックなし。タイムラインで data-scene-id が取れなければエラー停止
    progress["failed"].append(scene_num)
    break
```

`click_scene_by_timeline` は `[data-scene-id="..."]` セレクタで Playwright `locator().click()` を
使うため、Add scene ボタンと混在する余地がそもそもない（構造的に安全）。Section 6 の「タイムラインは
左パネル更新しない」罠は `page.mouse.click(x, y)` 限定で、`locator().click()` なら左パネルも
正しく更新される（同 Section の検証表で実証済み）。

`click_scene_script` 関数は呼び出し元（upload_audio リトライ・self_heal・VERIFY_MODE）の互換のため、
**`click_scene_by_timeline` の薄いラッパー**として残す（左パネル番号 span 検索ロジックは完全削除）。

検証結果（claudecode-security-failure, scene 3-10, 8 シーン連続）:
- scene 数 43 → 43 を完全維持（白紙シーン誤生成 0 件）
- 全 4 ポイント (`Upload audio click 後` / `set_input_files 後` / `Add audio click 後` / アバター配置後) で増加なし

### 14.4 検証済み・不採用のアプローチ
1. **`querySelector("button")` フィルターを削除して左パネル経由を維持** ← Add scene ボタンの構造変化に再び弱くなるリスク。タイムライン経由に切り替えれば誤クリックの可能性が構造的にゼロなので不採用
2. **画面サイズをフルスクリーン化** ← y=850 上限の余裕は増えるが、フィルターのバグは無関係に効くので根本解決にならない
3. **scrollTop の上限を厳しくする (95% → 80%)** ← Add scene 領域に到達する前に find ループを止められる可能性はあるが、シーン行自体を弾く根本原因は残る

### 14.5 教訓
- **defensive filter は除外条件を最小化する**。「念のため除外」を積み増すと、防ぎたい対象と区別がつかない正規データまで弾く（`querySelector("button")` がまさにこれ）
- **同じ目的を達成する経路が複数ある場合、構造的に安全な方を選ぶ**。座標クリック (`page.mouse.click`) より セレクタ指定 (`locator().click()`) の方が誤対象クリックの可能性を排除しやすい
- **症状再現が確実な場合、デバッグログを 4 ポイント仕込んで実機で観察**するのが最速。今回も 4 ポイント (Upload click 前後 / set_input_files / Add audio click) のシーン数監視で「クリック直後に scene 数 43→44」を検出して原因を 1 回の実行で特定できた
- **「Section X が正解」と書かれていた過去のドキュメントも、新しい事故が出たら訂正する**。Section 6 の「タイムラインではなく左パネル」は `page.mouse.click(x,y)` 限定の話で、`locator().click()` には当てはまらないことが後の検証で判明。古い前提が残ると次の人が同じ罠に戻る
