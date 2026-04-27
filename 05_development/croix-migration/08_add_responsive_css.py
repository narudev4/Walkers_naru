"""Add responsive img/iframe CSS via WP Customizer > Additional CSS.

This is reversible: the CSS lives in wp_options, not in theme files.
To revert, just blank the Additional CSS section.
"""
import asyncio
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto

CSS_RULE = """/* croix-migration: responsive media fix */
.media_detail_content img,
.media_detail_content .wp-caption,
.entry-content img,
.entry-content .wp-caption,
article img,
article .wp-caption {
    max-width: 100% !important;
    height: auto !important;
}
.media_detail_content iframe,
.entry-content iframe,
article iframe {
    max-width: 100% !important;
    aspect-ratio: 16 / 9;
    height: auto !important;
}
"""


async def main():
    pw, browser, ctx, _ = await connect()
    try:
        page = await ctx.new_page()
        await goto(page, "http://stg.croix.asia/wp-admin/customize.php")
        await asyncio.sleep(3)
        print("URL:", page.url)
        print("Title:", await page.title())

        if "wp-login" in page.url:
            print("ERROR: not logged in. Current URL:", page.url)
            return

        # Wait for customizer to load
        await page.wait_for_selector("#customize-footer-actions", timeout=60000)
        await asyncio.sleep(3)
        print("Customizer loaded")

        # The setting id is theme-keyed: custom_css[croix.asia-wp]
        setting_id = "custom_css[croix.asia-wp]"

        # Expand the section
        await page.evaluate("wp.customize.section('custom_css').expand()")
        await asyncio.sleep(2)

        # Read current value
        current = await page.evaluate(
            "(id) => wp.customize(id) ? wp.customize(id).get() : null", setting_id
        )
        print(f"Current Additional CSS length: {len(current or '')}")
        if current:
            print(f"Current CSS preview: {current[:200]}")

        # Set new value (replace existing block if present)
        marker = "croix-migration: responsive media fix"
        import re as _re
        base = current or ""
        if marker in base:
            # Remove the old block: from the marker comment to the next closing brace + newline
            base = _re.sub(
                r"/\* croix-migration: responsive media fix \*/.*?\}\s*",
                "",
                base,
                count=1,
                flags=_re.DOTALL,
            )
            print("Removed existing rule, will replace")

        new_value = base.rstrip() + "\n\n" + CSS_RULE
        await page.evaluate(
            "(args) => wp.customize(args.id).set(args.css)",
            {"id": setting_id, "css": new_value}
        )
        await asyncio.sleep(1)

        # Save (publish)
        await page.evaluate("wp.customize.previewer.save()")
        print("Saving...")
        await asyncio.sleep(8)

        # Verify
        saved = await page.evaluate(
            "(id) => wp.customize(id).get()", setting_id
        )
        print(f"After save, CSS length: {len(saved or '')}")
        if marker in (saved or ""):
            print("✓ CSS rule saved successfully")
        else:
            print("✗ CSS rule NOT saved — check manually")

        await page.close()
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
