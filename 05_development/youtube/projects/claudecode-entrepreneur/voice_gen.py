#!/usr/bin/env python3
"""yt-voice 音声生成スクリプト (claudecode-entrepreneur 用)"""
import re
import os
import subprocess
import shutil
import glob
from pathlib import Path
import requests

PROJECT = Path("/Users/naru/Walkers_naru/05_development/youtube/projects/claudecode-entrepreneur")
SCRIPT_MD = PROJECT / "script.md"
AUDIO_DIR = PROJECT / "audio"
AUDIO_DIR.mkdir(exist_ok=True, parents=True)
TMP = Path("/tmp/cce_voice")
TMP.mkdir(exist_ok=True, parents=True)
for f in TMP.glob("*.wav"):
    f.unlink()

CREDS = Path("/Users/naru/Walkers_naru/credentials")
API_KEY = (CREDS / "elevenlabs_api_key.txt").read_text().strip()
VOICE_ID = (CREDS / "elevenlabs_voice_id.txt").read_text().strip()

CTA_PCM = Path("/Users/naru/Walkers_naru/05_development/youtube/_shared/templates/cta_audio_pcm.wav")

# ---- STEP 1: 本編テキスト抽出 (CTA除外) ----
PRONUNCIATION_MAP = {
    'ノーコード': 'のーこーど',
    'ローコード': 'ろーこーど',
    'Walkers': 'ウォーカーズ',
    'Cursor': 'カーソル',
    'Claude Code': 'クロードコード',
    'ClaudeCode': 'クロードコード',
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
    'PMF': 'ピーエムエフ',
    'KPI': 'ケーピーアイ',
    'ARR': 'エーアールアール',
    'SaaS': 'サース',
    'VC': 'ブイシー',
    'UI': 'ユーアイ',
    'UX': 'ユーエックス',
    'GPT': 'ジーピーティー',
    'SNS': 'エスエヌエス',
    'Figma': 'フィグマ',
    'YouTube': 'ユーチューブ',
    'TikTok': 'ティックトック',
    'Discord': 'ディスコード',
    'Wix': 'ウィックス',
    'Base44': 'ベースフォーティーフォー',
    'Payout': 'ペイアウト',
    'Anything': 'エニシング',
    'App Store': 'アップストア',
    'Google Play': 'グーグルプレイ',
    'Y Combinator': 'ワイコンビネーター',
    'YC': 'ワイコンビネーター',
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

def extract_narration(md: str) -> list[tuple[int, str, str]]:
    """[(slide_no, slide_title, text), ...]"""
    out = []
    pattern = re.compile(r'^### 【スライド(\d+)】(.+?)$', re.MULTILINE)
    matches = list(pattern.finditer(md))
    for i, m in enumerate(matches):
        no = int(m.group(1))
        title = m.group(2).strip()
        start = m.end()
        end = matches[i+1].start() if i+1 < len(matches) else len(md)
        body = md[start:end].strip()
        body = re.sub(r'^---\s*$', '', body, flags=re.MULTILINE).strip()
        body = re.sub(r'<!--.*?-->', '', body, flags=re.DOTALL).strip()
        out.append((no, title, body))
    return out

md = SCRIPT_MD.read_text()
all_slides = extract_narration(md)
# CTA除外: スライド21〜28
main_slides = [(no, t, b) for (no, t, b) in all_slides if no <= 20]
print(f"全スライド数: {len(all_slides)}, 本編: {len(main_slides)}")

# テキスト整形
processed = []
for (no, title, body) in main_slides:
    fixed = apply_fixes(body)
    processed.append((no, title, fixed))
    print(f"  スライド{no}: {title[:30]} ({len(fixed)}文字)")

# ---- STEP 3: チャンク分割 (2000文字以下) ----
# セクション境界（スライド6, 10, 13）で分割を試みる
SECTION_BOUNDARIES = [6, 10, 13]

def make_chunks(slides, max_chars=2000):
    chunks = []
    current = []
    current_chars = 0
    current_first = None
    for (no, title, body) in slides:
        # セクション境界に到達したら、現在のチャンクを確定
        if no in SECTION_BOUNDARIES and current:
            chunks.append((current_first, current[-1][0], '\n\n'.join(s[2] for s in current)))
            current = []
            current_chars = 0
            current_first = None
        # 単スライドが上限超なら個別チャンク
        body_len = len(body) + 2  # 改行余裕
        if current_chars + body_len > max_chars and current:
            chunks.append((current_first, current[-1][0], '\n\n'.join(s[2] for s in current)))
            current = []
            current_chars = 0
            current_first = None
        if current_first is None:
            current_first = no
        current.append((no, title, body))
        current_chars += body_len
    if current:
        chunks.append((current_first, current[-1][0], '\n\n'.join(s[2] for s in current)))
    return chunks

chunks = make_chunks(processed)
print(f"\nチャンク数: {len(chunks)}")
for i, (first, last, txt) in enumerate(chunks):
    print(f"  Chunk {i+1}: スライド{first}-{last} ({len(txt)}文字)")
    assert len(txt) <= 2000, f"BLOCKED: Chunk {i+1} is {len(txt)} chars!"

# ---- STEP 4: ElevenLabs API ----
url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
headers = {
    "xi-api-key": API_KEY,
    "Content-Type": "application/json",
    "Accept": "audio/wav",
}

print("\n=== ElevenLabs 音声生成開始 ===")
chunk_paths = []
for i, (first, last, txt) in enumerate(chunks):
    out = TMP / f"chunk{i+1:02d}.wav"
    print(f"Chunk {i+1}: スライド{first}-{last} → {out.name} 生成中...")
    data = {
        "text": txt,
        "model_id": "eleven_v3",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0},
    }
    r = requests.post(url, json=data, headers=headers, timeout=300)
    assert r.status_code == 200, f"API error chunk{i+1}: {r.status_code} {r.text[:200]}"
    out.write_bytes(r.content)
    print(f"  → {len(r.content)} bytes")
    chunk_paths.append(out)

print(f"\n生成完了: {len(chunk_paths)} chunks")

# ---- STEP 5: PCM変換 + トリム + filter_complex 結合 + CTA結合 ----
print("\n=== PCM変換 + 結合 ===")
trimmed = []
for cp in chunk_paths:
    base = cp.stem
    pcm = TMP / f"{base}_pcm.wav"
    head = TMP / f"{base}_head.wav"
    tr = TMP / f"{base}_trim.wav"
    subprocess.run(["ffmpeg", "-y", "-i", str(cp), "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(pcm)], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-i", str(pcm), "-af", "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB", str(head)], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-i", str(head), "-af", "areverse,silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,areverse", str(tr)], check=True, capture_output=True)
    trimmed.append(tr)

silence = TMP / "silence_pad.wav"
subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.3", "-acodec", "pcm_s16le", str(silence)], check=True, capture_output=True)

inputs = []
for tr in trimmed:
    inputs.append(str(tr))
    inputs.append(str(silence))
inputs.append(str(CTA_PCM))

cmd = ["ffmpeg", "-y"]
for inp in inputs:
    cmd.extend(["-i", inp])
n = len(inputs)
filter_parts = "".join(f"[{i}]" for i in range(n))
cmd.extend([
    "-filter_complex", f"{filter_parts}concat=n={n}:v=0:a=1[out]",
    "-map", "[out]",
    "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1",
    str(AUDIO_DIR / "full_pcm.wav"),
])
print(f"結合中: {len(trimmed)} chunks + {len(trimmed)} silences + 1 CTA = {n} inputs")
result = subprocess.run(cmd, capture_output=True, text=True)
assert result.returncode == 0, f"ffmpeg failed: {result.stderr[-500:]}"
shutil.copy(AUDIO_DIR / "full_pcm.wav", AUDIO_DIR / "full.wav")
print("結合完了")

# ---- STEP 6: 検証 ----
print("\n=== 検証 ===")
def dur(p):
    r = subprocess.run(["ffprobe", "-i", str(p), "-show_entries", "format=duration", "-v", "quiet", "-of", "csv=p=0"], capture_output=True, text=True)
    return float(r.stdout.strip())

chunk_total = 0.0
for tr in trimmed:
    d = dur(tr)
    chunk_total += d
    print(f"  {tr.name}: {d:.2f}秒")
cta_dur = dur(CTA_PCM)
silence_total = 0.3 * len(trimmed)
full_dur = dur(AUDIO_DIR / "full_pcm.wav")
expected = chunk_total + silence_total + cta_dur
diff = full_dur - expected
print(f"\nチャンク合計: {chunk_total:.2f}秒")
print(f"無音パッド合計: {silence_total:.2f}秒")
print(f"CTAテンプレート: {cta_dur:.2f}秒")
print(f"期待値: {expected:.2f}秒")
print(f"実測値: {full_dur:.2f}秒")
print(f"差分: {diff:+.2f}秒")
assert abs(diff) <= 5.0, f"CTA欠落? 差分が大きすぎる: {diff:.2f}秒"
print("\n✅ 検証OK: CTA結合成功")

# ---- 結合点情報 ----
print("\n=== チャンク結合点 ===")
cum = 0.0
for i, tr in enumerate(trimmed):
    d = dur(tr)
    cum += d + 0.3
    first, last, txt = chunks[i]
    risk = "高" if len(txt) >= 1500 else ("中" if len(txt) >= 1000 else "低")
    m, s = divmod(int(cum), 60)
    print(f"  リスク{risk} | {m}:{s:02d}付近 | チャンク{i+1}末尾(スライド{first}-{last}) | {len(txt)}字")
print(f"  リスク中 | CTA結合点")

print(f"\nfull.wav: {AUDIO_DIR / 'full.wav'}")
