#!/usr/bin/env python3
"""yt-voice: 台本 → ElevenLabs 音声生成スクリプト。

設計（2026-05-01 確定）:
  Mode 1: 初回生成（環境変数なし）
    - script.md からチャンク分割（セクションタイトル境界・2000字上限）
    - 各チャンクを ElevenLabs API で生成 → audio/chunks/chunkNN.wav
    - 全チャンク + 無音パッド + CTA テンプレを filter_complex concat
    - 出力: audio/full.wav, audio/full_pcm.wav, audio/voice_report.json
    - CTA は API 呼ばない（_shared/templates/cta_audio_pcm.wav 流し込み）

  Mode 2: scene 単位再生成（REGEN_SCENES=14,16）
    - 指定 scene 番号の本文を script.md から抽出
    - 発音マップ適用 → ElevenLabs API
    - 先頭/末尾無音トリム → audio/scenes/sceneNN.wav 上書き
    - chunks/, full.wav は触らない（HeyGen には naru が手動で再アップ）
    - CTA scene 番号が指定されたらエラー停止（テンプレ運用のため）

使い方:
  HEYGEN_SLUG=foo /Users/naru/.pyenv/versions/3.13.0/bin/python3 \\
    05_development/youtube/_shared/yt-voice.py

  REGEN_SCENES=14,16 HEYGEN_SLUG=foo ... で scene 単位再生成

入力:
  projects/{slug}/script.md
  projects/{slug}/audio/voice_pronunciation_auto.json  （任意・外側 Claude が作成）
  projects/{slug}/voice_pronunciation.json             （任意・手動上書き）
  _shared/templates/cta_audio_pcm.wav                  （CTA 固定音声）
  credentials/elevenlabs_api_key.txt
  credentials/elevenlabs_voice_id.txt

発音マップの優先順位:
  base（ハードコード最小限） ← auto JSON ← manual JSON
  同じキーは後勝ち。

CTA 検出:
  スライドタイトルに「末尾スライドN」または「CTA N」を含む行を抽出。
  0件で停止。≥9件で停止。1〜7件は警告で続行（運用変動許容）。
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import requests


# ===== 定数 =====
ROOT = Path("/Users/naru/Walkers_naru")
PROJECTS_BASE = ROOT / "05_development" / "youtube" / "projects"
SHARED = ROOT / "05_development" / "youtube" / "_shared"
TEMPLATES_DIR = SHARED / "templates"
CTA_TEMPLATE = TEMPLATES_DIR / "cta_audio_pcm.wav"
CREDENTIALS = ROOT / "credentials"

CHUNK_MAX_CHARS = 2000
SILENCE_PAD_SEC = 0.3
DURATION_TOLERANCE_SEC = 5.0
SILENCE_THRESHOLD_DB = -50
SILENCE_MIN_DUR = 0.05
API_TIMEOUT_SEC = 300
API_RETRY_DELAY_SEC = 5

MODEL_ID = "eleven_v3"
VOICE_SETTINGS = {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0.0,
}

# claude -p が落ちた時の保険。汎用テック用語は auto JSON に任せる。
# 2026-05-08: 「ノーコード→のーこーど」「ローコード→ろーこーど」を削除。
#   ElevenLabs JP voice ではひらがな+長音記号(ー)の連続を分節崩壊する傾向あり、
#   「のーこーど」が「の高度/のコード/濃厚度」と誤読された (claudecode-security-failure 検証)。
#   カタカナ複合語は中黒区切り「ノー、コード」が安全。詳細は yt-script SKILL.md の
#   TTS-friendly ルール参照。
BASE_MAP = {
    "Walkers": "ウォーカーズ",
    "行っている": "おこなっている",
    "行っております": "おこなっております",
    "行う": "おこなう",
    "行い": "おこない",
}


# ===== 発音マップ =====

def load_pronunciation_map(proj_dir: Path) -> dict:
    """3 層マージ: BASE ← auto ← manual。同キーは後勝ち。"""
    merged = dict(BASE_MAP)
    auto_json = proj_dir / "audio" / "voice_pronunciation_auto.json"
    manual_json = proj_dir / "voice_pronunciation.json"
    for layer_path, label in [(auto_json, "auto"), (manual_json, "manual")]:
        if not layer_path.exists():
            continue
        try:
            data = json.loads(layer_path.read_text())
        except json.JSONDecodeError as e:
            print(f"⚠ {label} JSON 読込失敗 ({layer_path}): {e}", file=sys.stderr)
            continue
        if not isinstance(data, dict):
            print(f"⚠ {label} JSON が dict じゃない ({layer_path})", file=sys.stderr)
            continue
        merged.update(data)
        print(f"  [pron] {label}: {len(data)} 件マージ ({layer_path.name})")
    return merged


def apply_fixes(text: str, pron_map: dict) -> str:
    """発音マップ適用 + 「AI・」→「AI、」変換。"""
    for k, v in pron_map.items():
        text = text.replace(k, v)
    text = re.sub(r"AI・", "AI、", text)
    return text


# ===== script.md パース =====

SLIDE_PATTERN = re.compile(r"^### 【スライド(\d+)】(.+?)$", re.MULTILINE)
CTA_TITLE_PATTERN = re.compile(r"(末尾スライド|CTA\s*\d+)")


def extract_slides(script_path: Path) -> list:
    """[(slide_no, title, body), ...] を返す。

    body は HTML コメント・--- 区切り・空行をある程度整理。
    """
    text = script_path.read_text()
    matches = list(SLIDE_PATTERN.finditer(text))
    out = []
    for i, m in enumerate(matches):
        no = int(m.group(1))
        title = m.group(2).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        body = re.sub(r"^---\s*$", "", body, flags=re.MULTILINE).strip()
        body = re.sub(r"<!--.*?-->", "", body, flags=re.DOTALL).strip()
        out.append((no, title, body))
    return out


def detect_cta_slides(slides: list) -> set:
    """タイトルに「末尾スライドN」or「CTA N」を含むスライド番号を返す。

    0件 / ≥9件で停止。1〜7件は警告で続行。
    """
    cta = []
    for no, title, _body in slides:
        if CTA_TITLE_PATTERN.search(title):
            cta.append(no)
    if not cta:
        print(
            "ERROR: CTA scenes を検出できなかった。\n"
            "  スライドタイトルに「末尾スライドN」または「CTA N」を含めること。",
            file=sys.stderr,
        )
        sys.exit(1)
    if len(cta) >= 9:
        print(
            f"ERROR: CTA scenes が {len(cta)} 件 (≥9)。タイトルパターン誤検出の疑い。\n"
            f"  検出: {cta}",
            file=sys.stderr,
        )
        sys.exit(1)
    if len(cta) != 8:
        print(f"⚠ CTA scenes が {len(cta)} 件（通常 8）。続行。", file=sys.stderr)
    return set(cta)


def detect_section_boundaries(slides: list, cta_set: set) -> set:
    """タイトルが「セクションタイトル」で始まるスライド番号を返す（CTA 除外）。"""
    return {
        no for no, title, _body in slides
        if no not in cta_set and title.startswith("セクションタイトル")
    }


# ===== チャンク分割 =====

def make_chunks(main_slides: list, boundaries: set, pron_map: dict) -> list:
    """セクション境界 + 2000字上限で分割。

    戻り値: [{'no_first', 'no_last', 'text'}]
    """
    chunks = []
    current = []
    current_chars = 0

    def flush():
        nonlocal current, current_chars
        if current:
            chunks.append({
                "no_first": current[0][0],
                "no_last": current[-1][0],
                "text": "\n\n".join(t for _, t in current),
            })
        current = []
        current_chars = 0

    for no, _title, body in main_slides:
        fixed = apply_fixes(body, pron_map)
        body_with_break = fixed + "\n\n"
        body_len = len(body_with_break)
        # セクション境界に到達したら確定
        if no in boundaries and current:
            flush()
        # 2000字超なら確定
        if current_chars + body_len > CHUNK_MAX_CHARS and current:
            flush()
        current.append((no, fixed))
        current_chars += body_len
    flush()
    return chunks


# ===== ElevenLabs API =====

def call_elevenlabs(text: str, api_key: str, voice_id: str) -> bytes:
    """ElevenLabs に投げて wav バイト列を返す。5xx は 1 回再試行。"""
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/wav",
    }
    data = {
        "text": text,
        "model_id": MODEL_ID,
        "voice_settings": VOICE_SETTINGS,
    }
    last_err = None
    for attempt in range(2):
        try:
            r = requests.post(url, json=data, headers=headers, timeout=API_TIMEOUT_SEC)
        except requests.RequestException as e:
            last_err = f"network error: {e}"
            if attempt == 0:
                print(f"⚠ {last_err} → {API_RETRY_DELAY_SEC}秒後にリトライ", file=sys.stderr)
                time.sleep(API_RETRY_DELAY_SEC)
                continue
            raise RuntimeError(f"ElevenLabs API failed: {last_err}")
        if r.status_code == 200:
            return r.content
        if 500 <= r.status_code < 600 and attempt == 0:
            last_err = f"{r.status_code} {r.text[:200]}"
            print(f"⚠ ElevenLabs API {last_err} → {API_RETRY_DELAY_SEC}秒後にリトライ", file=sys.stderr)
            time.sleep(API_RETRY_DELAY_SEC)
            continue
        raise RuntimeError(f"ElevenLabs API failed: {r.status_code} {r.text[:300]}")
    raise RuntimeError(f"ElevenLabs API failed after retry: {last_err}")


# ===== ffmpeg helpers =====

def to_pcm(src: Path, dst: Path):
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src),
         "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(dst)],
        check=True, capture_output=True,
    )


def trim_silence(src: Path, dst: Path):
    """先頭・末尾の無音をトリム。閾値 -50dB / 0.05s。"""
    head = src.parent / f"{src.stem}_head.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src),
         "-af", f"silenceremove=start_periods=1:start_silence={SILENCE_MIN_DUR}:start_threshold={SILENCE_THRESHOLD_DB}dB",
         "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(head)],
        check=True, capture_output=True,
    )
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(head),
         "-af", f"areverse,silenceremove=start_periods=1:start_silence={SILENCE_MIN_DUR}:start_threshold={SILENCE_THRESHOLD_DB}dB,areverse",
         "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(dst)],
        check=True, capture_output=True,
    )
    head.unlink(missing_ok=True)


def make_silence(dst: Path, duration_sec: float):
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
         "-t", str(duration_sec), "-acodec", "pcm_s16le", str(dst)],
        check=True, capture_output=True,
    )


def get_duration(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-i", str(path), "-show_entries", "format=duration",
         "-v", "quiet", "-of", "csv=p=0"],
        capture_output=True, text=True,
    )
    return float(r.stdout.strip())


def concat_filter(inputs: list, dst: Path):
    """filter_complex concat で結合。-c copy は禁止（チャンク境界で音切れする）。"""
    cmd = ["ffmpeg", "-y"]
    for inp in inputs:
        cmd.extend(["-i", str(inp)])
    n = len(inputs)
    fparts = "".join(f"[{i}]" for i in range(n))
    cmd.extend([
        "-filter_complex", f"{fparts}concat=n={n}:v=0:a=1[out]",
        "-map", "[out]",
        "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1",
        str(dst),
    ])
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed: {r.stderr[-500:]}")


# ===== Mode 1: 初回生成 =====

def run_initial(
    slides: list, cta_set: set, boundaries: set,
    pron_map: dict, api_key: str, voice_id: str,
    audio_dir: Path, tmp_dir: Path,
):
    main_slides = [(no, t, b) for no, t, b in slides if no not in cta_set]
    print(f"[初回] 本編 {len(main_slides)} スライド / CTA {len(cta_set)} スライド")

    chunks = make_chunks(main_slides, boundaries, pron_map)
    print(f"[初回] {len(chunks)} チャンクに分割")
    for i, c in enumerate(chunks):
        n = len(c["text"])
        print(f"  chunk{i+1:02d}: スライド{c['no_first']}-{c['no_last']} ({n} 文字)")
        assert n <= CHUNK_MAX_CHARS, f"BLOCKED: chunk{i+1} is {n} chars > {CHUNK_MAX_CHARS}"

    chunks_dir = audio_dir / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)

    chunk_files = []
    for i, c in enumerate(chunks):
        out = chunks_dir / f"chunk{i+1:02d}.wav"
        print(f"[API] chunk{i+1:02d} 生成中... ({len(c['text'])} 文字)")
        wav_bytes = call_elevenlabs(c["text"], api_key, voice_id)
        out.write_bytes(wav_bytes)
        chunk_files.append(out)
        print(f"  → {len(wav_bytes)} bytes")

    pcm_dir = tmp_dir / "pcm"
    pcm_dir.mkdir(exist_ok=True, parents=True)
    trimmed = []
    for cf in chunk_files:
        pcm = pcm_dir / f"{cf.stem}_pcm.wav"
        tr = pcm_dir / f"{cf.stem}_trim.wav"
        to_pcm(cf, pcm)
        trim_silence(pcm, tr)
        trimmed.append(tr)

    silence = tmp_dir / "silence_pad.wav"
    make_silence(silence, SILENCE_PAD_SEC)

    inputs = []
    for tr in trimmed:
        inputs.append(tr)
        inputs.append(silence)
    inputs.append(CTA_TEMPLATE)

    full_pcm = audio_dir / "full_pcm.wav"
    full_wav = audio_dir / "full.wav"
    print(f"[結合] {len(trimmed)} chunks + {len(trimmed)} silences + 1 CTA = {len(inputs)} inputs")
    concat_filter(inputs, full_pcm)
    shutil.copy(full_pcm, full_wav)
    print(f"[結合] full.wav 完成: {full_pcm.stat().st_size:,} bytes")

    chunk_total = sum(get_duration(tr) for tr in trimmed)
    silence_total = SILENCE_PAD_SEC * len(trimmed)
    cta_dur = get_duration(CTA_TEMPLATE)
    full_dur = get_duration(full_pcm)
    expected = chunk_total + silence_total + cta_dur
    diff = full_dur - expected
    print(f"[検証] チャンク合計: {chunk_total:.2f}s / 無音: {silence_total:.2f}s / CTA: {cta_dur:.2f}s")
    print(f"[検証] 期待: {expected:.2f}s / 実測: {full_dur:.2f}s / 差分: {diff:+.2f}s")
    assert abs(diff) <= DURATION_TOLERANCE_SEC, (
        f"CTA 欠落の疑い: 差分 {diff:.2f}s > ±{DURATION_TOLERANCE_SEC}s"
    )
    print("✅ 検証 OK")

    report = {
        "mode": "initial",
        "chunks": [],
        "cta_duration": cta_dur,
        "full_duration": full_dur,
        "risk_table": [],
    }
    cum = 0.0
    for i, c in enumerate(chunks):
        d = get_duration(trimmed[i])
        cum += d + SILENCE_PAD_SEC
        n = len(c["text"])
        risk = "高" if n >= 1500 else ("中" if n >= 1000 else "低")
        m, s = divmod(int(cum), 60)
        report["chunks"].append({
            "no": i + 1,
            "slides": f"{c['no_first']}-{c['no_last']}",
            "chars": n,
            "duration": round(d, 2),
        })
        report["risk_table"].append({
            "risk": risk,
            "timestamp": f"{m}:{s:02d}",
            "note": f"chunk{i+1:02d} 末尾 (スライド{c['no_first']}-{c['no_last']}) {n}字",
        })
    cum_int = int(cum)
    report["risk_table"].append({
        "risk": "中",
        "timestamp": f"{cum_int//60}:{cum_int%60:02d}",
        "note": "CTA 結合点",
    })
    (audio_dir / "voice_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2)
    )
    print("[出力] voice_report.json")
    print(f"\nfull.wav: {full_wav}")


# ===== Mode 2: scene 単位再生成 =====

def parse_regen_scenes(env_val: str) -> list:
    return sorted({int(x) for x in env_val.split(",") if x.strip()})


def verify_scenes_with_whisper(scenes_dir: Path, scene_nos: list, slide_map: dict):
    """mlx-whisper で再生成 wav を書き起こし、元台本との差分から誤読疑いを警告。

    完璧ではない: Whisper は補正バイアスで実音の誤読を「正しく」転写することがある
    (例: 「じこうじれい」音声を「事故事例」に補正)。あくまでセーフティネット。
    最終判断は耳での確認に委ねる。
    """
    try:
        import mlx_whisper
    except ImportError:
        print("\n⚠ mlx-whisper 未インストール。Whisper 検証スキップ。", file=sys.stderr)
        return

    print("\n=== Whisper 自動検証 (TTS-friendly チェック H') ===")
    issues = []
    for sn in scene_nos:
        wav = scenes_dir / f"scene{sn:02d}.wav"
        if not wav.exists():
            continue
        try:
            r = mlx_whisper.transcribe(
                str(wav),
                path_or_hf_repo="mlx-community/whisper-large-v3-mlx",
                language="ja",
                verbose=False,
            )
        except Exception as e:
            print(f"  [whisper] scene{sn:02d}: 書き起こし失敗 ({e})")
            continue
        actual = r["text"].strip()
        _, expected = slide_map.get(sn, (None, ""))
        # 元台本に出てくる「目立つ語」のうち実音転写に消えているものを抽出
        # 漢字 2-4 字の熟語 + カタカナ 4 音節以上を疑い対象に
        suspect = set()
        suspect.update(re.findall(r"[一-鿿]{2,4}", expected))
        suspect.update(re.findall(r"[ァ-ヴー]{4,}", expected))
        missing = sorted(w for w in suspect if w in expected and w not in actual)
        if missing:
            print(f"  [whisper] scene{sn:02d}: ⚠ 期待語が転写に無い → {missing[:5]}")
            print(f"    実音: {actual[:120]}")
            issues.append((sn, missing))
        else:
            print(f"  [whisper] scene{sn:02d}: ✓ 主要語一致")

    if issues:
        print(f"\n⚠ {len(issues)} シーンで誤読疑い。実音を耳で確認推奨:")
        for sn, words in issues:
            print(f"   scene{sn:02d}: {words[:5]}")
        print("   (Whisper の補正バイアスで実音誤読を見逃す可能性あり)")
    else:
        print("\n✅ 全 scene 主要語一致")


def run_regen(
    scene_nos: list, slides: list, cta_set: set,
    pron_map: dict, api_key: str, voice_id: str,
    audio_dir: Path, tmp_dir: Path,
):
    invalid = sorted(n for n in scene_nos if n in cta_set)
    if invalid:
        print(
            f"ERROR: CTA scenes は再生成不可: {invalid}\n"
            f"  CTA は固定テンプレ ({CTA_TEMPLATE.name}) を使用するため。\n"
            f"  テンプレ自体を変えたい場合は別作業（_shared/templates/ を編集）。",
            file=sys.stderr,
        )
        sys.exit(1)

    slide_map = {no: (title, body) for no, title, body in slides}
    missing = [n for n in scene_nos if n not in slide_map]
    if missing:
        print(f"ERROR: scene 番号が script.md に存在しない: {missing}", file=sys.stderr)
        sys.exit(1)

    scenes_dir = audio_dir / "scenes"
    scenes_dir.mkdir(parents=True, exist_ok=True)
    pcm_dir = tmp_dir / "pcm"
    pcm_dir.mkdir(exist_ok=True, parents=True)

    for sn in scene_nos:
        title, body = slide_map[sn]
        text = apply_fixes(body, pron_map)
        if not text.strip():
            print(f"⚠ scene{sn:02d} は本文が空。スキップ。", file=sys.stderr)
            continue
        n = len(text)
        if n > CHUNK_MAX_CHARS:
            print(
                f"ERROR: scene{sn:02d} が {n} 文字 (>{CHUNK_MAX_CHARS})。"
                f"単 scene でこの長さはあり得ない。script.md 確認。",
                file=sys.stderr,
            )
            sys.exit(1)
        print(f"[再生成] scene{sn:02d}: {title[:40]} ({n} 文字)")
        wav_bytes = call_elevenlabs(text, api_key, voice_id)
        raw = pcm_dir / f"scene{sn:02d}_raw.wav"
        pcm = pcm_dir / f"scene{sn:02d}_pcm.wav"
        out = scenes_dir / f"scene{sn:02d}.wav"
        raw.write_bytes(wav_bytes)
        to_pcm(raw, pcm)
        trim_silence(pcm, out)
        dur = get_duration(out)
        print(f"  → {out.name} ({dur:.2f}s)")
        # 2026-05-20: HeyGen 制約「> 1 秒」対策。1.0秒未満は scene21=「まとめ」3文字事故と同型。
        if dur < 1.0:
            print(
                f"\nERROR: {out.name} が {dur:.2f}s。HeyGen は 1.0秒未満の音声をアップロードできません。\n"
                f"対処: script.md の【スライド{sn}】のナレーション原稿を膨らませて再実行してください。\n"
                f"  REGEN_SCENES={sn} HEYGEN_SLUG={os.environ.get('HEYGEN_SLUG','<slug>')} python3 _shared/yt-voice.py\n"
                f"目安: 1秒以上にするには日本語で最低15文字程度（句読点含む）。\n"
                f"詳細ルール: .claude/skills/yt-script/SKILL.md 「scene の最低秒数」セクション参照。",
                file=sys.stderr,
            )
            sys.exit(1)

    # 2026-05-08 H': Whisper で誤読チェック (yt-script SKILL.md の TTS-friendly 戦略 5)
    verify_scenes_with_whisper(scenes_dir, scene_nos, slide_map)

    print("\n✅ 再生成完了。HeyGen に手動で再アップしてください。")


# ===== main =====

def main():
    slug = os.environ.get("HEYGEN_SLUG")
    if not slug:
        print("ERROR: HEYGEN_SLUG が未設定。例: HEYGEN_SLUG=foo", file=sys.stderr)
        sys.exit(1)

    proj = PROJECTS_BASE / slug
    if not proj.exists():
        print(f"ERROR: プロジェクトディレクトリがない: {proj}", file=sys.stderr)
        sys.exit(1)

    script_md = proj / "script.md"
    audio_dir = proj / "audio"
    tmp_dir = Path(f"/tmp/yt_voice_{slug}")
    audio_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    # /tmp は毎回クリア（chunks/scenes は永続）
    for f in tmp_dir.rglob("*"):
        if f.is_file():
            f.unlink()

    # 入力チェック
    if not script_md.exists():
        print(f"ERROR: script.md がない: {script_md}", file=sys.stderr)
        sys.exit(1)
    if not CTA_TEMPLATE.exists():
        print(f"ERROR: CTA テンプレがない: {CTA_TEMPLATE}", file=sys.stderr)
        sys.exit(1)
    api_key_path = CREDENTIALS / "elevenlabs_api_key.txt"
    voice_id_path = CREDENTIALS / "elevenlabs_voice_id.txt"
    if not api_key_path.exists() or not voice_id_path.exists():
        print(f"ERROR: ElevenLabs 認証情報がない ({CREDENTIALS}/)", file=sys.stderr)
        sys.exit(1)
    api_key = api_key_path.read_text().strip()
    voice_id = voice_id_path.read_text().strip()

    print(f"\n{'='*60}\nyt-voice\n  slug: {slug}\n  proj: {proj}\n{'='*60}\n")

    slides = extract_slides(script_md)
    print(f"[parse] {len(slides)} スライド検出")
    cta_set = detect_cta_slides(slides)
    print(f"[parse] CTA scenes: {sorted(cta_set)}")
    boundaries = detect_section_boundaries(slides, cta_set)
    print(f"[parse] セクション境界: {sorted(boundaries)}")
    pron_map = load_pronunciation_map(proj)
    print(f"[parse] 発音マップ: {len(pron_map)} 件")

    regen_env = os.environ.get("REGEN_SCENES", "").strip()
    if regen_env:
        scene_nos = parse_regen_scenes(regen_env)
        print(f"\n=== Mode 2: scene 単位再生成 ===\n対象 scene: {scene_nos}\n")
        run_regen(scene_nos, slides, cta_set, pron_map, api_key, voice_id, audio_dir, tmp_dir)
    else:
        print(f"\n=== Mode 1: 初回生成 ===\n")
        run_initial(slides, cta_set, boundaries, pron_map, api_key, voice_id, audio_dir, tmp_dir)

    print("\n[完了]")


if __name__ == "__main__":
    main()
