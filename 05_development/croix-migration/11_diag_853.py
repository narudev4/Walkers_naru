"""Diagnose why #853 itakeru image [0] still overflows at mobile width.

Checks: parent chain, computed max-width, inline style, matching CSS rules.
"""
import asyncio
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto


async def main():
    pw, browser, ctx, _ = await connect()
    try:
        page = await ctx.new_page()
        await page.set_viewport_size({"width": 390, "height": 900})
        await goto(page, "http://stg.croix.asia/news/itakeru/")
        await asyncio.sleep(2)

        info = await page.evaluate("""
            () => {
                const imgs = document.querySelectorAll('.media_detail_content img, article img');
                const first = imgs[0];
                if (!first) return {error: 'no img'};
                // Parent chain
                const chain = [];
                let el = first;
                while (el && el !== document.body) {
                    chain.push({
                        tag: el.tagName.toLowerCase(),
                        id: el.id || null,
                        cls: el.className || null,
                        w: el.getBoundingClientRect().width,
                    });
                    el = el.parentElement;
                }
                const cs = getComputedStyle(first);
                return {
                    src: first.src,
                    natW: first.naturalWidth,
                    attrW: first.getAttribute('width'),
                    attrH: first.getAttribute('height'),
                    inlineStyle: first.getAttribute('style'),
                    rect: {w: first.getBoundingClientRect().width, h: first.getBoundingClientRect().height},
                    computedMaxWidth: cs.maxWidth,
                    computedWidth: cs.width,
                    computedHeight: cs.height,
                    computedDisplay: cs.display,
                    chain: chain,
                    // Also: count all images in .media_detail_content, article, .entry-content
                    imgsInMediaDetail: document.querySelectorAll('.media_detail_content img').length,
                    imgsInArticle: document.querySelectorAll('article img').length,
                    imgsInEntryContent: document.querySelectorAll('.entry-content img').length,
                    bodyClass: document.body.className,
                };
            }
        """)
        print("=== FIRST IMG DIAGNOSTIC ===")
        print(f"src: {info['src']}")
        print(f"natural: {info['natW']}  attr_w: {info['attrW']}  attr_h: {info['attrH']}")
        print(f"inline style: {info['inlineStyle']}")
        print(f"rect: {info['rect']}")
        print(f"computed max-width: {info['computedMaxWidth']}")
        print(f"computed width: {info['computedWidth']}")
        print(f"computed height: {info['computedHeight']}")
        print(f"computed display: {info['computedDisplay']}")
        print(f"\nbody class: {info['bodyClass']}")
        print(f"imgs in .media_detail_content: {info['imgsInMediaDetail']}")
        print(f"imgs in article: {info['imgsInArticle']}")
        print(f"imgs in .entry-content: {info['imgsInEntryContent']}")
        print(f"\nparent chain (from img to body):")
        for i, el in enumerate(info['chain']):
            print(f"  [{i}] <{el['tag']} id={el['id']!r} class={el['cls']!r}> width={el['w']:.0f}")

        await page.close()
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
