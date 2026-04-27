#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
what-is-glide 音声分割スクリプト (Phase 1-2)
Whisper medium で full_pcm.wav を文字起こし → segments.json を保存
"""

import json
import whisper
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SLUG = "what-is-glide"
AUDIO_DIR = BASE_DIR / "projects" / SLUG / "audio"
FULL_PCM = AUDIO_DIR / "full_pcm.wav"
SEGMENTS_JSON = AUDIO_DIR / "whisper_segments.json"

print(f"=== Phase 2: Whisper文字起こし ===")
print(f"入力: {FULL_PCM}")
print("モデルロード中... (mediumモデル)")

model = whisper.load_model("medium")

print("文字起こし開始... (MPS/GPU使用。約5〜10分かかります)")
result = model.transcribe(str(FULL_PCM), language="ja", word_timestamps=True)

# セグメント + 単語タイムスタンプを保存
segments = []
for s in result['segments']:
    seg = {
        'start': s['start'],
        'end': s['end'],
        'text': s['text'],
        'words': [{'word': w['word'], 'start': w['start'], 'end': w['end']} for w in s.get('words', [])]
    }
    segments.append(seg)

with open(SEGMENTS_JSON, "w", encoding="utf-8") as f:
    json.dump(segments, f, ensure_ascii=False, indent=2)

print(f"\nセグメント数: {len(segments)}")
print(f"保存: {SEGMENTS_JSON}")

# セグメント一覧表示
print("\n=== セグメント一覧 ===")
for i, seg in enumerate(segments):
    m = int(seg['start'] // 60)
    s = seg['start'] % 60
    print(f"[{i:3d}] {m:2d}:{s:05.2f} | {seg['text'][:80]}")
