# YouTube AI動画 HeyGen動画生成

PPTXスライドとシーン別音声ファイルから、HeyGenでアバター付き動画を生成する。

## 重要な前提

- **音声はElevenLabsで生成したWAVファイルをアップロードする方式**が最高品質
- HeyGenに音声をアップロードすると**自動でリップシンク**される
- PPTXアップロード時は**「スライドの内容を編集可能な要素としてインポート」を必ずOFF**
- PPTXアップロード時は**「Use speaker notes as your script」**を選択
- **Quality + 1080p**で生成すること

## 入力

$ARGUMENTS にスラッグまたはディレクトリパスが渡される。

- スラッグの場合: `output/youtube/{slug}/` 配下のファイルを自動検索
  - `output/youtube/{slug}/slides.pptx`
  - `output/youtube/{slug}/audio/scenes/scene*.wav`

---

## Phase 1: PPTXアップロード + アバター選択（手動）

ユーザーに以下の手順を案内する:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 手動作業: HeyGenでPPTXアップロード

  【1】HeyGen（https://app.heygen.com）を開く
  【2】「Create Video」→ PPTXをアップロード
     ・ファイル: output/youtube/{slug}/slides.pptx
     ・⚠「スライドの内容を編集可能な要素としてインポート」→ OFF
     ・「Use speaker notes as your script」を選択
  【3】アバター選択: 「本番用：山口〜」を選ぶ

━━━━━━━━━━━━━━━━━━━━━━━━━━━
→ 完了したら「OK」と言ってください。Phase 2（音声アップロード自動化）に進みます。
```

---

## Phase 2: 音声アップロード + アバター配置（自動化）

### 概要

CDP ChromeをPlaywright経由で操作し、全シーンに対して以下を自動実行する:
1. カスタム音声（WAV）のアップロード
2. アバターを200×200にリサイズ（moveable.request() API）
3. アバターをキャンバス右上角に配置（ArrowKey精度ループ）

### 自動化スクリプト

```bash
# CDP Chrome起動
./05_development/scripts/chrome-cdp-launcher.sh start

# HeyGenエディタをCDP Chrome上で開いた状態で実行:
HEYGEN_SLUG=what-is-make HEYGEN_START=1 HEYGEN_END=33 \
  /Users/naru/.pyenv/versions/3.13.0/bin/python3 \
  output/youtube/_shared/heygen-setup.py
```

### 環境変数

| 変数 | 説明 | デフォルト |
|------|------|-----------|
| HEYGEN_SLUG | 動画スラッグ（必須） | - |
| HEYGEN_START | 開始シーン番号 | 1 |
| HEYGEN_END | 終了シーン番号 | 全シーン |
| HEYGEN_DRY | "1"でドライラン | "0" |

### シーンナビゲーション方式

**左パネルの「Nスクリプトを入力してください」行をクリック**して移動。

- scene ID の手動取得は不要
- Uploadボタンが既に表示中なら再クリックをスキップ
- 番号の完全一致チェック（"1"が"10"にマッチしない）
- 仮想スクロール対応（scrollTop反復 + 400px刻み）

### アバターリサイズ: moveable.request() API

**ドラッグではなくHeyGen内部のmoveableライブラリAPIを直接呼ぶ。**

```javascript
// .moveable-control-box の React fiber → moveable instance
const mv = fiber.ref.current.moveable;
const req = mv.request('resizable');
req.request({offsetWidth: 200, offsetHeight: 200});
req.requestEnd();
```

- HeyGen内部座標系（1920×1080）で直接サイズ指定
- 1px精度で正確（ドラッグでは202↔198の振動で200到達不可能だった）
- `el.style.width` が HeyGen内部座標のサイズ（`width: 200px` = HeyGen 200単位）

### 位置調整: ArrowKey精度ループ

ドラッグで大まかに移動 → ArrowKeyで0px誤差まで微調整（最大50回）。

---

## ⚠️ 既知の問題と対策

### 音声の自動伝播（CRITICAL）

**HeyGenは音声アップロード時に、後続の空シーンに音声を自動コピーする場合がある。**

- 原因: HeyGen側の挙動（スクリプト側では制御不能）
- 症状: シーンNに音声をアップ → シーンN+1, N+2にも同じ音声が入る
- 対策:
  - 各シーンのアップロード後に伝播チェック（スクリプトに実装済み）
  - **末尾3シーンは手動確認が必要**
  - 伝播した音声は左パネルの×ボタンで削除可能
  - ×ボタンで削除すると連鎖削除される場合あり → シーン複製→削除で対処

### パネルの仮想スクロール限界

- 20シーン以上に音声があると、パネルが肥大化（各シーン約300px）
- 残りシーンのエントリがDOMから消えることがある
- 対策: スクリプトは1回のバッチで15シーン程度に抑え、止まったら再実行
- 「＋シーンを追加」ボタンの誤クリック防止: scrollHeight 95%で停止

### パネル番号の不安定性

- 音声アップロードのたびにパネルの番号表示が変わることがある
- パネル番号とHeyGenシーン番号は通常1:1だが、シーン追加/削除で狂う
- 確認方法: 右パネル「アバター & ボイス（シーン N）」を読む

---

## HeyGen内部構造メモ

### 座標系
- **内部座標**: 1920×1080（CSS styleに直接記述）
- **DOM座標**: 内部座標 × scale(0.38) = 729.6×410.4px

### アバター要素構造
```
<div data-element-id="XXXX" style="width:200px; height:200px; transform:translate(1720px,0px)">
  └─ parent: transform: scale(0.38)
```

### React props（avatar type element）
```json
{
  "width": 720, "height": 720,
  "scaleX": 0.27778,  // 720 * 0.27778 = 200
  "left": 1720, "top": 0,
  "type": "avatar"
}
```

---

## Phase 3: BGM設定 + 生成（手動）

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 手動作業: BGM設定 → 生成

  【1】背景BGMを追加
     ・画面上部「Background Music」を選択
     ・ジャンル: Corporate / Upbeat系
     ・**Volume: 3%**
     ・**Loop music: ON**

  【2】プレビュー確認
     ・スライドが正しく表示されているか
     ・アバターが右上に200×200で配置されているか
     ・音声がスライドと一致しているか

  【3】生成
     ・右上「✓ 生成」ボタン
     ・**Quality + 1080p**
     ・生成開始（2〜4時間）

━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## ハマりポイント

| 問題 | 対策 |
|------|------|
| ドラッグでアバターサイズ200到達不可 | `moveable.request('resizable')` で直接200指定 |
| `startsWith("1")`がシーン10にマッチ | 次の文字が数字でないことを確認 |
| DOM .click()がReactで無反応 | `page.mouse.click(x, y)` を使う |
| FileChooserが発火しない | `text=/ファイルをアップロード/` → fallback: `input[type=file]` |
| 音声アップ後に後続シーンに伝播 | 伝播チェック + ×ボタン削除 + 末尾は手動確認 |
| パネル末尾で「シーンを追加」誤クリック | scrollHeight 95%でスクロール停止 |
| アバター選択状態が消える | 6回ごとに再クリック |
| ロックモーダル | `display:none`で非表示化（閉じるとエディタ離脱） |

## 出力先

- 動画: `output/youtube/{slug}/{slug}-video.mp4`（HeyGenからダウンロード後に配置）

## 関連ファイル

| ファイル | 用途 |
|---------|------|
| `output/youtube/_shared/heygen-setup.py` | 自動化スクリプト本体（1100行） |
| `output/youtube/_shared/heygen-automation-learnings.md` | 詳細な学習ログ |
| `05_development/scripts/chrome-cdp-launcher.sh` | CDP Chrome起動/停止 |
