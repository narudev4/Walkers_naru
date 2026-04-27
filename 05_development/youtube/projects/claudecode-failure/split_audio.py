#!/usr/bin/env python3
"""yt-split-audio: Whisperベースで full.wav をシーン別に分割"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Users/naru/Walkers_naru")
SLUG = "claudecode-failure"
PROJ = ROOT / "output" / "youtube" / SLUG
FULL_PCM = PROJ / "audio" / "full_pcm.wav"
SCENES_DIR = PROJ / "audio" / "scenes"
SCRIPT_PATH = PROJ / "script.md"
WHISPER_JSON = PROJ / "audio" / "whisper_segments.json"
SCENES_DIR.mkdir(parents=True, exist_ok=True)


# ==== シーン定義 ====
# (slide_no, scene_name, opening_phrase) - opening_phraseはWhisperの出力で照合する先頭部分文字列
SCENES = [
    (1, "title", "皆様こんにちは"),
    (2, "problem", "本当に安全なの"),
    (3, "purpose", "結論から言うと"),
    (4, "intro_self", "改めまして自己紹介"),
    (5, "subscribe", "アプリ開発研究所では"),
    (6, "sec01", "それではまず最初に"),
    (7, "intro_data", "クロードコードというのは"),
    (8, "sec02", "さてここからは"),
    (9, "case1_what", "これは"),  # "これはですね、2026年" - 但し他のスライドも"これは"で始まるため要文脈
    (10, "case1_why", "なぜこういう事故"),
    (11, "case1_fix", "ルールは言葉ではなく"),
    (12, "sec03", "続いてですね"),
    (13, "case2_what", "複数のケースで"),
    (14, "case2_why", "整理して"),
    (15, "case2_fix", "対策はシンプル"),
    (16, "sec04", "大事なパスワード"),
    (17, "case3_what", "個人の問題ではなく"),
    (18, "case3_why", "渡されたファイル"),
    (19, "case3_fix", "対策は明確に"),
    (20, "sec05", "ここからはですね、失敗事例の四つ目"),
    (21, "case4_what", "架空のパッケージ"),
    (22, "case4_why", "言葉の続き"),
    (23, "case4_fix", "公式サイトで検索"),
    (24, "sec06", "さてここからはですね、失敗事例の五つ目"),
    (25, "case5_what", "コストに関する"),
    (26, "case5_why", "投げる文字"),
    (27, "case5_fix", "毎週金曜日"),
    (28, "sec07", "ここからは最後"),
    (29, "case6_what", "確認スキップ"),
    (30, "case6_why", "人間の最後"),
    (31, "case6_fix", "自分が使うツール"),
    (32, "sec08", "最後のセクション"),
    (33, "fix1_auth", "使える範囲を設計で"),
    (34, "fix2_visibility", "動きを見える化"),
    (35, "fix3_backup", "引き返し方を用意"),
]

CTA_PHRASES = [
    "アプリ開発研究所ではAI",  # cta1
    "具体的にはですね",        # cta2
    "また開発期間",             # cta3
    "Walkersでは",              # cta4 (Whisperが Walkers を英語のまま転記)
    "とにかくですね",           # cta5
    "概要欄にある",             # cta6 (両方ある cta6 と cta8 - 文脈で見極め)
    "またたった",               # cta7
    "概要欄にある１分で",       # cta8 (1分で  /  全角扱いに注意)
]


def normalize(s: str) -> str:
    """空白・記号を緩めに揃える"""
    s = s.replace(' ', '').replace('　', '').replace('、', '').replace('。', '')
    s = s.replace('「', '').replace('」', '').replace('"', '').replace("'", '')
    return s


def run_whisper():
    """Phase 2: Whisper文字起こし。既存JSONがあれば再利用。"""
    if WHISPER_JSON.exists():
        size = WHISPER_JSON.stat().st_size
        if size > 5000:
            print(f"既存のWhisper結果を再利用: {WHISPER_JSON} ({size} bytes)")
            return
    print("Whisper medium で文字起こし開始（CPU・word_timestamps）...")
    print("  ※ 約30分かかります")
    import whisper
    model = whisper.load_model("medium")
    result = model.transcribe(str(FULL_PCM), language="ja", word_timestamps=True, fp16=False)
    segments = []
    for s in result['segments']:
        segments.append({
            'start': s['start'],
            'end': s['end'],
            'text': s['text'],
            'words': [{'word': w['word'], 'start': w['start'], 'end': w['end']} for w in s.get('words', [])]
        })
    WHISPER_JSON.write_text(json.dumps(segments, ensure_ascii=False, indent=2))
    print(f"  saved: {WHISPER_JSON} ({len(segments)} segments)")


def find_scene_starts(segments, scenes):
    """各シーンの開始時刻を、Whisperセグメント+単語で特定する。

    シーケンシャルに進めて、各シーンの opening_phrase が現れる最初の word.start を採る。
    見つからない場合はセグメントレベルで部分一致を試す。
    """
    # 全単語をフラット化して時系列順にする
    flat_words = []
    for si, seg in enumerate(segments):
        for w in seg['words']:
            flat_words.append((w['start'], w['end'], normalize(w['word']), si))
    flat_words.sort(key=lambda x: x[0])

    starts = []
    word_cursor = 0
    for slide_no, name, phrase in scenes:
        norm_phrase = normalize(phrase)
        head = norm_phrase[:6]  # 先頭6文字で照合
        found_time = None
        # 単語の連続結合で部分一致を探す
        for j in range(word_cursor, len(flat_words)):
            buf = ''
            for k in range(j, min(j + 12, len(flat_words))):
                buf += flat_words[k][2]
                if head in buf:
                    found_time = flat_words[j][0]
                    word_cursor = j + 1
                    break
            if found_time is not None:
                break

        # フォールバック: セグメントテキストで照合
        if found_time is None:
            min_t = starts[-1][3] if starts and starts[-1][3] >= 0 else 0
            for si, seg in enumerate(segments):
                if seg['end'] < min_t:
                    continue
                if head in normalize(seg['text']):
                    found_time = seg['start']
                    break

        if found_time is None:
            print(f"  ⚠️ slide{slide_no} {name}: 開始位置が見つからず (phrase='{phrase}')")
            # 推定: 前シーンと総尺から線形配置
            found_time = -1
        starts.append((slide_no, name, phrase, found_time))
    return starts


def find_cta_starts(segments, cta_phrases, search_after):
    """CTAの開始位置を search_after 秒以降から探す。"""
    flat_words = []
    for si, seg in enumerate(segments):
        for w in seg['words']:
            if w['start'] < search_after - 0.5:
                continue
            flat_words.append((w['start'], w['end'], normalize(w['word']), si))
    flat_words.sort(key=lambda x: x[0])

    starts = []
    word_cursor = 0
    for i, phrase in enumerate(cta_phrases):
        norm_phrase = normalize(phrase)
        head = norm_phrase[:6]
        found_time = None
        for j in range(word_cursor, len(flat_words)):
            buf = ''
            for k in range(j, min(j + 14, len(flat_words))):
                buf += flat_words[k][2]
                if head in buf:
                    found_time = flat_words[j][0]
                    word_cursor = j + 1
                    break
            if found_time is not None:
                break
        if found_time is None:
            print(f"  ⚠️ cta{i+1}: 開始位置が見つからず (phrase='{phrase}')")
            found_time = -1
        starts.append((i + 1, phrase, found_time))
    return starts


def get_duration(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-i", str(path), "-show_entries", "format=duration", "-v", "quiet", "-of", "csv=p=0"],
        capture_output=True, text=True,
    )
    return float(r.stdout.strip())


def cut_wav(start: float, end: float, out: Path):
    cmd = ["ffmpeg", "-y", "-i", str(FULL_PCM), "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
           "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(out)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print('STDERR:', r.stderr[-500:])
        raise RuntimeError(f"ffmpeg failed for {out.name}")


def main():
    run_whisper()
    segments = json.loads(WHISPER_JSON.read_text())
    print(f"\nWhisperセグメント数: {len(segments)}")
    full_dur = get_duration(FULL_PCM)
    print(f"全長: {full_dur:.2f}秒")

    print("\n=== Phase 4: シーン開始位置の特定 ===")
    scene_starts = find_scene_starts(segments, SCENES)
    for slide_no, name, phrase, t in scene_starts:
        marker = "❌" if t < 0 else "✅"
        m, s = divmod(t if t >= 0 else 0, 60)
        print(f"  {marker} slide{slide_no:2d} {name:20s} @ {int(m):2d}:{s:05.2f}  | {phrase}")

    # 検出失敗があれば停止
    missing = [x for x in scene_starts if x[3] < 0]
    if missing:
        print(f"\n❌ {len(missing)}個のシーン開始位置が未検出です。フレーズ調整が必要。")
        # それでも全セグメント一覧をデバッグ用に出す
        print("\n=== Whisperセグメント一覧（先頭30件）===")
        for i, seg in enumerate(segments[:30]):
            m, s = int(seg['start'] // 60), seg['start'] % 60
            print(f"  [{i:3d}] {m:2d}:{s:05.2f} | {seg['text'][:80]}")
        sys.exit(1)

    # CTA開始位置を本編最後シーン以降から探索
    last_main_start = scene_starts[-1][3]
    cta_search_after = last_main_start + 5.0  # 最終シーンから少し後
    # より精密にしたいので、最終本編シーンの推定終了時刻 = CTA結合直前
    # 検証時の出力では「16:30付近」がCTA接合点
    print(f"\n=== Phase 4 (CTA): {cta_search_after:.2f}秒以降からCTAを探索 ===")
    cta_starts = find_cta_starts(segments, CTA_PHRASES, cta_search_after)
    for i, phrase, t in cta_starts:
        marker = "❌" if t < 0 else "✅"
        m, s = divmod(t if t >= 0 else 0, 60)
        print(f"  {marker} cta{i} @ {int(m):2d}:{s:05.2f}  | {phrase}")

    missing_cta = [x for x in cta_starts if x[2] < 0]
    if missing_cta:
        print(f"\n❌ {len(missing_cta)}個のCTA開始位置が未検出です。")
        sys.exit(2)

    # cut points を構築
    cut_points = []
    for slide_no, name, phrase, t in scene_starts:
        cut_points.append((f"scene{slide_no:02d}_{name}", t))
    for i, phrase, t in cta_starts:
        cta_idx = len(SCENES) + i  # 36, 37, ..., 43
        cut_points.append((f"scene{cta_idx:02d}_cta{i}", t))

    # cut_points をソート（万一順序乱れ対策）
    cut_points.sort(key=lambda x: x[1])

    # 末尾は full_dur
    print("\n=== Phase 5: ffmpeg分割 ===")
    for i, (name, start) in enumerate(cut_points):
        if i + 1 < len(cut_points):
            end = cut_points[i + 1][1]
        else:
            end = full_dur
        out = SCENES_DIR / f"{name}.wav"
        cut_wav(start, end, out)
        dur = get_duration(out)
        m, s = int(start // 60), start % 60
        print(f"  ✅ {name}.wav  start={int(m):2d}:{s:05.2f}  dur={dur:.2f}s")

    print(f"\n✅ 分割完了: {len(cut_points)} シーン → {SCENES_DIR}")


if __name__ == "__main__":
    main()
