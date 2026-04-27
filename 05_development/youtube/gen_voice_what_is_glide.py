#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
what-is-glide 音声生成スクリプト
ElevenLabs V3 API → チャンク音声生成 → PCM変換 → filter_complex結合 → CTA結合
"""

import re
import os
import sys
import glob
import shutil
import subprocess
import requests
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SLUG = "what-is-glide"
SCRIPT_PATH = BASE_DIR / "projects" / SLUG / "script.md"
AUDIO_DIR = BASE_DIR / "projects" / SLUG / "audio"
CTA_PCM = BASE_DIR / "templates" / "cta_audio_pcm.wav"
CREDENTIALS_DIR = BASE_DIR.parent.parent / "credentials"

AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ─── PRONUNCIATION MAP ──────────────────────────────────
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
    'PWA': 'ピーダブリューエー',
    'Airtable': 'エアテーブル',
    'BigQuery': 'ビッグクエリ',
    # 漢字誤変換対策
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

def apply_fixes(text):
    for k, v in PRONUNCIATION_MAP.items():
        text = text.replace(k, v)
    # 中黒修正: 「AI・」→「AI、」
    text = re.sub(r'AI・', 'AI、', text)
    return text

# ─── STEP 1: 台本から本編テキスト抽出（CTA除外）──────────
print("=== STEP 1: 台本読み込み・本編テキスト抽出 ===")
script_text = SCRIPT_PATH.read_text(encoding='utf-8')

# 各スライドのナレーションを抽出
# スライド30〜37はCTA（除外）
slide_sections = re.split(r'(?=### 【スライド)', script_text)

narrations = []  # (slide_num, title_hint, text)
for section in slide_sections:
    m = re.match(r'### 【スライド(\d+)】(.+?)(?:\n)(.*)', section, re.DOTALL)
    if not m:
        continue
    slide_num = int(m.group(1))
    slide_title = m.group(2).strip()
    body = m.group(3)

    # スライド30以降はCTA → 除外
    if slide_num >= 30:
        continue

    # HTMLコメント除去
    body = re.sub(r'<!--.*?-->', '', body, flags=re.DOTALL)
    # 区切り線除去
    body = re.sub(r'^---+$', '', body, flags=re.MULTILINE)
    body = body.strip()

    if body:
        narrations.append((slide_num, slide_title, body))
        print(f"  Slide {slide_num}: {slide_title[:30]}... ({len(body)}字)")

print(f"本編スライド数: {len(narrations)}枚")

# ─── STEP 2: 発音修正 + Audio Tags 挿入 ──────────────────
print("\n=== STEP 2: 発音修正 + Audio Tags 挿入 ===")

# 全体テキストを一旦結合してから適用
full_narration_parts = []
for slide_num, title, text in narrations:
    full_narration_parts.append((slide_num, title, apply_fixes(text)))

# Audio Tags 挿入（セクションスライドの前に[pause]を挿入）
# セクションタイトルスライド: 6, 8, 13, 18, 20, 28
SECTION_SLIDES = {6, 8, 13, 18, 20, 28}

tagged_parts = []
for slide_num, title, text in full_narration_parts:
    if slide_num == 1:
        # 冒頭に[calm]
        text = "[calm] " + text
    if slide_num in SECTION_SLIDES:
        # セクション開始前に[pause]
        text = "[pause] " + text
    tagged_parts.append((slide_num, title, text))

# ─── STEP 3: 2000文字以下チャンク分割 ───────────────────
print("\n=== STEP 3: チャンク分割 ===")

# セクション境界で分割: スライド6,8,13,18,20,28の直前で切る
# チャンク境界スライド番号
CHUNK_BOUNDARIES = [1, 6, 8, 13, 18, 20, 28]

chunks = []
current_chunk_slides = []
current_boundary_idx = 0

for i, (slide_num, title, text) in enumerate(tagged_parts):
    # 次の境界に達したらチャンク確定
    if i > 0 and slide_num in SECTION_SLIDES:
        # 現在のチャンクを確定
        chunk_text = "\n\n".join(t for _, _, t in current_chunk_slides)
        if len(chunk_text) > 2000:
            # スライド単位で再分割
            sub_chunk = ""
            for sn, stitle, stext in current_chunk_slides:
                candidate = sub_chunk + "\n\n" + stext if sub_chunk else stext
                if len(candidate) > 2000:
                    if sub_chunk:
                        chunks.append(sub_chunk.strip())
                    sub_chunk = stext
                else:
                    sub_chunk = candidate
            if sub_chunk:
                chunks.append(sub_chunk.strip())
        else:
            if chunk_text:
                chunks.append(chunk_text.strip())
        current_chunk_slides = [(slide_num, title, text)]
    else:
        current_chunk_slides.append((slide_num, title, text))

# 最後のチャンク
if current_chunk_slides:
    chunk_text = "\n\n".join(t for _, _, t in current_chunk_slides)
    if len(chunk_text) > 2000:
        sub_chunk = ""
        for sn, stitle, stext in current_chunk_slides:
            candidate = sub_chunk + "\n\n" + stext if sub_chunk else stext
            if len(candidate) > 2000:
                if sub_chunk:
                    chunks.append(sub_chunk.strip())
                sub_chunk = stext
            else:
                sub_chunk = candidate
        if sub_chunk:
            chunks.append(sub_chunk.strip())
    else:
        if chunk_text:
            chunks.append(chunk_text.strip())

# チャンク確認 + assert
print(f"チャンク数: {len(chunks)}")
for i, chunk in enumerate(chunks):
    print(f"  Chunk {i+1}: {len(chunk)}字")
    assert len(chunk) <= 2000, f"BLOCKED: Chunk {i+1} is {len(chunk)} chars! 2000字を超えています"

print("全チャンク 2000字以下 → OK")

# ─── STEP 4: ElevenLabs API 呼び出し ────────────────────
print("\n=== STEP 4: ElevenLabs API 呼び出し ===")

api_key = (CREDENTIALS_DIR / "elevenlabs_api_key.txt").read_text().strip()
voice_id = (CREDENTIALS_DIR / "elevenlabs_voice_id.txt").read_text().strip()

url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
headers = {
    "xi-api-key": api_key,
    "Content-Type": "application/json",
    "Accept": "audio/wav"
}

for i, chunk in enumerate(chunks):
    out_path = f"/tmp/chunk{i+1}.wav"
    data = {
        "text": chunk,
        "model_id": "eleven_v3",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0
        }
    }
    print(f"  Chunk {i+1}/{len(chunks)} を生成中... ({len(chunk)}字)", end="", flush=True)
    response = requests.post(url, json=data, headers=headers)
    assert response.status_code == 200, f"API error: {response.status_code} - {response.text[:200]}"
    with open(out_path, "wb") as f:
        f.write(response.content)
    print(f" → {len(response.content):,} bytes saved → {out_path}")

# ─── STEP 5: PCM変換 → トリム → filter_complex 結合 ────
print("\n=== STEP 5: PCM変換・トリム・結合 ===")

# 1. 各チャンクをPCM変換
for i in range(1, len(chunks) + 1):
    src = f"/tmp/chunk{i}.wav"
    dst = f"/tmp/chunk{i}_pcm.wav"
    ret = subprocess.run(
        ["ffmpeg", "-y", "-i", src, "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", dst],
        capture_output=True
    )
    assert ret.returncode == 0, f"PCM変換失敗 chunk{i}: {ret.stderr.decode()}"
    print(f"  PCM変換: chunk{i}.wav → chunk{i}_pcm.wav")

# 2. 各チャンクの先頭/末尾無音をトリム
for i in range(1, len(chunks) + 1):
    src_pcm = f"/tmp/chunk{i}_pcm.wav"
    head_trimmed = f"/tmp/chunk{i}_pcm_head_trimmed.wav"
    trimmed = f"/tmp/chunk{i}_pcm_trimmed.wav"

    # 先頭無音トリム
    ret = subprocess.run(
        ["ffmpeg", "-y", "-i", src_pcm,
         "-af", "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB",
         head_trimmed],
        capture_output=True
    )
    assert ret.returncode == 0, f"先頭トリム失敗 chunk{i}: {ret.stderr.decode()}"

    # 末尾無音トリム（reverse→トリム→reverse）
    ret = subprocess.run(
        ["ffmpeg", "-y", "-i", head_trimmed,
         "-af", "areverse,silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB,areverse",
         trimmed],
        capture_output=True
    )
    assert ret.returncode == 0, f"末尾トリム失敗 chunk{i}: {ret.stderr.decode()}"
    print(f"  トリム: chunk{i}_pcm_trimmed.wav")

# 3. 0.3秒無音パッド生成
silence_pad = "/tmp/silence_pad.wav"
ret = subprocess.run(
    ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
     "-t", "0.3", "-acodec", "pcm_s16le", silence_pad],
    capture_output=True
)
assert ret.returncode == 0, f"無音パッド生成失敗: {ret.stderr.decode()}"
print("  無音パッド生成: silence_pad.wav (0.3秒)")

# 4. filter_complex concat で結合
trimmed_chunks = sorted(glob.glob("/tmp/chunk*_pcm_trimmed.wav"))
cta_pcm_abs = str(CTA_PCM.resolve())

# 入力リスト: chunk1, silence, chunk2, silence, ..., chunkN, silence, CTA
inputs = []
for chunk_path in trimmed_chunks:
    inputs.append(chunk_path)
    inputs.append(silence_pad)
inputs.append(cta_pcm_abs)

cmd = ["ffmpeg", "-y"]
for inp in inputs:
    cmd.extend(["-i", inp])

n = len(inputs)
filter_parts = "".join(f"[{i}]" for i in range(n))
filter_complex = f"{filter_parts}concat=n={n}:v=0:a=1[out]"

full_pcm_out = str(AUDIO_DIR / "full_pcm.wav")
cmd.extend([
    "-filter_complex", filter_complex,
    "-map", "[out]",
    "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1",
    full_pcm_out
])

print(f"\n  結合: {len(trimmed_chunks)}チャンク + {len(trimmed_chunks)}無音 + 1 CTA = {n}入力")
ret = subprocess.run(cmd, capture_output=True, text=True)
assert ret.returncode == 0, f"ffmpeg結合失敗: {ret.stderr}"
print(f"  → {full_pcm_out}")

# full.wavにもコピー
full_out = str(AUDIO_DIR / "full.wav")
shutil.copy(full_pcm_out, full_out)
print(f"  → {full_out}")

# ─── STEP 6: 検証 ────────────────────────────────────────
print("\n=== STEP 6: 秒数検証 ===")

def get_duration(path):
    ret = subprocess.run(
        ["ffprobe", "-i", path, "-show_entries", "format=duration",
         "-v", "quiet", "-of", "csv=p=0"],
        capture_output=True, text=True
    )
    return float(ret.stdout.strip())

chunk_total = 0.0
for i in range(1, len(chunks) + 1):
    dur = get_duration(f"/tmp/chunk{i}_pcm.wav")
    print(f"  chunk{i}_pcm.wav: {dur:.1f}秒")
    chunk_total += dur

cta_dur = get_duration(cta_pcm_abs)
print(f"  CTA template: {cta_dur:.1f}秒")

full_dur = get_duration(full_pcm_out)
print(f"  Full audio: {full_dur:.1f}秒")

expected = chunk_total + cta_dur
diff = abs(full_dur - expected)
print(f"\n  期待値: {expected:.1f}秒 / 実測: {full_dur:.1f}秒 / 差: {diff:.1f}秒")

assert diff <= 10.0, f"CRITICAL: CTA欠落の可能性あり! 差が{diff:.1f}秒 (許容±10秒)"
print("  → 秒数検証 PASS ✓")

print(f"\n=== 完了 ===")
print(f"  出力: {full_out}")
print(f"  出力: {full_pcm_out}")
print(f"  総尺: {full_dur:.1f}秒 ({int(full_dur//60)}分{int(full_dur%60)}秒)")

# チャンク結合点テーブル表示
print("\n=== チャンク結合点テーブル（要確認） ===")
print(f"{'リスク':<6} {'タイムスタンプ':<14} 内容")
print("-" * 55)
cumulative = 0.0
for i in range(1, len(chunks) + 1):
    dur = get_duration(f"/tmp/chunk{i}_pcm.wav")
    cumulative += dur + 0.3  # silence pad分も加算
    mm = int(cumulative // 60)
    ss = int(cumulative % 60)
    chars = len(chunks[i-1])
    if chars >= 1500:
        risk = "高"
    elif chars >= 1000:
        risk = "中"
    else:
        risk = "低"
    print(f"  {risk:<4}  {mm}:{ss:02d}付近        チャンク{i}末尾 ({chars}字)")

# CTAテンプレート接合部
cta_start = full_dur - cta_dur
mm_cta = int(cta_start // 60)
ss_cta = int(cta_start % 60)
print(f"  中    {mm_cta}:{ss_cta:02d}付近        CTAテンプレート接合部")
