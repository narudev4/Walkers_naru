#!/usr/bin/env python3
"""yt-voice 音声生成スクリプト（claudecode-failure）"""
import re
import os
import sys
import glob
import shutil
import subprocess
import requests
from pathlib import Path

ROOT = Path("/Users/naru/Walkers_naru")
SLUG = "claudecode-failure"
SCRIPT_PATH = ROOT / "output" / "youtube" / SLUG / "script.md"
AUDIO_DIR = ROOT / "output" / "youtube" / SLUG / "audio"
CTA_PCM = ROOT / "05_development" / "youtube" / "templates" / "cta_audio_pcm.wav"
CHUNK_DIR = Path("/tmp/cc_failure_audio")
CHUNK_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

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


def extract_narrations(script_text: str):
    """各 ### 【スライドN】 のナレーションを抽出。末尾スライドは除外。"""
    sections = re.split(r'^### 【(末尾スライド\d+|スライド\d+)】.*$', script_text, flags=re.MULTILINE)
    # sections[0] はヘッダー部分。以降 [marker, body, marker, body, ...]
    slides = []
    for i in range(1, len(sections), 2):
        marker = sections[i]
        body = sections[i + 1] if i + 1 < len(sections) else ''
        if marker.startswith('末尾スライド'):
            continue
        body = body.strip()
        body = re.sub(r'^---\s*$', '', body, flags=re.MULTILINE).strip()
        body = re.sub(r'<!--.*?-->', '', body, flags=re.DOTALL)
        if body:
            slides.append((marker, body))
    return slides


def is_section_title(marker: str, body: str) -> bool:
    return 'セクションタイトル' in body[:100] or 'セクションタイトル' in marker


def chunk_slides(slides, max_chars=2000):
    """セクションタイトル境界で分割。超えたらスライド単位で更に分割。"""
    chunks = []
    current = []
    current_len = 0

    def flush():
        nonlocal current, current_len
        if current:
            text = '\n\n'.join(b for _, b in current)
            chunks.append(text)
            current = []
            current_len = 0

    section_start_indices = []
    for idx, (marker, body) in enumerate(slides):
        if 'セクションタイトル' in body[:60]:
            section_start_indices.append(idx)

    # シンプル戦略: セクションタイトル位置で分割し、各塊が2000を超える場合さらに分割
    boundaries = section_start_indices + [len(slides)]
    prev = 0
    blocks = []
    for b in boundaries:
        if b > prev:
            blocks.append(slides[prev:b])
            prev = b

    chunks = []
    cur_text = ''
    for block in blocks:
        block_text = '\n\n'.join(body for _, body in block)
        # current chunk + block_text が 2000 以下なら結合
        candidate = (cur_text + '\n\n' + block_text).strip() if cur_text else block_text
        if len(candidate) <= 1900:
            cur_text = candidate
        else:
            if cur_text:
                chunks.append(cur_text)
                cur_text = ''
            # block_text 自体が 2000 超ならスライド単位で再分割
            if len(block_text) <= 1900:
                cur_text = block_text
            else:
                sub = ''
                for _, body in block:
                    cand = (sub + '\n\n' + body).strip() if sub else body
                    if len(cand) <= 1900:
                        sub = cand
                    else:
                        if sub:
                            chunks.append(sub)
                        sub = body
                if sub:
                    cur_text = sub
    if cur_text:
        chunks.append(cur_text)
    return chunks


def call_elevenlabs(chunk_text: str, idx: int, api_key: str, voice_id: str) -> Path:
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/wav",
    }
    data = {
        "text": chunk_text,
        "model_id": "eleven_v3",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
        },
    }
    print(f"  ► API call chunk {idx}: {len(chunk_text)} chars...")
    response = requests.post(url, json=data, headers=headers, timeout=300)
    assert response.status_code == 200, f"API error: {response.status_code} / {response.text[:300]}"
    out = CHUNK_DIR / f"chunk{idx}.wav"
    out.write_bytes(response.content)
    print(f"    saved: {out} ({len(response.content)} bytes)")
    return out


def run(cmd, **kwargs):
    r = subprocess.run(cmd, capture_output=True, text=True, **kwargs)
    if r.returncode != 0:
        print('STDOUT:', r.stdout[-500:])
        print('STDERR:', r.stderr[-1000:])
        raise RuntimeError(f"Command failed: {' '.join(cmd[:6])}...")
    return r


def ffprobe_duration(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-i", str(path), "-show_entries", "format=duration", "-v", "quiet", "-of", "csv=p=0"],
        capture_output=True, text=True,
    )
    return float(r.stdout.strip())


def main():
    api_key = (ROOT / "credentials" / "elevenlabs_api_key.txt").read_text().strip()
    voice_id = (ROOT / "credentials" / "elevenlabs_voice_id.txt").read_text().strip()
    assert CTA_PCM.exists(), f"CTA template not found: {CTA_PCM}"

    print("STEP 1: 台本読み込み・ナレーション抽出")
    script_text = SCRIPT_PATH.read_text()
    slides = extract_narrations(script_text)
    print(f"  抽出スライド数: {len(slides)}")

    print("STEP 2: 発音修正")
    fixed_slides = [(m, apply_fixes(b)) for m, b in slides]

    print("STEP 3: チャンク分割（≤2000文字）")
    chunks = chunk_slides(fixed_slides, max_chars=2000)
    for i, c in enumerate(chunks, 1):
        print(f"  Chunk {i}: {len(c)} chars")
        assert len(c) <= 2000, f"BLOCKED: Chunk {i} is {len(c)} chars!"

    # チャンクテキストをファイルに保存（デバッグ用）
    for i, c in enumerate(chunks, 1):
        (CHUNK_DIR / f"chunk{i}.txt").write_text(c)

    print("STEP 4: ElevenLabs API 呼び出し")
    # 既存チャンクがあれば再利用（再実行時の節約）
    chunk_wavs = []
    for i, c in enumerate(chunks, 1):
        target = CHUNK_DIR / f"chunk{i}.wav"
        if target.exists() and target.stat().st_size > 100_000:
            print(f"  Chunk {i}: 既存ファイルを再利用 ({target.stat().st_size} bytes)")
        else:
            call_elevenlabs(c, i, api_key, voice_id)
        chunk_wavs.append(target)

    print("STEP 5: PCM変換 → トリム → filter_complex結合 → CTA結合")
    # PCM変換
    pcm_wavs = []
    for w in chunk_wavs:
        out = CHUNK_DIR / (w.stem + "_pcm.wav")
        run(["ffmpeg", "-y", "-i", str(w), "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(out)])
        pcm_wavs.append(out)

    # トリム
    trimmed = []
    for w in pcm_wavs:
        head = CHUNK_DIR / (w.stem + "_head.wav")
        run(["ffmpeg", "-y", "-i", str(w), "-af",
             "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB", str(head)])
        tail = CHUNK_DIR / (w.stem + "_trimmed.wav")
        run(["ffmpeg", "-y", "-i", str(head), "-af",
             "areverse,silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,areverse", str(tail)])
        trimmed.append(tail)

    # 0.3秒の無音パッド
    silence_pad = CHUNK_DIR / "silence_pad.wav"
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.3",
         "-acodec", "pcm_s16le", str(silence_pad)])

    # filter_complex で結合
    inputs = []
    for t in trimmed:
        inputs.append(str(t))
        inputs.append(str(silence_pad))
    inputs.append(str(CTA_PCM))

    cmd = ["ffmpeg", "-y"]
    for inp in inputs:
        cmd.extend(["-i", inp])
    n = len(inputs)
    filter_parts = "".join(f"[{i}]" for i in range(n))
    filter_complex = f"{filter_parts}concat=n={n}:v=0:a=1[out]"
    full_pcm = AUDIO_DIR / "full_pcm.wav"
    cmd.extend(["-filter_complex", filter_complex, "-map", "[out]",
                "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(full_pcm)])
    print(f"  Combining {len(trimmed)} chunks + {len(trimmed)} silences + 1 CTA = {n} inputs")
    run(cmd)

    full_wav = AUDIO_DIR / "full.wav"
    shutil.copy(full_pcm, full_wav)
    print(f"  Saved: {full_pcm} / {full_wav}")

    print("STEP 6: 検証")
    chunk_total = 0.0
    chunk_durations = []
    for w in pcm_wavs:
        dur = ffprobe_duration(w)
        chunk_durations.append(dur)
        chunk_total += dur
        print(f"  {w.name}: {dur:.2f}秒")
    cta_dur = ffprobe_duration(CTA_PCM)
    full_dur = ffprobe_duration(full_pcm)
    print(f"  CTA: {cta_dur:.2f}秒")
    print(f"  Full: {full_dur:.2f}秒")
    expected = chunk_total + cta_dur
    diff = full_dur - expected
    print(f"  Expected: {expected:.2f}秒 / Actual: {full_dur:.2f}秒 / Diff: {diff:.2f}秒")
    assert abs(diff) < 5.0, f"CTA欠落の可能性: diff={diff:.2f}秒"

    # チャンク結合点情報を出力
    print("\n=== チャンク結合点（時系列順） ===")
    cumulative = 0.0
    for i, (c, d) in enumerate(zip(chunks, chunk_durations), 1):
        cumulative += d
        m, s = divmod(int(cumulative), 60)
        risk = "低" if len(c) < 1000 else ("中" if len(c) < 1500 else "高")
        print(f"  チャンク{i}末尾: {m}:{s:02d} / {len(c)}字 / リスク={risk}")
    cta_start = cumulative
    m, s = divmod(int(cta_start), 60)
    print(f"  CTA接合点: {m}:{s:02d} / リスク=中")
    print(f"\n全体: {int(full_dur//60)}:{int(full_dur%60):02d}")


if __name__ == "__main__":
    main()
