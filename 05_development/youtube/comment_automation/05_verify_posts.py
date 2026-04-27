#!/usr/bin/env python3
"""Phase E (検証): 各動画のコメント状態を YouTube Data API で検証。

以下を判定:
- サービス案内コメント（署名文字列 ▼無料相談はこちらから▼ を含む）が存在するか
- 目次コメントが存在するか（toc_comment の先頭50文字が一致するコメントがあるか）

制約: YouTube Data API は「コメントが固定されているか」を返さない。
     固定の検証は DOM スクレイピングが必要（別スクリプト）。

入力:
- data/sheet_rows.json
- data/run_log.jsonl
- .env の YOUTUBE_API_KEY

出力:
- data/verify_report.json
- 標準出力にサマリ
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
ROWS_JSON = DATA_DIR / "sheet_rows.json"
RUN_LOG = DATA_DIR / "run_log.jsonl"
REPORT_JSON = DATA_DIR / "verify_report.json"

SIGNATURE = "▼無料相談はこちらから▼"


def latest_run_log() -> dict[str, dict]:
    latest: dict[str, dict] = {}
    if not RUN_LOG.exists():
        return latest
    for line in RUN_LOG.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("status") == "dry_run":
            continue
        vid = rec.get("video_id")
        if vid:
            latest[vid] = rec
    return latest


def fetch_top_comments(yt, video_id: str, max_items: int = 20) -> list[str]:
    """上位のコメント本文を取得（relevance順）。失敗なら空リスト。"""
    try:
        resp = yt.commentThreads().list(
            part="snippet",
            videoId=video_id,
            maxResults=max_items,
            order="relevance",
            textFormat="plainText",
        ).execute()
    except HttpError as e:
        # コメント無効化や権限エラー
        return [f"__ERROR__:{e.resp.status}"]
    texts = []
    for item in resp.get("items", []):
        top = item.get("snippet", {}).get("topLevelComment", {}).get("snippet", {})
        text = top.get("textDisplay", "")
        texts.append(text)
    return texts


def main() -> None:
    load_dotenv(ROOT / ".env")
    api_key = os.environ.get("YOUTUBE_API_KEY")
    if not api_key:
        sys.exit("YOUTUBE_API_KEY が無い。.env を確認。")

    if not ROWS_JSON.exists():
        sys.exit("sheet_rows.json が無い。先に 02_to_sheet.py を。")

    data = json.loads(ROWS_JSON.read_text(encoding="utf-8"))
    headers = data["headers"]
    col = {h: i for i, h in enumerate(headers)}
    row_by_vid = {r[col["video_id"]]: r for r in data["rows"]}

    log_map = latest_run_log()
    targets = [
        vid for vid, r in log_map.items()
        if r.get("status", "").startswith("pinned_and_posted")
        or r.get("status") == "posted_intro_pinned_toc_empty"
    ]
    print(f"検証対象: {len(targets)}本")

    yt = build("youtube", "v3", developerKey=api_key)

    report: list[dict] = []
    ok_intro = ok_toc = 0
    fail_intro: list[str] = []
    fail_toc: list[str] = []

    for i, vid in enumerate(targets, 1):
        row = row_by_vid.get(vid)
        toc = (row[col["toc_comment"]] if row else "").strip()
        expected_toc_empty = not toc

        comments = fetch_top_comments(yt, vid, max_items=20)
        err = next((c for c in comments if c.startswith("__ERROR__:")), None)

        has_intro = any(SIGNATURE in c for c in comments)
        # 目次の検出: toc_comment の先頭30文字が一致する行
        toc_probe = toc.splitlines()[0][:30] if toc else ""
        has_toc = (
            expected_toc_empty
            or (toc_probe and any(toc_probe in c for c in comments))
        )

        if has_intro:
            ok_intro += 1
        else:
            fail_intro.append(vid)
        if has_toc:
            ok_toc += 1
        else:
            fail_toc.append(vid)

        report.append(
            {
                "video_id": vid,
                "title": (row[col["title"]] if row else "")[:60],
                "expected_toc_empty": expected_toc_empty,
                "has_intro": has_intro,
                "has_toc": has_toc,
                "error": err,
            }
        )

        # 進捗
        if i % 10 == 0 or i == len(targets):
            print(f"  {i}/{len(targets)} intro_ok={ok_intro} toc_ok={ok_toc}")
        time.sleep(0.1)  # レート制限対策

    REPORT_JSON.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("\n==== 検証結果 ====")
    print(f"intro (サービス案内) 有り: {ok_intro}/{len(targets)}")
    print(f"toc   (目次) 有り      : {ok_toc}/{len(targets)}  ※目次なし動画はOK扱い")
    if fail_intro:
        print(f"\n⚠ intro NG: {len(fail_intro)}本")
        for v in fail_intro[:20]:
            print(f"  - {v}")
    if fail_toc:
        print(f"\n⚠ toc NG: {len(fail_toc)}本")
        for v in fail_toc[:20]:
            print(f"  - {v}")
    print(f"\n詳細: {REPORT_JSON}")


if __name__ == "__main__":
    main()
