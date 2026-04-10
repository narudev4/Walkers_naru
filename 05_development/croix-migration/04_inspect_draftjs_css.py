"""Find out how the original croix.asia renders Draft.js [data-block] divs,
so we can mirror those styles in the STG theme."""
import asyncio
import json
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto


async def main():
    pw, browser, ctx, _ = await connect()
    try:
        orig = await ctx.new_page()
        await goto(orig, "https://croix.asia/news/2025_newyear/")
        await asyncio.sleep(2)

        # Inspect the draft.js divs
        data = await orig.evaluate("""
            () => {
                const blocks = document.querySelectorAll('[data-block="true"]');
                if (!blocks.length) return {blocks: 0};
                const out = [];
                for (let i = 0; i < Math.min(3, blocks.length); i++) {
                    const el = blocks[i];
                    const cs = getComputedStyle(el);
                    out.push({
                        index: i,
                        tag: el.tagName,
                        cls: el.className,
                        text: (el.textContent||'').slice(0, 40),
                        color: cs.color,
                        fontSize: cs.fontSize,
                        fontWeight: cs.fontWeight,
                        lineHeight: cs.lineHeight,
                        marginTop: cs.marginTop,
                        marginBottom: cs.marginBottom,
                        paddingTop: cs.paddingTop,
                        paddingBottom: cs.paddingBottom,
                        display: cs.display,
                    });
                }
                // Also check inner .public-DraftStyleDefault-block
                const inners = document.querySelectorAll('.public-DraftStyleDefault-block');
                const inner_out = [];
                for (let i = 0; i < Math.min(3, inners.length); i++) {
                    const el = inners[i];
                    const cs = getComputedStyle(el);
                    inner_out.push({
                        index: i,
                        tag: el.tagName,
                        cls: el.className,
                        text: (el.textContent||'').slice(0, 40),
                        color: cs.color,
                        fontSize: cs.fontSize,
                        fontWeight: cs.fontWeight,
                        lineHeight: cs.lineHeight,
                        marginTop: cs.marginTop,
                        marginBottom: cs.marginBottom,
                    });
                }
                // Parent container
                const parent = document.querySelector('[data-block="true"]')?.parentElement;
                let parentInfo = null;
                if (parent) {
                    const cs = getComputedStyle(parent);
                    parentInfo = {
                        tag: parent.tagName,
                        cls: parent.className,
                        fontSize: cs.fontSize,
                        lineHeight: cs.lineHeight,
                    };
                }
                return {blocks: blocks.length, data_block_samples: out, inner_samples: inner_out, parent: parentInfo};
            }
        """)
        print("=== ORIGINAL Draft.js styles ===")
        print(json.dumps(data, ensure_ascii=False, indent=2))

        # Same on STG
        stg = await ctx.new_page()
        await goto(stg, "http://stg.croix.asia/news/2025_newyear/")
        await asyncio.sleep(2)
        data2 = await stg.evaluate("""
            () => {
                const blocks = document.querySelectorAll('[data-block="true"]');
                if (!blocks.length) return {blocks: 0};
                const out = [];
                for (let i = 0; i < Math.min(3, blocks.length); i++) {
                    const el = blocks[i];
                    const cs = getComputedStyle(el);
                    out.push({
                        index: i, tag: el.tagName, cls: el.className,
                        text: (el.textContent||'').slice(0, 40),
                        color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
                        lineHeight: cs.lineHeight, marginTop: cs.marginTop, marginBottom: cs.marginBottom,
                        paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, display: cs.display,
                    });
                }
                return {blocks: blocks.length, data_block_samples: out};
            }
        """)
        print("\n=== STG Draft.js styles ===")
        print(json.dumps(data2, ensure_ascii=False, indent=2))

        # Check what CSS rules are applied to .public-DraftStyleDefault-block in the original
        rules = await orig.evaluate("""
            () => {
                const matches = [];
                for (const sheet of document.styleSheets) {
                    try {
                        for (const rule of sheet.cssRules || []) {
                            const sel = rule.selectorText || '';
                            if (sel.includes('Draft') || sel.includes('data-block') || sel.includes('public-Draft')) {
                                matches.push({sel, css: rule.cssText.slice(0, 300)});
                            }
                        }
                    } catch (e) {}
                }
                return matches;
            }
        """)
        print("\n=== ORIG CSS rules mentioning Draft ===")
        for r in rules: print(r)

    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
