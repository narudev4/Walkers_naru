"""Fetch rwm-app article (STG + ORIG) and save to output/ for diff."""
import asyncio
import json
import os
import sys
sys.path.insert(0, "/Users/naru/Walkers_naru/05_development/croix-migration")
from cdp import connect, goto

OUT_DIR = "/Users/naru/Walkers_naru/05_development/croix-migration/output"


async def main():
    pw, browser, ctx, _ = await connect()
    try:
        p = await ctx.new_page()
        # Find STG post by slug
        await goto(p, "http://stg.croix.asia/wp-json/wp/v2/news?slug=rwm-app")
        body = await p.evaluate("() => document.body.innerText")
        arr = json.loads(body)
        if not arr:
            print("STG: not found by slug=rwm-app, trying search")
            await goto(p, "http://stg.croix.asia/wp-json/wp/v2/news?search=rwm")
            body = await p.evaluate("() => document.body.innerText")
            arr = json.loads(body)
        if not arr:
            print("Not found")
            return
        d = arr[0]
        stg_id = d["id"]
        slug = d["slug"]
        title = d["title"]["rendered"]
        stg_content = d["content"]["rendered"]
        print(f"STG #{stg_id} {slug}: title={title}, len={len(stg_content)}")

        # Fetch ORIG
        orig_url = f"https://croix.asia/news/{slug}/"
        await p.goto(orig_url, wait_until="domcontentloaded", timeout=20000)
        data = await p.evaluate("""
            () => {
                const sels = ['.media_detail_content','.entry-content','.post-content',
                              'article .content','article','main'];
                let best = null, bestLen = 0;
                for (const s of sels) {
                    const el = document.querySelector(s);
                    if (el && el.innerHTML.length > bestLen) {
                        const txt = el.textContent || '';
                        if (txt.length < 200) continue;
                        best = s;
                        bestLen = el.innerHTML.length;
                    }
                }
                return {best, bestHtml: best ? document.querySelector(best).innerHTML : null};
            }
        """)
        print(f"ORIG best selector: {data['best']} len={len(data['bestHtml']) if data['bestHtml'] else 0}")

        out = {
            "stg_id": stg_id,
            "nickname": "rwm-app",
            "issue": "M列: アイコン・QRコード非表示, 改行異常",
            "slug": slug,
            "title": title,
            "stg_content": stg_content,
            "orig_url": orig_url,
            "orig_selector": data["best"],
            "orig_html": data["bestHtml"],
        }
        with open(f"{OUT_DIR}/{stg_id}_rwm-app.json", "w") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print(f"Saved {OUT_DIR}/{stg_id}_rwm-app.json")
        await p.close()
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
