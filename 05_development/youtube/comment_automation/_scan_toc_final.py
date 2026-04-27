#!/usr/bin/env python3
"""取得漏れ・不整合の最終走査。以下全パターンを洗い出す。

A) TS形式バリエーション: `(00:00)` / `[00:00]` / `→ 00:00` / `00:00→` / `#00:00` /
   `・0:00` / `▶0:00` / 全角スペース区切り / タブ区切り
B) toc内容がおかしい: current toc の行数がTS検出数と合わない
C) description内の【目次】以外の場所にTS連続（別セクションに目次もどきがある）
D) TS最大値（動画長を示す最後のTS）と本数の整合性チェック
"""
from __future__ import annotations

import json
import re
from pathlib import Path

raw = json.loads(Path("data/videos_raw.json").read_text(encoding="utf-8"))
rows = json.loads(Path("data/sheet_rows.json").read_text(encoding="utf-8"))
col = {h: i for i, h in enumerate(rows["headers"])}
cur_toc = {r[col["video_id"]]: r[col["toc_comment"]] for r in rows["rows"]}

# 検査済みで問題が判明している14本
KNOWN = {
    "sl-g6A1ykbg", "7y8p6Gee5U8", "yW68RHYAmwU", "JtJvhVjGyoM",
    "ZVOoShh6pI0", "I3LLKZs8rmI", "gV-2auQIqWo", "_JPX3ojqkac",
    "u19Dh_erLRM", "cA300mYivzQ", "CnBgX-9Dx3Q", "dssim-xKJ-Y",
    "V-DrrVIPjPY", "ffHpo6j7LrI",
}

# 非常に緩いTS検出（括弧・矢印・装飾・全角スペース・タブ含む）
TS_ANY = re.compile(
    r"""
    (?:^|[\s　\t])            # 先頭 or 空白類
    [\(\[（【]?               # 任意の開き括弧
    (?:\d{1,2}:)?\d{1,2}:\d{2}  # TS本体
    [\)\]）】]?               # 任意の閉じ括弧
    """,
    re.VERBOSE,
)

TS_LINE_ANY = re.compile(
    r"""^[\s\-・▶▷◆●○■□▪▫>＞※◇*→➤➡➔◎◯◉\t]*
        [\(\[（【]?
        (\d{1,2}:)?\d{1,2}:\d{2}
        [\)\]）】]?
    """,
    re.VERBOSE,
)

# 通常の TS_LOOSE (前回と同じ)
TS_LOOSE = re.compile(
    r"^[\s\-・▶▷◆●○■□▪▫>＞※◇*]*"
    r"(\d{1,2}:)?\d{1,2}:\d{2}"
    r"(?=[\s　]|[^\d:])"
)


def parse_ts_to_seconds(s: str) -> int | None:
    m = re.match(r"(?:(\d{1,2}):)?(\d{1,2}):(\d{2})", s)
    if not m:
        return None
    h = int(m.group(1) or 0)
    mm = int(m.group(2))
    ss = int(m.group(3))
    return h * 3600 + mm * 60 + ss


def desc_ts_lines_any(desc: str) -> list[str]:
    """TS装飾・括弧・矢印・タブも含めて抽出。"""
    out = []
    for ln in desc.split("\n"):
        s = ln.strip()
        # 全角スペース正規化
        s_norm = s.replace("\u3000", " ").replace("\t", " ")
        if TS_LINE_ANY.match(s_norm):
            out.append(s)
    return out


def find_ts_clusters(desc: str) -> list[list[int]]:
    """連続TSクラスタ（1行空白は許容）の開始/終了行番号リスト。"""
    lines = desc.split("\n")
    clusters = []
    cur = []
    blank_since_ts = 0
    for i, ln in enumerate(lines):
        s = ln.strip()
        if TS_LOOSE.match(s):
            cur.append(i)
            blank_since_ts = 0
        elif not s:
            if cur:
                blank_since_ts += 1
                if blank_since_ts >= 2:
                    clusters.append(cur)
                    cur = []
                    blank_since_ts = 0
        else:
            if cur and len(cur) >= 2:
                clusters.append(cur)
            cur = []
            blank_since_ts = 0
    if cur and len(cur) >= 2:
        clusters.append(cur)
    return clusters


print("=== (A) 装飾付きTS（括弧・矢印等）を含む動画で、KNOWNに入っていないもの ===")
a_hits = []
for v in raw:
    vid = v["video_id"]
    if vid in KNOWN:
        continue
    desc = v.get("description", "") or ""
    any_lines = desc_ts_lines_any(desc)
    loose_lines = [ln for ln in desc.split("\n") if TS_LOOSE.match(ln.strip())]
    # 「any >= loose + 2」なら装飾付きTSを取りこぼしている可能性
    if len(any_lines) > len(loose_lines) and len(any_lines) - len(loose_lines) >= 2:
        a_hits.append((vid, v["title"][:50], len(any_lines), len(loose_lines)))
for vid, title, a, l in a_hits:
    print(f"  {vid} any={a} loose={l}  {title}")
print(f"  → {len(a_hits)}本")

print()
print("=== (B) 【目次】以外の場所に TSクラスタ（別目次もどき）がある動画 ===")
b_hits = []
for v in raw:
    vid = v["video_id"]
    desc = v.get("description", "") or ""
    clusters = find_ts_clusters(desc)
    if len(clusters) >= 2:
        b_hits.append((vid, v["title"][:50], [len(c) for c in clusters]))
for vid, title, sizes in b_hits:
    print(f"  {vid} clusters={sizes}  {title}")
print(f"  → {len(b_hits)}本")

print()
print("=== (C) 現 toc_comment の行末が中途半端（...で終わる/文途中で切れてる）動画 ===")
c_hits = []
TAIL_BROKEN = re.compile(r"[…、,。]$|\s*$")
for vid, toc in cur_toc.items():
    if not toc.strip():
        continue
    last_line = toc.rstrip().split("\n")[-1]
    # 最後のTS行の本文がやたら短い（〜3文字）or 末尾が「、」など
    m = re.match(r"\s*\d+:\d{2}(?::\d{2})?\s*(.*)$", last_line)
    if m:
        body = m.group(1).strip()
        if len(body) <= 2 and body not in ("", "終", "終わり"):
            c_hits.append((vid, last_line))
for vid, ll in c_hits:
    print(f"  {vid}  最終行: {ll!r}")
print(f"  → {len(c_hits)}本")

print()
print("=== (D) TS値の不整合（重複/逆転） ===")
d_hits = []
for vid, toc in cur_toc.items():
    if not toc.strip():
        continue
    times = []
    for ln in toc.split("\n"):
        m = re.match(r"\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\b", ln.strip())
        if m:
            sec = parse_ts_to_seconds(m.group(1))
            if sec is not None:
                times.append((m.group(1), sec))
    # 逆転または重複
    for i in range(1, len(times)):
        if times[i][1] < times[i - 1][1]:
            d_hits.append((vid, times[i - 1][0], times[i][0]))
            break
for vid, a, b in d_hits:
    print(f"  {vid}  {a} → {b}（逆転）")
print(f"  → {len(d_hits)}本")
