#!/usr/bin/env python3
"""Phase B: videos_raw.json を元に、スプシ投入用のデータを整形して出力。

実際のスプシ作成は Claude が mcp__google-workspace__* を使って行うので、
このスクリプトは JSON/TSV を出力するだけ。
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
RAW_JSON = DATA_DIR / "videos_raw.json"
ROWS_JSON = DATA_DIR / "sheet_rows.json"
ROWS_TSV = DATA_DIR / "sheet_rows.tsv"

INTRO_COMMENT = """▼無料相談はこちらから▼
https://walker-s.co.jp/contact/

▼AI・ノーコードを用いた開発支援のサービス概要はこちらから▼
https://walker-s.co.jp/development/

▼1分で開発費用の見積もりシミュレーション▼
https://simulation.walker-s.co.jp/"""

HEADERS = [
    "video_id",
    "video_url",
    "title",
    "published_at",
    "already_commented",
    "toc_parse_ok",
    "intro_comment",
    "toc_comment",
    "status",
    "last_updated",
]


def main() -> None:
    if not RAW_JSON.exists():
        raise SystemExit(f"ERROR: {RAW_JSON} が無い。先に 01_collect.py を実行してください。")

    videos = json.loads(RAW_JSON.read_text(encoding="utf-8"))
    # 公開日 昇順（古い順）: 古い動画から先に処理して早期に問題検出
    videos.sort(key=lambda r: r.get("published_at", ""))

    rows: list[list] = []
    for v in videos:
        already = v.get("already_commented")
        if already is True:
            status = "skipped_already_commented"
        elif already is None:
            status = "pending_comments_disabled"
        else:
            status = "pending"
        rows.append(
            [
                v["video_id"],
                v["video_url"],
                v["title"],
                v["published_at"],
                "TRUE" if already is True else ("" if already is None else "FALSE"),
                "TRUE" if v["toc_parse_ok"] else "FALSE",
                INTRO_COMMENT,
                v.get("toc_text", ""),
                status,
                "",
            ]
        )

    # JSON (MCP 書き込み用)
    ROWS_JSON.write_text(
        json.dumps(
            {"headers": HEADERS, "rows": rows, "intro_comment": INTRO_COMMENT},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # TSV (手動コピペ fallback 用)
    with ROWS_TSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(HEADERS)
        writer.writerows(rows)

    print(f"✅ {ROWS_JSON} / {ROWS_TSV} を生成")
    print(f"   総 {len(rows)}行 / pending {sum(1 for r in rows if r[8].startswith('pending'))}行 "
          f"/ skipped {sum(1 for r in rows if r[8] == 'skipped_already_commented')}行")
    print()
    print("次: Claude にスプシ作成を依頼（mcp__google-workspace__create_spreadsheet 経由）")


if __name__ == "__main__":
    main()
