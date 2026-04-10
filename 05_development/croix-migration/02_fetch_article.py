"""Fetch original + STG HTML for one article (by STG post id or slug)
and print them side-by-side for manual diffing.

Usage:
    python3 02_fetch_article.py <stg_id_or_slug>
"""
import asyncio
import json
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto


async def main():
    if len(sys.argv) < 2:
        print("Usage: python3 02_fetch_article.py <stg_id_or_slug>")
        sys.exit(1)
    target = sys.argv[1]

    pw, browser, ctx, _ = await connect()
    try:
        # --- Resolve slug via REST API (news CPT) ---
        api = await ctx.new_page()
        if target.isdigit():
            rest_url = f"http://stg.croix.asia/wp-json/wp/v2/news/{target}"
        else:
            rest_url = f"http://stg.croix.asia/wp-json/wp/v2/news?slug={target}"
        await goto(api, rest_url)
        body_text = await api.evaluate("() => document.body.innerText")
        data = json.loads(body_text)
        if isinstance(data, list):
            if not data:
                print("No article found for slug:", target)
                return
            post = data[0]
        else:
            post = data
        stg_id = post["id"]
        stg_slug = post["slug"]
        stg_title = post["title"]["rendered"]
        stg_content = post["content"]["rendered"]
        print(f"=== STG id={stg_id} slug={stg_slug} ===")
        print(f"Title: {stg_title}")
        print(f"Content length: {len(stg_content)}")
        print("--- STG content[:2000] ---")
        print(stg_content[:2000])
        print("--- STG content[last 500] ---")
        print(stg_content[-500:] if len(stg_content) > 2500 else "")

        # --- Fetch original from croix.asia ---
        # Try different URL patterns: /news/{slug}/, /{year}/{month}/{day}/{slug}/, /{slug}/
        orig = await ctx.new_page()
        candidates = [
            f"https://croix.asia/news/{stg_slug}/",
            f"https://croix.asia/{stg_slug}/",
        ]
        html_orig = None
        for url in candidates:
            try:
                resp = await orig.goto(url, wait_until="domcontentloaded", timeout=20000)
                if resp and resp.status == 200 and "404" not in (await orig.title()):
                    html_orig = await orig.evaluate(
                        "() => { const el = document.querySelector('.entry-content, article, .post-content, .media_detail_content, main');"
                        " return el ? el.innerHTML : document.body.innerHTML; }"
                    )
                    print(f"\n=== ORIG {url} ===")
                    print(f"Title: {await orig.title()}")
                    break
            except Exception as e:
                print(f"  ! {url}: {e}")
                continue
        # If still no match, search by title
        if not html_orig:
            search = await ctx.new_page()
            await goto(search, f"https://croix.asia/?s={stg_slug}")
            await asyncio.sleep(1)
            hits = await search.evaluate(
                "() => Array.from(document.querySelectorAll('a'))"
                ".filter(a => a.href.includes('croix.asia') && a.textContent.trim().length > 0)"
                ".slice(0, 10).map(a => ({text: a.textContent.trim().slice(0,80), href: a.href}))"
            )
            print("Search hits:", hits)

        if html_orig:
            print("--- ORIG content[:2500] ---")
            print(html_orig[:2500])

    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
