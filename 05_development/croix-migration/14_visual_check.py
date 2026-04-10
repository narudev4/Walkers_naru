"""Desktop (1440px) visual check: computed styles for strong/alignleft/font-size.

For each of the 5 articles, report:
- <strong> computed font-weight
- <img class="alignleft"> computed float, parent bounding rect
- <span style="font-size"> computed font-size vs inline
Plus full-page screenshot.
"""
import asyncio
import json
import os
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto

OUT_DIR = "/Users/naru/Walkers_naru/05_development/croix-migration/output"
SHOT_DIR = "/Users/naru/Walkers_naru/05_development/croix-migration/screenshots"
REPORT = f"{OUT_DIR}/visual_check_report.md"

ARTICLES = [
    ("283", "croix-studyjam"),
    ("410", "nemcaro"),
    ("853", "itakeru"),
    ("1247", "rwm-app"),
    ("6075", "tokyofm-0828"),
]


async def check_one(page, slug, stg_id, out):
    url = f"http://stg.croix.asia/news/{slug}/"
    await goto(page, url)
    await asyncio.sleep(2)

    info = await page.evaluate("""
        () => {
            const scope = document.querySelector('.media_detail_content, article, .entry-content, main');
            if (!scope) return {error: 'no scope'};

            // <strong> computed font-weight
            const strongs = [...scope.querySelectorAll('strong')].map((el, i) => ({
                i,
                text: (el.textContent || '').trim().slice(0, 40),
                fontWeight: getComputedStyle(el).fontWeight,
                fontSize: getComputedStyle(el).fontSize,
                color: getComputedStyle(el).color,
            }));

            // alignleft images
            const alignlefts = [...scope.querySelectorAll('img.alignleft, .alignleft img, .alignleft')].map((el, i) => {
                const cs = getComputedStyle(el);
                const p = el.parentElement;
                const pcs = p ? getComputedStyle(p) : null;
                return {
                    i,
                    tag: el.tagName.toLowerCase(),
                    cls: el.className,
                    float: cs.float,
                    display: cs.display,
                    width: el.getBoundingClientRect().width,
                    parentTag: p ? p.tagName.toLowerCase() : null,
                    parentCls: p ? p.className : null,
                    parentFloat: pcs ? pcs.float : null,
                    parentWidth: p ? p.getBoundingClientRect().width : null,
                };
            });

            // font-size spans
            const fontSpans = [...scope.querySelectorAll('span[style*="font-size"], p[style*="font-size"], font[size]')].map((el, i) => ({
                i,
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || '').trim().slice(0, 40),
                inlineStyle: el.getAttribute('style') || el.getAttribute('size'),
                computed: getComputedStyle(el).fontSize,
                fontWeight: getComputedStyle(el).fontWeight,
                color: getComputedStyle(el).color,
            }));

            // color spans (detect faint text complaint)
            const colorSpans = [...scope.querySelectorAll('[style*="color"]')].slice(0, 20).map((el, i) => ({
                i,
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || '').trim().slice(0, 40),
                inline: el.getAttribute('style'),
                computed: getComputedStyle(el).color,
            }));

            // scope width for context
            const scopeRect = scope.getBoundingClientRect();

            return {
                scopeTag: scope.tagName.toLowerCase() + '.' + scope.className,
                scopeWidth: scopeRect.width,
                strongs, alignlefts, fontSpans, colorSpans,
                strongCount: strongs.length,
            };
        }
    """)

    out.append(f"\n## #{stg_id} {slug}\n")
    out.append(f"URL: {url}  \nScope: `{info.get('scopeTag')}` width={info.get('scopeWidth'):.0f}px  \n")

    # Strong
    out.append(f"\n### `<strong>` computed font-weight ({info.get('strongCount', 0)} items)\n")
    if info.get('strongs'):
        out.append("| # | font-weight | size | color | text |")
        out.append("|---|---|---|---|---|")
        # Show only entries that are NOT bold (700/bold) to highlight bug
        weak = [s for s in info['strongs'] if s['fontWeight'] not in ('700', 'bold', '800', '900')]
        normal = [s for s in info['strongs'] if s['fontWeight'] in ('700', 'bold', '800', '900')]
        out.append(f"| - | **WEAK: {len(weak)}** | - | - | (first 10 weak shown) |")
        for s in weak[:10]:
            out.append(f"| {s['i']} | **{s['fontWeight']}** | {s['fontSize']} | {s['color']} | `{s['text']}` |")
        out.append(f"| - | bold: {len(normal)} | - | - | - |")

    # Alignleft
    out.append(f"\n### alignleft elements ({len(info.get('alignlefts', []))} items)\n")
    if info.get('alignlefts'):
        out.append("| # | tag | class | float | width | parent | p.float | p.width |")
        out.append("|---|---|---|---|---|---|---|---|")
        for a in info['alignlefts']:
            pw = f"{a['parentWidth']:.0f}" if a['parentWidth'] else "-"
            out.append(f"| {a['i']} | {a['tag']} | `{a['cls']}` | {a['float']} | {a['width']:.0f} | {a['parentTag']}.{a['parentCls']} | {a['parentFloat']} | {pw} |")
    else:
        out.append("(none)")

    # Font-size spans
    out.append(f"\n### Inline font-size elements ({len(info.get('fontSpans', []))} items)\n")
    if info.get('fontSpans'):
        out.append("| # | tag | inline | computed | weight | text |")
        out.append("|---|---|---|---|---|---|")
        for f in info['fontSpans'][:20]:
            out.append(f"| {f['i']} | {f['tag']} | `{f['inlineStyle']}` | {f['computed']} | {f['fontWeight']} | `{f['text']}` |")
    else:
        out.append("(none)")

    # Color
    out.append(f"\n### Inline color elements (first 20 of {len(info.get('colorSpans', []))})\n")
    if info.get('colorSpans'):
        out.append("| # | tag | inline | computed | text |")
        out.append("|---|---|---|---|---|")
        for c in info['colorSpans']:
            out.append(f"| {c['i']} | {c['tag']} | `{c['inline']}` | {c['computed']} | `{c['text']}` |")
    else:
        out.append("(none)")

    # Screenshot
    shot_path = f"{SHOT_DIR}/{stg_id}_{slug}_1440.png"
    await page.screenshot(path=shot_path, full_page=True)
    out.append(f"\n📸 `{shot_path}`\n")
    print(f"  ✓ {stg_id} {slug}")


async def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    pw, browser, ctx, _ = await connect()
    try:
        page = await ctx.new_page()
        await page.set_viewport_size({"width": 1440, "height": 900})

        out = ["# Visual check report — 1440px desktop\n",
               "Per-article computed-style audit for <strong> / alignleft / inline font-size.\n"]

        for stg_id, slug in ARTICLES:
            try:
                await check_one(page, slug, stg_id, out)
            except Exception as e:
                out.append(f"\n## {stg_id} {slug} — ERROR: {e}\n")
                print(f"  ✗ {stg_id}: {e}")

        with open(REPORT, "w") as f:
            f.write("\n".join(out))
        print(f"\nWrote {REPORT}")
        await page.close()
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
