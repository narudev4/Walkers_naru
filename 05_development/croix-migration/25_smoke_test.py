#!/usr/bin/env python3
"""Smoke test: headless Playwright で STG vs ORIG の DOM スナップショットを比較。
CDPデーモン不要。1記事で動作確認する。
"""
import asyncio
import json
from playwright.async_api import async_playwright

STG_BASE = "http://stg.croix.asia"
ORIG_BASE = "https://croix.asia"
BASIC_USER = "test"
BASIC_PASS = "test2025"

TEST_SLUG = "croix-studyjam"
STG_URL = f"{STG_BASE}/news/{TEST_SLUG}/"
ORIG_URL = f"{ORIG_BASE}/news/{TEST_SLUG}/"

SNAPSHOT_JS = r"""
() => {
  const getStyle = (el, ...props) => {
    const s = window.getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = s.getPropertyValue(p);
    return out;
  };
  const container =
    document.querySelector('.media_detail_content') ||
    document.querySelector('.entry-content') ||
    document.querySelector('article') ||
    document.body;

  const images = [...container.querySelectorAll('img')].map(img => ({
    src: img.src,
    alt: img.alt || '',
    broken: img.naturalWidth === 0 || img.naturalHeight === 0,
    clientWidth: img.clientWidth,
    clientHeight: img.clientHeight,
  }));

  const iframes = [...container.querySelectorAll('iframe')].map(f => ({
    src: f.src,
    clientWidth: f.clientWidth,
    clientHeight: f.clientHeight,
  }));

  const BLOCK_TAGS = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','LI']);
  const isLeafBlock = (el) => {
    for (const c of el.children) {
      if (BLOCK_TAGS.has(c.tagName) && (c.innerText || '').trim()) return false;
    }
    return true;
  };
  const seen = new Set();
  const text_blocks = [];
  for (const el of container.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6')) {
    const text = (el.innerText || '').trim();
    if (!text) continue;
    if (!isLeafBlock(el)) continue;
    let parent = el.parentElement;
    let nested = false;
    while (parent && parent !== container) {
      if (seen.has(parent)) { nested = true; break; }
      parent = parent.parentElement;
    }
    if (nested) continue;
    seen.add(el);
    const firstSpan = el.querySelector('span');
    const repStyle = firstSpan ? getStyle(firstSpan, 'font-weight', 'font-size', 'color') : {};
    text_blocks.push({
      tag: el.tagName,
      text_head: text.slice(0, 100),
      text_length: text.length,
      ...getStyle(el, 'font-weight', 'font-size', 'color', 'text-align'),
      span_font_weight: repStyle['font-weight'] || '',
      span_font_size: repStyle['font-size'] || '',
      span_color: repStyle['color'] || '',
    });
  }

  const strongs = [...container.querySelectorAll('strong, b')].map(s => ({
    text: (s.innerText || '').slice(0, 120),
    ...getStyle(s, 'font-weight', 'font-size', 'color'),
  }));

  return {
    url: location.href,
    title: document.title,
    container: container.className || container.tagName,
    image_count: images.length,
    images_broken: images.filter(i => i.broken).length,
    iframe_count: iframes.length,
    text_block_count: text_blocks.length,
    strong_count: strongs.length,
    text_blocks,
    strongs,
    images,
    iframes,
  };
}
"""


async def snapshot(page, url, label):
    print(f"  [{label}] navigating to {url}")
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(2)
    data = await page.evaluate(SNAPSHOT_JS)
    print(f"  [{label}] text_blocks={data['text_block_count']}, images={data['image_count']}, strongs={data['strong_count']}")
    return data


def compare(stg, orig):
    diffs = []

    # テキストブロック数
    if stg["text_block_count"] != orig["text_block_count"]:
        diffs.append(f"text_blocks: STG={stg['text_block_count']} vs ORIG={orig['text_block_count']}")

    # 画像数
    if stg["image_count"] != orig["image_count"]:
        diffs.append(f"images: STG={stg['image_count']} vs ORIG={orig['image_count']}")

    # 壊れた画像
    if stg["images_broken"] > 0:
        diffs.append(f"STG broken images: {stg['images_broken']}")

    # iframe数
    if stg["iframe_count"] != orig["iframe_count"]:
        diffs.append(f"iframes: STG={stg['iframe_count']} vs ORIG={orig['iframe_count']}")

    # strong数
    if stg["strong_count"] != orig["strong_count"]:
        diffs.append(f"strongs: STG={stg['strong_count']} vs ORIG={orig['strong_count']}")

    # テキストブロックの中身比較（先頭80文字で突合）
    min_len = min(len(stg["text_blocks"]), len(orig["text_blocks"]))
    text_diffs = []
    for i in range(min_len):
        s, o = stg["text_blocks"][i], orig["text_blocks"][i]
        if s["text_head"][:60] != o["text_head"][:60]:
            text_diffs.append(f"  block[{i}] STG: {s['text_head'][:50]}...")
            text_diffs.append(f"          ORIG: {o['text_head'][:50]}...")
        # font-size差異
        if s.get("font-size") != o.get("font-size"):
            text_diffs.append(f"  block[{i}] font-size: STG={s.get('font-size')} vs ORIG={o.get('font-size')}")
        # font-weight差異
        if s.get("font-weight") != o.get("font-weight"):
            text_diffs.append(f"  block[{i}] font-weight: STG={s.get('font-weight')} vs ORIG={o.get('font-weight')}")
        # color差異
        if s.get("color") != o.get("color"):
            text_diffs.append(f"  block[{i}] color: STG={s.get('color')} vs ORIG={o.get('color')}")

    if text_diffs:
        diffs.append(f"text_block diffs ({len(text_diffs)} items):")
        diffs.extend(text_diffs[:30])  # 最初の30件

    return diffs


async def main():
    print(f"=== Smoke Test: {TEST_SLUG} ===\n")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)

        # STG (Basic認証付き)
        stg_ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            http_credentials={"username": BASIC_USER, "password": BASIC_PASS},
        )
        stg_page = await stg_ctx.new_page()
        stg_data = await snapshot(stg_page, STG_URL, "STG")

        # ORIG (認証不要)
        orig_ctx = await browser.new_context(
            viewport={"width": 1440, "height": 900},
        )
        orig_page = await orig_ctx.new_page()
        orig_data = await snapshot(orig_page, ORIG_URL, "ORIG")

        await browser.close()

    # 差分比較
    print(f"\n=== Comparison ===")
    diffs = compare(stg_data, orig_data)

    if not diffs:
        print("  No differences found!")
    else:
        print(f"  Found {len(diffs)} diff items:")
        for d in diffs:
            print(f"    {d}")

    # JSON保存
    out = {
        "slug": TEST_SLUG,
        "stg": stg_data,
        "orig": orig_data,
        "diffs": diffs,
    }
    outpath = "/Users/naru/Walkers_naru/05_development/croix-migration/output/smoke_test_result.json"
    with open(outpath, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\n  Result saved to {outpath}")


if __name__ == "__main__":
    asyncio.run(main())
