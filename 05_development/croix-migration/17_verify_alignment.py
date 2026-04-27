"""Verify alignment CSS fix: re-check .alignleft float on STG for all 4 articles."""
import asyncio
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect

SHOT_DIR = "/Users/naru/Walkers_naru/05_development/croix-migration/screenshots"

ARTICLES = [
    ("283",  "croix-studyjam"),
    ("410",  "nemcaro"),
    ("853",  "itakeru"),
    ("1247", "rwm-app"),
]


async def main():
    pw, browser, ctx, _ = await connect()
    try:
        page = await ctx.new_page()
        await page.set_viewport_size({"width": 1440, "height": 900})

        print("## Alignment fix verification\n")
        for stg_id, slug in ARTICLES:
            url = f"http://stg.croix.asia/news/{slug}/?_t=" + str(asyncio.get_event_loop().time())
            await page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(2)

            info = await page.evaluate("""
                () => {
                    const scope = document.querySelector('.media_detail_content, article, .entry-content');
                    if (!scope) return {error: 'no scope'};
                    const als = [...scope.querySelectorAll('.alignleft')].map((el, i) => ({
                        i,
                        tag: el.tagName.toLowerCase(),
                        cls: el.className,
                        float: getComputedStyle(el).float,
                        width: el.getBoundingClientRect().width,
                    }));
                    return {als};
                }
            """)
            print(f"### #{stg_id} {slug}")
            for a in info.get('als', []):
                flag = "OK" if a['float'] == 'left' else "FAIL"
                print(f"  [{flag}] #{a['i']} {a['tag']} float={a['float']} width={a['width']:.0f} `{a['cls']}`")

            # Screenshot for visual confirmation
            shot_path = f"{SHOT_DIR}/{stg_id}_{slug}_after_align.png"
            await page.screenshot(path=shot_path, full_page=True)
            print(f"  shot: {shot_path}\n")

        await page.close()
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
