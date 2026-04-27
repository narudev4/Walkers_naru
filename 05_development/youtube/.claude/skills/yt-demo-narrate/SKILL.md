---
description: YouTube AI動画 実演動画用ナレーション生成（Claude vision + ElevenLabs）
---

# YouTube AI動画 実演動画ナレーション生成

記事内に含まれる**実演動画（操作デモ等）**に対して、Claude visionで画面解析しナレーション原稿を生成、ElevenLabsで音声化するスキル。

## 前提

- 実演動画は**音声なしのMP4**であることが多い（手動録画）
- 本編ナレーション（`script.md`）とは別に、実演動画専用のナレーションが必要
- HeyGenは動画を背景にしてアバターを重ねられる（検証済み）

## 入力

`$ARGUMENTS` にスラッグまたは動画ファイルパスが渡される。

- スラッグの場合: `projects/{slug}/demo.mp4` or `projects/{slug}/*実演*.mp4` を自動検出
- 複数動画がある場合: ユーザーに選択を促す

## 処理フロー（2フェーズ）

```
Phase 1: ナレーション原稿生成（自動 → 人間確認）
  ↓
✋ 確認ゲート（ユーザーOKで続行）
  ↓
Phase 2: 音声化 + 尺調整（自動）
```

---

### Phase 1: ナレーション原稿生成

#### STEP 1: 動画メタデータ取得

```bash
DEMO=projects/{slug}/demo.mp4
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$DEMO")
echo "動画尺: ${DURATION}秒"
# 目標文字数: 7字/秒 × 動画尺 × 0.95（余裕を持たせる）
TARGET_CHARS=$(python3 -c "print(int(float('$DURATION') * 7 * 0.95))")
echo "目標文字数: ${TARGET_CHARS}字"
```

#### STEP 2: キーフレーム抽出

```bash
# 10秒間隔で抽出
mkdir -p /tmp/demo-frames-{slug}
ffmpeg -y -i "$DEMO" -vf "fps=1/10" /tmp/demo-frames-{slug}/frame_%02d.jpg

# サイズを1280pxに縮小（vision処理高速化）
for f in /tmp/demo-frames-{slug}/*.jpg; do
    sips -Z 1280 "$f" --out "$f"
done
```

#### STEP 3: Claude vision解析

各フレームをReadツールで読み、以下を認識:
- 画面内のテキスト（日本語UI要素含む）
- 操作の進行状況（どのステップにいるか）
- 時系列の変化（前のフレームから何が変わったか）

**出力フォーマット:**
```
| 時刻 | 画面内容 | 操作状況 |
|------|---------|---------|
| 0:00 | ... | ... |
| 0:10 | ... | ... |
...
```

#### STEP 4: ナレーション原稿生成

vision解析結果 + `article.md`（該当セクション）+ `script.md`（該当スライド）を参考に、**目標文字数に収まる**ナレーション原稿を生成。

**鉄の掟（CRITICAL — 過去の事故から）:**

1. **各ナレーションセクションは動画の時刻範囲と1:1対応させる**
   （セクション内で5秒以上の画面変化があれば更に分割）
2. **動画の最終フレーム内容もナレーションに組み込む**
   （例: 動画末尾にモーダルが出てるなら、そのモーダルに言及する文を用意）
3. **目標文字数の算出は「実測速度 7.5字/秒」を使用**
   （初期の 7字/秒 設定では遅く見積もって音声が短くなる事故発生 @what-is-make）
4. **無音パッドは絶対NG**。ナレーションが動画より明らかに短い（<0.9×）場合は原稿を**伸ばして再生成**。埋めない。

**ルール:**
- 本編台本と同じ発音ルール（のーこーど、グライド、ウォーカーズ、おこなう等）
- 文末の「ですよ」は5箇所以下に抑制（`feedback_yt_script_ndesuyo.md`）
- 動画の時系列に沿ったタイムライン構造
- 各セクションの文字数を集計して目標との差分を明示

**出力先:** `projects/{slug}/demo_narration.md`

**テンプレート構造:**
```markdown
# {動画名} ナレーション原稿

**動画**: demo.mp4
**動画尺**: XXX秒
**目標文字数**: 約XXX字
**配置**: 本編STEP N（XXX）の実演部分

---

## ナレーション本文（タイムライン対応）

### 【0:00〜0:10】セクション名（約N字）
ナレーション本文...

### 【0:10〜0:25】...
...

---

## 発音ルール適用済み
...

## 文字数集計
...
```

#### STEP 5: 確認ゲート（CRITICAL）

**必ずユーザーに原稿を見せて OK をもらうまで Phase 2 に進まない。**

```
✅ Phase 1 完了: ナレーション原稿を生成しました。

📄 原稿: projects/{slug}/demo_narration.md

目標尺: {target_chars}字 / 実際: {actual_chars}字（差分: ±{diff}字）

━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 あなたの作業:
  1. 原稿を確認してください
  2. 修正したい箇所があれば指示してください
  3. OKなら「OK」と言ってください
━━━━━━━━━━━━━━━━━━━━━━━━━━━
→ 「OK」で Phase 2（音声化）に進みます。
```

---

### Phase 2: 音声化 + 尺調整

#### STEP 6: テキスト修正（yt-voice と同じ）

```python
PRONUNCIATION_MAP = {
    'ノーコード': 'のーこーど',
    'Glide': 'グライド',
    'Walkers': 'ウォーカーズ',
    'AI': 'AI',  # そのまま
    '行う': 'おこなう',
    # ... yt-voice と同じルール
}
# 「AI・」→「AI、」変換も同様
```

Audio Tags は最小限（2分尺なので`[pause]` 2-3箇所、`[calm]`冒頭1箇所程度）

#### STEP 7: ElevenLabs API呼び出し

**中間ファイルは `/tmp/demo-narrate-{slug}/` に書き出す**（`projects/{slug}/` を汚さない）。最終成果物だけ `projects/{slug}/demo_narration.wav` に置く。

**次回実行時の再利用ポリシー:** TMP_DIR が残っていても**削除は不要**。`os.makedirs(..., exist_ok=True)` で素通し、`requests.post` は `raw.wav` を上書き、以降の `ffmpeg -y` も全て上書き動作のため、前回 crash で掃除が走らなかった場合でも自動で再生成される。手動で `rm -rf` する必要はない。

2分尺（最大840字程度）なら**1チャンクで完結**（2000字制限内）:

```python
import os
import requests

TMP_DIR = f"/tmp/demo-narrate-{slug}"
os.makedirs(TMP_DIR, exist_ok=True)

api_key = open("/Users/naru/Walkers_naru/credentials/elevenlabs_api_key.txt").read().strip()
voice_id = open("/Users/naru/Walkers_naru/credentials/elevenlabs_voice_id.txt").read().strip()

url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
headers = {
    "xi-api-key": api_key,
    "Content-Type": "application/json",
    "Accept": "audio/wav"
}
data = {
    "text": narration_text,
    "model_id": "eleven_v3",
    "voice_settings": {
        "stability": 0.5,
        "similarity_boost": 0.75,
        "style": 0.0,
        "speed": 1.0  # 初回は 1.0 で生成
    }
}
r = requests.post(url, json=data, headers=headers)
assert r.status_code == 200
with open(f"{TMP_DIR}/raw.wav", "wb") as f:
    f.write(r.content)
```

#### STEP 8: PCM変換 + 無音トリム

```bash
TMP=/tmp/demo-narrate-{slug}

# PCM変換
ffmpeg -y -i $TMP/raw.wav \
    -acodec pcm_s16le -ar 44100 -ac 1 \
    $TMP/pcm.wav

# 冒頭/末尾の無音トリム
ffmpeg -y -i $TMP/pcm.wav \
    -af "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB" \
    $TMP/head.wav

ffmpeg -y -i $TMP/head.wav \
    -af "areverse,silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,areverse" \
    $TMP/trimmed.wav
```

#### STEP 9: 尺検証 + 自動補正

最終成果物だけ `projects/{slug}/demo_narration.wav` に書き出す。

```python
import subprocess

TMP_DIR = f"/tmp/demo-narrate-{slug}"
FINAL = f"projects/{slug}/demo_narration.wav"

def get_duration(path):
    r = subprocess.run(["ffprobe", "-v", "error",
                        "-show_entries", "format=duration",
                        "-of", "default=noprint_wrappers=1:nokey=1", path],
                       capture_output=True, text=True)
    return float(r.stdout.strip())

video_dur = get_duration(f"projects/{slug}/demo.mp4")
narr_dur = get_duration(f"{TMP_DIR}/trimmed.wav")

ratio = narr_dur / video_dur
diff_pct = (ratio - 1) * 100

print(f"動画: {video_dur:.1f}秒 / ナレーション: {narr_dur:.1f}秒 / 差分: {diff_pct:+.1f}%")

if 0.90 <= ratio <= 1.10:
    # ±10%内: atempo で補正
    speed = ratio  # 長い場合は速く、短い場合は遅く
    # atempo は 0.5-2.0 範囲
    subprocess.run([
        "ffmpeg", "-y",
        "-i", f"{TMP_DIR}/trimmed.wav",
        "-filter:a", f"atempo={speed:.4f}",
        "-acodec", "pcm_s16le", "-ar", "44100",
        FINAL
    ])
    print(f"✅ atempo={speed:.4f} で補正完了")
elif ratio < 0.90:
    # 短すぎる: 末尾に無音パッド
    pad_sec = video_dur - narr_dur
    subprocess.run([
        "ffmpeg", "-y",
        "-i", f"{TMP_DIR}/trimmed.wav",
        "-af", f"apad=pad_dur={pad_sec}",
        "-acodec", "pcm_s16le", "-ar", "44100",
        FINAL
    ])
    print(f"⚠ ナレーション短い: {pad_sec:.1f}秒の無音パッドを追加")
else:
    # 長すぎる: ユーザーに判断を委ねる
    print(f"❌ ナレーションが動画より {abs(diff_pct):.1f}% 長い")
    print("   選択肢:")
    print("   A) 原稿を短縮して再生成")
    print("   B) 動画の最終フレームを延長して尺合わせ（ffmpegで対応可）")
    print("   C) 手動録音に切り替え（demo_narration_manual.wav を配置）")
```

#### STEP 10: 中間ファイル掃除 + 最終出力

最終WAVが `projects/{slug}/demo_narration.wav` に存在することを確認してから、中間ディレクトリ `/tmp/demo-narrate-{slug}/` を削除する。

**掃除を飛ばしてはいけない理由:** 中間ファイル4つ合計 ~13MB が `projects/{slug}/` に残ると、git にノイズが入り、次回作業時に「どれが最終？」と迷う。失敗時のデバッグ用途で残したくなるが、原稿 `demo_narration.md` が残っていれば再生成は数秒で済むため不要。

```python
import os, shutil

FINAL = f"projects/{slug}/demo_narration.wav"
TMP_DIR = f"/tmp/demo-narrate-{slug}"

assert os.path.exists(FINAL) and os.path.getsize(FINAL) > 100_000, \
    f"最終WAV {FINAL} が存在しないか異常に小さい。掃除を中止"

shutil.rmtree(TMP_DIR, ignore_errors=True)
print(f"🧹 中間ファイル削除: {TMP_DIR}")
```

```
✅ Phase 2 完了: 音声を生成しました。

📁 出力:
  - projects/{slug}/demo_narration.md     # 原稿
  - projects/{slug}/demo_narration.wav    # 最終音声（動画尺に合わせ済み）

🎬 HeyGen上での配置（手動）:
  該当シーンの背景を demo.mp4 に変更し、
  音声として demo_narration.wav をアップロード
```

## 出力ファイル

```
projects/{slug}/
├── demo.mp4                        # 元の実演動画
├── demo_narration.md               # ナレーション原稿（人間確認済み）
└── demo_narration.wav              # 最終音声（尺調整済み、HeyGenアップロード用）

/tmp/demo-narrate-{slug}/           # 中間ファイル（STEP 10で自動削除）
├── raw.wav                         # ElevenLabs生出力
├── pcm.wav                         # PCM変換版
├── head.wav                        # 冒頭トリム
└── trimmed.wav                     # 冒頭末尾トリム
```

## エラーハンドリング

| エラー | 対応 |
|-------|------|
| demo.mp4 が見つからない | `projects/{slug}/*.mp4` でリストアップしてユーザーに選択してもらう |
| ElevenLabs 429（レート制限） | 30秒wait → リトライ |
| 尺差分 >10% | ユーザーに選択肢提示（短縮/パッド/手動） |
| vision解析で日本語UI文字が誤認識 | 解像度を1920pxに上げて再抽出 |

## 品質チェック

- [ ] 原稿が動画の時系列と一致している
- [ ] 発音ルールが適用されている（のーこーど、グライド等）
- [ ] ナレーション尺と動画尺の差分が ±10% 以内
- [ ] 冒頭/末尾の無音が適切にトリムされている
- [ ] HeyGen上でFit to Scene が効くファイル形式（PCM WAV 44100Hz mono）

## 関連ファイル

- `_shared/heygen-setup.py`: HeyGen自動化（動画背景対応は未実装、別途拡張要）
- `.claude/skills/yt-voice/SKILL.md`: 本編音声生成（発音ルールを共有）
