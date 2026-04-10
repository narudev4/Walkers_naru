"""Per-article investigation for the 4 substantive-bug candidates.

Saves each article's STG content + ORIG content to its own file under output/
so we can diff them without overwhelming context.

Uses better ORIG selectors than 05_investigate_bugs.py — tries multiple
candidates and picks the one with the longest article-like content.
"""
import asyncio
import json
import os
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto

OUT_DIR = "/Users/naru/Walkers_naru/05_development/croix-migration/output"

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
        return d.get("slug"), d.get("title", {}).get("rendered"), d.get("content", {}).get("rendered")
    except Exception as e:
        return None, f"ERR: {e}", body[:500]


async def fetch_orig_html(ctx, slug):
    p = await ctx.new_page()
    candidates = [
        f"https://croix.asia/news/{slug}/",
        f"https://croix.asia/{slug}/",
    ]
    for url in candidates:
        try:
            r = await p.goto(url, wait_until="domcontentloaded", timeout=20000)
            if not r or r.status != 200:
                continue
            title = await p.title()
            if "404" in title or "Not Found" in title:
                continue
            # Try multiple selectors and pick the longest meaningful one
            data = await p.evaluate(
                """
                () => {
                    const sels = [
                        '.media_detail_content',
                        '.entry-content',
                        '.post-content',
                        'article .content',
                        'article',
                        'main',
                        '#main',
                        '.container .row',
                    ];
                    const out = {};
                    for (const s of sels) {
                        const el = document.querySelector(s);
                        if (el) out[s] = el.innerHTML.length;
                    }
                    // Also pick the best
                    let best = null, bestLen = 0;
                    for (const s of sels) {
                        const el = document.querySelector(s);
                        if (el && el.innerHTML.length > bestLen) {
                            // Skip if it's mostly nav/footer junk
                            const txt = el.textContent || '';
                            if (txt.length < 200) continue;
                            best = s;
                            bestLen = el.innerHTML.length;
                        }
                    }
                    return {selectors: out, best, bestHtml: best ? document.querySelector(best).innerHTML : null,
                            title: document.title, url: location.href};
                }
                """
            )
            await p.close()
            return url, data
        except Exception as e:
            print(f"  ! {url}: {e}")
            continue
    await p.close()
    return None, None


async def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    pw, browser, ctx, _ = await connect()
    try:
        # Allow filtering via CLI
        only = sys.argv[1] if len(sys.argv) > 1 else None
        for stg_id, nickname, issue in TARGETS:
            if only and only != str(stg_id):
                continue
            print(f"\n=== #{stg_id} {nickname} ({issue}) ===")
            slug, title, content = await fetch_stg(ctx, stg_id)
            if not slug:
                print(f"STG fetch failed: {title}")
                continue
            print(f"Title: {title}")
            print(f"Slug: {slug}")
            print(f"STG content length: {len(content)}")

            orig_url, orig_data = await fetch_orig_html(ctx, slug)
            if orig_data:
                print(f"ORIG url: {orig_url}")
                print(f"ORIG selectors found: {orig_data['selectors']}")
                print(f"ORIG best selector: {orig_data['best']} (len={len(orig_data['bestHtml']) if orig_data['bestHtml'] else 0})")
                # Save to file
                with open(f"{OUT_DIR}/{stg_id}_{nickname}.json", "w") as f:
                    json.dump({
                        "stg_id": stg_id,
                        "nickname": nickname,
                        "issue": issue,
                        "slug": slug,
                        "title": title,
                        "stg_content": content,
                        "orig_url": orig_url,
                        "orig_selector": orig_data["best"],
                        "orig_html": orig_data["bestHtml"],
                    }, f, ensure_ascii=False, indent=2)
                print(f"Saved to {OUT_DIR}/{stg_id}_{nickname}.json")
            else:
                print("ORIG: not found")
                with open(f"{OUT_DIR}/{stg_id}_{nickname}.json", "w") as f:
                    json.dump({
                        "stg_id": stg_id, "nickname": nickname, "issue": issue,
                        "slug": slug, "title": title, "stg_content": content,
                        "orig_url": None, "orig_html": None,
                    }, f, ensure_ascii=False, indent=2)
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
