"""Compare ORIG vs STG computed styles for the two suspected bugs:
(A) .alignleft float value
(B) <span style=font-size> computed font-weight
"""
import asyncio
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect

REPORT = "/Users/naru/Walkers_naru/05_development/croix-migration/output/orig_compare_report.md"

PAIRS = [
    ("283", "croix-studyjam", "https://croix.asia/news/croix-studyjam/",   "http://stg.croix.asia/news/croix-studyjam/"),
    ("410", "nemcaro",         "https://croix.asia/news/nemcaro/",          "http://stg.croix.asia/news/nemcaro/"),
    ("1247","rwm-app",         "https://croix.asia/news/rwm-app/",          "http://stg.croix.asia/news/rwm-app/"),
    ("853", "itakeru",         "https://croix.asia/news/itakeru/",          "http://stg.croix.asia/news/itakeru/"),
]

EVAL_JS = """
() => {
    // Try multiple scopes
    const scope = document.querySelector('.media_detail_content') ||
                  document.querySelector('.entry-content') ||
                  document.querySelector('article') ||
                  document.querySelector('main');
    if (!scope) return {error: 'no scope'};

    // Alignleft sample (first 5)
    const al = [...scope.querySelectorAll('.alignleft')].slice(0, 5).map((el, i) => ({
        i,
        tag: el.tagName.toLowerCase(),
        cls: el.className,
        float: getComputedStyle(el).float,
        display: getComputedStyle(el).display,
        width: el.getBoundingClientRect().width,
    }));

    // First 5 span[style*="font-size"]
    const fs = [...scope.querySelectorAll('span[style*="font-size"]')].slice(0, 5).map((el, i) => ({
        i,
        inline: el.getAttribute('style'),
        computed: getComputedStyle(el).fontSize,
        weight: getComputedStyle(el).fontWeight,
        text: (el.textContent || '').trim().slice(0, 50),
    }));

    return {
        scopeTag: scope.tagName.toLowerCase() + '.' + (scope.className || ''),
        alignleftCount: scope.querySelectorAll('.alignleft').length,
        alignlefts: al,
        fontSpanCount: scope.querySelectorAll('span[style*="font-size"]').length,
        fontSpans: fs,
    };
}
"""


async def check(page, url, label):
    await page.goto(url, wait_until="domcontentloaded", timeout=25000)
    await asyncio.sleep(2)
    return await page.evaluate(EVAL_JS)


async def main():
    pw, browser, ctx, _ = await connect()
    out = ["# ORIG vs STG computed style comparison\n",
           "Testing hypotheses:\n",
           "- (A) `.alignleft` float should be `left` on ORIG but is `none` on STG\n",
           "- (B) `<span style=font-size>` should be bold (700) on ORIG\n"]
    try:
        page = await ctx.new_page()
        await page.set_viewport_size({"width": 1440, "height": 900})

        for stg_id, slug, orig_url, stg_url in PAIRS:
            out.append(f"\n---\n\n## #{stg_id} {slug}\n")
            print(f"[{stg_id}] {slug}", flush=True)

            for label, url in [("ORIG", orig_url), ("STG", stg_url)]:
                try:
                    info = await asyncio.wait_for(check(page, url, label), timeout=45)
                except Exception as e:
                    out.append(f"\n### {label}: ERROR {e}\n")
                    print(f"  {label} error: {e}", flush=True)
                    continue

                out.append(f"\n### {label}: `{info['scopeTag'][:60]}`  \n")
                out.append(f"alignleft count: {info['alignleftCount']} / font-size spans: {info['fontSpanCount']}\n")

                if info['alignlefts']:
                    out.append("\n**alignleft:**\n")
                    out.append("| # | tag | float | display | width | class |")
                    out.append("|---|---|---|---|---|---|")
                    for a in info['alignlefts']:
                        out.append(f"| {a['i']} | {a['tag']} | **{a['float']}** | {a['display']} | {a['width']:.0f} | `{a['cls']}` |")

                if info['fontSpans']:
                    out.append("\n**font-size spans (first 5):**\n")
                    out.append("| # | inline | computed | weight | text |")
                    out.append("|---|---|---|---|---|")
                    for f in info['fontSpans']:
                        out.append(f"| {f['i']} | `{f['inline']}` | {f['computed']} | **{f['weight']}** | `{f['text']}` |")
                print(f"  {label} ok: al={info['alignleftCount']} fs={info['fontSpanCount']}", flush=True)

        with open(REPORT, "w") as f:
            f.write("\n".join(out))
        print(f"\nWrote {REPORT}", flush=True)
        await page.close()
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
