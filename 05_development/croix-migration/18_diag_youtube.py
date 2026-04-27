"""Diagnose YouTube iframe sizing. Find which article and inspect."""
import asyncio
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect

# Most likely: relaxworld_app (has YouTube per spreadsheet)
CANDIDATES = [
    "relaxworld_app",
    "rwm-app",
    "nemcaro",
]


async def main():
    pw, browser, ctx, _ = await connect()
    try:
        page = await ctx.new_page()
        await page.set_viewport_size({"width": 1440, "height": 900})

        for slug in CANDIDATES:
            url = f"http://stg.croix.asia/news/{slug}/"
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(1.5)
            except Exception as e:
                print(f"[{slug}] nav error: {e}")
                continue

            info = await page.evaluate("""
                () => {
                    const iframes = [...document.querySelectorAll('iframe')].filter(f =>
                        f.src && (f.src.includes('youtube') || f.src.includes('youtu.be'))
                    );
                    if (!iframes.length) return {count: 0};
                    return {
                        count: iframes.length,
                        items: iframes.map(f => {
                            const cs = getComputedStyle(f);
                            const p = f.parentElement;
                            const pcs = p ? getComputedStyle(p) : null;
                            return {
                                src: f.src,
                                attrW: f.getAttribute('width'),
                                attrH: f.getAttribute('height'),
                                inlineStyle: f.getAttribute('style'),
                                rect: {w: f.getBoundingClientRect().width, h: f.getBoundingClientRect().height},
                                computedW: cs.width,
                                computedH: cs.height,
                                computedMaxW: cs.maxWidth,
                                parentTag: p ? p.tagName.toLowerCase() : null,
                                parentCls: p ? p.className : null,
                                parentW: p ? p.getBoundingClientRect().width : null,
                                parentCS: pcs ? {width: pcs.width, display: pcs.display} : null,
                            };
                        }),
                    };
                }
            """)
            if info.get('count', 0) > 0:
                print(f"\n=== {slug} ===")
                for i, it in enumerate(info['items']):
                    print(f"  iframe[{i}]:")
                    print(f"    src: {it['src'][:80]}")
                    print(f"    attr: w={it['attrW']} h={it['attrH']}")
                    print(f"    inline style: {it['inlineStyle']}")
                    print(f"    rect: {it['rect']['w']:.0f} x {it['rect']['h']:.0f}")
                    print(f"    computed: w={it['computedW']} h={it['computedH']} max-w={it['computedMaxW']}")
                    print(f"    parent: {it['parentTag']}.{it['parentCls']} w={it['parentW']:.0f}")
        await page.close()
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
