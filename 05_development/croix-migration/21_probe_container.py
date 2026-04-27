#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fallthrough している記事の本当のコンテナを探る。"""
import asyncio
import json
from pathlib import Path
from cdp import connect, goto

TARGETS = [
    ("14", "http://stg.croix.asia/news/2024_newyear/"),
    ("17", "http://stg.croix.asia/news/relaxworld-brainwave/"),
    ("20", "http://stg.croix.asia/news/tokyofm-0828/"),
    ("72", "http://stg.croix.asia/news/sound-healing-association/"),
]

PROBE_JS = r"""
() => {
  // ありそうなセレクタを総当たり
  const candidates = [
    '.media_detail_content', '.entry-content', 'article',
    '.news_detail', '.post-content', '.single-content',
    '.media_detail', '.content', 'main', '.main',
  ];
  const hits = {};
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) hits[sel] = {
      tag: el.tagName, cls: el.className,
      imgs: el.querySelectorAll('img').length,
      ps: el.querySelectorAll('p').length,
      chars: (el.innerText || '').length,
    };
  }
  // 本文の最初のPを持つ親チェーンを辿る
  const ps = [...document.querySelectorAll('p')].filter(p => (p.innerText || '').length > 100);
  const firstBig = ps[0];
  let chain = [];
  if (firstBig) {
    let el = firstBig;
    for (let i = 0; i < 8 && el; i++) {
      chain.push(`${el.tagName}.${el.className || '(none)'}`);
      el = el.parentElement;
    }
  }
  return { hits, chain, url: location.href, title: document.title };
}
"""


async def main():
    pw, browser, ctx, page = await connect()
    try:
        for no, url in TARGETS:
            print(f"=== No.{no} {url}")
            await goto(page, url)
            await page.wait_for_load_state("networkidle", timeout=15000)
            info = await page.evaluate(PROBE_JS)
            print(json.dumps(info, ensure_ascii=False, indent=2))
    finally:
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
