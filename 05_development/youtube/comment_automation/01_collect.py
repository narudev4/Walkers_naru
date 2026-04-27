#!/usr/bin/env python3
"""Phase A: YouTube Data API でチャンネル動画データを収集。

出力: data/videos_raw.json
- 動画ID, URL, タイトル, 公開日
- 概要欄から抽出した目次テキスト
- 既に「▼無料相談はこちらから▼」を含むコメントがあるか
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SIGNATURE = "▼無料相談はこちらから▼"
TOC_HEADER_RE = re.compile(r"^[【\[]目次[】\]]")
TOC_LINE_RE = re.compile(r"^\s*\d+:\d{2}(?::\d{2})?\s+.+")
ANOTHER_HEADER_RE = re.compile(r"^[【\[][^】\]]+[】\]]")

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
RAW_JSON = DATA_DIR / "videos_raw.json"


def extract_toc(description: str) -> tuple[str, bool]:
    """概要欄から「【目次】」セクションを抽出。

    Returns: (toc_text, ok). ok=False なら toc_text は空。
    """
    lines = description.splitlines()
    in_toc = False
    toc_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not in_toc:
            if TOC_HEADER_RE.match(stripped):
                in_toc = True
                toc_lines.append("【目次】")
            continue
        # In TOC
        if not stripped:
            # 空行で終端（ただし目次が始まってすぐの空行は許容したい）
            if len(toc_lines) > 1:
                break
            continue
        if ANOTHER_HEADER_RE.match(stripped) and not TOC_HEADER_RE.match(stripped):
            break
        if TOC_LINE_RE.match(stripped):
            toc_lines.append(stripped)
        else:
            # 目次行でも空行でもない、かつ別セクションでもない → 終端とみなす
            # ただし最初の数行は説明文のこともあるので、目次行を1つも取れてなければ継続
            if len(toc_lines) > 1:
                break
            continue

    if len(toc_lines) < 2:
        return "", False
    return "\n".join(toc_lines), True


def get_channel_id(youtube, handle: str) -> str:
    handle = handle.lstrip("@")
    resp = youtube.channels().list(forHandle=handle, part="id").execute()
    items = resp.get("items", [])
    if not items:
        raise RuntimeError(f"channel not found for handle @{handle}")
    return items[0]["id"]


def get_uploads_playlist_id(youtube, channel_id: str) -> str:
    resp = (
        youtube.channels()
        .list(id=channel_id, part="contentDetails")
        .execute()
    )
    return resp["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]


def iter_playlist_video_ids(youtube, playlist_id: str):
    page_token = None
    while True:
        resp = (
            youtube.playlistItems()
            .list(
                playlistId=playlist_id,
                part="contentDetails,snippet",
                maxResults=50,
                pageToken=page_token,
            )
            .execute()
        )
        for item in resp["items"]:
            yield {
                "video_id": item["contentDetails"]["videoId"],
                "published_at": item["contentDetails"].get("videoPublishedAt", ""),
            }
        page_token = resp.get("nextPageToken")
        if not page_token:
            break


def fetch_video_details(youtube, video_ids: list[str]) -> dict[str, dict]:
    """50本ずつバッチで snippet を取得。"""
    out: dict[str, dict] = {}
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i : i + 50]
        resp = (
            youtube.videos()
            .list(id=",".join(chunk), part="snippet")
            .execute()
        )
        for item in resp["items"]:
            out[item["id"]] = {
                "title": item["snippet"]["title"],
                "description": item["snippet"]["description"],
                "published_at": item["snippet"]["publishedAt"],
            }
    return out


def has_signature_comment(youtube, video_id: str) -> bool | None:
    """トップレベルコメントに固定シグネチャを含むものがあるか。

    Returns:
        True: 含むコメントあり（スキップ）
        False: 含まない
        None: コメント取得不可（disabled 等）。safe側でFalseとして扱う判断は呼び出し側で。
    """
    try:
        page_token = None
        while True:
            resp = (
                youtube.commentThreads()
                .list(
                    videoId=video_id,
                    part="snippet",
                    maxResults=100,
                    textFormat="plainText",
                    pageToken=page_token,
                )
                .execute()
            )
            for item in resp["items"]:
                text = item["snippet"]["topLevelComment"]["snippet"]["textDisplay"]
                if SIGNATURE in text:
                    return True
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        return False
    except HttpError as e:
        # 403: commentsDisabled などは None で返す
        msg = str(e)
        if "commentsDisabled" in msg or "403" in msg:
            return None
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="先頭N本だけ処理（デバッグ用）")
    parser.add_argument(
        "--skip-comment-check",
        action="store_true",
        help="既コメント判定をスキップ（API節約 or 高速確認）",
    )
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    api_key = os.environ.get("YOUTUBE_API_KEY")
    handle = os.environ.get("YOUTUBE_CHANNEL_HANDLE", "@walkers-development")
    if not api_key:
        sys.exit("ERROR: YOUTUBE_API_KEY が .env に設定されていません")

    youtube = build("youtube", "v3", developerKey=api_key)

    print(f"[1/4] チャンネルID取得: {handle}")
    channel_id = get_channel_id(youtube, handle)
    print(f"     channel_id={channel_id}")

    print("[2/4] uploads プレイリストID取得")
    playlist_id = get_uploads_playlist_id(youtube, channel_id)
    print(f"     uploads_playlist={playlist_id}")

    print("[3/4] 全動画リスト取得")
    basic = list(iter_playlist_video_ids(youtube, playlist_id))
    print(f"     {len(basic)}本")
    if args.limit:
        basic = basic[: args.limit]
        print(f"     --limit {args.limit} 適用: {len(basic)}本に絞る")

    video_ids = [b["video_id"] for b in basic]

    print("[4/4] 動画詳細(snippet) + コメント確認")
    details = fetch_video_details(youtube, video_ids)

    results: list[dict] = []
    for idx, v in enumerate(basic, 1):
        vid = v["video_id"]
        det = details.get(vid, {})
        description = det.get("description", "")
        toc_text, toc_ok = extract_toc(description)
        already = None
        if not args.skip_comment_check:
            already = has_signature_comment(youtube, vid)
            # レートリミット回避の軽い待機
            time.sleep(0.05)
        print(
            f"  [{idx}/{len(basic)}] {vid} toc_ok={toc_ok} "
            f"already_commented={already} title={det.get('title','')[:40]}"
        )
        results.append(
            {
                "video_id": vid,
                "video_url": f"https://www.youtube.com/watch?v={vid}",
                "title": det.get("title", ""),
                "published_at": det.get("published_at", v.get("published_at", "")),
                "description": description,
                "toc_text": toc_text,
                "toc_parse_ok": toc_ok,
                "already_commented": already,
            }
        )

    DATA_DIR.mkdir(exist_ok=True)
    RAW_JSON.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✅ 書き出し完了: {RAW_JSON}")
    print(f"   合計 {len(results)}本 / 目次OK {sum(1 for r in results if r['toc_parse_ok'])}本"
          f" / 既コメント {sum(1 for r in results if r['already_commented'])}本")


if __name__ == "__main__":
    main()
