# /yt-heygen — HeyGen動画生成スキル

PPTXスライドとシーン別音声ファイルから、HeyGenエディタ上でアバター付き動画を準備する。

## 重要な前提

- **音声はElevenLabsで生成したWAVファイルをアップロードする方式**が最高品質（API連携は品質低下する）
- HeyGenに音声をアップロードすると**自動でリップシンク**される
- PPTXアップロード時は**「スライドの内容を編集可能な要素としてインポート」を必ずOFF**
- PPTXアップロード時は**「Use speaker notes as your script」**を選択
- **Quality + 1080p**で生成すること

## 処理フロー

```
Phase 0: PPTXアップロード（自動 / browser-use CLI）
    ↓
Phase 1+2: 音声アップ＋アバター配置（自動 / Playwright CDP）
  シーンごとに繰り返し:
    1. シーンをクリック（タイムライン）
    2. 音声をアップロード（右パネル）
    3. アバターを200x200にリサイズ＆右上角に配置
    ↓
動画生成ボタン（手動）
```

## 入力

`$ARGUMENTS` にスラッグが渡される。

- スラッグ → `output/youtube/{slug}/audio/scenes/scene01_*.wav` 〜
- 引数なし → エラー（スラッグ必須）

## 前提条件

- Phase 0: browser-use CLI使用可能、`walker-s.co.jp` プロファイルでHeyGenにログイン済み
- Phase 1+2: browser-useが起動したChromeにHeyGenエディタが開いた状態
- `output/youtube/{slug}/audio/scenes/` に `scene01_*.wav` 〜 `sceneNN_*.wav` が存在
- **手動で音声を先にアップしないこと**（複製・ずれの原因）

## 環境変数

| 変数 | 必須 | デフォルト | 説明 |
|------|------|-----------|------|
| `HEYGEN_SLUG` | YES | — | 動画スラッグ（例: what-is-make） |
| `HEYGEN_PPTX_PATH` | no | — | PPTXパス（設定時Phase 0実行→停止） |
| `HEYGEN_START` | no | 1 | 開始シーン番号（レジューム用） |
| `HEYGEN_END` | no | 全シーン | 終了シーン番号 |
| `HEYGEN_DRY` | no | 0 | "1"でドライラン |
| `HEYGEN_VERIFY` | no | 0 | "1"でスイープ検証モード（アップロードせず全シーンの音声を検証） |
| `HEYGEN_VERIFY_VISUAL` | no | 0 | "1"でclaude -p視覚検証を有効化（HEYGEN_VERIFY=1と併用） |

## 使い方

```bash
# Phase 0: PPTXアップロード（browser-use CLI、ログイン済みプロファイル使用）
HEYGEN_SLUG=what-is-make HEYGEN_PPTX_PATH=output/youtube/what-is-make/what-is-make.pptx /Users/naru/.pyenv/versions/3.13.0/bin/python3 output/youtube/_shared/heygen-setup.py

# Phase 1+2: 全シーン一括処理（音声アップ＋アバター配置）
HEYGEN_SLUG=what-is-make /Users/naru/.pyenv/versions/3.13.0/bin/python3 output/youtube/_shared/heygen-setup.py

# 途中から再開
HEYGEN_SLUG=what-is-make HEYGEN_START=15 /Users/naru/.pyenv/versions/3.13.0/bin/python3 output/youtube/_shared/heygen-setup.py

# ドライラン（操作せず確認のみ）
HEYGEN_SLUG=what-is-make HEYGEN_DRY=1 /Users/naru/.pyenv/versions/3.13.0/bin/python3 output/youtube/_shared/heygen-setup.py
```

## 実装スクリプト: `output/youtube/_shared/heygen-setup.py`

音声アップロードとアバター配置を統合した1ファイル。Playwright CDP接続で操作。

### シーンごとの処理フロー

```
1. シーンをクリック（タイムラインのdata-scene-id要素）
   - 初回にget_all_scene_ids()で全シーンIDを収集
   - scrollLeftでスクロール → クリック

2. 音声アップロード
   - 右パネルの「Upload audio」ボタンをクリック
   - page.expect_file_chooser() + set_files()で音声ファイルをセット
   - 「Add audio」ボタンが非表示になるまで待機（最大30秒）
   - 失敗時は即停止（ずれ防止）

3. アバター配置
   - data-element-id要素を面積順ソートで取得（最大=canvas、2番目=avatar）
   - safe_click_point()でキャンバス内クリック座標を算出
   - SEハンドルでドラッグリサイズ → target_px = ceil(200 * canvas_w / 1920)
   - 右上角に移動（canvas右端-avatar幅, canvas上端）
   - ArrowKeyで0px誤差まで微調整（最大50回）
   - 巨大化ガード: 1.5倍超で即中断
```

### 安全策

| ガード | 内容 |
|--------|------|
| 即停止 | 音声アップロード失敗時、後続シーンを処理しない（ずれ防止） |
| safe_click_point | アバタークリック座標をキャンバス内に収める（右パネル誤クリック防止） |
| 巨大化ガード | リサイズ後サイズが目標の1.5倍超なら中断 |
| SEハンドル確認 | 選択されなければ処理中断 |
| キャンバス同サイズ検出 | リサイズ後にキャンバスと同サイズなら誤検出として中断 |

### レジューム

`output/youtube/{slug}/heygen-setup-progress.json` で中断→再開。

```json
{
  "completed": [1, 2, 3],
  "failed": [4],
  "verified": {
    "1": {"filename": "scene01_title.wav", "method": "dom"},
    "2": {"filename": "scene02_problem.wav", "method": "healed"}
  },
  "healed": [],
  "status": "stopped"
}
```

### 音声検証システム

各シーンのアップロード直後にDOM検証を実行:
1. 左パネルに表示された.wavファイル名を読み取り、期待値と照合
2. ミスマッチ時は自己修復（音声削除→再アップロード→再検証、最大2回）
3. 曖昧な場合は`claude -p`でスクリーンショット解析（`HEYGEN_VERIFY_VISUAL=1`時）

スイープ検証モード（`HEYGEN_VERIFY=1`）で全シーン一括検証も可能。

### PIDロック

二重起動防止のため、起動時にロックファイルを作成。
ロックファイル: `output/youtube/{slug}/heygen-setup.lock`

**ad-hocスクリプトを/tmpに書いて実行しないこと** — 全ロジックはheygen-setup.pyに集約。

## アバター配置仕様

| 項目 | 値 |
|------|-----|
| サイズ | 200×200 HeyGen単位（1pxのずれも不可） |
| 位置 | 右上角（キャンバス右端・上端に合わせる） |
| 形状 | 円形（デフォルトで丸。border-radiusは触らない） |
| 計算式 | `target_px = ceil(200 * canvas_w_px / 1920)` |

## 背景BGM設定（手動・動画生成前）

| 設定 | 値 |
|------|-----|
| BGMジャンル | Corporate / Upbeat系 |
| Volume | **3%** |
| Loop music | **ON** |

## 品質チェック

- [ ] 全シーンでアバターが200×200・右上角に配置されているか
- [ ] リップシンクが音声と同期しているか
- [ ] スライドの切り替えがシーンと一致しているか
- [ ] 背景BGMが設定されているか（Volume 3%、Loop ON）

## 既知の制約

- HeyGenの同一ドラフトは複数タブで同時に開けない（"The draft is being edited"）
- HeyGenのUI変更でDOM構造が変わるとスクリプト修正が必要
- 音声伝播（HeyGenが後続シーンに自動コピー）→ 伝播チェック + ファイル名判別で対策済み
- 二重起動でレースコンディション → PIDロックで対策済み
