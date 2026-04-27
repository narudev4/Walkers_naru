#!/usr/bin/env python3
"""追加チェック:
(1) 【目次】以外の見出し（タイムスタンプ / チャプター / Chapters）がある動画
(2) 見出しは無いがTS行が3本以上連続する動画（ヘッダ無しtoc）
"""
from __future__ import annotations

import json
import re
from pathlib import Path

raw = json.loads(Path("data/videos_raw.json").read_text(encoding="utf-8"))
rows = json.loads(Path("data/sheet_rows.json").read_text(encoding="utf-8"))
col = {h: i for i, h in enumerate(rows["headers"])}
cur_toc = {r[col["video_id"]]: r[col["toc_comment"]] for r in rows["rows"]}

TS_LOOSE = re.compile(
    r"^[\s\-・▶▷◆●○■□▪▫>＞※◇*]*"
    r"(\d{1,2}:)?\d{1,2}:\d{2}"
    r"(?=[\s　]|[^\d:])"
)
TOC_HEADER_STRICT = re.compile(r"^[【\[]目次[】\]]")
ALT_HEADERS = [
    r"タイムスタンプ", r"チャプター", r"Chapters", r"Chapter list",
    r"^目次$", r"TOC", r"INDEX",
]
ALT_RE = re.compile("|".join(ALT_HEADERS), re.IGNORECASE)

print("=== (1) 【目次】無し + 代替見出しっぽい動画 ===")
alt_hit = []
for v in raw:
    desc = v.get("description", "") or ""
    if TOC_HEADER_STRICT.search(desc):
        continue  # 【目次】あるのでOK対象
    for ln in desc.split("\n"):
        s = ln.strip()
        if ALT_RE.search(s) and len(s) < 30:
            alt_hit.append((v["video_id"], v["title"][:50], s))
            break
for vid, title, header in alt_hit:
    print(f"  {vid}  [{header}]  {title}")

print()
print("=== (2) 【目次】無し + 連続TS3本以上（cur_toc空のみ抽出） ===")
no_header_cluster = []
for v in raw:
    vid = v["video_id"]
    desc = v.get("description", "") or ""
    cur = cur_toc.get(vid, "") or ""
    if cur.strip():
        continue  # 既にtocあり
    lines = desc.split("\n")
    # 連続TS行（空行だけ1回はさんでも可）の最大長
    max_run = 0
    run = 0
    prev_blank = False
    for ln in lines:
        s = ln.strip()
        if TS_LOOSE.match(s):
            run += 1
            prev_blank = False
            max_run = max(max_run, run)
        elif not s and prev_blank is False:
            prev_blank = True  # 1回までのブランクは継続扱い
        else:
            run = 0
            prev_blank = False
    if max_run >= 3:
        no_header_cluster.append((vid, v["title"][:50], max_run))
for vid, title, n in no_header_cluster:
    print(f"  {vid}  TS連続={n}  {title}")
print(f"  → {len(no_header_cluster)}本")

print()
print("=== (3) toc_parse_ok=False だったのに、descにTSが存在する動画 ===")
parse_fail = []
for v in raw:
    if v.get("toc_parse_ok"):
        continue
    desc = v.get("description", "") or ""
    ts_count = sum(1 for ln in desc.split("\n") if TS_LOOSE.match(ln.strip()))
    if ts_count >= 3:
        parse_fail.append((v["video_id"], v["title"][:50], ts_count))
for vid, title, n in parse_fail:
    print(f"  {vid}  TS数={n}  {title}")
print(f"  → {len(parse_fail)}本")
