---
description: YouTube AI動画 一括制作パイプライン
---

# YouTube AI動画 一括制作パイプライン

記事URLから台本→スライド→音声→動画→YouTube投稿までの全工程を一括実行する統合スキル。
手動作業が必要なタイミングでは、ユーザーに「次にやるべきこと」を明示的に指示する。

## 入力

`$ARGUMENTS` に記事URLが渡される。

- URLの場合: フルパイプライン実行
- 引数なしの場合: ユーザーにURLまたはテーマをヒアリング

## パイプライン全体像と実行手順

```
[1] 🤖 /yt-scrape       → article.md
[2] 🤖 /yt-script       → script.md          👤 台本確認
[3] 🤖 /yt-slides   ┓    → slides.pptx       👤 PPTX確認
[4] 🤖 /yt-voice    ┛並列 → audio/full.wav    👤 CTA末尾の音声確認
[5] 🤖 /yt-split-audio  → scenes/*.wav
[5.5] 🤖 概要欄チャプター生成（実音声ベース）
[6] 👤+🤖 /yt-heygen    → video.mp4
[7] 👤 YouTube投稿      → YouTube URL
```

凡例: 🤖 = AI自動処理 / 👤 = 人間の手動確認が必要

---

### STEP 1: 記事スクレイピング 🤖

- 入力: URL
- 出力: `output/youtube/{slug}/article.md`
- 処理: WebFetch or Chrome MCP で記事取得・Markdown化

完了: 「STEP 1 完了。記事取得しました → STEP 2 に進みます」

---

### STEP 2: 台本生成 🤖 → 👤確認

- 入力: `article.md`
- 出力: `output/youtube/{slug}/script.md`
- 処理: 記事の見出し構造に追従した台本を生成。概要欄・チャプター・HeyGen対応表も含む

完了: 「STEP 2 完了。台本を `{path}` に保存しました（自動で開きます）。内容を確認し、修正指示があれば指示してください。OK なら STEP 3+4 に進みます」

**ユーザーが「OK」するまで待機。修正指示があれば台本を修正して再表示。**

---

### STEP 3+4: スライド生成 + 音声生成 🤖 → 👤確認（並列実行）

- 並列タスクA（スライド）: `script.md` → `output/youtube/{slug}/slides.pptx`（`/yt-slides` に委譲）
- 並列タスクB（音声）: `script.md` → `output/youtube/{slug}/audio/full.wav`（`/yt-voice` に委譲、ElevenLabs API）

完了メッセージに含める情報:
- スライド枚数 N・音声の分秒
- PPTX は Finder で自動オープン、WAV も Finder で自動オープン
- **チャンク結合点の重点チェック**: STEP 4 の生成結果から各チャンクの文字数・秒数・結合タイムスタンプを算出して表で提示する
- **CTA末尾の耳チェック項目**:
  - 「2700万円」「900万円」「300万円」が正しく読まれているか
  - 「3分の1」が「13」になっていないか
  - 「0から1」「0から100」が正しいか
  - 音声が途中で崩壊していないか
- スライド内容修正は slides.json 編集 → エンジン再実行
- 両方「OK」で STEP 5 に進む

---

### STEP 5: 音声分割 🤖

- 入力: `full.wav` + `script.md`
- 出力: `output/youtube/{slug}/audio/scenes/scene01〜{N}.wav` + `scene{N+1}_cta1〜scene{N+8}_cta8.wav`
- 処理: Whisper medium で文字起こし → 台本の冒頭フレーズで正確にカット。**CTA音声も8スライド分に自動分割する（確認不要・必ず実行）**
- 詳細は `/yt-split-audio` 相当のロジック（現状 SKILL.md 内ロジックとして実行）

完了: 「STEP 5 完了。{N}シーン + CTA 8シーン分割 → 保存先を Finder で自動オープン。STEP 5.5 に自動で進みます」

---

### STEP 5.5: 概要欄チャプター生成（実音声ベース） 🤖

STEP 5 の分割結果から各 scene の WAV 秒数を取得し、累積タイムスタンプを計算。

処理手順:
1. 各 scene WAV のファイルサイズから秒数算出: `(bytes - 44) / 2 / 44100`
2. 累積タイムスタンプを計算
3. セクションタイトルスライド（sec01, sec02...）の開始時刻をチャプターとする
4. 形式: `M:SS セクション名`（YouTube準拠）
5. 台本ファイルの概要欄テンプレート内【目次】セクションを実測値で更新
6. チャプター一覧を表示（クリップボードにもコピー）

完了: 「STEP 5.5 完了。概要欄チャプターを実測値で生成。次は STEP 6（HeyGen動画生成）の手動作業に進みます」

---

### STEP 6: HeyGen動画生成 👤+🤖

- 入力: `slides.pptx` + `audio/scenes/*.wav`
- 出力: `video.mp4`
- 自動化: `/yt-heygen {slug}` に完全委譲（PPTXアップ・音声アップ・アバター配置・BGM自動化）
- 手動手順を参照: `Read .claude/skills/yt-produce/references/heygen-manual.md`
- 手動5項目サマリ: PPTXインポート設定確認 / アバター選択（初回のみ） / BGM追加（Volume 3%、Loop ON） / プレビュー確認 / 生成ボタン

完了後「完成した」と伝えられたら STEP 7 に進む。

---

### STEP 7: YouTube投稿 👤

- 入力: HeyGen ダウンロード動画
- 出力: YouTube URL
- 手動手順を参照: `Read .claude/skills/yt-produce/references/youtube-upload.md`
- 手動5項目サマリ: 動画アップロード / 概要欄設定（クリップボードから貼付） / サムネイル / **「改変されたコンテンツ」にチェック（CRITICAL）** / 公開設定

完了後「完了」と伝えられたらパイプライン終了。

---

## 進捗表示テンプレート

各STEP完了ごとに更新表示する:

```
🎬 YouTube AI動画制作パイプライン
✅ STEP 1/7: 記事取得           🤖 完了
✅ STEP 2/7: 台本生成           🤖 完了 → 👤 確認済み
✅ STEP 3/7: スライド生成       🤖 完了 → 👤 確認済み
✅ STEP 4/7: 音声生成           🤖 完了 → 👤 CTA確認済み
✅ STEP 5/7: 音声分割           🤖 完了
⏳ STEP 6/7: HeyGen動画生成    👤 作業中...
⬚ STEP 7/7: YouTube投稿       👤
```

## エラーハンドリング

| エラー | 対応 |
|-------|------|
| WebFetch失敗 | Chrome MCP or Playwright MCPにフォールバック |
| ElevenLabs APIキーなし | `credentials/elevenlabs_api_key.txt` を確認。なければユーザーにヒアリング |
| ElevenLabs 5000文字超 | セクション遷移の位置で分割 → 複数APIコール → FFmpeg結合 |
| CTA音声崩壊 | CTA部分だけ再生成。テンプレート音声（`05_development/youtube/templates/cta_audio_pcm.wav`）があればそれを使用 |
| Whisper分割精度が低い | 全セグメント一覧を出力し、手動でカットポイントを調整 |
| スライド生成エラー | slides.jsonを確認し、エンジン（yt_slide_engine.py）を再実行 |

## 出力ファイル一覧

```
output/youtube/{slug}/
├── article.md                 # 記事テキスト
├── script.md                  # 台本
├── slides.json                # スライドデータ（単一ソース）
├── slides.pptx                # スライド（エンジン生成）
└── audio/
    ├── full.wav               # 全体音声
    ├── full_pcm.wav           # PCM変換版（Whisper用）
    └── scenes/
        ├── scene01_title.wav
        ├── scene02_toc.wav
        └── ...
```

## コスト（1動画あたり）

| 項目 | 金額 |
|-----|------|
| ElevenLabs（約7,000文字） | 約210円 |
| HeyGen Avatar IV（約19分） | 約2,850円 |
| **合計** | **約3,060円** |

## 所要時間

| 区分 | 時間 |
|-----|------|
| 🤖 AI自動処理 | 約30分 |
| 👤 人間の手動作業 | 約36分 |
| ⏳ HeyGen生成待ち | 2〜4時間（放置OK） |
| **実働合計** | **約1時間** |
