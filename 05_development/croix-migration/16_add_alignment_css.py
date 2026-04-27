"""Add WP core alignment CSS (alignleft/alignright/aligncenter) via Customizer.

The new STG theme is missing WP core alignment styles, so .alignleft
computes as float:none. This adds them back.

Reversible: lives in wp_options, not theme files.
"""
import asyncio
import re as _re
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto

CSS_RULE = """/* croix-migration: WP core alignment fix */
.media_detail_content .alignleft,
.media_detail_content img.alignleft,
.media_detail_content .wp-caption.alignleft,
.entry-content .alignleft,
.entry-content img.alignleft,
.entry-content .wp-caption.alignleft,
article .alignleft,
article img.alignleft,
article .wp-caption.alignleft {
    float: left !important;
    margin-right: 1.5em;
    margin-bottom: 1em;
}
.media_detail_content .alignright,
.media_detail_content img.alignright,
.media_detail_content .wp-caption.alignright,
.entry-content .alignright,
.entry-content img.alignright,
.entry-content .wp-caption.alignright,
article .alignright,
article img.alignright,
article .wp-caption.alignright {
    float: right !important;
    margin-left: 1.5em;
    margin-bottom: 1em;
}
.media_detail_content .aligncenter,
.media_detail_content img.aligncenter,
.entry-content .aligncenter,
article .aligncenter {
    display: block !important;
    margin-left: auto !important;
    margin-right: auto !important;
}
"""

MARKER = "croix-migration: WP core alignment fix"


async def main():
    pw, browser, ctx, _ = await connect()
    try:
        page = await ctx.new_page()
        await goto(page, "http://stg.croix.asia/wp-admin/customize.php")
        await asyncio.sleep(3)
        print("URL:", page.url)

        if "wp-login" in page.url:
            print("ERROR: not logged in.")
            return

        await page.wait_for_selector("#customize-footer-actions", timeout=60000)
        await asyncio.sleep(3)

        setting_id = "custom_css[croix.asia-wp]"
        await page.evaluate("wp.customize.section('custom_css').expand()")
        await asyncio.sleep(2)

        current = await page.evaluate(
            "(id) => wp.customize(id) ? wp.customize(id).get() : null", setting_id
        )
        print(f"Current Additional CSS length: {len(current or '')}")

        base = current or ""
        if MARKER in base:
            # Replace existing block
            base = _re.sub(
                r"/\* croix-migration: WP core alignment fix \*/.*?(?=/\* croix-migration|\Z)",
                "",
                base,
                count=1,
                flags=_re.DOTALL,
            )
            print("Removed existing alignment block, will replace")

        new_value = base.rstrip() + "\n\n" + CSS_RULE
        await page.evaluate(
            "(args) => wp.customize(args.id).set(args.css)",
            {"id": setting_id, "css": new_value}
        )
        await asyncio.sleep(1)

        await page.evaluate("wp.customize.previewer.save()")
        print("Saving...")
        await asyncio.sleep(8)

        saved = await page.evaluate("(id) => wp.customize(id).get()", setting_id)
        print(f"After save, CSS length: {len(saved or '')}")
        if MARKER in (saved or ""):
            print("OK: alignment CSS saved")
        else:
            print("FAIL: not saved")

        await page.close()
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
