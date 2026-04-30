---
description: YouTube AI動画 音声分割（full.wav → scene{NN}.wav 複数本）
---

# YouTube AI動画 音声分割

`yt-voice` が生成した `full.wav` を、シーン別の `.wav` ファイルに分割する。

実装はすべて `_shared/yt-split-audio.py` に集約されている。

## 入力

- `projects/{slug}/script.md`
- `projects/{slug}/slides.json`
- `projects/{slug}/audio/full.wav`

## 出力

- `projects/{slug}/audio/whisper_segments.json`（初回のみ生成・以降キャッシュ）
- `projects/{slug}/audio/proposed_cuts.json`（マッチング結果の記録）
- `projects/{slug}/audio/scenes/scene{NN}.wav`（連番。N=01〜）

## 使い方

通常はスラッグだけ指定：

```bash
HEYGEN_SLUG=claudecode-failure /Users/naru/.pyenv/versions/3.13.0/bin/python3 \
  05_development/youtube/_shared/yt-split-audio.py
```

### オプション環境変数

| 変数 | 用途 |
|------|------|
| `RECOMPUTE_WHISPER=1` | Whisperキャッシュを破棄して文字起こしから再実行（full.wav 差し替え時など） |
| `DRY_RUN=1` | cut せず `proposed_cuts.json` だけ出力（マッチング結果の確認用） |

## 仕組み（要約）

1. `script.md` の `### 【スライドN】` 各シーンの冒頭ナレーションを抽出
2. Whisper medium で `full.wav` を文字起こし（CPU・word_timestamps、約30分・初回のみ）
3. 各シーン冒頭フレーズと Whisper セグメントを位置一致でマッチング
   - 漢数字（一/二/三...）↔ 算用数字（1/2/3...）正規化
   - 英語表記（Claude Code 等）↔ カタカナ正規化
4. マッチ失敗シーンは前後マッチから補間（両端失敗時のみエラー停止）
5. ffmpeg で粗切り → silenceremove で末尾の長い無音/息継ぎをトリム

詳細は `_shared/yt-split-audio.py` のソース参照。

## 詰まった時の対処

| 症状 | 対処 |
|------|------|
| 「マッチできない」エラー | `proposed_cuts.json` の最後の出力を確認。台本冒頭フレーズと Whisper 結果が大きく違うシーンがないかチェック |
| Whisper が遅い | CPU で30分かかるのが正常。`whisper_segments.json` がキャッシュされる |
| 音声末尾が切れすぎ | `_shared/yt-split-audio.py` の `SILENCE_THRESHOLD_DB`（既定 -50）を下げる（例: -55） |
| 音声末尾の息継ぎが残る | 同 `SILENCE_THRESHOLD_DB` を上げる（例: -45） |

## 編集禁止（CRITICAL）

`_shared/yt-split-audio.py` は実機検証済みコード。挙動が変なら **まずキャッシュ削除→再実行**。
それでも詰まる場合は **ユーザーに相談してから**コードに触る（憶測修正は過去の罠を再発させるリスクが高い）。

## 削除されたパターン（参考）

過去には SKILL.md 内に Whisper / matching / ffmpeg のコード片を書いて毎回 Claude が実装していたが、
バグが毎回混入する問題があったため `_shared/yt-split-audio.py` に固定化（2026年4月）。
