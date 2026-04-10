"""Investigate the 4 substantive-bug candidates: fetch STG and ORIG HTML
and print side-by-side diagnostic info for each.

Candidates:
  #283  croix-studyjam       - 文字抜け
  #410  nemcaro              - YouTube embed size
  #6075 TOKYO FM 8/28        - missing image
  #853  itakeru              - oversized image
"""
import asyncio
import json
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto

TARGETS = [
    (283, "croix-studyjam", "文字抜け"),
    (410, "nemcaro", "YouTube埋め込みサイズ"),
    (6075, "tokyofm-0828", "画像未挿入"),
    (853, "itakeru", "画像サイズ大"),
]


async def fetch_stg(ctx, stg_id):
    p = await ctx.new_page()
    await goto(p, f"http://stg.croix.asia/wp-json/wp/v2/news/{stg_id}")
    body = await p.evaluate("() => document.body.innerText")
    await p.close()
    try:
        d = json.loads(body)
        return d["slug"], d["title"]["rendered"], d["content"]["rendered"]
    except Exception as e:
        return None, f"ERR: {e}", body[:300]


async def fetch_orig_html(ctx, slug):
    p = await ctx.new_page()
    urls = [
        f"https://croix.asia/news/{slug}/",
        f"https://croix.asia/{slug}/",
    ]
    for url in urls:
        try:
            r = await p.goto(url, wait_until="domcontentloaded", timeout=20000)
            if r and r.status == 200 and "404" not in (await p.title()):
                html = await p.evaluate(
                    "() => { const el = document.querySelector('.container, article, .entry-content, main');"
                    " return el ? el.innerHTML : document.body.innerHTML; }"
                )
                await p.close()
                return url, html
        except Exception:
            continue
    await p.close()
    return None, None


async def main():
    pw, browser, ctx, _ = await connect()
    try:
        for stg_id, nickname, issue in TARGETS:
            print(f"\n{'='*80}\n#{stg_id} {nickname} — {issue}\n{'='*80}")
            slug, title, content = await fetch_stg(ctx, stg_id)
            if not slug:
                print(f"STG fetch failed: {title}")
                continue
            print(f"Title: {title}")
            print(f"Slug:  {slug}")
            print(f"STG content length: {len(content)}")
            print(f"--- STG content ---")
            print(content)
            orig_url, orig_html = await fetch_orig_html(ctx, slug)
            if orig_html:
                print(f"\n--- ORIG content ({orig_url}) ---")
                print(orig_html[:3000])
                if len(orig_html) > 3000:
                    print(f"... (+{len(orig_html)-3000} more chars)")
                print(f"ORIG content length (after container): {len(orig_html)}")
            else:
                print("ORIG: not found")
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
