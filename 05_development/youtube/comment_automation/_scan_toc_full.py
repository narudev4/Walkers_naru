#!/usr/bin/env python3
"""toc 取得漏れ総当たりスキャナ。
description 内で「TSっぽい行」を幅広く検出し、
現行 toc_comment（スプシ同期済み）と件数差がある動画を全部炙り出す。
"""
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

# 緩めのTS検出:
# - 行頭（任意の bullet/空白の後）の `MM:SS` or `H:MM:SS`
# - 直後がスペースでも直接テキストでもOK（日本語が続くケースをカバー）
TS_LOOSE = re.compile(
    r"^[\s\-・▶▷◆●○■□▪▫>＞※◇*]*"
    r"(\d{1,2}:)?\d{1,2}:\d{2}"
    r"(?=[\s　]|[^\d:])"  # TSの直後はスペース or 非数字・非コロン
)

# 既存パーサが使っているTS（TS後スペース必須）
TS_STRICT = re.compile(r"^\s*\d+:\d{2}(?::\d{2})?\s+.+")


def count_loose_ts(text: str) -> int:
    return sum(1 for ln in text.split("\n") if TS_LOOSE.match(ln.strip()))


def count_strict_ts(text: str) -> int:
    return sum(1 for ln in text.split("\n") if TS_STRICT.match(ln.strip()))


def find_ts_cluster(desc: str) -> tuple[int, list[int]]:
    """description を全行走査し、TSっぽい行のインデックスを返す（最大クラスタ）。"""
    lines = desc.split("\n")
    ts_idx = [i for i, ln in enumerate(lines) if TS_LOOSE.match(ln.strip())]
    return len(lines), ts_idx


print(f"{'video_id':<14} {'cur':>4} {'desc_loose':>10}  {'title'}")
print("-" * 100)

problems = []
for v in raw:
    vid = v["video_id"]
    desc = v.get("description", "") or ""
    cur = cur_toc.get(vid, "") or ""
    cur_ts = count_strict_ts(cur)
    desc_ts = count_loose_ts(desc)
    # 差が2以上ある動画は怪しい
    if desc_ts - cur_ts >= 1 and desc_ts >= 2:
        title = (v.get("title") or "")[:45]
        problems.append((vid, cur_ts, desc_ts, title, desc))

problems.sort(key=lambda x: -(x[2] - x[1]))
for vid, cur_ts, desc_ts, title, _ in problems:
    diff = desc_ts - cur_ts
    print(f"{vid:<14} {cur_ts:>4} {desc_ts:>10}  -diff {diff:>3}  {title}")

print()
print(f"[scan] 差分あり: {len(problems)}本")

# 新規検出（前回の8本以外）を具体的に確認するため、1本ずつ description抜粋を表示
prev_8 = {
    "V-DrrVIPjPY", "CnBgX-9Dx3Q", "cA300mYivzQ", "sl-g6A1ykbg",
    "ZVOoShh6pI0", "7y8p6Gee5U8", "I3LLKZs8rmI", "u19Dh_erLRM",
}
print()
print("=== 前回検出済みの8本を除く新規問題 ===")
new_problems = [p for p in problems if p[0] not in prev_8]
print(f"新規: {len(new_problems)}本")
for vid, cur_ts, desc_ts, title, desc in new_problems:
    print()
    print(f"--- {vid} (cur={cur_ts} / desc_loose={desc_ts}) {title}")
    # description から TS行だけ抽出表示
    for ln in desc.split("\n"):
        s = ln.strip()
        if TS_LOOSE.match(s):
            print(f"    TS: {s[:100]}")
