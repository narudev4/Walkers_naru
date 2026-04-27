"""Shared helper: connect to the browser-use daemon Chrome on port 65300.

Why port 65300: `browser-use daemon --profile walker-s.co.jp` is running with
Profile 4 (walker-s.co.jp), which is already logged in to stg.croix.asia
WP admin. Profile 4 cookies are persisted on this Chrome instance.
"""
import asyncio
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

CDP_URL = "http://localhost:9222"


async def connect():
    """Return (playwright, browser, context, page) — caller awaits pw.stop()."""
    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp(CDP_URL)
    ctx = browser.contexts[0]
    # Prefer the most recent non-DevTools page
    pages = [p for p in ctx.pages if not p.url.startswith("devtools://")]
    if not pages:
        page = await ctx.new_page()
    else:
        page = pages[-1]
    return pw, browser, ctx, page


async def goto(page: Page, url: str):
    await page.goto(url, wait_until="domcontentloaded")
    await asyncio.sleep(1)


async def find_or_new_tab(ctx: BrowserContext, url_substring: str) -> Page:
    for p in ctx.pages:
        if url_substring in p.url:
            return p
    return await ctx.new_page()
