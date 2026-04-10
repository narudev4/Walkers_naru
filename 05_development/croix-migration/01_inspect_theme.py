"""Inspect the STG site theme to plan Pattern A (CSS fix).

Goals:
1. Find the active theme name and its style.css file path (via WP admin).
2. Capture current computed styles on a sample "文字が薄い" article (#826).
3. Fetch the original croix.asia equivalent computed styles for comparison.

Outputs to stdout as a report.
"""
import asyncio
import json
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto


async def computed_styles(page, selector: str, props: list[str]) -> dict:
    js = """
    (args) => {
        const el = document.querySelector(args.sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        const out = {};
        for (const p of args.props) out[p] = cs.getPropertyValue(p);
        return out;
    }
    """
    return await page.evaluate(js, {"sel": selector, "props": props})


PROPS = [
    "color", "background-color", "font-size", "font-weight",
    "font-family", "line-height", "letter-spacing", "margin-bottom",
]


async def main():
    pw, browser, ctx, _ = await connect()
    try:
        # --- STG: inspect article 826 ---
        stg = await ctx.new_page()
        await goto(stg, "http://stg.croix.asia/news/2025_newyear/")
        await asyncio.sleep(2)
        print("=== STG #826 (2025_newyear) ===")
        print("URL:", stg.url)
        print("Title:", await stg.title())

        # Body + content container
        for sel in ["body", ".media_detail_content", ".media_detail_content p"]:
            cs = await computed_styles(stg, sel, PROPS)
            print(f"{sel}: {json.dumps(cs, ensure_ascii=False)}")

        # Inner HTML snippet (first 400 chars) for pattern detection
        html = await stg.evaluate(
            "() => { const el = document.querySelector('.media_detail_content');"
            " return el ? el.innerHTML.slice(0,400) : null; }"
        )
        print("HTML[:400]:", html)

        # --- Original croix.asia ---
        orig = await ctx.new_page()
        await goto(orig, "https://croix.asia/news/2025_newyear/")
        await asyncio.sleep(2)
        print("\n=== ORIG #826 (2025_newyear) ===")
        print("URL:", orig.url)
        print("Title:", await orig.title())
        # Try a few likely content selectors
        for sel in ["body", "article", ".entry-content", ".post-content",
                    ".media_detail_content", "main p", "p"]:
            cs = await computed_styles(orig, sel, PROPS)
            if cs:
                print(f"{sel}: {json.dumps(cs, ensure_ascii=False)}")

        # --- WP admin: theme file editor ---
        wp = await ctx.new_page()
        await goto(wp, "http://stg.croix.asia/wp-admin/theme-editor.php")
        await asyncio.sleep(3)
        print("\n=== WP theme editor ===")
        print("URL:", wp.url)
        print("Title:", await wp.title())
        # Active theme heading
        heading = await wp.evaluate(
            "() => { const h = document.querySelector('#wpbody-content h1');"
            " return h ? h.textContent.trim() : null; }"
        )
        print("Heading:", heading)
        # File list (all files under this theme)
        files = await wp.evaluate(
            "() => Array.from(document.querySelectorAll('#templateside a'))"
            ".map(a => a.textContent.trim()).slice(0, 60)"
        )
        print("Files (first 60):", files)

    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
