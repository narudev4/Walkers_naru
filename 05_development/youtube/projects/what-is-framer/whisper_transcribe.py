#!/usr/bin/env python3
"""Phase 2: Whisper CPU transcription with word timestamps (~30min for 17min audio)."""
import json
import sys
import time
from pathlib import Path

import whisper

AUDIO = Path("/Users/naru/Walkers_naru/05_development/youtube/projects/what-is-framer/audio/full_pcm.wav")
OUT = Path("/tmp/framer_whisper_segments.json")

print(f"Loading whisper medium (CPU)...")
t0 = time.time()
model = whisper.load_model("medium")
print(f"Model loaded in {time.time()-t0:.1f}s")

print(f"Transcribing {AUDIO} ... (~30min expected)")
t0 = time.time()
result = model.transcribe(str(AUDIO), language="ja", word_timestamps=True, fp16=False)
print(f"Done in {time.time()-t0:.1f}s")

segments = []
for s in result['segments']:
    seg = {
        'start': s['start'],
        'end': s['end'],
        'text': s['text'],
        'words': [{'word': w['word'], 'start': w['start'], 'end': w['end']}
                  for w in s.get('words', [])],
    }
    segments.append(seg)

OUT.write_text(json.dumps(segments, ensure_ascii=False, indent=2))
print(f"Saved {len(segments)} segments to {OUT}")
