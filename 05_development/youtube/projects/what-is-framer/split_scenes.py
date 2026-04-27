#!/usr/bin/env python3
"""Split full.wav into 47 scenes using Whisper segment index mapping.

Each scene's starting segment was identified manually from the Whisper output.
The cut point between scene N and N+1 is simply scene N+1's segment['start'].
"""
import json
import subprocess
from pathlib import Path

PROJ = Path("/Users/naru/Walkers_naru/05_development/youtube/projects/what-is-framer")
FULL_WAV = PROJ / "audio" / "full.wav"
SEGMENTS = Path("/tmp/framer_whisper_segments.json")
OUT_DIR = PROJ / "audio" / "scenes"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# (slide_num, name, segment_index)
SCENE_MAP = [
    (1,  "title",            0),
    (2,  "problem",           8),
    (3,  "intent",           18),
    (4,  "selfintro",        29),
    (5,  "subscribe",        35),
    (6,  "sec01_framer",     40),
    (7,  "framer_overview",  42),
    (8,  "framer_history",   53),
    (9,  "sec02_features",   63),
    (10, "feat1_visual",     65),
    (11, "feat2_cms",        74),
    (12, "feat3_seo",        85),
    (13, "feat4_anim",       95),
    (14, "feat5_multidev",  105),
    (15, "feat6_multilang", 115),
    (16, "feat7_ai",        127),
    (17, "feat8_integ",     139),
    (18, "sec03_demerits",  150),
    (19, "demerit1_learn",  153),
    (20, "demerit2_ja",     166),
    (21, "demerit3_seo",    179),
    (22, "demerit4_price",  190),
    (23, "demerit5_info",   202),
    (24, "sec04_pricing",   212),
    (25, "pricing_personal",214),
    (26, "pricing_biz",     226),
    (27, "sec05_cases",     239),
    (28, "case1_noble",     242),
    (29, "case2_biograph",  253),
    (30, "case3_nova",      263),
    (31, "case4_zazu",      275),
    (32, "case5_wotter",    286),
    (33, "case6_jack",      298),
    (34, "sec06_compare",   312),
    (35, "compare_table",   314),
    (36, "sec07_usage",     328),
    (37, "step1to3",        331),
    (38, "step4",           354),
    (39, "step5",           365),
    (40, "cta1_reduction",  375),
    (41, "cta2_result1",    380),
    (42, "cta3_result2",    387),
    (43, "cta4_result3",    389),
    (44, "cta5_inquiry",    394),
    (45, "cta6_contact_img",401),
    (46, "cta7_simulator",  403),
    (47, "cta8_ending",     407),
]


def probe_duration(path):
    out = subprocess.check_output([
        "ffprobe", "-i", str(path), "-show_entries", "format=duration",
        "-v", "quiet", "-of", "csv=p=0"
    ])
    return float(out.decode().strip())


def cut(start, end, outpath):
    cmd = [
        "ffmpeg", "-y", "-i", str(FULL_WAV),
        "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
        "-acodec", "pcm_s16le", "-ar", "44100",
        str(outpath)
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        print(f"ERROR cutting {outpath.name}: {r.stderr.decode()[-400:]}")
        return False
    return True


def main():
    segments = json.loads(SEGMENTS.read_text())
    total_dur = probe_duration(FULL_WAV)
    print(f"Full audio: {total_dur:.2f}s, {len(segments)} segments, mapping {len(SCENE_MAP)} scenes\n")

    # --- compute cut points ---
    # scene N starts at segments[seg_idx]['start']
    # except scene 1 which starts at 0.0 (to include any lead-in silence)
    # scene N ends at scene N+1's start
    # last scene ends at total_dur
    starts = []
    for i, (n, name, seg_idx) in enumerate(SCENE_MAP):
        if i == 0:
            starts.append(0.0)  # first scene captures lead-in
        else:
            starts.append(segments[seg_idx]["start"])

    cut_times = starts + [total_dur]

    # --- write each scene ---
    print("=== Writing scene files ===")
    ok = 0
    for i, (n, name, seg_idx) in enumerate(SCENE_MAP):
        start = cut_times[i]
        end = cut_times[i + 1]
        outpath = OUT_DIR / f"scene{n:02d}_{name}.wav"
        text_preview = segments[seg_idx]["text"].strip()[:40]
        if cut(start, end, outpath):
            dur = end - start
            print(f"  scene{n:02d}_{name:<20s}  {start:7.2f} - {end:7.2f}  ({dur:5.2f}s) | {text_preview}")
            ok += 1

    print(f"\nOK: {ok}/{len(SCENE_MAP)}  → {OUT_DIR}")


if __name__ == "__main__":
    main()
