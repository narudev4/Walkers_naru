"""Debug: what settings does the customizer have?"""
import asyncio
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto


async def main():
    pw, browser, ctx, _ = await connect()
    try:
        page = await ctx.new_page()
        await goto(page, "http://stg.croix.asia/wp-admin/customize.php")
        await asyncio.sleep(5)
        print("URL:", page.url)

        # Wait for some customize DOM element
        await page.wait_for_selector("#customize-footer-actions", timeout=60000)
        await asyncio.sleep(3)
        has_wp = await page.evaluate("() => typeof wp !== 'undefined' && !!wp.customize")
        print("wp.customize present:", has_wp)

        # List all settings and sections
        info = await page.evaluate("""
            () => {
                const settings = [];
                wp.customize.each((s) => settings.push(s.id));
                const sections = [];
                wp.customize.section.each((s) => sections.push(s.id));
                return {settings_count: settings.length, sections_count: sections.length,
                        css_settings: settings.filter(s => s.toLowerCase().includes('css')),
                        css_sections: sections.filter(s => s.toLowerCase().includes('css')),
                        all_sections: sections};
            }
        """)
        print("INFO:", info)
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
