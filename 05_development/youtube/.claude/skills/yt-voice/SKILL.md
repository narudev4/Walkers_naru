---
description: YouTube AI動画 音声生成（ElevenLabs API）
---

# YouTube AI動画 音声生成（ElevenLabs API）

台本から ElevenLabs V3 + IVC で音声ファイル（WAV）を生成する。

## 鉄の掟（破ったら音声が途切れる。過去5回以上事故発生）

1. **1チャンク最大2000文字**（assertで強制。超えたら即エラー）
2. **CTAは毎回生成しない**（テンプレート音声を結合する）
3. **「AI・」の中黒は「AI、」に変換**（変な間が入る）
4. **CTAテンプレートは必ず `cta_audio_pcm.wav` を使う**（`cta_audio.wav` は中身がMP3なので結合に失敗する。絶対に使わない）
5. **結合後に秒数検証を必ず行う**（本編チャンク合計 + CTA秒数 ≒ full.wav秒数。CTA分が欠落していないかassertする）

## 入力

$ARGUMENTS に台本ファイルパスまたはスラッグが渡される。

- パスの場合: そのファイルを読み込む
- スラッグの場合: `projects/{slug}/script.md` を読み込む
- 引数なしの場合: `projects/` 内の最新の `*-script.md` を使用

## 処理フロー（6ステップ）

### STEP 1: 本編テキスト抽出（CTAは除外）

1. 台本MDを読み込む
2. 各 `### 【スライドN】` のナレーションテキストを抽出
3. **「末尾スライド」で始まるスライドは全て除外**（CTAはテンプレート使用）
4. HTMLコメント除去

### STEP 2: テキスト修正

#### 発音修正（二重適用OK）
```python
import re

PRONUNCIATION_MAP = {
    'ノーコード': 'のーこーど',
    'ローコード': 'ろーこーど',
    'Walkers': 'ウォーカーズ',
    'Cursor': 'カーソル',
    'Claude Code': 'クロードコード',
    'Lovable': 'ラバブル',
    'Next.js': 'ネクストジェイエス',
    'React': 'リアクト',
    'Flutter': 'フラッター',
    'Python': 'パイソン',
    'Bubble': 'バブル',
    'Adalo': 'アダロ',
    'Glide': 'グライド',
    'MVP': 'エムブイピー',
    'LP': 'エルピー',
    'API': 'エーピーアイ',
    'SSL': 'エスエスエル',
    'LLM': 'エルエルエム',
    'CLI': 'シーエルアイ',
    'iOS': 'アイオーエス',
    'Android': 'アンドロイド',
    'VS Code': 'ブイエスコード',
    'Dify': 'ディフィ',
    'env': 'えんぶ',
    # 漢字誤変換対策
    '社内': 'しゃない',
    '既存': 'きそん',
    '基幹': 'きかん',
    '保守': 'ほしゅ',
    '可視化': 'かしか',
    '行っている': 'おこなっている',
    '行っております': 'おこなっております',
    '行う': 'おこなう',
    '行い': 'おこない',
}

def apply_fixes(text):
    for k, v in PRONUNCIATION_MAP.items():
        text = text.replace(k, v)
    # 中黒修正: 「AI・」→「AI、」（他の「・」はそのまま）
    text = re.sub(r'AI・', 'AI、', text)
    return text
```

#### Audio Tags挿入
| 場面 | タグ | 目安数 |
|------|-----|-------|
| セクション遷移の直前 | `[pause]` | 5〜7箇所 |
| 数字の前後 | `[pause]` `[deliberate]` | 3〜5箇所 |
| 強調 | `[excited]` | 2〜3箇所 |
| 冒頭 | `[calm]` | 1箇所 |
| 自然さ | `[breathes]` `[hesitates]` | 3〜5箇所 |

### STEP 3: 2000文字以下にチャンク分割（CRITICAL）

```python
# セクションタイトルスライドの境界で分割
# さらに2000文字を超えるならスライド単位で分割

for i, chunk in enumerate(chunks):
    print(f"Chunk {i+1}: {len(chunk)} chars")
    assert len(chunk) <= 2000, f"BLOCKED: Chunk {i+1} is {len(chunk)} chars!"
```

分割ルール:
- **1チャンク最大2000文字（絶対超えない）**
- 分割位置: セクションタイトルスライドの境界 → 収まらなければスライド単位
- 文章の途中で切らない
- 各チャンクの文字数をprint出力で確認

### STEP 4: ElevenLabs API呼び出し

```python
import requests

api_key = open("credentials/elevenlabs_api_key.txt").read().strip()
voice_id = open("credentials/elevenlabs_voice_id.txt").read().strip()

url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
headers = {
    "xi-api-key": api_key,
    "Content-Type": "application/json",
    "Accept": "audio/wav"
}

for i, chunk in enumerate(chunks):
    data = {
        "text": chunk,
        "model_id": "eleven_v3",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0
        }
    }
    response = requests.post(url, json=data, headers=headers)
    assert response.status_code == 200, f"API error: {response.status_code}"
    with open(f"/tmp/chunk{i+1}.wav", "wb") as f:
        f.write(response.content)
    print(f"Chunk {i+1}: {len(response.content)} bytes saved")
```

### STEP 5: PCM変換 → トリム → filter_complex結合 → CTA結合

**⚠ 鉄の掟: `ffmpeg -f concat -c copy` での単純結合は絶対禁止。チャンク境界で音が途切れる（過去3回事故発生）。必ず filter_complex concat フィルタを使うこと。**

```bash
# 1. 各チャンクをPCM変換
for f in /tmp/chunk*.wav; do
    base=$(basename "$f" .wav)
    ffmpeg -y -i "$f" -acodec pcm_s16le -ar 44100 -ac 1 "/tmp/${base}_pcm.wav"
done

# 2. CTAテンプレートをPCM版で準備（CRITICAL: cta_audio.wavは中身MP3なので絶対使わない）
CTA_PCM="_shared/templates/cta_audio_pcm.wav"
if [ ! -f "$CTA_PCM" ]; then
    ffmpeg -y -i "_shared/templates/cta_audio.wav" -acodec pcm_s16le -ar 44100 -ac 1 "$CTA_PCM"
fi

# 3. 各チャンクの先頭/末尾の無音をトリム
for f in /tmp/chunk*_pcm.wav; do
    base=$(basename "$f" .wav)
    # 先頭無音をトリム
    ffmpeg -y -i "$f" -af "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB" "/tmp/${base}_head_trimmed.wav"
    # 末尾無音をトリム（reverse→先頭トリム→reverse）
    ffmpeg -y -i "/tmp/${base}_head_trimmed.wav" -af "areverse,silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,areverse" "/tmp/${base}_trimmed.wav"
done

# 4. 0.3秒の無音パッドを生成（チャンク間の自然な間）
ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 -acodec pcm_s16le /tmp/silence_pad.wav

# 5. filter_complex concat で結合（単純concat -c copy は絶対禁止）
#    Pythonで動的にfilter_complex文字列を構築する
```

```python
import subprocess, glob, os

# トリム済みチャンクファイルを取得（ソート）
trimmed_chunks = sorted(glob.glob("/tmp/chunk*_pcm_trimmed.wav"))
silence_pad = "/tmp/silence_pad.wav"
cta_pcm = os.path.abspath("_shared/templates/cta_audio_pcm.wav")
slug_audio_dir = "projects/{slug}/audio"

# ffmpeg入力リストを構築: chunk1, silence, chunk2, silence, ..., chunkN, silence, CTA
inputs = []
for chunk_path in trimmed_chunks:
    inputs.append(chunk_path)
    inputs.append(silence_pad)
inputs.append(cta_pcm)  # 最後にCTA

# ffmpegコマンド構築
cmd = ["ffmpeg", "-y"]
for inp in inputs:
    cmd.extend(["-i", inp])

# filter_complex: [0][1][2][3]...[N]concat=n=N+1:v=0:a=1[out]
n = len(inputs)
filter_parts = "".join(f"[{i}]" for i in range(n))
filter_complex = f"{filter_parts}concat=n={n}:v=0:a=1[out]"

cmd.extend([
    "-filter_complex", filter_complex,
    "-map", "[out]",
    "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1",
    f"{slug_audio_dir}/full_pcm.wav"
])

print(f"Combining {len(trimmed_chunks)} chunks + {len(trimmed_chunks)} silences + 1 CTA = {n} inputs")
result = subprocess.run(cmd, capture_output=True, text=True)
assert result.returncode == 0, f"ffmpeg failed: {result.stderr}"

# full.wavもコピー
import shutil
shutil.copy(f"{slug_audio_dir}/full_pcm.wav", f"{slug_audio_dir}/full.wav")
print("Done: full_pcm.wav and full.wav created")
```

**なぜ filter_complex が必須か:**
- `concat -c copy` はバイナリ結合。ElevenLabsが各チャンクに付けるフェードイン/フェードアウトがそのまま残り、結合点で「ブツッ」と切れる
- `filter_complex concat` はデコード→再エンコードするため、チャンク間のフェードが自然に処理される
- 0.3秒の無音パッドがセクション遷移の自然な間として機能する

### STEP 6: 検証（CRITICAL: CTA欠落検知）

```bash
# 各チャンクの秒数を確認
CHUNK_TOTAL=0
for f in /tmp/chunk*_pcm.wav; do
    dur=$(ffprobe -i "$f" -show_entries format=duration -v quiet -of csv=p=0)
    echo "$(basename $f): ${dur}秒"
    CHUNK_TOTAL=$(echo "$CHUNK_TOTAL + $dur" | bc)
done

# CTAテンプレートの秒数
CTA_DUR=$(ffprobe -i _shared/templates/cta_audio_pcm.wav -show_entries format=duration -v quiet -of csv=p=0)
echo "CTA template: ${CTA_DUR}秒"

# 全体の秒数
FULL_DUR=$(ffprobe -i projects/{slug}/audio/full_pcm.wav -show_entries format=duration -v quiet -of csv=p=0)
echo "Full audio: ${FULL_DUR}秒"

# 期待値との差分チェック（±5秒以内なら合格）
EXPECTED=$(echo "$CHUNK_TOTAL + $CTA_DUR" | bc)
DIFF=$(echo "$FULL_DUR - $EXPECTED" | bc)
echo "Expected: ${EXPECTED}秒 / Actual: ${FULL_DUR}秒 / Diff: ${DIFF}秒"
```

**CTA欠落チェック（assert）:**
- `full.wav秒数` ≒ `チャンク合計 + CTA秒数`（±5秒以内）でなければ**CTA結合に失敗している**
- CTA分（約105秒）が丸ごと欠落するパターンが過去に発生。原因は`cta_audio.wav`（中身MP3）を使ったこと
- **必ず `cta_audio_pcm.wav` を使い、秒数assertを通すこと**

出力後 `open -R projects/{slug}/audio/full.wav` でFinderを開く。

## CTAテンプレート

- ファイル: `_shared/templates/cta_audio_pcm.wav`（PCM 44100Hz mono, 約1分45秒）
- 内容: 末尾スライド1〜8の固定ナレーション（毎動画共通）
- **毎回APIで生成しない。テンプレートを結合するだけ。**

### テンプレートが存在しない場合
CTA台本テキストを**単独で1回のAPIコール**（2000文字以内）で生成し保存:
```bash
mkdir -p _shared/templates/
ffmpeg -y -i cta_raw.wav -acodec pcm_s16le -ar 44100 -ac 1 _shared/templates/cta_audio_pcm.wav
```

### テンプレート再生成が必要な場合
CTA台本の文言が変わったときのみ。

## 出力先

- `projects/{slug}/audio/full.wav`
- `projects/{slug}/audio/full_pcm.wav`（HeyGenアップロード用・Whisper分割用）

## 品質チェック

- [ ] 各チャンクが2000文字以下であること（assert通過）
- [ ] 各チャンクの音声秒数が妥当か（極端に短い→途切れの可能性）
- [ ] チャンク繋ぎ目で途切れ・不自然なポーズがないか
- [ ] 全体秒数が台本想定尺に近いか
- [ ] 発音修正が適用されているか（特に「のーこーど」）
- [ ] 最後2分（CTA部分）を再生して途切れがないか
- [ ] 「AI、のーこーど」の間が自然か

## ユーザー確認用：チャンク結合点テーブル（CRITICAL）

音声生成完了後、ユーザーに以下の形式で**切れやすいタイムスタンプ一覧**を必ず提示する。
チャンク末尾の累積秒数を算出し、リスクを「高/中/低」で判定する。

**表示順: タイムスタンプの昇順（時系列順）で並べる。** リスク順ではない。

```
| リスク | タイムスタンプ | 内容 | チェック理由 |
|--------|-------------|------|-------------|
| 低 | **1:22付近** | チャンク1末尾（オープニング終わり） | 595字 |
| 低 | **3:19付近** | チャンク2末尾（{セクション名}終わり） | 735字 |
| 中 | **8:04付近** | チャンク4末尾（{セクション名}終わり） | 1261字 |
| 中 | **13:17付近** | CTAテンプレート接合部 | CTA結合点 |
```

**リスク判定基準:**
- 高: 1500文字以上のチャンク末尾
- 中: 1000〜1499文字のチャンク末尾、またはCTAテンプレート接合部
- 低: 999文字以下のチャンク末尾
