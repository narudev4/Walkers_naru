# HeyGen 音声アップロード自動化ガイド

> 作成: 2026-04-06 | 実績: what-is-make動画 39シーン全成功

## 概要

HeyGenの動画エディタで、各シーンにカスタム音声（WAV）を自動アップロードするPlaywright自動化手法。

## 前提環境

| 項目 | 値 |
|------|-----|
| Python | 3.13+ |
| ライブラリ | `playwright` (async API) |
| Chrome | CDP接続（ヘッドレス or ヘッドフル） |
| 音声形式 | WAV（HeyGenが受け付ける形式） |
| 命名規則 | `scene{NN}_{label}.wav`（例: `scene01_title.wav`） |

## アーキテクチャ

```
通常Chrome（ユーザー操作用）
    ↓ 競合しない
CDP Chrome（自動化用） ← chrome-cdp-launcher.sh で起動
    ↑ Playwright connect_over_cdp
Python スクリプト
```

### なぜCDP Chromeを分離するか

- `playwright` が通常のChromeプロファイルに直接接続すると、ユーザーのブラウザがロックされる
- `chrome-cdp-launcher.sh` でProfile 4（walker-s.co.jp）を `/tmp/` にコピーし、別プロセスとして起動
- HeyGenのログインセッション（Cookie）がコピーされるので再ログイン不要

## セットアップ

### 1. CDP Chrome起動スクリプト

場所: `05_development/scripts/chrome-cdp-launcher.sh`

```bash
# 起動（Profile 4をコピーしてヘッドレスChrome起動）
./05_development/scripts/chrome-cdp-launcher.sh start

# 停止・クリーンアップ
./05_development/scripts/chrome-cdp-launcher.sh stop

# ポート確認
./05_development/scripts/chrome-cdp-launcher.sh port
```

**ポイント:**
- `rsync` でCache系を除外してコピー（高速化）
- PIDファイルで多重起動を防止
- デフォルトポート: `9222`

### 2. Chromeプロファイルの特定

```bash
# macOSの場合
ls ~/Library/Application\ Support/Google/Chrome/
# → Default, Profile 1, Profile 2, ... の中から目的のプロファイルを探す

# 各プロファイルの名前確認
cat ~/Library/Application\ Support/Google/Chrome/Profile\ 4/Preferences | python3 -c "import sys,json; print(json.load(sys.stdin)['profile']['name'])"
```

## 音声アップロードスクリプト

### フロー（1シーンあたり）

```
1. ESCキーで既存モーダルを閉じる
2. data-scene-id でシーン要素を特定 → クリック
3. 「音声をアップロード」ボタンをクリック
4. 「ファイルをアップロード」ドロップゾーンをクリック → FileChooser発火
5. FileChooserにWAVファイルをセット
6. 「Add audio」ボタンをクリック
7. モーダルが閉じるのを待つ（= アップロード完了）
```

### シーンIDの取得方法

HeyGenエディタのDOMから `data-scene-id` 属性を取得する:

```javascript
// ブラウザのDevToolsコンソールで実行
document.querySelectorAll('[data-scene-id]').forEach((el, i) => {
  console.log(`${i+1}: ${el.getAttribute('data-scene-id')}`);
});
```

### 核心コード（抜粋）

```python
async def upload_scene(page, scene_num, wav_path):
    # ESCで既存モーダルを閉じる
    await page.keyboard.press("Escape")
    await asyncio.sleep(0.4)

    # シーン選択
    scene_id = SCENE_IDS[scene_num]
    el = page.locator(f'[data-scene-id="{scene_id}"]').first
    await el.scroll_into_view_if_needed(timeout=3000)
    await el.click(timeout=3000)
    await asyncio.sleep(0.6)

    # 「音声をアップロード」ボタン
    upload_btn = page.locator(
        'button:has-text("音声をアップロード"), button:has-text("Upload Audio")'
    ).first
    await upload_btn.wait_for(state="visible", timeout=5000)
    await upload_btn.click()
    await asyncio.sleep(1.0)

    # FileChooser経由でファイル設定
    async with page.expect_file_chooser(timeout=5000) as fc_info:
        dz = page.locator('text=/ファイルをアップロード/').first
        await dz.click(timeout=5000)
    fc = await fc_info.value
    await fc.set_files(str(wav_path))

    # 「Add audio」→ モーダル閉じ待ち
    await asyncio.sleep(1.2)
    add_btn = page.locator('button:has-text("Add audio"), button:has-text("音声を追加")').first
    await add_btn.wait_for(state="visible", timeout=10000)
    await add_btn.click()

    # モーダルが閉じる = 完了
    await page.wait_for_selector(
        'button:has-text("Add audio"), button:has-text("音声を追加")',
        state="hidden", timeout=30000
    )
```

## ハマりポイントと対策

### 1. ドロップゾーンのロケータ（最重要）

| NG | OK |
|----|-----|
| `text="ファイルをアップロード"` （完全一致） | `text=/ファイルをアップロード/` （正規表現・部分一致） |

理由: HeyGenのUIテキストに全角スペースや改行が含まれることがあり、完全一致だとヒットしない。

### 2. transcribed待機は不要

初期バージョンでは音声のtranscribe完了を待っていたが、「Add audio」クリック後にモーダルが閉じるのを待つだけで十分。transcribe表示はタイミングによって出ないことがある。

### 3. 日本語/英語の二重ロケータ

HeyGenのUIは言語設定によって日英が混在する。ボタンテキストは常に両方指定する:

```python
page.locator('button:has-text("音声をアップロード"), button:has-text("Upload Audio")')
```

### 4. シーン間の待機時間

- シーン切替後: `0.6秒` — DOMの再レンダリング待ち
- ファイル設定後: `1.2秒` — アップロード処理待ち
- 短すぎると次のロケータが前のシーンのDOMを掴む

### 5. エラーリカバリ

- 各ステップで失敗したらスクリーンショットを `/tmp/err_sceneNN_*.png` に保存
- 失敗シーンはスキップして次へ（バッチ全体を止めない）
- 失敗リストを最後にまとめて表示 → 再実行時にSKIP_SCENESを調整

## 再利用テンプレート

新しい動画で使う場合の手順:

1. 音声ファイルを `scene{NN}_{label}.wav` の命名で準備
2. HeyGenエディタを開き、DevToolsで `data-scene-id` を取得
3. スクリプトの `SCENE_IDS` / `AUDIO_DIR` / `START_SCENE` / `END_SCENE` を更新
4. CDP Chrome起動 → スクリプト実行

```bash
./05_development/scripts/chrome-cdp-launcher.sh start
/Users/naru/.pyenv/versions/3.13.0/bin/python3 /path/to/heygen_auto.py
```

## 関連ファイル

| ファイル | 用途 |
|---------|------|
| `05_development/scripts/chrome-cdp-launcher.sh` | CDP Chrome起動/停止 |
| `custom/skills/browser-use.md` | ブラウザ自動化スキル定義 |
| `.claude/commands/browser-use.md` | スキルエイリアス |
