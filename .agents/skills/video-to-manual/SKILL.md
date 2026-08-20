---
description: 動画（Google Drive or ローカル）からマニュアルmarkdownを生成（mlx-whisper + キーフレーム）
---

# 動画→マニュアル化

トリガー: 「動画からマニュアル」「動画文字起こしマニュアル化」「video-to-manual」「録画をマニュアルに」「この動画 manual」

## 概要

Google Drive または ローカルの動画ファイルから、**話者の発言と画面操作**を抽出して**手順マニュアル markdown** を生成するスキル。

note執筆マニュアル（山口流）の作成に使ったフローを一般化したもの。実演型の録画（操作レクチャー・ノウハウ共有・OJT動画）に最適。

## 出力物

```
output/manuals/[topic]/
├── video.mp4              # 動画コピー（または元ファイルへのリンク）
├── audio.wav              # 16kHz mono の抽出音声
├── audio.json             # mlx-whisper の生JSON
├── transcript.txt         # タイムスタンプ付き全文（[start-end] text 形式）
├── transcript_plain.txt   # 平文（ハルシネーション除去済み）
├── frames/                # 10秒ごとのキーフレーム（PNG）
└── manual.md              # 最終マニュアル
```

## 必要ツール

| ツール | 用途 | インストール確認 |
|--------|------|---------------|
| `ffmpeg` | 音声抽出・フレーム抽出 | `which ffmpeg` |
| `mlx_whisper` | Apple Silicon最適化Whisper | `which mlx_whisper` |
| Google Workspace MCP | Drive ダウンロード | `mcp__google-workspace__get_drive_file_download_url` |

未インストールの場合:
```bash
brew install ffmpeg
pip install mlx-whisper
```

## 実行フロー

### Phase 1: 入力受付・ヒアリング

#### 1-A. 動画ソース（必須）

| 入力形式 | 取得方法 |
|---------|---------|
| Google Drive URL（`https://drive.google.com/file/d/XXX/view`） | URLから`fileId`抽出 → `mcp__google-workspace__get_drive_file_download_url` |
| Google Drive fileId | 直接 `mcp__google-workspace__get_drive_file_download_url` |
| ローカル動画パス | そのまま使う |
| YouTube URL | **このスキルでは扱わない**。`youtube-research` スキルを使う |

#### 1-B. トピック名（必須）

出力フォルダ名 `output/manuals/[topic]/` の `[topic]` 部分。

- ユーザー指定があればそれ
- 無ければ動画のファイル名から英数 kebab-case 化して提案（例: `なるなる記事執筆マニュアル.mp4` → `naru-article-manual`）

#### 1-C. マニュアルの目的（任意・聞ける場合は聞く）

最終的なマニュアルの粒度・構成が変わるので、可能なら確認する。1メッセージ1質問の原則に従い、動画ソースとトピック名が揃ったタイミングで聞く。

| 目的 | 構成の傾向 |
|------|----------|
| **手順書として再現** | STEP詳細 + キーフレーム参照を厚く |
| **ノウハウ整理** | 戦略の前提 + 思考プロセスを厚く |
| **受講者向け教材** | チェックリスト + 補足FAQを厚く |

ユーザーが答えに迷う場合は **手順書** をデフォルトとして進める。

**保存ベースパス**: `output/manuals/[topic]/`

### Phase 2: 動画ダウンロード（Drive の場合）

```python
# fileIdは https://drive.google.com/file/d/XXX/view の XXX 部分
mcp__google-workspace__get_drive_file_download_url(file_id="XXX")
```

返り値の `Saved to:` パスから `video.mp4` として作業フォルダにコピー。

### Phase 3: 音声・キーフレーム抽出

#### 変数定義（以降の Phase で再利用）

> **重要**: Bash ツールは呼び出し毎に CWD と環境変数がリセットされる。**毎 Bash 呼び出しの先頭で変数を再定義**するか、**絶対パスをベタ書き**する。

各 Phase の冒頭で次の2変数を定義する想定:

```bash
TOPIC=naru-article-manual          # Phase 1-B で決めたトピック名
WORK=/Users/naru/Walkers_naru/output/manuals/$TOPIC
```

#### 抽出コマンド

```bash
TOPIC=naru-article-manual; WORK=/Users/naru/Walkers_naru/output/manuals/$TOPIC
cd "$WORK" && \
  ffmpeg -y -i video.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le audio.wav && \
  mkdir -p frames && \
  ffmpeg -y -i video.mp4 -vf "fps=1/10,scale=1280:-1" frames/frame_%03d.png && \
  ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 video.mp4
```

#### 動画長の判定 → 戦略分岐

`ffprobe` の出力（秒）を見て分岐する:

| 動画長 | 文字起こし戦略 |
|--------|--------------|
| 10分以下（≤600s） | Phase 4 で**一括**処理 |
| 10〜30分（600〜1800s） | Phase 4 で一括 → Phase 5 のハルシネーション検出に応じて分割 |
| **30分超（>1800s）** | **Phase 4 を飛ばして最初から分割**（下記参照）→ 各 part を Phase 4 にかけて、Phase 5.5 でマージ |

#### 30分超の分割コマンド（10分単位）

```bash
cd "$WORK"
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 video.mp4 | cut -d= -f2 | awk '{printf "%d", $1}')
PART_SEC=600  # 10分単位
PART_COUNT=$(( (DURATION + PART_SEC - 1) / PART_SEC ))

for i in $(seq 0 $((PART_COUNT - 1))); do
  START=$((i * PART_SEC))
  ffmpeg -y -ss $START -t $PART_SEC -i audio.wav \
    -ac 1 -ar 16000 -c:a pcm_s16le "audio_part$((i+1)).wav"
done
```

これで `audio_part1.wav`, `audio_part2.wav` ... が `$WORK` 直下に生成される。各 part の開始秒は `(i-1) * 600` で固定。

### Phase 4: 文字起こし（mlx-whisper）

#### 推奨モデル

| モデル | 用途 |
|--------|------|
| `mlx-community/whisper-large-v3-turbo` | **第一選択**。速くてハルシネーションが起きにくい |
| `mlx-community/whisper-large-v3-mlx` | 精度重視。ただしハルシネーション傾向あり |

#### 一括処理（10分以下）

```bash
TOPIC=naru-article-manual; WORK=/Users/naru/Walkers_naru/output/manuals/$TOPIC
cd "$WORK" && mlx_whisper audio.wav \
  --model mlx-community/whisper-large-v3-turbo \
  --language ja \
  --output-format json \
  --output-dir "$WORK"
```

→ `$WORK/audio.json` が生成される。次は Phase 5 へ。

#### 分割処理（30分超 or 一括が破綻したとき）

Phase 3 で生成した `audio_part1.wav, audio_part2.wav, ...` を順に処理:

```bash
TOPIC=naru-article-manual; WORK=/Users/naru/Walkers_naru/output/manuals/$TOPIC
cd "$WORK"
for f in audio_part*.wav; do
  mlx_whisper "$f" \
    --model mlx-community/whisper-large-v3-turbo \
    --language ja \
    --output-format json \
    --output-dir "$WORK"
done
```

→ `$WORK/audio_part1.json, audio_part2.json, ...` が生成される。次は Phase 5 へ（各 part を個別検査 → Phase 5.5 でマージ）。

> **必ず `--output-dir` に絶対パスを渡す**。run_in_background で実行する場合、相対パスだと CWD 変動で出力ファイルが見つからなくなる事故が実測で発生した。

### Phase 5: ハルシネーション検出・除去（重要）

**mlx-whisper は無音区間や低音量区間で「同じ短いフレーズを延々繰り返す」ハルシネーションに陥りやすい**。これを検出して除去する。

#### 検出関数（一括・分割どちらでも使う）

```python
import json
from pathlib import Path

WORK = Path('/Users/naru/Walkers_naru/output/manuals/naru-article-manual')

# 相槌は5連続以上でも保護（MTG音声等の誤打ち切り防止。2026-05-25 改良）
# NOTE: 「ありがとうございました」は意図的に除外（末尾ハルシネーションの典型）
SHORT_OK = {'はい','うん','ええ','そう','ああ','おう','うーん','なるほど',
            'ありがとう','ありがとうございます','了解','お願いします','すみません'}

def clean_hallucination(segs, repeat_threshold=5):
    """空テキストを除去し、同一テキストN連続スパンを除去（相槌は例外、打ち切りせず継続）。

    旧版は最初の連続スパンで全打ち切りする設計だったが、中間に短い繰り返しスパン
    （「!」、無音区間の繰り返し短句）が散在する音声（MTG等）で本物の会話を取りこぼす
    問題があったため、スパン単位の除去に改良。末尾の長大ハルシネーション（同句が
    延々続く）も同じロジックで除去される。

    実証: meeting-transcribe で not-wdya-kbb (28.7分) を処理した際、旧版は 8.2分で
    誤打ち切り → 改良版で 27.2分の有効逐語を救出。
    """
    segs = [s for s in segs if s['text'].strip()]  # 空テキスト除去
    result = []
    i = 0
    while i < len(segs):
        t = segs[i]['text'].strip()
        j = i
        while j < len(segs) and segs[j]['text'].strip() == t:
            j += 1
        if j - i >= repeat_threshold and t not in SHORT_OK:
            pass  # ハルシネーション・スパン除去
        else:
            result.extend(segs[i:j])
        i = j
    # 互換性のため (採用セグメント, 採用数) を返す
    return result, len(result)

# 一括処理した audio.json を検査する例
data = json.loads((WORK / 'audio.json').read_text())
clean_segs, cutoff = clean_hallucination(data['segments'])
print(f'kept {cutoff}/{len(data["segments"])} segments, last good @ {clean_segs[-1]["end"]:.1f}s')
# NOTE: 改良版は末尾ハルシネーションを除去するため、`clean_segs[-1]["end"]` は
# 「最後の正常発話時刻」を意味する。動画長と比較した残差で retry 要否を判定する。
```

#### 分割時の一括検査ループ

```python
import json
from pathlib import Path
WORK = Path('/Users/naru/Walkers_naru/output/manuals/naru-article-manual')

results = []  # (path, clean_segs, last_good_sec) を集める
for part_json in sorted(WORK.glob('audio_part*.json')):
    data = json.loads(part_json.read_text())
    cs, cutoff = clean_hallucination(data['segments'])
    last_sec = cs[-1]['end'] if cs else 0
    results.append((part_json, cs, last_sec))
    print(f'{part_json.name}: kept {cutoff}/{len(data["segments"])}, last @ {last_sec:.1f}s')
```

このループの結果から「どの part が破綻したか」が一覧で見える。破綻した part は部分再文字起こしの対象。すべて完走しているなら直接 Phase 5.5 のマージへ。

#### カット位置が動画長より大幅に手前 → 部分再文字起こし

例: 動画480秒 / `clean_segs[-1]['end']` が238秒 → 後半240秒分が破綻している。

**retry 閾値（目安）**: `動画長 - clean_segs[-1]["end"] > 60` （秒）。1分以上残っていれば、それは末尾ハルシネーション除去だけでは説明できない量で、本物の会話が残っている可能性が高い。逆に残差が 60秒以内なら、純粋な末尾ハルシネーション（雑談・無音・退出）の除去後と見なし retry 不要。

```python
# 破綻位置の秒数を取得
last_good_sec = clean_segs[-1]['end']         # 例: 238.0
restart_sec = max(0, int(last_good_sec) - 5)  # 5秒余裕を持って戻る → 233s
print(f'restart from {restart_sec}s')
```

```bash
# 上で得た restart_sec を埋め込んで切り出し → 再文字起こし
RESTART=233
ffmpeg -y -ss $RESTART -i audio.wav -ac 1 -ar 16000 -c:a pcm_s16le audio_part_retry.wav
mlx_whisper audio_part_retry.wav \
  --model mlx-community/whisper-large-v3-turbo \
  --language ja \
  --output-format json \
  --output-dir "$WORK"
```

破綻が再度起きたら `restart_sec` を更新してさらに繰り返す（動画末尾まで）。

### Phase 5.5: 複数 part のマージ

分割処理 or 部分再文字起こしで複数の `audio_*.json` ができた場合、オフセットを足してマージする。一括処理だけで完走したならスキップして Phase 6 へ。

```python
import json
from pathlib import Path

WORK = Path('/Users/naru/Walkers_naru/output/manuals/naru-article-manual')

# (json_path, offset_sec, valid_range_start, valid_range_end)
# offset_sec: その part の開始秒（audio.wav 全体の中での位置）
# valid_range: マージ時に採用する秒数範囲（重複領域を捨てる）
sources = [
    (WORK / 'audio.json',             0,   0,   238),  # 一括処理の有効範囲
    (WORK / 'audio_part_retry.json',  233, 238, 333),  # 部分再文字起こし1
    (WORK / 'audio_part_retry2.json', 330, 333, 9999), # 部分再文字起こし2
]

merged = []
for path, offset, vs, ve in sources:
    if not path.exists():
        continue
    data = json.loads(path.read_text())
    for s in data['segments']:
        s['start'] += offset
        s['end']   += offset
        if vs <= s['start'] < ve:
            merged.append(s)

# 最後にもう一度ハルシネーション検査（マージ後に末尾繰り返しが残ることがある）
clean_segs, _ = clean_hallucination(merged)
print(f'merged {len(clean_segs)}/{len(merged)} segments, last @ {clean_segs[-1]["end"]:.1f}s')
```

### Phase 6: 整形 → transcript.txt / transcript_plain.txt

Phase 5（一括）または Phase 5.5（マージ）で確定した `clean_segs` を書き出す:

```python
from pathlib import Path
WORK = Path('/Users/naru/Walkers_naru/output/manuals/naru-article-manual')

# タイムスタンプ付き
with (WORK / 'transcript.txt').open('w') as f:
    for s in clean_segs:
        f.write(f"[{s['start']:.1f}-{s['end']:.1f}] {s['text'].strip()}\n")

# 平文
with (WORK / 'transcript_plain.txt').open('w') as f:
    f.write(' '.join([s['text'].strip() for s in clean_segs]))
```

### Phase 7: キーフレーム読み取り（任意）

操作系・UI解説系の動画では、`frames/frame_*.png` を `Read` で確認しながら**画面側の文脈**を補う。読み取るフレームの選び方:

- 動画の節目（10秒ごとに1枚あるので、トランスクリプトのトピック切り替わり付近）
- 画面が大きく切り替わった可能性のある箇所
- 全部見る必要はない（5〜10枚程度をサンプリング）

非UI系（座学・対談など）はスキップしてよい。

### Phase 8: マニュアル markdown 生成

`$WORK/manual.md` に生成する。Phase 1-C で確認した目的（手順書 / ノウハウ整理 / 教材）に応じて構成の重みを変える。

#### 構成テンプレート（汎用版）

```markdown
# [動画タイトル]

> 出典: 録画「[元ファイル名]」（[日付] / [長さ]）
> 講師: [話者名]
> 文字起こし: `transcript.txt`

## 0. このマニュアルのスコープ
[1段落で要約]

## 1. 戦略の前提（なぜこの作業をやるか）
[話者の動機・背景]

## 2. ツール構成
| 役割 | ツール |
|------|--------|
| ... | ... |

## 3. ワークフロー全体像
```
[ASCII図 or 箇条書きで全体像]
```

## 4. ステップ詳細
### STEP 1: [ステップ名]
[手順・コマンド・スクリーンショット参照]

### STEP 2: ...

## 5. チェックリスト
- [ ] ...

## 6. 未確定事項（要すり合わせ）
| 項目 | 状態 |
|------|------|
| ... | ... |

## 付録: 録画タイムライン
| 時刻 | 内容 |
|------|------|
| 0:08 | [要点] |
| ... | ... |
```

#### 構成は内容に応じて省略・追加してよい

- 操作系 → STEP 詳細 + キーフレーム参照を厚く
- 戦略系 → 戦略の前提 + 思考プロセスを厚く
- ノウハウ系 → ステップ + チェックリストを厚く

#### 引用ルール

- 話者の決め台詞・キーフレーズは **`> 「...」（話者名）`** で引用
- タイムスタンプを書くと後で原典に戻れる: `（[02:45]）`

### Phase 9: 完成・プレビュー

```bash
TOPIC=naru-article-manual; WORK=/Users/naru/Walkers_naru/output/manuals/$TOPIC
~/bin/mo "$WORK/manual.md"
```

ユーザーに完成報告 + プレビュー URL を返す。

## エラー対応

| 症状 | 対処 |
|------|------|
| `mlx_whisper` not found | `pip install mlx-whisper` |
| Drive ダウンロード失敗（権限） | ユーザーに「Driveの共有設定を確認してください」 |
| 文字起こしが途中で破綻（同じフレーズ繰り返し） | Phase 5 のハルシネーション除去 + 部分再文字起こし |
| `large-v3-mlx` で全体的に精度低い | `large-v3-turbo` に切り替え |
| ffprobe が動画長 0 と返す | 動画ファイルが破損。ダウンロードからやり直し |
| 日本語以外の音声が混じる | `--language` を指定しない（自動検出に任せる） or 部分ごとに言語指定 |

## バックグラウンド実行の注意

文字起こしは長尺（数分〜十数分）になりがち。`run_in_background: true` でバックグラウンド実行する場合:

- **出力先は必ず絶対パス**で指定する（`--output-dir /Users/.../output/manuals/[topic]`）
- 相対パスだと CWD が予期せず変わって出力ファイルが消えるリスクがある
- 完了通知が来たら `TaskOutput` で確認

## 関連スキル

- `note-rewrite` — note記事リライト（このスキルで作ったマニュアルを参照する側）
- `youtube-research` — YouTube動画リサーチ（YouTubeはこちら）
- `meeting-minutes` — 会議録音→議事録（似てるが議事録特化）
- `youtube-script` — YouTube台本生成

## 既知の制約

- **mlx-whisper の Apple Silicon 専用**。Intel Mac では `whisper`（OpenAI公式）にフォールバック
- **YouTube動画は扱わない**（別スキル）
- **30分超の動画は分割必須**。分割境界の選び方はユーザーと相談
- **キーフレーム抽出は10秒ごと固定**。細かく見たい場合は ffmpeg で間隔調整

## 進化のヒント

このスキル自体も「録画→文字起こし→学習」のループで改善する想定。
別の動画でうまくいかないケースが出たら、その動画のフォルダで試行錯誤して、得た知見を本 SKILL.md に追記する運用。
