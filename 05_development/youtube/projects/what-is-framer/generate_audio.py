#!/usr/bin/env python3
"""STEP 4: ElevenLabs音声生成 — what-is-framer."""
import os
import re
import sys
import glob
import shutil
import subprocess
from pathlib import Path

import requests

ROOT = Path("/Users/naru/Walkers_naru/05_development/youtube")
SCRIPT_MD = ROOT / "projects/what-is-framer/script.md"
AUDIO_DIR = ROOT / "projects/what-is-framer/audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

CTA_PCM = ROOT / "_shared/templates/cta_audio_pcm.wav"
CTA_SRC = ROOT / "_shared/templates/cta_audio.wav"

API_KEY = open("/Users/naru/Walkers_naru/credentials/elevenlabs_api_key.txt").read().strip()
VOICE_ID = open("/Users/naru/Walkers_naru/credentials/elevenlabs_voice_id.txt").read().strip()

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
    'Framer': 'フレーマー',
    'Figma': 'フィグマ',
    'Webflow': 'ウェブフロー',
    'STUDIO': 'スタジオ',
    'SEO': 'エスイーオー',
    'CMS': 'シーエムエス',
    'UI': 'ユーアイ',
    'UX': 'ユーエックス',
    'HTML': 'エイチティーエムエル',
    'CSS': 'シーエスエス',
    'JavaScript': 'ジャバスクリプト',
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


def apply_fixes(text: str) -> str:
    for k, v in PRONUNCIATION_MAP.items():
        text = text.replace(k, v)
    text = re.sub(r'AI・', 'AI、', text)
    return text


def extract_body_narration(md_text: str) -> list[tuple[int, str, str]]:
    """Return [(slide_num, heading_line, narration_text), ...] for body slides (not CTA)."""
    # Split by slide heading
    # Heading format: ### 【スライドN】...
    blocks = re.split(r'^(### 【スライド(\d+)】[^\n]*)\n', md_text, flags=re.MULTILINE)
    # blocks: [prefix, heading1, num1, body1, heading2, num2, body2, ...]
    results = []
    for i in range(1, len(blocks), 3):
        heading = blocks[i]
        num = int(blocks[i + 1])
        body = blocks[i + 2]
        # remove HTML comments
        body = re.sub(r'<!--.*?-->', '', body, flags=re.DOTALL)
        # remove trailing separators (---)
        body = re.sub(r'^---\s*$', '', body, flags=re.MULTILINE)
        # strip empty lines
        body_clean = '\n'.join([ln.strip() for ln in body.strip().splitlines() if ln.strip()])
        # Skip CTA (末尾スライド starts, or heading contains 末尾 or slide >= 42)
        if '末尾スライド' in heading or num >= 42:
            continue
        results.append((num, heading, body_clean))
    return results


def chunk_by_section(slides: list[tuple[int, str, str]], max_chars: int = 2000) -> list[str]:
    """Chunk text at section title boundaries, then split further if exceeds max."""
    # Section title slides are those whose heading contains 'セクションタイトル'
    # Build list of (is_section_boundary, text)
    chunks: list[str] = []
    current = ""
    for num, heading, body in slides:
        is_section = ('セクションタイトル' in heading)
        piece = body
        # Section title itself - treat as boundary; flush current first
        if is_section and current:
            chunks.append(current.strip())
            current = ""
        if len(current) + len(piece) + 1 > max_chars:
            if current:
                chunks.append(current.strip())
                current = ""
            # if single piece still > max, split by sentences (。)
            if len(piece) > max_chars:
                sents = re.split(r'(?<=。)', piece)
                buf = ""
                for s in sents:
                    if len(buf) + len(s) > max_chars:
                        if buf:
                            chunks.append(buf.strip())
                        buf = s
                    else:
                        buf += s
                if buf:
                    current = buf
            else:
                current = piece
        else:
            current = (current + "\n" + piece) if current else piece
    if current:
        chunks.append(current.strip())
    return chunks


def call_eleven(text: str, out_path: Path) -> None:
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    headers = {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/wav",
    }
    data = {
        "text": text,
        "model_id": "eleven_v3",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
        },
    }
    print(f"  POST {url} (text: {len(text)} chars)")
    r = requests.post(url, json=data, headers=headers, timeout=300)
    assert r.status_code == 200, f"API error {r.status_code}: {r.text[:400]}"
    out_path.write_bytes(r.content)
    print(f"  saved {out_path} ({len(r.content)} bytes)")


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL: {' '.join(cmd[:6])}...")
        print(r.stderr[-2000:])
        raise SystemExit(1)
    return r


def probe_duration(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-i", str(path), "-show_entries", "format=duration",
         "-v", "quiet", "-of", "csv=p=0"],
        capture_output=True, text=True,
    )
    return float(r.stdout.strip())


def main():
    md = SCRIPT_MD.read_text(encoding="utf-8")
    slides = extract_body_narration(md)
    print(f"Body slides: {len(slides)} (expected 41)")
    for num, heading, body in slides[:3]:
        print(f"  slide {num}: {heading[:50]}... ({len(body)} chars)")

    # Apply pronunciation fixes
    fixed = [(n, h, apply_fixes(b)) for n, h, b in slides]

    # Chunk
    chunks = chunk_by_section(fixed, max_chars=2000)
    print(f"\nChunks: {len(chunks)}")
    for i, c in enumerate(chunks):
        print(f"  Chunk {i+1}: {len(c)} chars")
        assert len(c) <= 2000, f"BLOCKED: Chunk {i+1} is {len(c)} chars!"

    # Confirmation line
    total = sum(len(c) for c in chunks)
    print(f"Total body chars: {total}")

    # Save chunks text for reference
    chunks_dir = AUDIO_DIR / "chunks_text"
    chunks_dir.mkdir(exist_ok=True)
    for i, c in enumerate(chunks):
        (chunks_dir / f"chunk{i+1}.txt").write_text(c, encoding="utf-8")

    # Prepare CTA PCM if missing
    if not CTA_PCM.exists():
        assert CTA_SRC.exists(), f"CTA source missing: {CTA_SRC}"
        print(f"Converting CTA to PCM: {CTA_PCM}")
        run(["ffmpeg", "-y", "-i", str(CTA_SRC), "-acodec", "pcm_s16le",
             "-ar", "44100", "-ac", "1", str(CTA_PCM)])

    # Step 4: API calls
    print("\n=== STEP 4a: ElevenLabs API ===")
    chunk_wavs = []
    for i, c in enumerate(chunks):
        wav = Path(f"/tmp/framer_chunk{i+1}.wav")
        if wav.exists() and wav.stat().st_size > 50_000:
            print(f"Chunk {i+1}: already exists ({wav.stat().st_size} bytes), skip")
        else:
            call_eleven(c, wav)
        chunk_wavs.append(wav)

    # Step 5: PCM → trim → concat
    print("\n=== STEP 4b: PCM + trim + concat ===")
    trimmed_wavs = []
    for i, w in enumerate(chunk_wavs):
        pcm = Path(f"/tmp/framer_chunk{i+1}_pcm.wav")
        run(["ffmpeg", "-y", "-i", str(w), "-acodec", "pcm_s16le",
             "-ar", "44100", "-ac", "1", str(pcm)])
        head = Path(f"/tmp/framer_chunk{i+1}_head.wav")
        run(["ffmpeg", "-y", "-i", str(pcm), "-af",
             "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB",
             str(head)])
        trimmed = Path(f"/tmp/framer_chunk{i+1}_trimmed.wav")
        run(["ffmpeg", "-y", "-i", str(head), "-af",
             "areverse,silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,areverse",
             str(trimmed)])
        trimmed_wavs.append(trimmed)

    silence_pad = Path("/tmp/framer_silence_pad.wav")
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
         "-t", "0.3", "-acodec", "pcm_s16le", str(silence_pad)])

    inputs = []
    for t in trimmed_wavs:
        inputs.append(str(t))
        inputs.append(str(silence_pad))
    inputs.append(str(CTA_PCM))

    full_pcm = AUDIO_DIR / "full_pcm.wav"
    cmd = ["ffmpeg", "-y"]
    for inp in inputs:
        cmd.extend(["-i", inp])
    n = len(inputs)
    filter_parts = "".join(f"[{i}]" for i in range(n))
    filter_complex = f"{filter_parts}concat=n={n}:v=0:a=1[out]"
    cmd.extend([
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1",
        str(full_pcm),
    ])
    print(f"Combining {len(trimmed_wavs)} chunks + {len(trimmed_wavs)} silences + 1 CTA = {n} inputs")
    run(cmd)

    full_wav = AUDIO_DIR / "full.wav"
    shutil.copy(full_pcm, full_wav)

    # Verify
    print("\n=== STEP 4c: Verify ===")
    chunk_total = 0.0
    for i, w in enumerate(chunk_wavs):
        d = probe_duration(Path(f"/tmp/framer_chunk{i+1}_pcm.wav"))
        print(f"  Chunk {i+1}: {d:.1f}s")
        chunk_total += d
    cta_dur = probe_duration(CTA_PCM)
    full_dur = probe_duration(full_pcm)
    expected = chunk_total + cta_dur
    diff = full_dur - expected
    print(f"\nChunks total: {chunk_total:.1f}s")
    print(f"CTA: {cta_dur:.1f}s")
    print(f"Expected: {expected:.1f}s")
    print(f"Full: {full_dur:.1f}s")
    print(f"Diff: {diff:+.1f}s")
    assert abs(diff) <= 10.0, f"CTA likely missing! diff={diff:+.1f}s"
    print("\nDONE.")
    print(f"Output: {full_wav}")
    print(f"Output: {full_pcm}")

    # chunk cumulative timestamps for user table
    print("\n=== Chunk splice timestamps ===")
    cum = 0.0
    for i, w in enumerate(trimmed_wavs):
        d = probe_duration(w)
        cum += d + 0.3
        mins = int(cum // 60)
        secs = int(cum % 60)
        chars = len(chunks[i])
        risk = "高" if chars >= 1500 else ("中" if chars >= 1000 else "低")
        print(f"  Chunk{i+1} end @ {mins}:{secs:02d} ({chars} chars, risk={risk})")
    cta_start_min = int(cum // 60)
    cta_start_sec = int(cum % 60)
    print(f"  CTA splice @ {cta_start_min}:{cta_start_sec:02d} (risk=中)")


if __name__ == "__main__":
    main()
