#!/usr/bin/env python3
"""既に投稿済みのトップコメントに対して pin_top_comment だけを試し、
途中でダイアログDOMもダンプする調査兼テストスクリプト。

前提: CDP:9222 で繋がるChromeに、固定したい動画ページが開いている。
"""
from __future__ import annotations

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

CDP_URL = "http://localhost:9222"


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(CDP_URL)
        ctx = browser.contexts[0]
        target = None
        for p in ctx.pages:
            if "youtube.com/watch" in p.url:
                target = p
                break
        if target is None:
            print("no youtube tab. open a watch page first.")
            return

        page = target
        print(f"url: {page.url}")
        page.bring_to_front()

        # 前回テストで開きっぱなしのメニューやダイアログを閉じる
        for _ in range(3):
            page.keyboard.press("Escape")
            page.wait_for_timeout(150)

        thread = page.locator("ytd-comment-thread-renderer").first
        thread.wait_for(state="visible", timeout=5000)
        thread.scroll_into_view_if_needed()
        page.wait_for_timeout(400)
        thread.hover()
        page.wait_for_timeout(400)

        menu_btn = thread.locator("#action-menu button").first
        menu_btn.wait_for(state="visible", timeout=5000)
        menu_btn.click()
        page.wait_for_timeout(800)

        # 「固定」クリック（popup 全件から has_text で絞る）
        pin_item = page.locator(
            "ytd-menu-popup-renderer [role='menuitem']"
        ).filter(has_text="固定").first
        pin_item.wait_for(state="visible", timeout=5000)
        print("clicking 固定 ...")
        pin_item.click()
        page.wait_for_timeout(1500)

        # 確認ダイアログDOMをダンプ
        print("\n--- dialog probe ---")
        for sel in [
            "yt-confirm-dialog-renderer",
            "tp-yt-paper-dialog",
            "ytd-popup-container yt-confirm-dialog-renderer",
            "ytd-popup-container tp-yt-paper-dialog",
        ]:
            loc = page.locator(sel)
            print(f"[{sel}] count={loc.count()}")

        dialog = page.locator("yt-confirm-dialog-renderer").last
        if dialog.count() > 0:
            try:
                print("dialog.inner_text:")
                print(dialog.inner_text(timeout=2000))
            except PWTimeout:
                print("(inner_text timeout)")
            # ダイアログ内のボタンを列挙
            for sel in ["button", "[role='button']", "yt-button-renderer", "#confirm-button button"]:
                loc = dialog.locator(sel)
                n = loc.count()
                print(f"  dialog[{sel}] count={n}")
                for i in range(min(n, 6)):
                    try:
                        txt = loc.nth(i).inner_text(timeout=1000).strip()
                    except Exception as e:  # noqa: BLE001
                        txt = f"(err {e})"
                    print(f"    [{i}] {txt!r}")


if __name__ == "__main__":
    main()
