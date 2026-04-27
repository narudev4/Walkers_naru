#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
STG (stg.croix.asia) 巡回スナップショット撮影。
snapshot_lib にロジック集約済み。--only "1,3,4" で一部のみ再撮影可能。

出力: output/verify_snapshots/{No}.json
"""
import argparse
import asyncio
import json
from pathlib import Path

from cdp import connect
from snapshot_lib import load_articles, snapshot_article, parse_only

BASE = Path(__file__).parent
OUT_DIR = BASE / "output" / "verify_snapshots"
OUT_DIR.mkdir(parents=True, exist_ok=True)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default=None, help="カンマ区切り No 指定（例: 1,3,4）")
    parser.add_argument("--resume", action="store_true", help="既存 snapshot はスキップ")
    args = parser.parse_args()

    articles = load_articles()
    only = parse_only(args.only)
    if only:
        articles = [a for a in articles if a["No"] in only]
    if args.resume:
        articles = [a for a in articles if not (OUT_DIR / f"{a['No']}.json").exists()]
    print(f"Articles to verify: {len(articles)}")

    pw, browser, ctx, page = await connect()
    try:
        for i, art in enumerate(articles, 1):
            print(f"[{i}/{len(articles)}] No.{art['No']} {art['url']}")
            snap = await snapshot_article(page, art, url_key="url")
            out = OUT_DIR / f"{art['No']}.json"
            out.write_text(json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8")
            if "error" in snap:
                print(f"  ERROR: {snap['error']}")
            else:
                imgs = snap["images"]
                broken = sum(1 for im in imgs if im["broken"])
                tb = len(snap.get("text_blocks", []))
                print(f"  imgs={len(imgs)} broken={broken} iframes={len(snap['iframes'])} text_blocks={tb}")
    finally:
        await pw.stop()

    print(f"\nDone. Snapshots saved to {OUT_DIR}")


if __name__ == "__main__":
    asyncio.run(main())
