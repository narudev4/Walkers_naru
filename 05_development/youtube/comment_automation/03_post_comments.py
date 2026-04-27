#!/usr/bin/env python3
"""Phase C: YouTube 動画ページでコメント投稿+固定を自動実行。

前提:
- chrome-cdp-launcher.sh start で Profile 4（walker-s.co.jp）の Chrome を
  CDP:9222 で起動済み
- そのChromeで @walkers-development のチャンネル所有者としてログイン済み

入力:
- data/sheet_rows.json (02_to_sheet.py の出力)
  status が "pending" の行だけ処理

出力:
- data/run_log.jsonl （逐次追記、1動画1行）
- 処理結果を標準出力に進捗表示
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from playwright.sync_api import (
    Browser,
    Page,
    Playwright,
    TimeoutError as PWTimeout,
    sync_playwright,
)

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
ROWS_JSON = DATA_DIR / "sheet_rows.json"
RUN_LOG = DATA_DIR / "run_log.jsonl"

CDP_URL = "http://localhost:9222"
SIGNATURE_SUBSTRING = "▼無料相談はこちらから▼"

# ---- タイムアウトなど定数 ----
COMMENTS_SCROLL_TIMEOUT = 15000  # ms
ELEMENT_TIMEOUT = 10000  # ms
BETWEEN_VIDEOS_SLEEP = 6.0  # sec
POST_ACTION_SLEEP = 1.2  # sec


def log_run(entry: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    entry["ts"] = datetime.now().isoformat(timespec="seconds")
    with RUN_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def already_processed(video_id: str) -> bool:
    if not RUN_LOG.exists():
        return False
    for line in RUN_LOG.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("video_id") == video_id and rec.get("status") in (
            "pinned_and_posted",
            "posted_toc_only",
        ):
            return True
    return False


def connect_browser(pw: Playwright) -> Browser:
    return pw.chromium.connect_over_cdp(CDP_URL)


def get_or_create_page(browser: Browser) -> Page:
    # 既存コンテキストを使い回す（認証セッションを維持）
    contexts = browser.contexts
    if not contexts:
        context = browser.new_context()
    else:
        context = contexts[0]
    pages = context.pages
    if pages:
        # 空のタブがあれば使う、なければ新規
        for p in pages:
            if p.url in ("about:blank", "chrome://newtab/"):
                return p
    return context.new_page()


def scroll_to_load_comments(page: Page) -> None:
    """コメント欄をロードするためにスクロール。YTはlazyload。"""
    # ヘッダーが邪魔になりすぎないよう中間まで
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(1500)
    # 動画説明欄の下までスクロール
    page.mouse.wheel(0, 1200)
    page.wait_for_timeout(800)
    page.mouse.wheel(0, 1500)
    page.wait_for_timeout(800)
    # コメント欄領域を探す
    try:
        page.wait_for_selector(
            "ytd-comments #sections, ytd-comments ytd-comments-header-renderer",
            timeout=COMMENTS_SCROLL_TIMEOUT,
        )
    except PWTimeout:
        # コメント無効の可能性
        raise RuntimeError("comments_not_available")


def check_signature_in_dom(page: Page) -> bool:
    """既に「▼無料相談はこちらから▼」を含むコメントがあるか、可視範囲で確認。

    重い処理なので、API判定が信用できない時のフォールバック的用途。
    """
    # コメント全件は見ない。上位30件程度を確認
    try:
        page.wait_for_selector("ytd-comment-thread-renderer #content-text", timeout=5000)
    except PWTimeout:
        return False
    contents = page.locator("ytd-comment-thread-renderer #content-text").all_text_contents()
    return any(SIGNATURE_SUBSTRING in c for c in contents[:30])


def _find_role_button(scope, name_candidates: list[str]):
    """role=button で name が候補のいずれかに一致するもののLocatorを返す。

    scope は Page または Locator（検索範囲を絞るために必ず指定する）。
    ページ全体を渡すと `並び替え` 等の無関係ボタンを拾う事故が起きる。
    """
    for name in name_candidates:
        loc = scope.get_by_role("button", name=name, exact=False)
        if loc.count() > 0:
            return loc.first
    return None


def click_comment_box(page: Page) -> None:
    """コメント入力欄のプレースホルダをクリックしてテキストエリアを表示。"""
    placeholder = page.locator("ytd-comment-simplebox-renderer #simplebox-placeholder")
    if placeholder.count() == 0:
        placeholder = page.locator(
            "ytd-comments ytd-comment-simplebox-renderer"
        )
    placeholder.first.scroll_into_view_if_needed()
    placeholder.first.click()
    page.wait_for_timeout(500)


def type_and_submit(page: Page, text: str) -> None:
    """コメント入力 → 送信ボタンクリック。"""
    commentbox = page.locator("ytd-commentbox").first
    editor = commentbox.locator(
        "#contenteditable-root[contenteditable='true']"
    )
    editor.wait_for(state="visible", timeout=ELEMENT_TIMEOUT)
    editor.click()
    page.wait_for_timeout(200)
    page.keyboard.press("Control+A")
    page.keyboard.press("Delete")
    editor.type(text, delay=4)
    page.wait_for_timeout(400)

    # 送信ボタンは必ず ytd-commentbox 配下から探す。
    # ページ全体を探すと "並び替え" 等の無関係ボタンを誤クリックする。
    submit = commentbox.locator("#submit-button button").first
    try:
        submit.wait_for(state="visible", timeout=ELEMENT_TIMEOUT)
    except PWTimeout:
        fallback = _find_role_button(
            commentbox, ["コメント", "Comment", "返信", "Reply"]
        )
        if fallback is None:
            raise
        submit = fallback
    submit.click()
    page.wait_for_timeout(2500)  # 投稿反映


def find_my_top_comment(page: Page):
    """最上部のコメントスレッドロケータを返す（投稿直後は最新が先頭）。"""
    thread = page.locator("ytd-comment-thread-renderer").first
    thread.wait_for(state="visible", timeout=ELEMENT_TIMEOUT)
    return thread


def pin_top_comment(page: Page) -> None:
    """最上部のコメントを固定する。"""
    thread = find_my_top_comment(page)
    thread.scroll_into_view_if_needed()
    page.wait_for_timeout(300)

    # 3点メニュー（#action-menu の下の button）
    menu_btn = thread.locator("#action-menu button").first
    # hover で表示させる（通常のコメントでは hover で action-menu が出る）
    thread.hover()
    page.wait_for_timeout(300)
    menu_btn.wait_for(state="visible", timeout=ELEMENT_TIMEOUT)
    menu_btn.click()
    page.wait_for_timeout(500)

    # メニュー内の「固定」項目を探す。
    # 現在のYouTube UIは role="menuitem" ベース（ytd-menu-service-item-renderer は使われない）。
    # ytd-menu-popup-renderer は「並び替え」メニュー等でも使われるため、
    # popup を .last や .first で絞らず、全件から has_text="固定" でフィルタする。
    pin_item = page.locator(
        "ytd-menu-popup-renderer [role='menuitem']"
    ).filter(has_text="固定").first
    try:
        pin_item.wait_for(state="visible", timeout=ELEMENT_TIMEOUT)
    except PWTimeout:
        pin_item = page.locator(
            "ytd-menu-popup-renderer [role='menuitem']"
        ).filter(has_text="Pin").first
        pin_item.wait_for(state="visible", timeout=ELEMENT_TIMEOUT)
    pin_item.click()
    page.wait_for_timeout(500)

    # 確認ダイアログ (yt-confirm-dialog-renderer) の「固定」ボタンを
    # ダイアログスコープ内で探す。ページ全体を検索すると hover 状態の
    # 3点メニューや他UI要素を拾う事故が起きる。
    dialog = page.locator("yt-confirm-dialog-renderer").first
    dialog.wait_for(state="visible", timeout=ELEMENT_TIMEOUT)
    confirm = _find_role_button(dialog, ["固定", "Pin", "PIN"])
    if confirm is None:
        confirm = dialog.locator("#confirm-button button").first
    confirm.wait_for(state="visible", timeout=ELEMENT_TIMEOUT)
    confirm.click()
    page.wait_for_timeout(1500)


def process_one(page: Page, row: dict, intro_comment: str) -> dict:
    vid = row["video_id"]
    url = row["video_url"]
    toc = row["toc_comment"]

    print(f"  → open {url}")
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    try:
        scroll_to_load_comments(page)
    except RuntimeError as e:
        return {"video_id": vid, "status": f"failed:{e}"}

    # DOMレベルで再チェック（API判定の取りこぼしを拾う）
    if check_signature_in_dom(page):
        return {"video_id": vid, "status": "skipped_already_commented_dom"}

    try:
        click_comment_box(page)
        type_and_submit(page, intro_comment)
        time.sleep(POST_ACTION_SLEEP)

        pin_top_comment(page)
        time.sleep(POST_ACTION_SLEEP)
    except Exception as e:  # noqa: BLE001
        return {"video_id": vid, "status": f"failed_intro:{type(e).__name__}:{e}"[:300]}

    status = "pinned_and_posted"

    if toc.strip():
        try:
            # 目次コメントを投稿（固定しない）
            # コメント入力欄は投稿後に再度現れるはず
            page.wait_for_timeout(800)
            click_comment_box(page)
            type_and_submit(page, toc)
            time.sleep(POST_ACTION_SLEEP)
        except Exception as e:  # noqa: BLE001
            return {
                "video_id": vid,
                "status": f"{status}_but_toc_failed:{type(e).__name__}:{e}"[:300],
            }
    else:
        status = "posted_intro_pinned_toc_empty"

    return {"video_id": vid, "status": status}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="先頭N本だけ処理")
    parser.add_argument(
        "--video-id", action="append", default=None, help="指定IDだけ処理（複数可）"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="何も投稿せずログだけ"
    )
    args = parser.parse_args()

    if not ROWS_JSON.exists():
        sys.exit(f"ERROR: {ROWS_JSON} が無い。先に 02_to_sheet.py を実行してください。")

    data = json.loads(ROWS_JSON.read_text(encoding="utf-8"))
    headers = data["headers"]
    rows = data["rows"]
    intro_comment = data["intro_comment"]

    col = {h: i for i, h in enumerate(headers)}

    targets: list[dict] = []
    for r in rows:
        vid = r[col["video_id"]]
        status = r[col["status"]]
        if status != "pending":
            continue
        if args.video_id and vid not in args.video_id:
            continue
        if already_processed(vid):
            continue
        targets.append(
            {
                "video_id": vid,
                "video_url": r[col["video_url"]],
                "title": r[col["title"]],
                "toc_comment": r[col["toc_comment"]],
            }
        )

    if args.limit:
        targets = targets[: args.limit]

    print(f"▶ 処理対象: {len(targets)}本 (dry_run={args.dry_run})")
    if not targets:
        print("  何もする必要がありません。")
        return

    with sync_playwright() as pw:
        browser = connect_browser(pw)
        page = get_or_create_page(browser)

        for idx, t in enumerate(targets, 1):
            print(f"[{idx}/{len(targets)}] {t['video_id']} {t['title'][:50]}")
            if args.dry_run:
                log_run({"video_id": t["video_id"], "status": "dry_run"})
                continue
            try:
                result = process_one(page, t, intro_comment)
            except Exception as e:  # noqa: BLE001
                result = {"video_id": t["video_id"], "status": f"fatal:{type(e).__name__}:{e}"[:300]}
            result["title"] = t["title"]
            log_run(result)
            print(f"   → {result['status']}")
            time.sleep(BETWEEN_VIDEOS_SLEEP)

    print(f"\n✅ 完了 / ログ: {RUN_LOG}")


if __name__ == "__main__":
    main()
