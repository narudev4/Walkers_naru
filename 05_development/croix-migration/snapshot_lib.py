#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Shared snapshot logic for STG (20_verify_all.py) and ORIG (23_verify_orig.py).

SNAPSHOT_JS: 本文コンテナの DOM 状態を JSON 化する JavaScript。
  - 旧 `<p>` 系と DraftJS `<div.public-DraftStyleDefault-block>` 系の両方を
    `text_blocks` にまとめて抽出する（A_CSS font-color/weight 判定のため）。
  - images / iframes / aligns は従来のまま。

SCROLL_AND_DECODE_JS: lazy load 画像を強制ロードさせる。
"""
import asyncio
import json
from pathlib import Path

BASE = Path(__file__).parent


def load_articles():
    """articles.json + 19_build_issue_index.ROWS からマージ。stg URL を返す。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location("idx", BASE / "19_build_issue_index.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    titles = {row[0]: row[1] for row in mod.ROWS}
    arts = json.loads((BASE / "output" / "articles.json").read_text(encoding="utf-8"))
    return [{"No": a["No"], "slug": a["slug"], "title": titles.get(a["No"], ""), "url": a["url"]} for a in arts]


def rewrite_to_orig(stg_url: str) -> str:
    """http://stg.croix.asia/... → https://croix.asia/..."""
    return stg_url.replace("http://stg.croix.asia", "https://croix.asia").replace(
        "https://stg.croix.asia", "https://croix.asia"
    )


SNAPSHOT_JS = r"""
() => {
  const getStyle = (el, ...props) => {
    const s = window.getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = s.getPropertyValue(p);
    return out;
  };

  // 本文コンテナを特定
  const container =
    document.querySelector('.media_detail_content') ||
    document.querySelector('.entry-content') ||
    document.querySelector('article') ||
    document.body;

  const images = [...container.querySelectorAll('img')].map(img => ({
    src: img.src,
    alt: img.alt || '',
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    clientWidth: img.clientWidth,
    clientHeight: img.clientHeight,
    broken: img.naturalWidth === 0 || img.naturalHeight === 0,
    className: img.className || '',
    parentClassName: img.parentElement ? img.parentElement.className : '',
    ...getStyle(img, 'float', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'display', 'max-width', 'width', 'height'),
  }));

  const iframes = [...container.querySelectorAll('iframe')].map(f => ({
    src: f.src,
    clientWidth: f.clientWidth,
    clientHeight: f.clientHeight,
    className: f.className || '',
    ...getStyle(f, 'width', 'height', 'max-width', 'aspect-ratio'),
  }));

  // paragraphs は従来互換のため残す
  const paragraphs = [...container.querySelectorAll('p')].map(p => ({
    text_head: (p.innerText || '').slice(0, 80),
    text_length: (p.innerText || '').length,
    isEmpty: !(p.innerText || '').trim(),
    childImg: !!p.querySelector('img'),
    childBr: p.querySelectorAll('br').length,
    ...getStyle(p, 'font-weight', 'font-size', 'color', 'text-align', 'margin-top', 'margin-bottom'),
  }));

  // text_blocks: <p> / DraftJS ブロック / div[dir] / leaf-level <div> / 見出し を統一収集。
  // leaf-level = 直下にブロック要素（P/DIV/H*/BLOCKQUOTE/LI）を持たないもの。
  // これにより、WP classic, DraftJS, Facebook移植(dir=auto)、プレーン<div>の全てを拾える。
  const BLOCK_TAGS = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','LI']);
  const isLeafBlock = (el) => {
    for (const c of el.children) {
      if (BLOCK_TAGS.has(c.tagName) && (c.innerText || '').trim()) return false;
    }
    return true;
  };
  const candidateSel = 'p, div, h1, h2, h3, h4, h5, h6';
  const seen = new Set();
  const text_blocks = [];
  for (const el of container.querySelectorAll(candidateSel)) {
    const text = (el.innerText || '').trim();
    if (!text) continue;
    if (!isLeafBlock(el)) continue;
    // 内包関係の除外：親が既に収集済みならスキップ
    let parent = el.parentElement;
    let nested = false;
    while (parent && parent !== container) {
      if (seen.has(parent)) { nested = true; break; }
      parent = parent.parentElement;
    }
    if (nested) continue;
    seen.add(el);
    // 文字色は span[style] の実装になっていることがあるので代表子要素も見る
    const firstSpan = el.querySelector('span');
    const repStyle = firstSpan ? getStyle(firstSpan, 'font-weight', 'font-size', 'color') : {};
    text_blocks.push({
      tag: el.tagName,
      className: el.className || '',
      text_head: text.slice(0, 80),
      text_length: text.length,
      childImg: !!el.querySelector('img'),
      childBr: el.querySelectorAll('br').length,
      ...getStyle(el, 'font-weight', 'font-size', 'color', 'text-align', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right'),
      span_font_weight: repStyle['font-weight'] || '',
      span_font_size: repStyle['font-size'] || '',
      span_color: repStyle['color'] || '',
    });
  }

  const strongs = [...container.querySelectorAll('strong, b')].map(s => ({
    text: (s.innerText || '').slice(0, 120),
    ...getStyle(s, 'font-weight', 'font-size', 'color'),
  }));

  const spans = [...container.querySelectorAll('span[style]')].map(sp => ({
    text: (sp.innerText || '').slice(0, 120),
    style_attr: sp.getAttribute('style') || '',
    ...getStyle(sp, 'font-weight', 'font-size', 'color'),
  }));

  const aligns = [...container.querySelectorAll('.alignleft, .alignright, .aligncenter')].map(el => ({
    tagName: el.tagName,
    className: el.className,
    text_head: (el.innerText || '').slice(0, 60),
    ...getStyle(el, 'float', 'margin', 'margin-left', 'margin-right', 'display', 'text-align'),
  }));

  return {
    container_selector: container.className || container.tagName,
    url: location.href,
    title: document.title,
    images,
    iframes,
    paragraphs,
    text_blocks,
    strongs,
    spans,
    aligns,
    html_snippet: container.outerHTML.slice(0, 8000),
  };
}
"""


SCROLL_AND_DECODE_JS = r"""
async () => {
  const step = () => new Promise(r => { window.scrollBy(0, 800); setTimeout(r, 150); });
  const maxSteps = Math.ceil(document.body.scrollHeight / 800) + 6;
  for (let i = 0; i < maxSteps; i++) await step();
  window.scrollTo(0, 0);
  const imgs = [...document.querySelectorAll('img')];
  await Promise.all(imgs.map(img => {
    if (img.loading === 'lazy') img.loading = 'eager';
    if (img.complete) return Promise.resolve();
    return new Promise(r => {
      img.addEventListener('load', r, { once: true });
      img.addEventListener('error', r, { once: true });
      setTimeout(r, 3000);
    });
  }));
  return true;
}
"""


async def snapshot_article(page, article, url_key="url"):
    from cdp import goto
    url = article[url_key]
    try:
        await goto(page, url)
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        await page.evaluate(SCROLL_AND_DECODE_JS)
        try:
            await page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
    except Exception as e:
        return {"error": f"goto failed: {e}", **article}
    try:
        snap = await page.evaluate(SNAPSHOT_JS)
        snap.update({"No": article["No"], "title": article["title"], "source_url": url})
        return snap
    except Exception as e:
        return {"error": f"evaluate failed: {e}", **article}


def parse_only(arg: str):
    """--only "1,3,4" → ["1","3","4"]"""
    if not arg:
        return None
    return [s.strip() for s in arg.split(",") if s.strip()]
