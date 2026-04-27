#!/usr/bin/env python3
"""【目次】内にURL等の非TS行が挟まって、toc取得が途切れた動画を検出。"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"

raw = json.loads((DATA / "videos_raw.json").read_text(encoding="utf-8"))
rows = json.loads((DATA / "sheet_rows.json").read_text(encoding="utf-8"))
col = {h: i for i, h in enumerate(rows["headers"])}
cur_toc = {r[col["video_id"]]: r[col["toc_comment"]] for r in rows["rows"]}

TS_RE = re.compile(r"^\s*(\d{1,2}:)?\d{1,2}:\d{2}\b")
HEADER_RE = re.compile(r"^【?\s*目次\s*】?|^タイムスタンプ|^Chapters", re.IGNORECASE)


def find_toc_block(desc: str) -> list[str]:
    lines = desc.split("\n")
    start = None
    for i, ln in enumerate(lines):
        if HEADER_RE.match(ln.strip()):
            start = i + 1
            break
    if start is None:
        return []
    block: list[str] = []
    blank = 0
    for ln in lines[start:]:
        s = ln.strip()
        if not s:
            blank += 1
            block.append(ln)
            if blank >= 2:
                break
            continue
        blank = 0
        if s.startswith("【") and s.endswith("】"):
            break
        if s.startswith("#") and not TS_RE.match(s):
            break
        block.append(ln)
    return block


suspects = []
for v in raw:
    vid = v["video_id"]
    desc = v.get("description", "") or ""
    block = find_toc_block(desc)
    if not block:
        continue
    ts_indices = [i for i, ln in enumerate(block) if TS_RE.match(ln.strip())]
    if len(ts_indices) < 2:
        continue
    first_ts, last_ts = ts_indices[0], ts_indices[-1]
    interrupts = []
    for i in range(first_ts + 1, last_ts):
        ln = block[i].strip()
        if ln and not TS_RE.match(ln):
            interrupts.append(ln)
    if interrupts:
        cur = cur_toc.get(vid, "") or ""
        cur_ts_count = sum(1 for ln in cur.split("\n") if TS_RE.match(ln.strip()))
        suspects.append(
            {
                "vid": vid,
                "title": v.get("title", "")[:50],
                "block_ts": len(ts_indices),
                "cur_ts": cur_ts_count,
                "interrupts": interrupts,
            }
        )

print(f"[scan] 【目次】にURL等の割込み行がある動画: {len(suspects)}本\n")
missing = [s for s in suspects if s["cur_ts"] < s["block_ts"]]
print(f"[scan] そのうち toc 取得漏れしている動画: {len(missing)}本\n")
for s in missing:
    vid = s["vid"]
    cur = s["cur_ts"]
    full = s["block_ts"]
    title = s["title"]
    print(f"- {vid}  cur_ts={cur} / full_ts={full}  {title}")
    for ln in s["interrupts"][:3]:
        snippet = ln[:80]
        print(f"    割込行: {snippet}")
