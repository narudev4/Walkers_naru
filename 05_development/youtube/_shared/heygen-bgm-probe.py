#!/usr/bin/env python3
"""HeyGen BGM UI 実機調査スクリプト（read-only / 一切クリックしない）

CDP 接続して create-v4 エディタタブから BGM 関連 UI のセレクタ候補を列挙する。
セレクタが特定できたら heygen-setup.py に Phase 3 として実装する。

Usage:
  python3 _shared/heygen-bgm-probe.py
"""

import asyncio
import json as _json
import os
import sys
import urllib.request

from playwright.async_api import async_playwright


def detect_cdp_url():
    for port in list(range(9222, 9231)) + [65300]:
        try:
            with urllib.request.urlopen(f"http://localhost:{port}/json", timeout=2) as r:
                pages = _json.loads(r.read())
                if any("create-v4" in (p.get("url", "") or "") for p in pages):
                    return f"http://localhost:{port}"
        except Exception:
            continue
    return None


async def main():
    cdp = detect_cdp_url()
    if not cdp:
        print("❌ CDP/HeyGen タブ未検出。先に Phase 0 を完了させてください。", flush=True)
        sys.exit(1)
    print(f"CDP: {cdp}", flush=True)

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(cdp)
        ctx = browser.contexts[0]
        page = next((pg for pg in ctx.pages if "create-v4" in pg.url), None)
        if page is None:
            print("❌ create-v4 タブ未検出", flush=True)
            return
        print(f"page.url = {page.url}", flush=True)

        # 画面全体のスクリーンショット
        out_dir = "/tmp/heygen-bgm-probe"
        os.makedirs(out_dir, exist_ok=True)
        await page.screenshot(path=f"{out_dir}/full.png", full_page=False)
        print(f"📸 {out_dir}/full.png", flush=True)

        # BGM 関連テキストを含む要素を網羅的に列挙
        keywords = [
            "Background Music", "Background music", "BGM",
            "Music", "music", "音楽",
            "Volume", "volume", "音量",
            "Loop", "loop",
            "Audio Track",
        ]
        results = await page.evaluate(
            """(keywords) => {
                const out = [];
                const all = document.querySelectorAll('button, a, [role="tab"], [role="menuitem"], div[class*="menu"], div[class*="sidebar"], span, label');
                for (const el of all) {
                    const t = (el.textContent || '').trim();
                    if (!t || t.length > 80) continue;
                    for (const kw of keywords) {
                        if (t.includes(kw)) {
                            const rect = el.getBoundingClientRect();
                            out.push({
                                tag: el.tagName.toLowerCase(),
                                role: el.getAttribute('role'),
                                cls: (el.className || '').toString().slice(0, 80),
                                text: t.slice(0, 60),
                                x: Math.round(rect.x), y: Math.round(rect.y),
                                w: Math.round(rect.width), h: Math.round(rect.height),
                                visible: rect.width > 0 && rect.height > 0,
                            });
                            break;
                        }
                    }
                }
                return out;
            }""",
            keywords,
        )

        print(f"\n=== BGMキーワードヒット: {len(results)}件 ===", flush=True)
        for i, r in enumerate(results[:50]):
            vis = "✓" if r["visible"] else "×"
            print(f"  [{i}] {vis} <{r['tag']}> {r['text']!r} @({r['x']},{r['y']}) {r['w']}x{r['h']} role={r['role']!r} cls={r['cls']!r}", flush=True)

        # 左メニュー / 上部メニュー / 右パネルの構造をざっと探索
        layout = await page.evaluate(
            """() => {
                const candidates = [
                    { name: 'left-sidebar', el: document.querySelector('aside, nav, [class*="sidebar"], [class*="LeftPanel"], [class*="menu-left"]') },
                    { name: 'top-bar', el: document.querySelector('header, [class*="topbar"], [class*="TopBar"], [class*="header"]') },
                    { name: 'right-panel', el: document.querySelector('[class*="RightPanel"], [class*="right-panel"], aside.right') },
                ];
                return candidates.filter(c => c.el).map(c => {
                    const r = c.el.getBoundingClientRect();
                    const buttons = Array.from(c.el.querySelectorAll('button')).slice(0, 30).map(b => (b.textContent||'').trim().slice(0,40)).filter(Boolean);
                    return { name: c.name, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), buttons };
                });
            }"""
        )
        print(f"\n=== レイアウトプローブ ===", flush=True)
        for layer in layout:
            print(f"  [{layer['name']}] @({layer['x']},{layer['y']}) {layer['w']}x{layer['h']}", flush=True)
            for b in layer["buttons"]:
                if b:
                    print(f"     · {b!r}", flush=True)

        # data-testid / aria-label の網羅
        attrs = await page.evaluate(
            """() => {
                const all = document.querySelectorAll('[data-testid], [aria-label]');
                const out = [];
                for (const el of all) {
                    const tid = el.getAttribute('data-testid');
                    const al = el.getAttribute('aria-label');
                    const v = tid || al || '';
                    if (!v) continue;
                    if (/music|bgm|volume|loop|audio|background/i.test(v)) {
                        const r = el.getBoundingClientRect();
                        out.push({
                            tag: el.tagName.toLowerCase(),
                            testid: tid, aria: al,
                            text: (el.textContent||'').trim().slice(0,40),
                            x: Math.round(r.x), y: Math.round(r.y),
                            visible: r.width > 0 && r.height > 0,
                        });
                    }
                }
                return out;
            }"""
        )
        print(f"\n=== data-testid / aria-label ヒット: {len(attrs)}件 ===", flush=True)
        for a in attrs[:30]:
            vis = "✓" if a["visible"] else "×"
            print(f"  {vis} <{a['tag']}> testid={a['testid']!r} aria={a['aria']!r} text={a['text']!r} @({a['x']},{a['y']})", flush=True)

        # 既知パターン: "Music" "Audio" を含むナビアイテム
        nav_items = await page.evaluate(
            """() => {
                const all = document.querySelectorAll('nav button, nav a, [class*="menu"] button, [class*="sidebar"] button');
                const out = [];
                for (const el of all) {
                    const t = (el.textContent||'').trim();
                    if (!t) continue;
                    const r = el.getBoundingClientRect();
                    if (r.width === 0) continue;
                    out.push({
                        text: t.slice(0,40),
                        x: Math.round(r.x), y: Math.round(r.y),
                        w: Math.round(r.width), h: Math.round(r.height),
                    });
                }
                return out.slice(0, 40);
            }"""
        )
        print(f"\n=== ナビアイテム一覧（左/サイドバーのbutton/aを縦に） ===", flush=True)
        for n in nav_items:
            print(f"  · {n['text']!r} @({n['x']},{n['y']}) {n['w']}x{n['h']}", flush=True)

        await browser.close()
        print(f"\n✓ 調査完了。スクリーンショット: {out_dir}/full.png", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
