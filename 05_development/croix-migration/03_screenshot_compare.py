"""Take side-by-side screenshots of STG and original for a batch of articles
to help decide Pattern A (theme CSS) vs Pattern B (per-article HTML) for each.

Uses the STG post REST API to resolve slugs, then navigates to both sites.
"""
import asyncio
import json
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto

OUT_DIR = "/Users/naru/Walkers_naru/05_development/croix-migration/screenshots"

# Small batch: one from each "fix pattern" category for sanity check
BATCH = [
    # (stg_id, nickname, spreadsheet_category)
    (1655, "sound-healing", "要改行"),
    (1674, "believe-digital", "要改行"),
    (1103, "relaxworldcafe202304", "要改行"),
    (826, "newyear2025", "文字が薄い"),
    (1001, "relaxworld-nouha", "文字が薄い"),
    (1414, "pr20210916", "要改行"),
]


async def fetch_slug(ctx, stg_id):
    p = await ctx.new_page()
    await goto(p, f"http://stg.croix.asia/wp-json/wp/v2/news/{stg_id}")
    body = await p.evaluate("() => document.body.innerText")
    await p.close()
    try:
        d = json.loads(body)
        return d["slug"], d["title"]["rendered"], d["content"]["rendered"]
    except Exception:
        return None, None, None


async def screenshot_both(ctx, stg_id, nickname):
    slug, title, content = await fetch_slug(ctx, stg_id)
    if not slug:
        print(f"[skip] {stg_id} {nickname}: cannot resolve slug")
        return None
    stg_url = f"http://stg.croix.asia/news/{slug}/"
    orig_url = f"https://croix.asia/news/{slug}/"
    print(f"\n== #{stg_id} {nickname} ({title[:30]}) ==")
    print(f"STG:  {stg_url}")
    print(f"ORIG: {orig_url}")

    # STG
    p1 = await ctx.new_page()
    await p1.set_viewport_size({"width": 1200, "height": 1400})
    await goto(p1, stg_url)
    await asyncio.sleep(2)
    await p1.screenshot(path=f"{OUT_DIR}/{stg_id}_{nickname}_stg.png", full_page=True)

    # Also compute key styles for diagnosis
    style_snap = await p1.evaluate("""
        () => {
            const sel = ['body', '.media_detail_content', '.media_detail_content p', '.media_detail_content p:first-of-type'];
            const out = {};
            for (const s of sel) {
                const el = document.querySelector(s);
                if (!el) { out[s] = null; continue; }
                const cs = getComputedStyle(el);
                out[s] = {
                    color: cs.color,
                    bg: cs.backgroundColor,
                    fontSize: cs.fontSize,
                    fontWeight: cs.fontWeight,
                    lineHeight: cs.lineHeight,
                    marginBottom: cs.marginBottom,
                    paddingTop: cs.paddingTop,
                };
            }
            return out;
        }
    """)
    print("STG styles:", json.dumps(style_snap, ensure_ascii=False))
    await p1.close()

    # ORIG
    p2 = await ctx.new_page()
    await p2.set_viewport_size({"width": 1200, "height": 1400})
    try:
        r = await p2.goto(orig_url, wait_until="domcontentloaded", timeout=20000)
        if r and r.status == 200:
            await asyncio.sleep(2)
            await p2.screenshot(path=f"{OUT_DIR}/{stg_id}_{nickname}_orig.png", full_page=True)
            orig_style = await p2.evaluate("""
                () => {
                    const sel = ['body', 'article p', '.entry-content p', '.container p'];
                    const out = {};
                    for (const s of sel) {
                        const el = document.querySelector(s);
                        if (!el) { out[s] = null; continue; }
                        const cs = getComputedStyle(el);
                        out[s] = {
                            color: cs.color, bg: cs.backgroundColor,
                            fontSize: cs.fontSize, fontWeight: cs.fontWeight,
                            lineHeight: cs.lineHeight, marginBottom: cs.marginBottom,
                        };
                    }
                    return out;
                }
            """)
            print("ORIG styles:", json.dumps(orig_style, ensure_ascii=False))
        else:
            print("  ORIG: failed status")
    except Exception as e:
        print(f"  ORIG error: {e}")
    await p2.close()

    return {"stg_id": stg_id, "slug": slug, "title": title, "stg_content": content[:500]}


async def main():
    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    pw, browser, ctx, _ = await connect()
    try:
        results = []
        for stg_id, nickname, category in BATCH:
            r = await screenshot_both(ctx, stg_id, nickname)
            if r: results.append(r)
        print("\n=== done ===")
        print(f"Screenshots saved to {OUT_DIR}")
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
