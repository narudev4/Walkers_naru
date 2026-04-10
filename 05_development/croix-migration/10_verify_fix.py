"""Verify the responsive CSS fix by measuring rendered iframe/img widths
on the 4 bug candidates + take screenshots for visual confirmation.
"""
import asyncio
import os
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto

OUT = "/Users/naru/Walkers_naru/05_development/croix-migration/screenshots"

TARGETS = [
    (283, "croix-studyjam"),
    (410, "nemcaro"),
    (6075, "tokyofm-0828-2"),
    (853, "itakeru"),
]


async def measure(page, stg_id, slug, vw=1200):
    url = f"http://stg.croix.asia/news/{slug}/"
    await page.set_viewport_size({"width": vw, "height": 900})
    await goto(page, url)
    await asyncio.sleep(2)
    data = await page.evaluate("""
        () => {
            const container = document.querySelector('.media_detail_content, article, main');
            const cRect = container ? container.getBoundingClientRect() : null;
            const imgs = Array.from(document.querySelectorAll('.media_detail_content img, article img'))
                .slice(0, 20)
                .map(el => {
                    const r = el.getBoundingClientRect();
                    return {natW: el.naturalWidth, w: r.width, h: r.height, attr_w: el.getAttribute('width')};
                });
            const ifr = Array.from(document.querySelectorAll('.media_detail_content iframe, article iframe'))
                .slice(0, 10)
                .map(el => {
                    const r = el.getBoundingClientRect();
                    return {w: r.width, h: r.height, attr_w: el.getAttribute('width')};
                });
            return {containerWidth: cRect ? cRect.width : null, imgs, iframes: ifr};
        }
    """)
    return url, data


async def main():
    os.makedirs(OUT, exist_ok=True)
    pw, browser, ctx, _ = await connect()
    try:
        page = await ctx.new_page()
        for stg_id, slug in TARGETS:
            print(f"\n=== #{stg_id} {slug} ===")
            # Need to fetch actual slug for #6075 (URL encoded)
            if stg_id == 6075:
                # Resolve from REST
                tmp = await ctx.new_page()
                await goto(tmp, f"http://stg.croix.asia/wp-json/wp/v2/news/{stg_id}")
                import json as _j
                body = await tmp.evaluate("() => document.body.innerText")
                try:
                    real_slug = _j.loads(body)["slug"]
                except Exception:
                    real_slug = slug
                await tmp.close()
                slug_to_use = real_slug
            else:
                slug_to_use = slug
            url, data = await measure(page, stg_id, slug_to_use, vw=390)
            print(f"URL: {url} (viewport=390)")
            print(f"Container width: {data['containerWidth']}")
            print(f"Images ({len(data['imgs'])}):")
            for i, im in enumerate(data['imgs']):
                flag = "⚠ OVERFLOW" if im['w'] > data['containerWidth'] + 5 else "ok"
                print(f"  [{i}] rendered={im['w']:.0f}x{im['h']:.0f} natural={im['natW']} attr_w={im['attr_w']} {flag}")
            print(f"Iframes ({len(data['iframes'])}):")
            for i, fr in enumerate(data['iframes']):
                flag = "⚠ OVERFLOW" if fr['w'] > data['containerWidth'] + 5 else "ok"
                print(f"  [{i}] rendered={fr['w']:.0f}x{fr['h']:.0f} attr_w={fr['attr_w']} {flag}")
            # Screenshot (mobile)
            await page.screenshot(
                path=f"{OUT}/{stg_id}_{slug}_mobile_after.png",
                full_page=True,
            )
            print(f"Screenshot: {OUT}/{stg_id}_{slug}_mobile_after.png")
        await page.close()
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
