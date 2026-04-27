#!/usr/bin/env python3
"""Phase D: run_log.jsonl の結果を Google Sheets に同期。

入力:
- data/run_log.jsonl  （1動画あたり最終行を採用）
- sheet_config.json

動作:
- video_id 列（A列）で行番号を引く
- status (I列) と last_updated (J列) を batchUpdate で更新

冪等: 何度流しても同じ結果になる。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
RUN_LOG = DATA_DIR / "run_log.jsonl"
SHEET_CONFIG = ROOT / "sheet_config.json"
OAUTH_JSON = Path(
    "/Users/naru/Walkers_naru/credentials/workspace-mcp/"
    "naru.hosoya@walker-s.co.jp.json"
)

STATUS_COL = "I"  # 9列目 (1-indexed)
LAST_UPDATED_COL = "J"  # 10列目
VIDEO_ID_COL = "A"


def load_creds() -> Credentials:
    data = json.loads(OAUTH_JSON.read_text(encoding="utf-8"))
    creds = Credentials(
        token=data["token"],
        refresh_token=data.get("refresh_token"),
        token_uri=data["token_uri"],
        client_id=data["client_id"],
        client_secret=data["client_secret"],
        scopes=data["scopes"],
    )
    if not creds.valid and creds.refresh_token:
        creds.refresh(Request())
    return creds


def latest_run_log() -> dict[str, dict]:
    """video_id -> 最新レコード のマップ。"""
    if not RUN_LOG.exists():
        return {}
    latest: dict[str, dict] = {}
    for line in RUN_LOG.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        vid = rec.get("video_id")
        if not vid:
            continue
        # dry_run は上書きしない
        if rec.get("status") == "dry_run":
            continue
        latest[vid] = rec
    return latest


def main() -> None:
    if not SHEET_CONFIG.exists():
        sys.exit("sheet_config.json が無い。先に Phase B のスプシ作成を。")

    cfg = json.loads(SHEET_CONFIG.read_text(encoding="utf-8"))
    spreadsheet_id = cfg["spreadsheet_id"]
    sheet_name = cfg["sheet_name"]

    log_map = latest_run_log()
    if not log_map:
        print("run_log.jsonl が空。何もしない。")
        return
    print(f"run_log 対象: {len(log_map)} 件")

    creds = load_creds()
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
    values_api = svc.spreadsheets().values()

    # A列（video_id）を全行読み取り → 行番号マップ
    resp = values_api.get(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!{VIDEO_ID_COL}:{VIDEO_ID_COL}",
    ).execute()
    col_values = resp.get("values", [])
    row_of: dict[str, int] = {}
    for i, row in enumerate(col_values, start=1):
        if row and row[0]:
            row_of[row[0]] = i

    updates: list[dict] = []
    skipped_missing = 0
    for vid, rec in log_map.items():
        row_num = row_of.get(vid)
        if not row_num:
            skipped_missing += 1
            continue
        status = rec.get("status", "")
        ts = rec.get("ts", "")
        updates.append(
            {
                "range": f"{sheet_name}!{STATUS_COL}{row_num}:{LAST_UPDATED_COL}{row_num}",
                "values": [[status, ts]],
            }
        )

    if skipped_missing:
        print(f"⚠ スプシに無いvideo_id: {skipped_missing}件")

    if not updates:
        print("更新対象なし。")
        return

    body = {"valueInputOption": "RAW", "data": updates}
    result = values_api.batchUpdate(
        spreadsheetId=spreadsheet_id, body=body
    ).execute()
    print(f"✅ 更新完了: {result.get('totalUpdatedCells')} cells / {len(updates)} rows")


if __name__ == "__main__":
    main()
