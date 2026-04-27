#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FAIL 9件の STG/ORIG スクショを取り、output/fail_review/ に保存する。
フルページスクショ。
"""
import asyncio
from pathlib import Path

from cdp import connect, goto
from snapshot_lib import load_articles, rewrite_to_orig, SCROLL_AND_DECODE_JS

BASE = Path(__file__).parent
OUT = BASE / "output" / "fail_review"
OUT.mkdir(parents=True, exist_ok=True)

TARGETS = ["1", "6", "8", "14", "17", "21", "26", "34", "58"]


async def shoot(page, url, out_path):
    try:
        await goto(page, url)
        try:
            await page.wait_for_load_state("networkidle", timeout=12000)
        except Exception:
            pass
        await page.evaluate(SCROLL_AND_DECODE_JS)
        try:
            await page.wait_for_load_state("networkidle", timeout=6000)
        except Exception:
            pass
        await page.screenshot(path=str(out_path), full_page=True)
        return True
    except Exception as e:
        print(f"  ERROR {url}: {e}")
        return False


async def main():
    articles = load_articles()
    targets = [a for a in articles if a["No"] in TARGETS]
    for a in targets:
        a["orig_url"] = rewrite_to_orig(a["url"])
    print(f"FAIL targets: {len(targets)}")

    pw, browser, ctx, page = await connect()
    try:
        # Use 1440 viewport
        await page.set_viewport_size({"width": 1440, "height": 900})
        for i, a in enumerate(targets, 1):
            print(f"[{i}/{len(targets)}] No.{a['No']} {a['slug']}")
            stg_out = OUT / f"{a['No']}_stg.png"
            orig_out = OUT / f"{a['No']}_orig.png"
            print(f"  STG: {a['url']}")
            await shoot(page, a["url"], stg_out)
            print(f"  ORIG: {a['orig_url']}")
            await shoot(page, a["orig_url"], orig_out)
    finally:
        await pw.stop()
    print(f"\nDone. Saved to {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
