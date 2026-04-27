# Session Checkpoint

> このファイルはAIが自動更新する。新セッションで「前回の続きから」と言えば復旧に使われる。

Updated: 2026-04-15 (yt-produce STEP 5完了時点)

## Current Task
`/yt-produce claudecode-native-app` のSTEP 5（音声分割）完了。STEP 6（HeyGen動画生成）待ち。

## Progress
- [x] STEP 1-4 記事→台本→スライド→音声
- [x] STEP 5 音声分割（34シーン: 本編26 + CTA8）
- [x] STEP 5.5 概要欄チャプター生成
- [ ] STEP 6 HeyGen動画生成（次）
- [ ] STEP 7 YouTube投稿

## Files Modified
- `projects/claudecode-native-app/audio/scenes/scene01〜34_*.wav`
- `projects/claudecode-native-app/script.md`（概要欄チャプター実測値）
- `/tmp/yt_split_run.py`（カット調整: prev_end +0.25sマージン, scene34 -0.15sトリム）
- `/tmp/yt_split_transcribe.py`, `/tmp/whisper_main.json`

## Key Context
- slug: `claudecode-native-app`
- 動画長: 約12:04
- チャプター: 0:00 OP / 1:19 RN最適解 / 4:15 3つの方法 / 7:39 機能一覧 / 8:21 注意点 / 9:52 まとめ / 10:31 最後に
- 分割カット方式: 前シーン最終word end + 0.25s（SKILL.md準拠+マージン延長）
- scene16/17冒頭「ほうほうならた」はElevenLabs読み間違い（「方法②③」誤読）→分割では修正不能、ユーザー認識済み
- ユーザー確認済み: scene24「おもいます」完結、scene34「ました」完結

## Next Steps
STEP 6 HeyGen動画生成（ユーザーに「STEP 6開始」と言われたら実行）:
1. `HEYGEN_SLUG=claudecode-native-app HEYGEN_PPTX_PATH=projects/claudecode-native-app/slides.pptx /Users/naru/.pyenv/versions/3.13.0/bin/python3 _shared/heygen-setup.py`
2. `HEYGEN_SLUG=claudecode-native-app /Users/naru/.pyenv/versions/3.13.0/bin/python3 _shared/heygen-setup.py`（音声+アバター配置）
3. 手動: アバター選択・BGM(Corporate/3%/Loop)・生成ボタン
