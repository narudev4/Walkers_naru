---
description: 録画/音声ファイルから mlx-whisper で逐語＋構造化議事録を生成し、案件minutes/に保存する。本スキルは「手元に録画ファイルがあるケース」（OBS録画・Drive動画・tl;dv外の録音）用。
---

# MTG文字起こし＋議事録（tl;dv代替）

トリガー: 「MTG文字起こし」「議事録 録画」「meeting-transcribe」「録画から議事録」「会議録音 議事録化」「mtg」

**トリガー優先ルール（既存 `meeting-minutes` との競合回避）**: ユーザーが**録画/音声ファイル or Drive URL を提示**したら本スキル。Gemini メモ起点（録画ソース無し、議事録だけ作って欲しい）なら既存 `meeting-minutes`。「議事録」単独語のトリガーは meeting-minutes 優先。

## 概要

ローカル録画 or Drive の会議録画から、**mlx-whisper で逐語**＋**Claude で構造化議事録**を生成し、`03_projects/{案件}/minutes/{日付}_{会議名}/` に保存する。

**位置づけ（2026-08-20 更新）**: `mtg-pipeline` は削除済み（MTG自動化パイプライン終了）。本スキルは「手元に録画/音声ファイルがあるケース」（OBS 録画・Drive 動画・tl;dv 外の録音・tl;dv transcript の品質が不足する場合の再処理）専用。S3 同期は凍結済みのため同期連鎖は行わない。

## 出力物

```
03_projects/{案件}/minutes/{YYYY-MM-DD}_{会議名}/
├── transcript.txt          # タイムスタンプ付き全文
├── transcript_plain.txt    # 平文
├── minutes.md              # 構造化議事録（フロントマター＋決定事項＋アクション＋チャプター）
├── merge_clean.py          # マージ＋ハルシネーション除去＋ギャップ検出（再処理用）
└── parts/                  # 分割JSON（part_NNN_v3.json）。wav は完成後に削除
```

**録画動画本体・wav は S3 に上げない**（pre-sync-guard が 100MB 超を弾く。`audio.wav` と `parts/*.wav` は議事録完成後に必ず削除）。動画は **Google Drive の「マイドライブ」** か元のローカルパスに置き、`minutes.md` のフロントマターに Drive 共有リンク（または `file://` パス）を記載。

- Google Meet の自動録画はマイドライブの `Meet Recordings`。OBS 録画は既定で `~/Movies/OBS`（`basic.ini` の `RecFilePath` で確認可）
- **共有フォルダ（クライアントと共有しているフォルダ）には絶対に置かない**（decisions.md 2026-04-16 規約）
- 動画と transcript の同期再生（Lark 体験）は v2 の C 案（後述）

## 必要ツール

| ツール | 用途 | 確認 |
|---|---|---|
| `ffmpeg` | 音声抽出・分割 | `which ffmpeg` |
| `mlx_whisper` | 文字起こし（Apple Silicon） | `which mlx_whisper` |
| Google Workspace MCP | Drive 動画取得（必要時） | `mcp__google-workspace__get_drive_file_download_url` |

未インストール: `brew install ffmpeg && pip install mlx-whisper`

## 実行フロー

### Phase 1: ヒアリング（必須・1メッセージ1質問）

**原則：聞かずに自分で調べる（2026-06-03 naru 指示）。** 録画ソースの場所も参加者リストも、まず自力で特定する。ユーザーに聞き返すのは、自力で判定を試みて確証が得られなかった時だけ。

**録画ソースの場所は聞かない。** naru の OBS 録画先は **`~/Movies/OBS/`** で確定。Drive URL や別パスが**明示された時だけ**それを使い、無指定なら必ず `~/Movies/OBS/` を自動探索する。「録画どこ？」と聞き返すのは禁止。
同日に複数録画があるときだけ「どれが対象か」（=ファイルの特定）を、長さ＋開始時刻を提示して確認する。これは場所の質問ではない。

**参加者リストも聞かない（2026-06-03 naru 指示）。** 従来は「必ず聞く」だったが、録画から自分で判定する運用に変更。手順は Phase 1.5 を参照。**自力で判定 → 確証が持てない人物だけ要確認テーブルに `?` 付きで記録**し、ユーザーには議事録完成後にまとめて確認を促す（着手前に聞き返さない）。

| 項目 | 取得方法 |
|---|---|
| 1-A. 録画/音声ソース | **既定 `~/Movies/OBS/` 固定（聞かない）**。無指定なら `~/Movies/OBS` を `find -mtime` で自動探索し最新候補を提示。Drive URL / fileId / 別パスは明示時のみ使用 |
| 1-B. 案件名 | 引数・文脈から特定。`03_projects/` 直下のディレクトリ名（例: `福岡県環境部`）。新規ならその名前で作成 |
| 1-C. 会議名 | 引数・文脈から特定（例: `第3回MTG`）。無ければ日付＋`MTG`で仮置き |
| 1-D. 参加者リスト | **聞かない。Phase 1.5 で録画フレームから自分で判定**。Google Meet なら名前ラベル、対面なら音声の自己紹介から |
| 1-E. 日時 | 録画ファイル名/更新日時から推定（聞かない） |

**録画が複数ある場合**: 各ファイルの長さ（`ffprobe`）と開始時刻（ファイル名）を提示して**どれが対象か必ず確認**する（推測で進めない）。同日に複数の会議を録ることがある。

### Phase 1.5: 参加者を録画から自力判定（聞かない）

**Google Meet / Zoom 等の画面録画の場合（名前ラベルが映る）:**
参加者タイルの名前ラベルを OCR 代わりに画像 Read で読む。手順:
```bash
WORK=/Users/naru/Walkers_naru/03_projects/<案件>/minutes/<日付>_<会議名>
SRC="<動画パス>"
mkdir -p "$WORK/frames"
# まず中盤フレームを数点抽出して、画面のどこに Meet/Zoom パネルがあるか把握
for t in 600 1200 1800; do
  ffmpeg -y -loglevel error -ss $t -i "$SRC" -frames:v 1 "$WORK/frames/at_${t}s.jpg" 2>/dev/null
done
# 動画解像度を確認（crop 座標計算用）
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$SRC"
```
- まず `at_*.jpg` を Read してパネル位置を掴む（OBS だと画面の一部に Meet ウィンドウが小さく映ることが多い）。
- 名前ラベルが小さくて読めない時は、パネル領域を **crop + scale で拡大**してから Read する。**crop 後の画像は長辺 2000px 未満**にすること（API が大きすぎる画像を弾く）。例:
  ```bash
  # Meet パネル(全体の一部)を切り出して拡大。iw/ih は元動画基準の割合で指定
  ffmpeg -y -loglevel error -ss 660 -i "$SRC" -frames:v 1 \
    -vf "crop=iw*0.20:ih*0.16:iw*0.55:ih*0.40,scale=1900:-1" "$WORK/frames/panel.jpg" 2>/dev/null
  python3 -c "from PIL import Image; print(Image.open('$WORK/frames/panel.jpg').size)"  # サイズ確認
  ```
- crop 座標がズレたら割合を調整して撮り直す（数回の試行が普通）。発話中タイルは音声波形アイコンが出るので話者対応の手がかりになる。

**対面・音声のみ（名前ラベルが無い）の場合:**
フレーム判定は使えない。文字起こし後、冒頭の自己紹介や呼びかけ（「○○さん」）から推測し、確証が持てない人物は `?` 付き＋組織単位退避で対応（Phase 7 のルール）。

**判定できた参加者は Phase 7・Phase 8 のフロントマターに反映。読めなかった/確信が持てない人物は要確認テーブルに記録し、議事録完成報告時にまとめてユーザー確認を促す。**

**会議名の正規化**: スペース・全角空白は `_` に、`/\?!:*"<>|()` 等の禁則記号は除去。

### Phase 2: 動画/音声取得

**Drive:** `mcp__google-workspace__get_drive_file_download_url(file_id="XXX")` の `Saved to:` パスを使う。
**ローカル/OBS:** パスをそのまま使う。探索例:
```bash
find ~/Movies/OBS ~/Downloads ~/Desktop -type f \( -iname "*.mkv" -o -iname "*.mp4" -o -iname "*.mov" \) -mtime -3 -exec ls -lah {} \;
```

### Phase 3: 音声抽出＋分割

```bash
SRC="<取得した動画パス>"
WORK=/Users/naru/Walkers_naru/03_projects/<案件>/minutes/<日付>_<会議名>
mkdir -p "$WORK/parts"
ffmpeg -y -loglevel error -i "$SRC" -vn -ac 1 -ar 16000 -c:a pcm_s16le "$WORK/audio.wav"
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$WORK/audio.wav"
```

| 動画長 | 戦略 |
|---|---|
| ≤30分 | `audio.wav` を一括処理 |
| >30分 | 10分(600秒)単位に分割してループ |

分割（>30分）:
```bash
ffmpeg -y -loglevel error -i "$WORK/audio.wav" -f segment -segment_time 600 -c copy "$WORK/parts/part_%03d.wav"
ls "$WORK/parts/"   # part_000.wav 〜。長尺ほどパート数が増える（60分→7本, 90分→9本）
```

### Phase 4: 文字起こし（mlx-whisper）

**✅ 推奨レシピ（2026-05-28 同一音声で turbo と直接比較して確定）:**
- **モデル: `mlx-community/whisper-large-v3-mlx`**（非turboのフル版）。turbo より**文章が崩れず句読点付きの完全文**になる。Apple Silicon では処理速度はほぼ同じ（10分音声で約16秒）。
- **`--condition-on-previous-text True`**（既定ON）。large-v3 は反復暴走に強いため、文脈補正をONにしても暴走せず、文の一貫性が上がる。
- `--hallucination-silence-threshold 2` ＋ `--word-timestamps True` を併用。

```bash
# ≤30分（一括）
cd "$WORK" && mlx_whisper audio.wav \
  --model mlx-community/whisper-large-v3-mlx \
  --language ja \
  --condition-on-previous-text True \
  --hallucination-silence-threshold 2 \
  --word-timestamps True \
  --output-format json \
  --output-dir "$WORK"
```

```bash
# >30分（分割を全パートでループ。run_in_background: true 推奨）
cd "$WORK/parts"
for p in part_*.wav; do
  base="${p%.wav}"
  mlx_whisper "$p" \
    --model mlx-community/whisper-large-v3-mlx \
    --language ja \
    --condition-on-previous-text True \
    --hallucination-silence-threshold 2 \
    --word-timestamps True \
    --output-format json \
    --output-name "${base}_v3" \
    --output-dir "$WORK/parts"
done
```

| フラグ | 効果 |
|---|---|
| `--model ...whisper-large-v3-mlx` | **精度の主因**。turbo は速いが日本語の文が断片化・誤変換しやすい。large-v3-mlx で固有名詞（Vercel/INPEX/人名）も正確に |
| `--condition-on-previous-text True` | 文脈補正ON。文の一貫性が上がる。large-v3 なら暴走しない |
| `--hallucination-silence-threshold 2` | 無音2秒超の捏造（「ご視聴ありがとうございました」型）を抑制 |
| `--word-timestamps True` | セグメント境界・タイムスタンプ精度。後段のギャップ検出が正確に |

**⚠️ モデル名の落とし穴**: `mlx-community/whisper-large-v3`（`-mlx` なし）は**存在せず認証エラーになる**。必ず `-mlx` 付き、または `-turbo` 付きの正式名を使う。初回はモデルDL（large-v3-mlx は約3GB）。`ls ~/.cache/huggingface/hub/` で `models--mlx-community--whisper-large-v3-mlx` があればDL済み。

**❌ `--initial-prompt`（固有名詞ヒント）は使わない（2026-05-28 実証で逆効果）。** プロンプト語（例「福岡県」）に引っ張られ、無音区間でその語を連発する暴走を誘発する。固有名詞の揺れは Phase 7 で Claude が文脈補正＋「固有名詞・要確認」テーブルに記録する運用でカバー。

**フォールバック（turbo を使わざるを得ない時）**: 速度最優先や large-v3-mlx 未DLで急ぐ場合のみ `--model mlx-community/whisper-large-v3-turbo` ＋ `--condition-on-previous-text False`（turbo は文脈ON だと「昔昔昔…」型の反復暴走を起こすため必ず False）。ただし精度は明確に落ちる。

**検証は1パート先行**: 失敗が疑われたら最悪のパート1つだけ先に試し、コンテンツ復活を確認してから残りを回す（無駄な全再処理を避ける）。

### Phase 5: マージ＋ハルシネーション除去＋ギャップ検出

`$WORK/merge_clean.py` を作って実行する。役割は3つ:
1. **分割JSONをオフセット付きで結合**（優先順 `_v3 > _fix > base`。再処理版を自動採用）
2. **2種のハルシネーション除去**: セグメント内反復（`is_repetition`）＋セグメント間反復（`clean_consecutive`、相槌は保護）
3. **30秒超ギャップ検出**（コンテンツ欠損 vs 画面共有デモ中の正当な無音を Claude が判断するQAゲート）

```python
import json, re
from pathlib import Path

WORK = Path('/Users/naru/Walkers_naru/03_projects/<案件>/minutes/<日付>_<会議名>')
PARTS = WORK / 'parts'
SEG = 600          # 分割秒（Phase 3 と一致させる）
N_PARTS = 8        # ★録画長に応じて調整（60分=7, 90分=9 …。多めでも存在チェックで空振りするだけ）

SHORT_OK = {'はい','うん','ええ','そう','ああ','おう','うーん','なるほど',
            'ありがとう','ありがとうございます','了解','お願いします','すみません'}

def is_repetition(text, min_len=20, cover=0.7, min_rep=5):
    """単一セグメント内の病的反復を検出（昔×100, 福岡県、×40 等）"""
    t = text.strip()
    if len(t) < min_len:
        return False
    for u in range(1, 9):
        unit = t[:u]; rep = 0; i = 0
        while t[i:i+u] == unit:
            rep += 1; i += u
        if rep >= min_rep and (rep*u)/len(t) >= cover:
            return True
    c = re.sub(r'[、。\s]', '', t)
    return bool(c) and len(set(c))/len(c) < 0.12   # 文字多様性が極端に低い

def clean_consecutive(segs, threshold=5):
    result, removed, i = [], [], 0
    while i < len(segs):
        t = segs[i]['text']; j = i
        while j < len(segs) and segs[j]['text'] == t:
            j += 1
        if j - i >= threshold and t not in SHORT_OK:
            removed.append((segs[i]['start'], j-i, t[:20]))
        else:
            result.extend(segs[i:j])
        i = j
    return result, removed

# --- マージ（分割なら part_NNN[_v3/_fix].json。単発なら audio.json 1本） ---
all_segs = []
part_files_exist = PARTS.exists() and any(PARTS.glob('part_*.json'))
if part_files_exist:
    for idx in range(N_PARTS):
        v3   = PARTS / f'part_{idx:03d}_v3.json'
        fix  = PARTS / f'part_{idx:03d}_fix.json'
        base = PARTS / f'part_{idx:03d}.json'
        jf = v3 if v3.exists() else (fix if fix.exists() else base)
        if not jf.exists():
            continue
        off = idx * SEG
        for s in json.loads(jf.read_text())['segments']:
            all_segs.append({'start': s['start']+off, 'end': s['end']+off, 'text': s['text'].strip()})
else:
    for s in json.loads((WORK/'audio.json').read_text())['segments']:
        all_segs.append({'start': s['start'], 'end': s['end'], 'text': s['text'].strip()})
all_segs.sort(key=lambda s: s['start'])

segs = [s for s in all_segs if s['text'] and not is_repetition(s['text'])]
clean_segs, _ = clean_consecutive(segs)
gaps = [(a['end'], b['start'], b['start']-a['end'])
        for a, b in zip(clean_segs, clean_segs[1:]) if b['start']-a['end'] > 30]

with (WORK/'transcript.txt').open('w') as f:
    for s in clean_segs:
        m, sec = divmod(int(s['start']), 60)
        f.write(f"[{m:02d}:{sec:02d}] {s['text']}\n")
with (WORK/'transcript_plain.txt').open('w') as f:
    f.write(''.join(s['text'] for s in clean_segs))

hms = lambda x: f"{int(x)//60}:{int(x)%60:02d}"
print(f"有効={len(clean_segs)}seg / 文字数={sum(len(s['text']) for s in clean_segs)} / レンジ {hms(clean_segs[0]['start'])}〜{hms(clean_segs[-1]['end'])}")
print(f"30秒超ギャップ {len(gaps)}件:")
for st, en, g in gaps:
    print(f"  {hms(st)}〜{hms(en)} ({g:.0f}s)")
```

**品質判定の目安**: 1分あたり概ね 250〜300字。大幅に下回る・特定パートが0セグメント → そのパートを Phase 4 のフォールバックや別設定で再処理（`_fix`/`_v3` 命名でマージ側が自動優先）。会話の途中（言いさし）にギャップ＝欠損、画面共有デモ中＝正当な無音。

### Phase 6: transcript 確認

`transcript.txt` を Read で通読し、品質・ギャップ前後の整合・**録画に複数の会話が含まれていないか**を確認する（Phase 7 の注意参照）。

### Phase 7: 構造化議事録の生成（Claude）

`transcript.txt` を踏まえ、Phase 1 の案件・会議名・参加者リストで `minutes.md` を生成する。

**話者・担当推測:**
- 参加者リストの人物名で割り当て。文脈で推測なら `@古谷様?` と**末尾 `?`**。不明は `@不明`
- **個人特定に確証が持てない多人数MTGでは、本体を「当方／先方」の組織単位**で記載し、要確認セクションに明示（誤った氏名割当より安全）

**録画に複数の会話が混在するケースに注意（2026-05-28 実証）:**
OBS の録りっぱなしで **①本MTG → ②先方退出後の内部会話 → ③無関係な別件** が1ファイルに混ざることがある。
- 本MTGと内部会話は**セクションを分ける**（内部会話は「内部戦略メモ」として本件関係分のみ抽出）
- **無関係な別件は議事録から除外**し、冒頭注意に「○分以降に別件混入」と明記
- 退出の合図（「失礼いたします」）や話題の断絶が境界の手がかり

**日付・曜日の検算**: 「14だと日曜」等の手がかりが出たら `cal <月> <年>` で曜日照合し、聞き間違い（例「9月」→実は「6月」）を正す。確定できたら要確認テーブルに根拠つきで記載。

### Phase 8: minutes.md のテンプレート

```markdown
---
案件: <案件名>
会議: <会議名>
日時: <YYYY-MM-DD HH:MM JST>（録画長 <分>）
録画: <ファイル名> — <Driveリンク or file://パス>（OBS録画・S3非同期）
逐語: ./transcript.txt（<セグメント数>セグメント・有効<字>字・<モデル名>）
参加者:
  - <名前>（役割）
形式: <Google Meet / 対面 等>
---

# 議事録: <会議名>

> ⚠️ 要確認・注意（話者特定の確度、別会話の混入、日程の揺れ等を冒頭にまとめる）

## サマリー
<1段落。何が決まり、何が次の論点か>

## 決定事項
1. **<決定ラベル>**: <内容>

## ネクストアクション
- [ ] **@<担当>**: <内容>（期限）

## 提案/議論内容の骨子
<必要に応じて見出しで構造化>

## トピック（チャプター）
| 時刻 | 内容 |
|---|---|
| 0:00 | <冒頭の議題> |

## 固有名詞・要確認
| 議事録上の表記 | 揺れ／候補 | 推測根拠 |
|---|---|---|

## 逐語全文
`./transcript.txt`（タイムスタンプ付き）
```

### Phase 9: wav削除（後始末）

**大きな wav・中間ファイルを必ず削除する**（重複JSONも整理）:
```bash
rm -f "$WORK/audio.wav" "$WORK/parts/"*.wav
rm -rf "$WORK/compare"                       # 比較検証ディレクトリがあれば
# 採用しなかった旧JSON（turbo版 part_NNN.json / _fix.json）は混乱の元なので削除。_v3.json を残す
# 失敗の再現を1つ残したい時だけ1ファイルだけ残し、minutes.md に「再現用」と注記
```

> S3 同期（/sync-up 連鎖）は 2026-07-02 の凍結確定により**廃止**。同期は行わない。

**機密の注意**: 先方退出後の内部戦略トーク（入札の立ち回り等）は、議事録に残すかローカル限定メモに分けるかを**ユーザーに確認**する。

### Phase 10: 完成報告

minutes.md の内容サマリーをチャットで報告する（`~/bin/mo` は廃止済み・使用禁止。ビジュアル表示が必要なら show_widget を使う）。**要確認事項（話者特定・日程・別件混入・機密）は必ず明示**してユーザーの補正を促す。精度が問題になった場合は before/after の文字数差で改善を示す。

## 話者分離の運用方針

**v1（現行）**: Phase 1 の参加者ヒアリング ＋ Phase 7 で Claude が文脈推測（`?` 付き）。多人数で確証が無ければ組織単位（当方/先方）に退避。
**v2（将来）**: OBS マイクトラック分離（naru=トラック1/相手=トラック2 で確定）／pyannote（`pyannote/speaker-diarization-3.1`、HuggingFace トークン要）。

## 既存 meeting-minutes スキルとの関係

| | meeting-minutes（既存） | meeting-transcribe（本スキル） |
|---|---|---|
| 入力 | Google Meet の Gemini メモ | 録画/音声ファイル |
| 文字起こし | Gemini に任せる | mlx-whisper で自前 |
| 用途 | クライアントのワークブック（PPTX）反映 | 案件 minutes/ に保存→S3公開 |

**併存**。トリガーで分かれる。

## エラー対応

| 症状 | 対処 |
|---|---|
| 文章が断片的・固有名詞が崩れる | モデルを turbo→**large-v3-mlx** に。文脈補正 True に |
| 同一語の数百連発（昔昔昔／福岡県…） | turbo 使用時の症状。large-v3-mlx に変更、または turbo なら `--condition-on-previous-text False`。`--initial-prompt` を外す |
| `Invalid username or password` / repo エラー | モデル名の `-mlx`/`-turbo` 接尾辞漏れ。`whisper-large-v3` 単体は存在しない |
| 特定パートだけ0セグメント | そのパートを再処理（`_v3`/`_fix` 命名で merge が自動優先） |
| `mlx_whisper` not found | `pip install mlx-whisper` |
| `--output-dir` で出力が消える | 絶対パスを渡す（相対＋バックグラウンドの CWD 事故） |
| 会話途中の長いギャップ | 欠損疑い→該当パート再処理。デモ中の無音なら正当（議事録に明記） |
| 話者推測が外れる | 参加者リスト再入力、組織単位に退避、OBS マイクトラック分離（v2） |

## 既知の制約

- **Apple Silicon 専用**（mlx-whisper）。Intel Mac は `whisper`（OpenAI 公式）にフォールバック
- **話者分離は推測ベース**。多人数MTGは組織単位に退避
- **動画本体・wav は S3 非対象**。原典に戻る経路は Drive リンク or ローカルパスのみ
- **Google Drive の共有フォルダには保存しない**（2026-04-16 decisions）

## 関連

- `video-to-manual` — 動画→マニュアル（祖スキル）
- `meeting-minutes` — Gemini メモ→ワークブック反映（既存・併存）
- `/sync-up` / `/context-view` / `/aws-bootstrap`

## 進化のヒント

- 同案件の過去 minutes から固有名詞辞書を抽出（`--initial-prompt` ではなく Phase 7 の Claude 補正の参照辞書として使う）
- OBS マイクトラック分離（v2）で話者分離精度を上げる
- 議事録から `meeting-minutes` のワークブック反映に橋渡しする Phase 11
- 話題セグメンテーション（本MTG/内部/別件）の自動化

### C 案: 動画＋transcript 同期再生 HTML ビューア（v2 の本命）

`context-view` を拡張し、議事録閲覧画面に動画プレイヤーと transcript パネルを並べる（Lark Minutes 体験）。Drive 埋め込みプレイヤー（`/preview`）を `<iframe>`、チャプター/決定事項クリックで動画の該当時刻へジャンプ。着手前に research-first 必須（Drive 埋め込みの時刻ジャンプ API を調査、無ければ HTML5 メディアフラグメント `#t=120` に fallback）。

## 変更履歴

- 2026-05-26: 初版（tl;dv 代替）
- 2026-05-28: 福岡県環境部 第2回MTG（64分・OBS録画）で初の実戦投入。反復ハルシネーションでコンテンツ約2/3喪失（turbo+既定設定）を発見 → Phase 5 にセグメント内反復検出とギャップQAを追加、`--initial-prompt` 既定オフ、複数会話混在の取り扱い（Phase 7）、録画複数時の確認（Phase 1）を反映。
- 2026-06-02: naru 指示で**録画ソースの場所を毎回聞かない**運用に固定。既定録画先 `~/Movies/OBS/`（無指定ならここを自動探索）を Phase 1 冒頭・1-A に明記。聞くのは複数録画時の「どのファイルか」だけ。
- 2026-05-29: 同一音声で turbo と large-v3-mlx を直接比較。**large-v3-mlx + 文脈補正ON を推奨レシピに確定**（5,080字[turbo壊れ]→15,326字[turbo+対策]→17,856字[large-v3-mlx]、文も句読点付きの完全文に）。モデル名の `-mlx` 接尾辞の落とし穴、機密トーク同期の注意、merge の `_v3` 優先・N_PARTS 可変化を追記。
