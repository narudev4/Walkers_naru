"""zapier実演 demo_narration.md を ElevenLabs v3 で音声化。"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import requests

HERE = Path(__file__).parent
MD = HERE / "demo_narration.md"
OUT_RAW = HERE / "demo_narration_raw.wav"

API_KEY = Path("/Users/naru/Walkers_naru/credentials/elevenlabs_api_key.txt").read_text().strip()
VOICE_ID = Path("/Users/naru/Walkers_naru/credentials/elevenlabs_voice_id.txt").read_text().strip()


def extract_narration(md_text: str) -> str:
    """demo_narration.md から本文セクション（### 【x:xx〜x:xx】）の中身だけ連結。"""
    # ナレーション本文の範囲: "## ナレーション本文" 〜 "---" or "## 発音ルール"
    # セクション見出し（### 【...】...）の次行〜空行を拾う
    lines = md_text.splitlines()
    collected: list[str] = []
    in_body = False
    capture = False
    for line in lines:
        if line.startswith("## ナレーション本文"):
            in_body = True
            continue
        if not in_body:
            continue
        if line.startswith("## ") and not line.startswith("## ナレーション本文"):
            break
        if line.startswith("---"):
            break
        if line.startswith("### "):
            capture = True
            continue
        if capture:
            stripped = line.strip()
            if stripped:
                collected.append(stripped)
            # 空行はセクション終わり扱いにしない（次の ### でリセット）
    return "".join(collected)


def apply_pronunciation(text: str) -> str:
    """発音ルールを適用。"""
    rules = {
        "ノーコード": "のーこーど",
        "Walkers": "ウォーカーズ",
        "ウォーカーズ": "ウォーカーズ",
        "行う": "おこなう",
        # 既にカタカナ化済みのため Zapier/Zap/Exec coach 等は原稿で対応済み
    }
    for src, dst in rules.items():
        text = text.replace(src, dst)
    # 「AI・」→「AI、」
    text = text.replace("AI・", "AI、")
    return text


def main() -> None:
    md_text = MD.read_text(encoding="utf-8")
    body = extract_narration(md_text)
    body = apply_pronunciation(body)
    print(f"[tts] 文字数: {len(body)}")
    print(f"[tts] 本文: {body[:80]}…")
    print(f"[tts] voice_id={VOICE_ID[:8]}…")

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    headers = {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/wav",
    }
    data = {
        "text": body,
        "model_id": "eleven_v3",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "speed": 1.0,
        },
    }
    r = requests.post(url, json=data, headers=headers, timeout=180)
    if r.status_code != 200:
        print(f"[tts] ERROR {r.status_code}: {r.text[:500]}", file=sys.stderr)
        sys.exit(1)
    OUT_RAW.write_bytes(r.content)
    print(f"[tts] wrote {OUT_RAW} ({len(r.content):,} bytes)")


if __name__ == "__main__":
    main()
