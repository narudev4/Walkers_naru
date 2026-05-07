#!/usr/bin/env python3
"""HeyGen BGM 設定 (Phase 3 相当・独立スクリプト)

`heygen-setup.py` の Phase 0+1+2 完了後（音声アップ + アバター配置済み）に
独立して実行する。設計方針は heygen-setup.py の編集を避けるため別ファイル化。

やること:
  1. 右サイドバー「ミュージック」アイコンをクリックして音楽パネル開く
     （既に panel=music の場合はスキップ）
  2. 「マイ ミュージック」タブをクリック
  3. timeline に Audiio*.wav が既にあれば 4 へ。無ければ
     マイ ミュージック内の既存 Audiio*.wav トラックをクリックして
     timeline に追加する（無ければエラー停止 — 新規アップロードは未対応）
  4. timeline 下部の audio bar を右クリック → context menu 出す
  5. Volume slider を 1% にドラッグ
  6. Loop music switch を ON にクリック
  7. menu は閉じない（naru が手動で生成ボタンを押す前に目視確認できるよう）

前提:
  - CDP Chrome (port 9222 等) で HeyGen create-v4 タブを開いている
  - HeyGen の マイ ミュージック に Audiio*.wav トラックが永続保存されている
    （初回のみ手動アップロードが必要・以降はアカウント単位で残る仕様）

使い方:
  /Users/naru/.pyenv/versions/3.13.0/bin/python3 \\
    /Users/naru/Walkers_naru/05_development/youtube/_shared/heygen-bgm-setup.py
"""
import asyncio
import json as _json
import sys
import urllib.request

from playwright.async_api import async_playwright


# ===== 定数 =====
TARGET_VOLUME = 0.01      # 1% (Volume slider の aria-valuemax=1 なので 0.01 = 1%)
VOLUME_TOLERANCE = 0.015  # ドラッグ後の許容誤差


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


# ===== 状態判定 =====

async def is_track_in_timeline(page) -> bool:
    """timeline に Audiio*.wav が既に追加されているか"""
    return await page.evaluate(
        """() => {
            for (const el of document.querySelectorAll('div')) {
                const t = (el.textContent || '').trim();
                if (/^Audiio_+\\.wav$/.test(t)) {
                    const r = el.getBoundingClientRect();
                    if (r.y > 700 && r.x < 1000) return true;
                }
            }
            return false;
        }"""
    )


# ===== 各ステップ =====

async def open_music_panel(page):
    """右サイドバーの「ミュージック」アイコンをクリック"""
    if "?panel=music" in page.url:
        print("[1/6] 音楽パネルは既に開いてる", flush=True)
        return
    # 「音楽」ラベル付きのナビアイコンをクリック
    info = await page.evaluate(
        """() => {
            for (const el of document.querySelectorAll('span')) {
                const t = (el.textContent || '').trim();
                if (t === '音楽') {
                    const r = el.getBoundingClientRect();
                    // 右サイドバー内 (x > 1400)
                    if (r.x > 1400) {
                        return {
                            cx: Math.round(r.x + r.width / 2),
                            cy: Math.round(r.y + r.height / 2),
                        };
                    }
                }
            }
            return null;
        }"""
    )
    if not info:
        raise RuntimeError("「音楽」ナビアイコンが見つからない")
    await page.mouse.click(info["cx"], info["cy"])
    await asyncio.sleep(0.5)
    print(f"[1/6] 音楽パネル開いた", flush=True)


async def click_my_music_tab(page):
    """「マイ ミュージック」タブをクリック"""
    info = await page.evaluate(
        """() => {
            for (const el of document.querySelectorAll('button, [role="tab"], div')) {
                const t = (el.textContent || '').trim();
                if (t === 'マイ ミュージック' || t === 'マイミュージック') {
                    const r = el.getBoundingClientRect();
                    if (r.x > 1100 && r.width > 0 && r.width < 200) {
                        return {
                            cx: Math.round(r.x + r.width / 2),
                            cy: Math.round(r.y + r.height / 2),
                        };
                    }
                }
            }
            return null;
        }"""
    )
    if not info:
        raise RuntimeError("「マイ ミュージック」タブが見つからない")
    await page.mouse.click(info["cx"], info["cy"])
    await asyncio.sleep(0.4)
    print(f"[2/6] マイ ミュージック タブ切替", flush=True)


async def click_existing_track(page):
    """マイミュージック内の Audiio*.wav トラックをクリック → timeline に追加"""
    info = await page.evaluate(
        """() => {
            // 右パネル内 (x > 1100) の Audiio*.wav を含むクリック可能要素
            const candidates = [];
            for (const el of document.querySelectorAll('div, button')) {
                const t = (el.textContent || '').trim();
                if (/Audiio_+\\.wav/.test(t) && t.length < 60) {
                    const r = el.getBoundingClientRect();
                    if (r.x > 1100 && r.width > 100 && r.height > 20 && r.height < 80) {
                        candidates.push({
                            tag: el.tagName.toLowerCase(),
                            cls: (el.className || '').toString().slice(0, 80),
                            cx: Math.round(r.x + r.width / 2),
                            cy: Math.round(r.y + r.height / 2),
                            w: Math.round(r.width), h: Math.round(r.height),
                        });
                    }
                }
            }
            // 最も小さい (= 個別トラック行) を採用
            candidates.sort((a, b) => a.w * a.h - b.w * b.h);
            return candidates[0] || null;
        }"""
    )
    if not info:
        raise RuntimeError(
            "マイ ミュージックに Audiio*.wav トラックが見つからない。\n"
            "  HeyGen 側に永続トラックが保存されているか手動で確認してください。\n"
            "  （新規アップロードは本スクリプトの未対応範囲）"
        )
    print(f"[3/6] 既存 BGM トラック検出 @({info['cx']},{info['cy']}) → クリック", flush=True)
    await page.mouse.click(info["cx"], info["cy"])
    await asyncio.sleep(2.0)  # timeline への反映待ち
    # 反映確認
    if not await is_track_in_timeline(page):
        raise RuntimeError("timeline に BGM が追加されなかった（クリック失敗?）")
    print(f"[3/6] BGM トラックを timeline に追加した", flush=True)


async def find_audio_bar_position(page):
    """timeline 下部の audio bar の右クリック対象座標を返す"""
    info = await page.evaluate(
        """() => {
            for (const el of document.querySelectorAll('div')) {
                const t = (el.textContent || '').trim();
                if (/^Audiio_+\\.wav$/.test(t)) {
                    const r = el.getBoundingClientRect();
                    if (r.y > 700 && r.x < 1000) {
                        // 親辿って横長コンテナ
                        let cur = el;
                        for (let i = 0; i < 5; i++) {
                            if (!cur) break;
                            const cr = cur.getBoundingClientRect();
                            if (cr.width > 500 && cr.y > 700 && cr.height < 50) {
                                return {
                                    cx: Math.round(cr.x + Math.min(100, cr.width / 2)),
                                    cy: Math.round(cr.y + cr.height / 2),
                                };
                            }
                            cur = cur.parentElement;
                        }
                        return {
                            cx: Math.round(r.x + r.width / 2),
                            cy: Math.round(r.y + r.height / 2),
                        };
                    }
                }
            }
            return null;
        }"""
    )
    if not info:
        raise RuntimeError("timeline の audio bar が見つからない")
    return info["cx"], info["cy"]


async def open_context_menu(page, cx, cy):
    """audio bar を右クリックして context menu を開く"""
    await page.mouse.move(cx, cy)
    await asyncio.sleep(0.2)
    await page.mouse.click(cx, cy, button="right")
    await asyncio.sleep(0.7)
    # 出現確認
    visible = await page.evaluate(
        """() => {
            const els = document.querySelectorAll('[class*="stack-menu"], [role="menu"][data-radix-menu-content]');
            for (const e of els) {
                const r = e.getBoundingClientRect();
                if (r.width > 50 && r.height > 50) return true;
            }
            return false;
        }"""
    )
    if not visible:
        raise RuntimeError("context menu が開かなかった")
    print(f"[4/6] context menu 開いた @({cx},{cy})", flush=True)


async def set_volume(page, target=TARGET_VOLUME):
    """Volume slider を target (0-1) にドラッグ"""
    info = await page.evaluate(
        """() => {
            // valuemax=1 の slider が Volume (Fade in/out は valuemax=5)
            const s = document.querySelector('[role="slider"][aria-valuemax="1"]');
            if (!s) return null;
            const sr = s.getBoundingClientRect();
            // track（slider の祖先で w > 50, h < 30）
            let cur = s.parentElement;
            let trackRect = null;
            for (let i = 0; i < 6; i++) {
                if (!cur) break;
                const cr = cur.getBoundingClientRect();
                if (cr.width > 50 && cr.height < 30 && cr.width > (trackRect ? trackRect.width : 0)) {
                    trackRect = cr;
                }
                cur = cur.parentElement;
            }
            if (!trackRect) trackRect = sr;
            return {
                thumbX: Math.round(sr.x + sr.width / 2),
                thumbY: Math.round(sr.y + sr.height / 2),
                trackX: Math.round(trackRect.x),
                trackY: Math.round(trackRect.y + trackRect.height / 2),
                trackW: Math.round(trackRect.width),
                valueNow: parseFloat(s.getAttribute('aria-valuenow')),
            };
        }"""
    )
    if not info:
        raise RuntimeError("Volume slider が見つからない")
    print(f"[5/6] Volume slider 現在: {info['valueNow']:.2f} ({int(info['valueNow']*100)}%)", flush=True)

    target_x = info["trackX"] + info["trackW"] * target
    target_y = info["trackY"]

    # ドラッグ: thumb から target_x へ段階的に移動
    await page.mouse.move(info["thumbX"], info["thumbY"])
    await asyncio.sleep(0.1)
    await page.mouse.down()
    steps = 8
    for i in range(1, steps + 1):
        ix = info["thumbX"] + (target_x - info["thumbX"]) * i / steps
        await page.mouse.move(ix, target_y)
        await asyncio.sleep(0.04)
    await page.mouse.up()
    await asyncio.sleep(0.4)

    final = await page.evaluate(
        """() => {
            const s = document.querySelector('[role="slider"][aria-valuemax="1"]');
            return s ? parseFloat(s.getAttribute('aria-valuenow')) : null;
        }"""
    )
    if final is None:
        raise RuntimeError("Volume slider 値取得失敗")
    diff = abs(final - target)
    status = "✅" if diff <= VOLUME_TOLERANCE else "⚠"
    print(f"[5/6] Volume slider 設定後: {final:.4f} ({int(final*100)}%) {status} 差分 {diff:.4f}", flush=True)
    if diff > VOLUME_TOLERANCE:
        print(f"   target={target:.4f} 許容={VOLUME_TOLERANCE} 超過。再試行を検討", flush=True)


async def turn_on_loop(page):
    """Loop music switch を ON にする"""
    info = await page.evaluate(
        """() => {
            const s = document.querySelector('button[role="switch"][aria-checked]');
            if (!s) return null;
            const r = s.getBoundingClientRect();
            return {
                cx: Math.round(r.x + r.width / 2),
                cy: Math.round(r.y + r.height / 2),
                checked: s.getAttribute('aria-checked'),
            };
        }"""
    )
    if not info:
        raise RuntimeError("Loop music switch が見つからない")
    print(f"[6/6] Loop music switch 現在: aria-checked={info['checked']}", flush=True)
    if info["checked"] == "true":
        print(f"[6/6] Loop music は既に ON", flush=True)
        return
    await page.mouse.click(info["cx"], info["cy"])
    await asyncio.sleep(0.4)
    final = await page.evaluate(
        """() => {
            const s = document.querySelector('button[role="switch"][aria-checked]');
            return s ? s.getAttribute('aria-checked') : null;
        }"""
    )
    print(f"[6/6] Loop music switch 設定後: aria-checked={final}", flush=True)
    if final != "true":
        raise RuntimeError(f"Loop music を ON にできなかった (aria-checked={final})")


# ===== main =====

async def main():
    cdp = detect_cdp_url()
    if not cdp:
        print("❌ CDP/HeyGen タブ未検出 (port 9222 等で create-v4 タブが必要)", flush=True)
        sys.exit(1)
    print(f"CDP: {cdp}", flush=True)

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(cdp)
        ctx = browser.contexts[0]
        page = next((pg for pg in ctx.pages if "create-v4" in pg.url), None)
        if not page:
            print("❌ create-v4 タブが見つからない", flush=True)
            sys.exit(1)
        print(f"page.url = {page.url}", flush=True)

        # idempotent: timeline に既に track があれば 1-3 スキップ
        already_in_timeline = await is_track_in_timeline(page)
        if already_in_timeline:
            print(f"[skip 1-3] timeline に既に Audiio*.wav あり", flush=True)
        else:
            await open_music_panel(page)
            await click_my_music_tab(page)
            await click_existing_track(page)

        cx, cy = await find_audio_bar_position(page)
        await open_context_menu(page, cx, cy)
        await set_volume(page, TARGET_VOLUME)
        await turn_on_loop(page)

        print(f"\n✅ BGM 設定完了。menu 開いたまま終了します。", flush=True)
        print(f"   naru の確認後、生成ボタンを手動で押してください。", flush=True)
        # browser.close() を呼ばない方が menu が残る (Playwright は disconnect)


if __name__ == "__main__":
    asyncio.run(main())
