# YouTube AI動画 音声分割（Whisperコンテンツベース分割）

`/yt-voice` で生成した1本の音声ファイルを、Whisperで文字起こしして台本の内容に基づいてシーンごとに分割する。

## 重要な前提（2026-04-07更新）

- **文字数比率や推定秒数で分割してはいけない**。必ず**コンテンツ内容**で分割する
- **Whisper（mediumモデル以上）**で文字起こしし、各シーンの冒頭フレーズが出現する位置でカットする
- ElevenLabsのWAVは`format 85`（MP3相当）の場合があるので、先に`ffmpeg`で**PCM WAV（pcm_s16le, 44100Hz）に変換**してからWhisperに渡す

## カットポイントの計算（CRITICAL — 2026-04-07更新）

**カットポイント = 現シーンの最後の単語の`end`時刻 + 0.05s**（次シーンの最初の単語の`start`ではない）

```
✅ 正しい: 〜ます。
                  ↑ current_scene_last_word['end'] + 0.05s でカット
❌ 誤り:   〜ます。 [無音] [息吸い] 次のセリフ...
                                    ↑ next_scene_first_word['start'] でカット → 息吸いが混入
```

```python
# 各シーンのカット点計算
scene_words = [w for w in all_words
               if w['start'] >= scene_start and w['start'] < next_scene_start]
if scene_words:
    last_word = max(scene_words, key=lambda w: w['start'])
    cut_end = min(last_word['end'] + 0.05, next_scene_start)
else:
    cut_end = next_scene_start
```

## 既知の問題と対策（CRITICAL）

### 問題：Whisperが2つの文を1セグメントにまとめるケースがある

例：
- セグメント「この点については後で詳しく解説します **3つ目の違い自由度と制約について**」
  → 前半はスライド12の末尾、後半はスライド13の冒頭
- セグメント「続いてですねノーコードの強みと限界について解説していきます **ノーコードが力を発揮するのは**」
  → 前半はスライド14（セクションタイトル）、後半はスライド15の冒頭

**セグメントの開始時間でカットすると、前のシーンの末尾が次のシーンに混入する。**

### 対策：word_timestampsを使った単語レベル分割

1. Whisperの`word_timestamps=True`で**単語レベルのタイムスタンプ**を取得する
2. セグメント内でシーン境界がある場合は、**単語レベルで正確なカットポイント**を特定する
3. セグメント一覧を出力する際に、**各セグメントの全単語タイムスタンプも保存**する

```python
# セグメントだけでなく、単語レベルのタイムスタンプも保存
segments_with_words = []
for s in result['segments']:
    seg = {
        'start': s['start'],
        'end': s['end'],
        'text': s['text'],
        'words': [{'word': w['word'], 'start': w['start'], 'end': w['end']} for w in s.get('words', [])]
    }
    segments_with_words.append(seg)
```

### 対策の具体的な適用方法

セグメント照合で**1つのセグメント内に2シーン分のテキストが含まれている**と判断した場合：

1. そのセグメントの`words`リストを確認
2. 次のシーンの冒頭キーワードに該当するwordを特定
3. そのwordの`start`時間をカットポイントとする

```python
# 例: seg[55] = "この点については後で詳しく解説します 3つ目の違い自由度と制約について"
# → "3つ目" という単語のstart時間でカット
for word in seg['words']:
    if '3つ目' in word['word'] or '自由度' in word['word']:
        cut_time = word['start']
        break
```

## 入力

$ARGUMENTS にスラッグまたは音声ファイルパスが渡される。

- スラッグの場合: `output/youtube/{slug}/audio/full.wav` と `output/youtube/{slug}/script.md` を使用
- パスの場合: そのファイルを処理（台本は同ディレクトリまたは `output/youtube/` から最新を検索）
- 引数なしの場合: `output/youtube/` 内の最新の `full.wav` と `*-script.md` を使用

## 処理フロー

### Phase 1: PCM WAV変換

```bash
ffmpeg -y -i full.wav -acodec pcm_s16le -ar 44100 -ac 1 full_pcm.wav
```

### Phase 2: Whisper文字起こし（単語タイムスタンプ付き）

```python
import whisper, json

model = whisper.load_model("medium")  # baseは精度不足、mediumを使う
result = model.transcribe("full_pcm.wav", language="ja", word_timestamps=True)

# セグメント + 単語タイムスタンプを保存
segments = []
for s in result['segments']:
    seg = {
        'start': s['start'],
        'end': s['end'],
        'text': s['text'],
        'words': [{'word': w['word'], 'start': w['start'], 'end': w['end']} for w in s.get('words', [])]
    }
    segments.append(seg)

with open("/tmp/whisper_segments.json", "w") as f:
    json.dump(segments, f, ensure_ascii=False, indent=2)
```

※ 19分の音声で約5〜10分かかる

### Phase 3: 台本から各シーンの冒頭フレーズを抽出

台本MDをパースし、各スライドのナレーション冒頭テキストを取得する。

```python
import re

# 台本を ### 【 で分割
sections = re.split(r'### 【', content)
scene_markers = []
for sec in sections[1:]:
    # デュアルテキスト対応: 「**ナレーション:**」セクションがあればそこから抽出
    narration_match = re.search(r'\*\*ナレーション:\*\*\s*\n(.+)', sec)
    if narration_match:
        first_sentence = narration_match.group(1).strip()[:30]
    else:
        # 旧フォーマット: ヘッダー行の次の行を取得
        lines = [l for l in sec.split('\n') if l.strip() and not l.startswith('#') and not l.startswith('<!--') and l.strip() != '---' and not l.startswith('**スライド表示')]
        first_sentence = (lines[1] if len(lines) > 1 else lines[0])[:30] if lines else ''
    scene_markers.append(first_sentence)
```

### Phase 4: Whisperセグメントと台本の照合

全セグメントを一覧表示し、各シーンの冒頭フレーズに対応する位置を特定する。

**照合のルール:**
1. Whisperの認識はブレるため、完全一致ではなく**先頭数文字の部分一致**で判定
2. **順序保証**: シーンNの開始位置は、必ずシーンN-1の開始位置より後
3. **1セグメント内に2シーン分が含まれている場合** → 単語タイムスタンプで分割（Phase 4.5）

### Phase 4.5: セグメント内分割（単語レベル精度）

Phase 4で**1つのセグメント内に2シーン分のテキストが含まれている**ことが判明した場合：

```python
def find_word_cut_point(segment, keyword):
    """セグメント内の単語タイムスタンプからカットポイントを特定"""
    for word in segment['words']:
        # キーワードの先頭数文字で照合
        if keyword[:3] in word['word']:
            return word['start']
    # 見つからない場合はセグメントの中間点を返す（フォールバック）
    return (segment['start'] + segment['end']) / 2
```

**よくあるパターン:**
- セクションタイトル + 本文が同セグメント → セクションタイトルの開始 = セグメント開始、本文の開始 = 本文冒頭キーワードの単語start
- 前スライドの末尾 + 次スライドの冒頭が同セグメント → 次スライドの冒頭キーワードの単語startでカット

### Phase 5: FFmpegで分割

```python
for i in range(len(cut_times) - 1):
    start = cut_times[i]
    end = cut_times[i + 1]
    fname = f"scene{i+1:02d}_{name}.wav"
    os.system(f'ffmpeg -y -i full.wav -ss {start:.3f} -to {end:.3f} -acodec pcm_s16le -ar 44100 "{out_dir}/{fname}" 2>/dev/null')
```

## セグメント照合のガイド

### Step 1: 全セグメント一覧を出力

```python
for i, seg in enumerate(segments):
    m, s = int(seg['start'] // 60), seg['start'] % 60
    print(f"[{i:3d}] {m:2d}:{s:05.2f} | {seg['text'][:80]}")
```

### Step 2: 台本と照合して `scene_seg_map` を作成

```python
scene_seg_map = [
    (0,   "title"),           # [0] 皆様こんにちは
    (8,   "toc"),             # [8] 本動画ではこちらの項目
    (11,  "benefit"),         # [11] この動画を見ることで
    # ... 各シーンの開始セグメントindex
]
```

### Step 3: セグメント内分割が必要なケースを特定

照合中に「このセグメントには2シーン分のテキストが含まれている」と気づいたら：

1. そのセグメントの`words`を展開表示する
2. 次のシーンの冒頭キーワードに該当するwordのstart時間を取得
3. `scene_seg_map`の代わりに直接`cut_times`にそのword start時間を使う

```python
# セグメント内の単語を展開表示
seg = segments[55]  # 問題のセグメント
for w in seg['words']:
    print(f"  {w['start']:7.2f} | {w['word']}")
```

## 出力先

- `output/youtube/{slug}/audio/scenes/scene{NN}_{name}.wav`
- 完成後は `open` コマンドでフォルダを開く

## 出力後のアクション

分割完了後、以下を表示する:

```
✅ 音声分割完了（Whisperコンテンツベース分割）

| # | ファイル | 開始 | 長さ | 冒頭テキスト |
|---|---------|------|------|------------|
| 1 | scene01_title.wav | 0:00 | 37.6秒 | 皆様こんにちは... |
...

📁 保存先: output/youtube/{slug}/audio/scenes/
→ HeyGenの各シーンに「音声をアップロード」からアップロードしてください
```

## CTA音声のスライド別分割（CRITICAL — 必ず実行）

HeyGenでは各スライドに個別の音声ファイルが必要。CTAテンプレートは8スライド分が1ファイルにまとまっているため、**本編分割と同じフローでCTAも8ファイルに分割する**。確認不要・自動実行。

### 処理フロー
1. `scene_cta.wav` を Whisper medium (language=ja, word_timestamps=True) で文字起こし
2. 各CTAスライドの冒頭フレーズでカットポイントを特定
3. ffmpegで8ファイルに分割

### CTA各スライドの冒頭フレーズ（照合用）
| # | ファイル名 | 冒頭フレーズ |
|---|-----------|------------|
| 1 | scene{N+1}_cta1.wav | 「アプリ開発研究所ではAI」 |
| 2 | scene{N+2}_cta2.wav | 「具体的にはですね」 |
| 3 | scene{N+3}_cta3.wav | 「また開発期間においても」 |
| 4 | scene{N+4}_cta4.wav | 「またWalkersでは」 |
| 5 | scene{N+5}_cta5.wav | 「とにかくですね」 |
| 6 | scene{N+6}_cta6.wav | 「概要欄にある無料相談」 |
| 7 | scene{N+7}_cta7.wav | 「またたった10個の」 |
| 8 | scene{N+8}_cta8.wav | 「概要欄にある1分で」 |

※ Nは本編の最後のシーン番号。スライド総数に合わせてナンバリングする。

### 出力先
`output/youtube/{slug}/audio/scenes/scene{NN}_cta{1-8}.wav`

## 品質チェック

- [ ] 全シーンのWAVファイルが生成されているか
- [ ] **CTA音声が8ファイルに分割されているか（1ファイルのまま残さない）**
- [ ] 各ファイルがffprobeで正常に読めるか
- [ ] **各シーンの冒頭が台本の内容と一致しているか**（最重要チェック項目）
- [ ] **前のシーンの末尾テキストが次のシーンに混入していないか**（セグメント内分割の確認）
- [ ] 分割ポイントが発話の途中で切れていないか
- [ ] ファイル名にシーン番号とセクション名が入っているか
- [ ] シーン数が台本のスライド数（CTA8枚含む）と一致しているか
