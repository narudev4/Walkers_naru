#!/usr/bin/env python3
"""Phase E2 (固定検証): ランダムサンプルで「固定バッジ」の有無をDOMで確認。

YouTube Data API は isPinned を返さないため、スプシから status=pinned_and_posted の
動画をランダムサンプリングして、Playwright + CDP で各動画を開き、
トップコメントに固定バッジが出ているかを確認する。

前提: chrome-cdp-launcher.sh で CDP:9222 が起動中。

入力:
- data/run_log.jsonl （pinned_and_posted の動画が対象）

出力:
- data/verify_pin_report.json
- 標準出力

使い方:
    python 06_verify_pin_dom.py              # 20本ランダム
    python 06_verify_pin_dom.py --sample 10  # 10本
    python 06_verify_pin_dom.py --all        # 全部
    python 06_verify_pin_dom.py --video-id XXX --video-id YYY  # 指定
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout, sync_playwright

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
RUN_LOG = DATA_DIR / "run_log.jsonl"
ROWS_JSON = DATA_DIR / "sheet_rows.json"
REPORT = DATA_DIR / "verify_pin_report.json"

CDP_URL = "http://localhost:9222"


def latest_pinned() -> list[str]:
    if not RUN_LOG.exists():
        return []
    latest: dict[str, str] = {}
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
            latest[vid] = rec.get("status", "")
    return [v for v, s in latest.items() if s == "pinned_and_posted"]


def check_one(page, vid: str) -> dict:
    url = f"https://www.youtube.com/watch?v={vid}"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(1500)
    # コメント欄までスクロール
    page.mouse.wheel(0, 1200)
    page.wait_for_timeout(700)
    page.mouse.wheel(0, 1500)
    page.wait_for_timeout(700)
    try:
        page.wait_for_selector(
            "ytd-comment-thread-renderer",
            timeout=10000,
        )
    except PWTimeout:
        return {"video_id": vid, "pinned": None, "error": "comments_not_loaded"}

    # 「固定バッジ」セレクタ候補
    # a) pinned-badge（モダンUI）
    # b) pinned-comment-badge-renderer
    # c) 「固定されたコメント」テキスト
    thread = page.locator("ytd-comment-thread-renderer").first
    try:
        thread.wait_for(state="visible", timeout=5000)
    except PWTimeout:
        return {"video_id": vid, "pinned": None, "error": "no_thread"}

    # 固定バッジの存在チェック
    badge_sel = (
        "ytd-comment-thread-renderer #pinned-comment-badge, "
        "ytd-comment-thread-renderer ytd-pinned-comment-badge-renderer, "
        "ytd-comment-thread-renderer [id='pinned-badge']"
    )
    first_thread_pinned = thread.locator(
        "#pinned-comment-badge, ytd-pinned-comment-badge-renderer, #pinned-badge"
    ).count() > 0

    # フォールバック: 「固定されたコメント」テキスト
    if not first_thread_pinned:
        try:
            html = thread.inner_text(timeout=2000)
        except PWTimeout:
            html = ""
        if "固定" in html and ("チャンネル" in html or "コメント" in html):
            # 「固定されたコメント」「固定」単体だけだと誤検出リスク
            # "固定" が本文中でなくバッジ由来かは、より厳格なチェックが必要だが
            # 1階層目にそれがある=バッジとみなす
            first_thread_pinned = "固定されたコメント" in html or "固定中" in html

    return {"video_id": vid, "pinned": first_thread_pinned, "error": None}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=20)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--video-id", action="append", default=None)
    args = ap.parse_args()

    candidates = latest_pinned()
    if args.video_id:
        targets = [v for v in args.video_id if v in candidates]
    elif args.all:
        targets = candidates
    else:
        random.seed(42)
        targets = random.sample(candidates, min(args.sample, len(candidates)))

    print(f"検証対象: {len(targets)}本 / pinned_and_posted 候補 {len(candidates)}本")
    if not targets:
        sys.exit("対象なし。")

    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(CDP_URL)
        ctx = browser.contexts[0]
        pages = ctx.pages
        page = pages[0] if pages else ctx.new_page()

        results: list[dict] = []
        ok = ng = err = 0
        for i, vid in enumerate(targets, 1):
            try:
                res = check_one(page, vid)
            except Exception as e:  # noqa: BLE001
                res = {"video_id": vid, "pinned": None, "error": f"{type(e).__name__}:{e}"[:200]}
            results.append(res)
            if res["error"]:
                err += 1
                flag = "ERR"
            elif res["pinned"]:
                ok += 1
                flag = "OK"
            else:
                ng += 1
                flag = "NG"
            print(f"[{i}/{len(targets)}] {flag} {vid} err={res['error']}")
            time.sleep(2)

    REPORT.write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n==== 固定検証結果 ====")
    print(f"OK(固定あり): {ok} / NG(固定なし): {ng} / ERR: {err} / 合計 {len(targets)}")
    print(f"詳細: {REPORT}")


if __name__ == "__main__":
    main()
