#!/usr/bin/env python3
"""yt-split-audio: full.wav を43シーンに分割するスクリプト。

設計（2026-04-27 確定）:
  Q1 シーン名: 連番のみ scene01.wav 〜 scene43.wav
  Q2 マッチ失敗時: 前後マッチから補間（両端失敗のみエラー停止）
  Q3 入力: 環境変数 HEYGEN_SLUG
  Q4 トリム閾値: -50dB / 0.2s（定数化）
  Q5 出力: full.wav + scenes/sceneNN.wav + JSON 2つ

使い方:
  HEYGEN_SLUG=claudecode-failure python3 _shared/yt-split-audio.py

  RECOMPUTE_WHISPER=1 で whisper キャッシュを無視して再生成
  DRY_RUN=1 で proposed_cuts.json だけ出力（cut しない）

入力:
  projects/{slug}/script.md
  projects/{slug}/slides.json
  projects/{slug}/audio/full.wav

出力:
  projects/{slug}/audio/whisper_segments.json  （初回のみ生成、以後キャッシュ）
  projects/{slug}/audio/proposed_cuts.json     （3点照合結果の記録）
  projects/{slug}/audio/scenes/sceneNN.wav     （N=01〜）

ロジック:
  1. script.md から各スライドのナレーション冒頭を抽出
  2. Whisper medium で full.wav を文字起こし（CPU、word_timestamps=True、~30分）
  3. 各シーン冒頭フレーズと Whisper セグメント先頭を照合（位置一致スコア）
     - 漢数字（一,二,三...）↔ 算用数字（1,2,3...）正規化
     - 英語単語 → カタカナ正規化（PRONUNCIATION_MAP）
  4. マッチしないシーンは前後から線形補間で seg_idx 推定
  5. 各シーンを ffmpeg で粗切り → silenceremove で末尾の長い無音/息継ぎをトリム
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# ===== 定数（Q4） =====
ROOT = Path("/Users/naru/Walkers_naru")
PROJECTS_BASE = ROOT / "05_development" / "youtube" / "projects"

SILENCE_THRESHOLD_DB = -50          # 真の無音判定（発話末尾フェードは保持）
SILENCE_MIN_DURATION = 0.2          # 0.2秒以上の連続無音だけトリム
LAST_WORD_BUFFER = 0.05             # last_word.end + 0.05s でカット位置決定
SEARCH_AHEAD = 25                   # 各シーン候補は cursor から最大25セグメント先まで見る
MIN_SCORE_OK = 4                    # スコア4以上を「マッチ成功」と判定
MATCH_HEAD_LEN = 15                 # 先頭何文字で位置一致を見るか


# ===== 発音/表記の正規化 =====
PRONUNCIATION_MAP = {
    'Claude Code': 'クロードコード',
    'Walkers': 'ウォーカーズ',
    'Anthropic': 'アンスロピック',
    'Shopify': 'ショッピファイ',
    'METR': 'メーター',
    'GitGuardian': 'ギットガーディアン',
    'AWS': 'エーダブリューエス',
    'RDS': 'アールディーエス',
    'GitHub': 'ギットハブ',
    'USENIX': 'ユーゼニックス',
    'InfoQ': 'インフォキュー',
    'DataTalks.Club': 'データトークスドットクラブ',
    'npm': 'エヌピーエム',
    'pip': 'ピップ',
    'AI': 'エーアイ',
    'API': 'エーピーアイ',
    'CLI': 'シーエルアイ',
    'LLM': 'エルエルエム',
    'Cursor': 'カーソル',
    'Lovable': 'ラバブル',
    'Next.js': 'ネクストジェイエス',
    'React': 'リアクト',
    'Flutter': 'フラッター',
    'Python': 'パイソン',
    'Bubble': 'バブル',
    'Adalo': 'アダロ',
    'Glide': 'グライド',
    'iOS': 'アイオーエス',
    'Android': 'アンドロイド',
    'VS Code': 'ブイエスコード',
    'Dify': 'ディフィ',
}

KANJI_NUM = {'一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
             '六': '6', '七': '7', '八': '8', '九': '9', '十': '10'}


def normalize(s):
    """script.md と Whisper 出力を同じ表記に揃える"""
    if not s:
        return ''
    for k, v in PRONUNCIATION_MAP.items():
        s = s.replace(k, v)
    for k, v in KANJI_NUM.items():
        s = s.replace(k, v)
    s = re.sub(r'[\s、。！？「」『』（）()【】・,.!?\'"]+', '', s)
    return s


# ===== script.md からシーン抽出 =====

def extract_scenes(script_path):
    """script.md を `### 【スライドN】` で分割し、各シーンの冒頭ナレーションを抽出。

    Returns: [{'idx': int, 'kind': 'main'|'cta', 'narration': str}, ...]
    """
    text = script_path.read_text()
    pattern = re.compile(r'^### 【(末尾スライド\d+|スライド\d+)】([^\n]*)$', re.MULTILINE)
    matches = list(pattern.finditer(text))
    scenes = []
    for i, m in enumerate(matches):
        marker = m.group(1)
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[body_start:body_end]

        # 最初のナレーション行を取る
        narration = ''
        for line in body.split('\n'):
            line = line.strip()
            if not line or line.startswith('---') or line.startswith('<!--'):
                continue
            if re.match(r'^[（(]\d', line):  # (3:50〜4:25) のような時刻行を除外
                continue
            narration = line
            break

        if marker.startswith('末尾スライド'):
            num = int(re.search(r'\d+', marker).group())
            # CTA の場合、本編35枚 + CTA1〜8 = scene36〜43
            scenes.append({'idx': 35 + num, 'kind': 'cta', 'narration': narration})
        else:
            scenes.append({
                'idx': int(re.search(r'\d+', marker).group()),
                'kind': 'main',
                'narration': narration,
            })
    return scenes


# ===== Whisper 文字起こし =====

def run_whisper(full_pcm_path, output_path, force=False):
    """既存 JSON があれば再利用。なければ Whisper medium で文字起こし。"""
    if output_path.exists() and not force:
        size_mb = output_path.stat().st_size / 1024 / 1024
        if size_mb > 0.05:
            print(f"[whisper] キャッシュ再利用: {output_path.name} ({size_mb:.1f}MB)")
            return
    print(f"[whisper] Whisper medium で文字起こし中（CPU・約30分）...")
    import whisper
    model = whisper.load_model("medium")
    result = model.transcribe(str(full_pcm_path), language="ja",
                              word_timestamps=True, fp16=False)
    segments = []
    for s in result['segments']:
        segments.append({
            'start': s['start'],
            'end': s['end'],
            'text': s['text'],
            'words': [{'word': w['word'], 'start': w['start'], 'end': w['end']}
                      for w in s.get('words', [])],
        })
    output_path.write_text(json.dumps(segments, ensure_ascii=False, indent=2))
    print(f"[whisper] {len(segments)} セグメント保存: {output_path}")


# ===== マッチング =====

def similarity_score(narration_head, segment_text):
    """先頭MATCH_HEAD_LEN文字以内で、位置一致した文字数を返す。
    1〜2文字の認識ブレ（教訓→教育）も許容できるよう、最長共通プレフィックスではなく
    位置ベースで一致数をカウントする。
    """
    a = normalize(narration_head)
    b = normalize(segment_text)
    if not a or not b:
        return 0
    n = min(len(a), len(b), MATCH_HEAD_LEN)
    if n == 0:
        return 0
    match = sum(1 for i in range(n) if a[i] == b[i])
    # 先頭3文字のうち2文字以上一致しなければ、明らかに別シーン候補なので大幅減点
    if a[:3] != b[:3]:
        first3_match = sum(1 for i in range(min(3, n)) if a[i] == b[i])
        if first3_match < 2:
            match = max(0, match - 3)
    return match


def find_best_segment(narration, segments, start_idx):
    """ナレーション先頭にもっとも近いセグメントを返す。start_idx 以降のみ探索。"""
    if not narration:
        return None, 0
    head = narration[:30]
    best_idx, best_score = None, 0
    end_idx = min(start_idx + SEARCH_AHEAD, len(segments))
    for i in range(start_idx, end_idx):
        score = similarity_score(head, segments[i]['text'])
        if score > best_score:
            best_score = score
            best_idx = i
    return best_idx, best_score


def match_scenes_to_segments(scenes, segments):
    """全シーンを順次マッチング。失敗シーンは前後から補間（Q2のC案）。

    Returns: [{idx, narration, seg_idx, score, cut_time, confidence}, ...]
    """
    results = []
    cursor = 0
    for scene in scenes:
        seg_idx, score = find_best_segment(scene['narration'], segments, cursor)
        if seg_idx is not None and score >= MIN_SCORE_OK:
            results.append({
                **scene,
                'seg_idx': seg_idx,
                'score': score,
                'cut_time': segments[seg_idx]['start'],
                'confidence': 'high',
            })
            cursor = seg_idx + 1
        elif seg_idx is not None and score >= 2:
            # 中程度のマッチ：採用するが confidence は medium
            results.append({
                **scene,
                'seg_idx': seg_idx,
                'score': score,
                'cut_time': segments[seg_idx]['start'],
                'confidence': 'medium',
            })
            cursor = seg_idx + 1
        else:
            # マッチ失敗 → 後続シーンが見つかってから補間
            results.append({
                **scene,
                'seg_idx': None,
                'score': 0,
                'cut_time': None,
                'confidence': 'unmatched',
            })

    # 補間: 未マッチを前後の seg_idx から線形補間
    for i, r in enumerate(results):
        if r['seg_idx'] is not None:
            continue
        # 前の最後のマッチ
        prev_match = next((results[j] for j in range(i - 1, -1, -1)
                          if results[j]['seg_idx'] is not None), None)
        # 次の最初のマッチ
        next_match = next((results[j] for j in range(i + 1, len(results))
                          if results[j]['seg_idx'] is not None), None)
        if prev_match is None or next_match is None:
            print(f"❌ scene{r['idx']}: 前後どちらかのマッチがなく補間不可")
            continue
        # 前の seg_idx の直後（最も自然な仮定）
        interpolated_seg = prev_match['seg_idx'] + 1
        # 次のマッチを超えないように clip
        interpolated_seg = min(interpolated_seg, next_match['seg_idx'] - 1)
        r['seg_idx'] = interpolated_seg
        r['cut_time'] = segments[interpolated_seg]['start']
        r['confidence'] = 'interpolated'
        print(f"⚠ scene{r['idx']}: 補間（seg {interpolated_seg}, {r['cut_time']:.2f}s）")

    return results


# ===== 切り出し =====

def get_duration(path):
    r = subprocess.run(
        ["ffprobe", "-i", str(path), "-show_entries", "format=duration",
         "-v", "quiet", "-of", "csv=p=0"],
        capture_output=True, text=True,
    )
    return float(r.stdout.strip())


def find_last_word_end(segments, start_seg, end_seg):
    """セグメント [start_seg, end_seg) の中で最後の単語の end を返す。"""
    last = None
    for i in range(start_seg, min(end_seg, len(segments))):
        for w in segments[i].get('words', []):
            if last is None or w['end'] > last:
                last = w['end']
        if not segments[i].get('words'):
            if last is None or segments[i]['end'] > last:
                last = segments[i]['end']
    return last


def cut_scene(full_wav, start, end, outpath):
    """1段階目：粗切り → 2段階目：silenceremove で末尾の真の無音をトリム。"""
    tmp = outpath.with_suffix('.raw.wav')
    cmd1 = [
        "ffmpeg", "-y", "-i", str(full_wav),
        "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
        "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(tmp)
    ]
    r = subprocess.run(cmd1, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"❌ {outpath.name} (raw): {r.stderr[-300:]}")
        return False
    cmd2 = [
        "ffmpeg", "-y", "-i", str(tmp),
        "-af", f"areverse,silenceremove=start_periods=1:start_silence={SILENCE_MIN_DURATION}:start_threshold={SILENCE_THRESHOLD_DB}dB,areverse",
        "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(outpath)
    ]
    r = subprocess.run(cmd2, capture_output=True, text=True)
    tmp.unlink(missing_ok=True)
    if r.returncode != 0:
        print(f"❌ {outpath.name} (trim): {r.stderr[-300:]}")
        return False
    return True


# ===== メイン =====

def main():
    slug = os.environ.get("HEYGEN_SLUG")
    if not slug:
        print("ERROR: HEYGEN_SLUG が未設定。例: HEYGEN_SLUG=claudecode-failure", file=sys.stderr)
        sys.exit(1)

    proj = PROJECTS_BASE / slug
    if not proj.exists():
        print(f"ERROR: プロジェクトディレクトリが存在しない: {proj}", file=sys.stderr)
        sys.exit(1)

    script_md = proj / "script.md"
    full_wav = proj / "audio" / "full.wav"
    full_pcm = proj / "audio" / "full_pcm.wav"
    whisper_json = proj / "audio" / "whisper_segments.json"
    proposed_json = proj / "audio" / "proposed_cuts.json"
    scenes_dir = proj / "audio" / "scenes"
    scenes_dir.mkdir(parents=True, exist_ok=True)

    # 入力チェック
    for f in [script_md, full_wav]:
        if not f.exists():
            print(f"ERROR: 入力ファイルがない: {f}", file=sys.stderr)
            sys.exit(1)

    print(f"\n{'='*60}")
    print(f"yt-split-audio")
    print(f"  slug: {slug}")
    print(f"  proj: {proj}")
    print(f"{'='*60}\n")

    # 1. シーン抽出
    scenes = extract_scenes(script_md)
    print(f"[scenes] {len(scenes)} シーン抽出（main {sum(1 for s in scenes if s['kind']=='main')} + cta {sum(1 for s in scenes if s['kind']=='cta')}）")

    # 2. Whisper（キャッシュ優先）
    whisper_input = full_pcm if full_pcm.exists() else full_wav
    run_whisper(whisper_input, whisper_json, force=bool(os.environ.get("RECOMPUTE_WHISPER")))
    segments = json.loads(whisper_json.read_text())

    # 3. マッチング + 補間
    print(f"\n[match] 各シーンを Whisper セグメントに照合中...")
    matched = match_scenes_to_segments(scenes, segments)

    # 4. 結果サマリー
    high = sum(1 for r in matched if r['confidence'] == 'high')
    medium = sum(1 for r in matched if r['confidence'] == 'medium')
    interp = sum(1 for r in matched if r['confidence'] == 'interpolated')
    unmatched = sum(1 for r in matched if r['seg_idx'] is None)
    print(f"\n[match] 高信頼: {high} / 中: {medium} / 補間: {interp} / 失敗: {unmatched}")

    if unmatched > 0:
        print(f"\n❌ {unmatched} 件のシーンがマッチできませんでした。手動確認してください。")
        for r in matched:
            if r['seg_idx'] is None:
                print(f"  scene{r['idx']}: '{r['narration'][:30]}'")
        sys.exit(2)

    # 5. proposed_cuts.json 出力
    proposed_json.write_text(json.dumps(matched, ensure_ascii=False, indent=2))
    print(f"[output] {proposed_json}")

    if os.environ.get("DRY_RUN"):
        print("\n[DRY_RUN=1] cut せず終了。")
        return

    # 6. 切り出し
    full_dur = get_duration(full_wav)
    sorted_scenes = sorted(matched, key=lambda x: x['cut_time'])
    print(f"\n[cut] full.wav ({full_dur:.2f}s) を {len(sorted_scenes)} シーンに分割...")

    ok = 0
    for i, scene in enumerate(sorted_scenes):
        idx = scene['idx']
        start = scene['cut_time']
        # 終端 = 次シーンの最後の単語 end + buffer（次シーンが無ければ full_dur）
        if i + 1 < len(sorted_scenes):
            next_seg = sorted_scenes[i + 1]['seg_idx']
            last_word_end = find_last_word_end(segments, scene['seg_idx'], next_seg)
            if last_word_end is None:
                end = sorted_scenes[i + 1]['cut_time']
            else:
                end = min(last_word_end + LAST_WORD_BUFFER, sorted_scenes[i + 1]['cut_time'])
        else:
            last_word_end = find_last_word_end(segments, scene['seg_idx'], len(segments))
            end = min(last_word_end + LAST_WORD_BUFFER, full_dur) if last_word_end else full_dur

        outpath = scenes_dir / f"scene{idx:02d}.wav"
        if cut_scene(full_wav, start, end, outpath):
            actual = get_duration(outpath)
            m, s = int(start // 60), start % 60
            print(f"  ✅ scene{idx:02d}.wav  {m:>2d}:{s:05.2f}〜  ({actual:5.2f}s)  [{scene['confidence']}]")
            ok += 1
        else:
            print(f"  ❌ scene{idx:02d}.wav: 切り出し失敗")

    print(f"\n[done] {ok}/{len(sorted_scenes)} 完了 → {scenes_dir}")


if __name__ == "__main__":
    main()
