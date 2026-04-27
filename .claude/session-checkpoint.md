# Session Checkpoint

> このファイルはAIが自動更新する。新セッションで「前回の続きから」と言えば復旧に使われる。

Updated: 2026-04-14 (Phase 0完了直後)

## Current Task

**YouTube動画制作: `claudecode-security` の yt-heygen STEP6。Phase 0 (PPTXアップロード) 完了、Phase 1+2 (音声アップ+アバター配置) 未実施。**

## Progress

- [x] yt-scrape / yt-script / yt-slides / yt-voice / yt-split-audio 完了
- [x] Phase 0: PPTXアップロード → アバター選択 → Create Video → エディタ遷移
- [ ] Phase 1+2: 全40シーンの音声アップ＋アバター配置（200x200右上）
- [ ] 背景BGM設定（Corporate/Upbeat、Volume 3%、Loop ON）
- [ ] 動画生成ボタン押下（手動）
- [ ] STEP7 yt-thumbnail / STEP8 yt-upload

## Key Context

- **プロジェクトパス**: `05_development/youtube/projects/claudecode-security/`
- **シーン数**: 40（`audio/scenes/scene01_*.wav` 〜 `scene40_*.wav`）
- **HeyGenエディタURL**: `https://app.heygen.com/create-v4/3f2bc7b0223c46628146a253f9fcee17`
- **選択アバター**: 本番用：山口鳳汰(背景リアル&スーツ見えるver)
- **Phase 0の注意**: setup.py の自動Speaker notes選択はFAIL。アバター選択も `button.click()` (browser-use click) は反応せず、`imgs[0].click()` + card.click() のDOM直叩きで成功した

## Files Modified

なし（HeyGen側の操作のみ）

## Next Steps

1. ユーザー確認: Phase 1+2 実行してよいか
2. 実行コマンド: `HEYGEN_SLUG=claudecode-security /Users/naru/.pyenv/versions/3.13.0/bin/python3 _shared/heygen-setup.py`
3. 完走後、HeyGenで背景BGM設定 → 動画生成 → ダウンロード
4. STEP7 yt-thumbnail、STEP8 yt-upload へ

## 注意

- HeyGenのドラフトは複数タブ同時編集不可。別タブで開かないこと
- Phase 1+2が失敗したら `projects/claudecode-security/heygen-setup-progress.json` でレジューム可
- setup.py の本番用アバタークリック問題は learnings にまだ未追記（次回追記検討）
