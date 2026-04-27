#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
原本サイト (https://croix.asia) 巡回スナップショット撮影。
URL は articles.json の stg URL を host 差し替えで生成する。

出力: output/verify_snapshots_orig/{No}.json

使用例:
  python3 23_verify_orig.py --only 1,3,4,6,8,14,17,21,26,34,58,63,66
  python3 23_verify_orig.py --resume
"""
import argparse
import asyncio
import json
from pathlib import Path

from cdp import connect
from snapshot_lib import load_articles, rewrite_to_orig, snapshot_article, parse_only

BASE = Path(__file__).parent
OUT_DIR = BASE / "output" / "verify_snapshots_orig"
OUT_DIR.mkdir(parents=True, exist_ok=True)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default=None, help="カンマ区切り No 指定")
    parser.add_argument("--resume", action="store_true", help="既存 snapshot はスキップ")
    args = parser.parse_args()

    articles = load_articles()
    # orig URL を追加
    for a in articles:
        a["orig_url"] = rewrite_to_orig(a["url"])

    only = parse_only(args.only)
    if only:
        articles = [a for a in articles if a["No"] in only]
    if args.resume:
        articles = [a for a in articles if not (OUT_DIR / f"{a['No']}.json").exists()]
    print(f"Articles to verify (ORIG): {len(articles)}")

    pw, browser, ctx, page = await connect()
    try:
        for i, art in enumerate(articles, 1):
            print(f"[{i}/{len(articles)}] No.{art['No']} {art['orig_url']}")
            snap = await snapshot_article(page, art, url_key="orig_url")
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
