---
description: YouTube AI動画 音声生成（ElevenLabs API）
---

# YouTube AI動画 音声生成（ElevenLabs API）

台本から ElevenLabs V3 + IVC で音声ファイル（WAV）を生成する。
実装はすべて `_shared/yt-voice.py` に集約されている。

## 入力

- `projects/{slug}/script.md`
- `projects/{slug}/audio/voice_pronunciation_auto.json`（任意・**Mode 1 前にこのスキルが作る**）
- `projects/{slug}/voice_pronunciation.json`（任意・ユーザー手動上書き用）
- `_shared/templates/cta_audio_pcm.wav`（CTA 固定音声・8 スライド分）
- `credentials/elevenlabs_api_key.txt`、`credentials/elevenlabs_voice_id.txt`

## 出力

| パス | 内容 |
|---|---|
| `projects/{slug}/audio/full.wav` | 本編 + CTA 連結済み（ユーザー視聴 / yt-split-audio 入力） |
| `projects/{slug}/audio/full_pcm.wav` | 同上の PCM 版（HeyGen アップロード / Whisper 入力） |
| `projects/{slug}/audio/chunks/chunkNN.wav` | API から返ってきた生 wav（Mode 1 中間生成物） |
| `projects/{slug}/audio/scenes/sceneNN.wav` | scene 単位の wav（Mode 2 で上書き） |
| `projects/{slug}/audio/voice_report.json` | チャンクごとの秒数・結合点リスク |

## 2 モード

### Mode 1: 初回生成（環境変数なしで実行）

#### 手順

1. **`script.md` を読む**
2. **誤読しそうな単語を抽出して JSON 化**:
   - 抽出対象: 英単語・略語（API, MVP, SaaS, KPI 等）、英表記固有名詞（Cursor, Lovable 等）、漢字読みが揺れる単語（行う / 既存 等）
   - 抽出対象外: 一般カタカナ語（パソコン、データ等）、ひらがなの単語
   - 形式: `{"単語": "読み"}`（読みは**カタカナまたはひらがな**。英略語はカタカナ、漢字読み揺れはひらがなが標準）
   - 例: `{"PMF": "ピーエムエフ", "Cursor": "カーソル", "行う": "おこなう", "既存": "きそん"}`
   - 保存先: `projects/{slug}/audio/voice_pronunciation_auto.json`
3. **実行**（cwd 不問・絶対パス指定）:

```bash
HEYGEN_SLUG={slug} /Users/naru/.pyenv/versions/3.13.0/bin/python3 \
  /Users/naru/Walkers_naru/05_development/youtube/_shared/yt-voice.py
```

→ `audio/full.wav` 生成。後段の yt-split-audio の入力になる。

### Mode 2: scene 単位の修正

ユーザーから「scene14 の◯◯がおかしい」と FB を受けたとき:

1. **`projects/{slug}/voice_pronunciation.json` に修正を追記**（例: `{"PMF": "ピーエムエフ"}`）
   - `voice_pronunciation_auto.json` は触らない（Mode 1 で再生成される前提・Mode 2 では編集対象外）
2. **実行**（cwd 不問・絶対パス指定）:

```bash
REGEN_SCENES=14 HEYGEN_SLUG={slug} /Users/naru/.pyenv/versions/3.13.0/bin/python3 \
  /Users/naru/Walkers_naru/05_development/youtube/_shared/yt-voice.py
```

→ `audio/scenes/scene14.wav` だけ上書き。`full.wav` や他 scene は触らない。
→ HeyGen にはユーザーが手動で再アップ。

複数 scene 同時指定可: `REGEN_SCENES=14,16,20`

#### scene 番号 = slide 番号（CTA 込み）

`script.md` の `### 【スライドN】` の N がそのまま scene 番号になる（CTA も同じ通し番号）。

| 例 | 構成 | 本編 scene | CTA scene |
|---|---|---|---|
| 35 スライド構成（本編 27 + CTA 8） | slides 1-35 | scenes 1-27 | scenes 28-35 |
| 28 スライド構成（本編 20 + CTA 8） | slides 1-28 | scenes 1-20 | scenes 21-28 |
| 33 スライド構成（本編 25 + CTA 8） | slides 1-33 | scenes 1-25 | scenes 26-33 |

**scene 番号の特定方法**: `script.md` の `### 【スライドN】タイトル` を見て、タイトルに「末尾スライド」または「CTA N」が含まれるスライド番号 = CTA scene 番号（`REGEN_SCENES` で指定不可）。それ以外 = 本編 scene 番号（`REGEN_SCENES` で指定可）。

## 環境変数

| 変数 | 必須 | 用途 |
|------|------|------|
| `HEYGEN_SLUG` | ✅ | プロジェクトディレクトリ名 |
| `REGEN_SCENES` | | scene 番号のカンマ区切り。指定時は Mode 2 |

## 発音マップの優先順位

```
BASE_MAP（スクリプト内ハードコード・最小限）
  ↓ 上書き
voice_pronunciation_auto.json（このスキルが Mode 1 で生成）
  ↓ 上書き
voice_pronunciation.json（ユーザー手動上書き）
```

同じキーは後勝ち。

## CTA scenes

末尾 8 scenes（CTA）は `_shared/templates/cta_audio_pcm.wav` を流し込む。**API は呼ばない**（コスト削減）。
`REGEN_SCENES=36` 等で CTA scene 番号が指定されると **エラー停止**。テンプレ自体を変えたい場合は `_shared/templates/` を別作業で更新。

## 鉄の掟（破ったら音声が途切れる）

1. **1 チャンク最大 2000 文字**（`_shared/yt-voice.py` の assert で強制）
2. **CTA は毎回生成しない**（テンプレ流し込み）
3. **「AI・」の中黒は「AI、」に変換**（変な間が入る）
4. **CTA テンプレートは `cta_audio_pcm.wav` を使う**（`cta_audio.wav` は中身 MP3 で結合に失敗する）
5. **結合は filter_complex concat**（`-c copy` はチャンク境界で音切れ）
6. **結合後の秒数検証**（チャンク合計 + 無音パッド + CTA ≒ full.wav、±5秒以内 assert）
7. **scene wav は 1.0 秒以上**（HeyGen 制約「> 1 秒」・2026-05-20 追加）
   - 1.0秒未満で生成された場合、`yt-voice.py` Mode 2 と `yt-split-audio.py` が `sys.exit(1)` で停止
   - 対処: `script.md` の該当 scene ナレーション原稿を膨らます（最低15文字目安）
   - 事前防止ルールの詳細は `.claude/skills/yt-script/SKILL.md` 「scene の最低秒数」セクション参照

## 編集禁止（CRITICAL）

`_shared/yt-voice.py` は実機検証済みコード。挙動が変なら **まず `audio/chunks/` を消して再実行**。
それでも詰まる場合は **ユーザーに相談してから**コードに触る（憶測修正は過去の罠を再発させるリスクが高い）。

## 詰まった時の対処

| 症状 | 対処 |
|------|------|
| 「CTA scenes を検出できなかった」 | `script.md` のスライドタイトルに「末尾スライドN」または「CTA N」を含めること |
| 「CTA scenes が ≥9 件」 | タイトルパターン誤検出。本編のスライドタイトルに「末尾スライド」「CTA N」が入ってないか確認 |
| 「チャンクが 2000 文字超え」 | `script.md` のセクションタイトルを増やすか、本文を短くする |
| 「CTA 欠落の疑い: 差分 ◯秒」 | `_shared/templates/cta_audio_pcm.wav` の存在と長さ確認（約 1 分 45 秒） |
| ElevenLabs API 5xx | 1 回リトライ後失敗で停止。クレジット残量・ネット確認 |
| Mode 2 で「scene 番号が script.md に存在しない」 | `script.md` の `### 【スライドN】` 番号を確認 |

## 削除されたパターン（参考）

過去には SKILL.md 内に Python コード片を書いて毎回 Claude が voice_gen.py を実装していたが、以下の理由で `_shared/yt-voice.py` に固定化（2026-05-01）:

- 毎回バグ混入
- 1 単語修正で全チャンク再生成（API 料金 8 倍）
- 発音マップを Claude が手動メンテ → 漏れがち

新方式: 固定スクリプト + 発音マップ JSON 3 層 + scene 単位部分再生成。
