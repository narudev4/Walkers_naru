# Session Checkpoint

> このファイルはAIが自動更新する。新セッションで「前回の続きから」と言えば復旧に使われる。

Updated: 2026-04-28

## Current Task

yt-produce パイプラインの自動（cron）化に向けたリファクタとバグ調査。

claudecode-app-monetize 動画は **手動リカバリー込みで完成済み**（HeyGen 上での Phase 1+2 シーン水増しを手動修正）。次セッションは **同事象の原因特定**と関連改善が主題。

## Progress

- [x] STEP 1〜5.5: claudecode-app-monetize 動画パイプライン完走（記事→台本→スライド→音声→分割→概要欄チャプター）
- [x] yt-produce SKILL.md リファクタ
  - OK 待ち削除 → STEP 1〜5.5 完全自動進行
  - STEP 6 復元（ただし【5】プレビュー→生成ボタンセクションは削除）
  - STEP 7 を `/yt-upload` に委譲
  - CDP Chrome 自動起動の正しい記述に訂正（`chrome-cdp-launcher.sh` が `heygen-setup.py` から自動呼び出しされる仕様）
- [x] STEP 6 Phase 0 実機実行成功（PPTXアップロード + アバター選択 + Create Video）
- [x] STEP 6 Phase 1+2 実行 → **シーン2枚水増しバグに遭遇**（18・30 が真っ白で挿入され、scene18.wav 以降の音声が1ずつ後ろにずれる）
- [x] バグ原因調査: 5 関数（`click_scene_script` / `click_scene_by_timeline` / `upload_audio` / `place_avatar` / `dismiss_modals`）精査 → **コード上では「+ シーンを追加」を踏みうる箇所は特定不可**
- [x] 動画はユーザー手動でリカバリーして完成
- [ ] **learnings.md に未解決罠として記録（次セッション最優先）**
- [ ] yt-produce SKILL.md の BGM Volume を 3% → **1%** に修正

## Files Modified

- `.claude/skills/yt-produce/SKILL.md` — 大幅リファクタ（複数回）
- `projects/claudecode-app-monetize/article.md` — STEP 1 出力
- `projects/claudecode-app-monetize/script.md` — STEP 2 + STEP 5.5（実測チャプター反映）
- `projects/claudecode-app-monetize/slides.json` `slides.pptx` — STEP 3 出力
- `projects/claudecode-app-monetize/audio/full.wav` `audio/scenes/scene{01..35}.wav` — STEP 4・5 出力
- `projects/claudecode-app-monetize/heygen-setup-progress.json` — Phase 1+2 進捗
- `_shared/heygen-bgm-probe.py` — 新規（BGM UI 調査用 read-only スクリプト）

## Key Context

### 完了プロジェクト

- **claudecode-app-monetize**（HeyGen 動画完成済・YouTube 投稿は未）
  - 元記事: https://walker-s.co.jp/ai/claudecode-app-monetize/
  - 35 スライド / 約 17 分 / ElevenLabs assert PASS / Whisper 35/35 high confidence
  - HeyGen エディタ URL: `https://app.heygen.com/create-v4/53b37027aeb94475b2dff0091e71a920`

### バグ事象（次セッションで深掘り対象）

- **現象**: Phase 1+2 中に HeyGen 上でシーンが2枚水増しされる
- **観察**: 18 と 30 の位置に空シーン挿入、scene18.wav 以降が1ずつ後ろにずれる
- **過去にも何度も発生**（再現性のある罠 — ユーザー確認済み）
- 524 行目に既に「シーンを追加」誤クリック防止対策コメントあり = 過去にも同種事故
- 5 関数精査ではコード上の誤クリック箇所は見つからず
- **仮説3つ**:
  1. `dispatchEvent(click, {bubbles: true})` のイベント伝播副作用（upload_audio 内）
  2. HeyGen 自体の自動シーン追加の隠し仕様
  3. Escape 後のフォーカス残留
- **計装案**: 各シーンループ前後で `[data-scene-item]` の数とリストを記録 → どの瞬間に増えたか時系列で特定

### CDP Chrome 起動仕様（誤解防止メモ）

- `_shared/heygen-setup.py` が CDP 未検出時に `/Users/naru/Walkers_naru/05_development/scripts/chrome-cdp-launcher.sh start` を自動呼び出し
- ランチャーは Profile 4（walker-s.co.jp）を `/tmp/chrome-cdp-walkers/` に rsync コピー → **non-headless** で起動
- ユーザーは何もしない（既存 Chrome を閉じる必要もない）
- ただし、ランチャーが exit 1 で「Failed to start」を出しても実は Chrome は起動している、というエッジケースあり（cron 化前にこのエラー誤報を直したい）

## Next Steps（ユーザー指定の優先順）

### 1. `_shared/heygen-automation-learnings.md` の内容把握・棚卸し（最優先）

新セッションでまずここを通読する。今セッションで踏んだバグ事象を **未解決の既知罠**として追記する作業も含む。

### 2. シーン水増しバグの原因調査・修正

- 計装: `data-scene-item` の数を毎シーンループ前後で記録するロガーを `heygen-setup.py` に追加
- 1 動画分の Phase 1+2 を流して、シーン増加タイミングを特定
- 根本原因が判明 → 対策コードを足す → learnings.md に追記

### 3. 冒頭スライド 1〜3 の品質向上（離脱率対策）

冒頭の離脱率が視聴継続に大きく関わるため最優先級。
- 対象: `.claude/skills/yt-slides/SKILL.md`（テンプレート定義）
- 対象: `_shared/yt_slide_engine.py`（スライド1=title, 2-3=text の生成ロジック）

### 4. BGM 追加自動化（Volume **1%**・Loop ON）

- 関連: `_shared/heygen-bgm-probe.py`（既に作成済の read-only 調査スクリプト）
- 実装: `heygen-setup.py` に Phase 3 として追加 or 新規スクリプト
- 完了したら yt-produce SKILL.md の BGM 設定値も 3% → **1%** に更新

### おまけ（cron 化の前にやっておきたい）

- `chrome-cdp-launcher.sh` の「Failed to start 誤報」エッジケース修正
- 上記4タスク完了で `yt-produce` 全自動 → cron 化のラストピース揃う

## 補足

- yt-produce SKILL.md は今セッションで大幅改訂済み（git diff で前回比較可）
- empirical-prompt-tuning による構造審査済み（critical 7項目すべて○）
- リファクタ前の挙動に戻したい場合は最後のリファクタ前コミットへ git checkout 可
