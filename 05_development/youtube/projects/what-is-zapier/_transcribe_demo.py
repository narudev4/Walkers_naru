"""Whisper MPS で zapier実演.mp4 を文字起こし。"""
from __future__ import annotations

import json
from pathlib import Path

import torch
import whisper

HERE = Path(__file__).parent
WAV = HERE / "zapier_demo_pcm.wav"
OUT_MD = HERE / "zapier_demo_transcript.md"
OUT_JSON = HERE / "zapier_demo_transcript.json"

device = "mps" if torch.backends.mps.is_available() else "cpu"
print(f"[whisper] device={device}")

model = whisper.load_model("medium", device=device)
result = model.transcribe(
    str(WAV),
    language="ja",
    verbose=False,
    fp16=False,
)


def fmt(sec: float) -> str:
    m, s = divmod(int(sec), 60)
    return f"{m:02d}:{s:02d}"


lines = ["# zapier実演.mp4 文字起こし", "", f"- source: `zapier実演.mp4`", f"- language: ja", f"- model: whisper medium ({device})", ""]
lines.append("## タイムスタンプ付き")
lines.append("")
for seg in result["segments"]:
    lines.append(f"- **{fmt(seg['start'])} - {fmt(seg['end'])}**: {seg['text'].strip()}")
lines.append("")
lines.append("## 全文")
lines.append("")
lines.append(result["text"].strip())
lines.append("")

OUT_MD.write_text("\n".join(lines), encoding="utf-8")
OUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"[whisper] wrote {OUT_MD}")
print(f"[whisper] wrote {OUT_JSON}")
