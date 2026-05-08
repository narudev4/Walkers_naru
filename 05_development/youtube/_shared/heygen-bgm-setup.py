#!/usr/bin/env python3
"""HeyGen BGM 設定 (Phase 3 相当・独立スクリプト)

`heygen-setup.py` の Phase 0+1+2 完了後（音声アップ + アバター配置済み）に
独立して実行する。設計方針は heygen-setup.py の編集を避けるため別ファイル化。

やること:
  1. 右サイドバー「ミュージック」アイコンをクリックして音楽パネル開く
     （既に panel=music の場合はスキップ）
  2. 「マイ ミュージック」タブをクリック
  3. timeline に Audiio*.wav が既にあれば 4 へ。無ければ:
     a. マイ ミュージック内に既存 Audiio*.wav トラックがあればクリック → timeline 追加
     b. 無ければ「音楽をアップロード」で assets/Audiio_本番用.wav をアップロード →
        track 出現を待って → クリック → timeline 追加 (fallback、2026-05-XX 追加)
  4. timeline 下部の audio bar を右クリック → context menu 出す
  5. Volume slider を 1% にドラッグ
  6. Loop music switch を ON にクリック
  7. menu は閉じない（naru が手動で生成ボタンを押す前に目視確認できるよう）

前提:
  - CDP Chrome (port 9222 等) で HeyGen create-v4 タブを開いている
  - assets/Audiio_本番用.wav が存在する（fallback アップロード用）
  - HeyGen マイ ミュージックは CDP Chrome 起動毎に空になる場合がある
    （Profile rsync の都合・サーバー側永続データへのアクセスが安定しない）

使い方:
  /Users/naru/.pyenv/versions/3.13.0/bin/python3 \\
    /Users/naru/Walkers_naru/05_development/youtube/_shared/heygen-bgm-setup.py
"""
import asyncio
import json as _json
import sys
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright


# ===== 定数 =====
TARGET_VOLUME = 0.01      # 1% (Volume slider の aria-valuemax=1 なので 0.01 = 1%)
VOLUME_TOLERANCE = 0.015  # ドラッグ後の許容誤差
BGM_FILE_PATH = "/Users/naru/Walkers_naru/05_development/youtube/assets/Audiio_本番用.wav"
UPLOAD_TIMEOUT_SEC = 180  # アップロード完了待ち最大秒数（17MB BGM で実機 30〜60s 程度・余裕を持って 3分）
PROCESSING_START_TIMEOUT_SEC = 10  # 「Upload processing」表示が出るまでの待ち
POST_PROCESSING_STABILIZE_SEC = 5  # processing 完了後の UI 安定待ち


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


async def find_my_music_track(page):
    """マイミュージック内の **完成済み** Audiio*.wav トラック行を検出。無ければ None。

    重要: track 行の textContent に「Upload processing / 処理中」が含まれている場合は
    processing 中の track なので除外する。click しても timeline に正しく追加されないため。
    完成済み track の text は典型的に「Audiio*.wav」+「1:26s」等の時刻表示のみ。

    クリック座標は **行の左寄り** (file 名の領域) を返す。中央や右寄りだと
    track 内の別ボタン (メニュー / 再生) をクリックしてしまうリスクあり。
    """
    return await page.evaluate(
        """() => {
            const candidates = [];
            for (const el of document.querySelectorAll('div, button')) {
                const t = (el.textContent || '').trim();
                if (!/Audiio_+\\.wav/.test(t)) continue;
                if (t.length >= 60) continue;
                // ★processing 中は除外
                if (/Upload\\s+processing|処理中/i.test(t)) continue;
                const r = el.getBoundingClientRect();
                // 行サイズの典型: width 200-400, height 30-60。それより小さい内側要素は除外
                if (r.x > 1100 && r.width > 200 && r.height > 28 && r.height < 80) {
                    candidates.push({
                        // 左寄り (file 名の領域) を狙う
                        cx: Math.round(r.x + Math.min(120, r.width * 0.3)),
                        cy: Math.round(r.y + r.height / 2),
                        w: Math.round(r.width), h: Math.round(r.height),
                    });
                }
            }
            // 最も小さい (= 個別トラック行 326x36 程度) を採用
            candidates.sort((a, b) => a.w * a.h - b.w * b.h);
            return candidates[0] || null;
        }"""
    )


async def is_upload_processing(page):
    """マイミュージック内に Upload processing 中の行があるか判定"""
    return await page.evaluate(
        """() => {
            for (const el of document.querySelectorAll('*')) {
                const t = (el.textContent || '').trim();
                if (t.length >= 80) continue;
                if (/Upload\\s+processing|処理中/i.test(t)) return true;
            }
            return false;
        }"""
    )


async def wait_for_upload_completion(page, timeout_sec=UPLOAD_TIMEOUT_SEC):
    """アップロードのライフサイクルを段階的に待つ。

    Phase A: 「Upload processing」表示が出るのを待つ（最大 PROCESSING_START_TIMEOUT_SEC 秒）
             ※ 即座に出ない場合 = ファイルが既に処理済 / 小さくて瞬時完了 のいずれか。スキップ可
    Phase B: 「Upload processing」表示が消えるのを待つ（最大 timeout_sec 秒）
             ※ 17MB BGM で実機 30〜60 秒程度
    Phase C: 完成済み track が出現するのを確認 + UI 安定待ち
             ※ processing 消失 → track 出現 → +N 秒の安定 wait

    ★罠: 単純な「processing が false かつ track 出現」poll は、processing 開始前に
          偶然 false を返すタイミングがあり、まだ送信完了前の状態で誤判定する。
          Phase A で必ず処理開始を確認することで誤判定を防ぐ。
    """
    # Phase A: processing 開始待ち
    print(f"  [wait] processing 開始待ち...", flush=True)
    processing_seen = False
    for i in range(PROCESSING_START_TIMEOUT_SEC):
        await asyncio.sleep(1)
        if await is_upload_processing(page):
            processing_seen = True
            print(f"  [wait] processing 開始確認 ({i + 1} 秒)", flush=True)
            break
    if not processing_seen:
        print(f"  [wait] processing 開始を {PROCESSING_START_TIMEOUT_SEC} 秒で確認できず（既に完了している可能性）", flush=True)

    # Phase B: processing 完了待ち
    if processing_seen:
        print(f"  [wait] processing 完了待ち...", flush=True)
        completed = False
        for i in range(timeout_sec):
            await asyncio.sleep(1)
            if not await is_upload_processing(page):
                print(f"  [wait] processing 完了 ({i + 1} 秒)", flush=True)
                completed = True
                break
        if not completed:
            raise RuntimeError(f"processing が {timeout_sec} 秒で完了しなかった")

    # Phase C: track 出現確認 + UI 安定
    print(f"  [wait] track 出現待ち + UI 安定 ({POST_PROCESSING_STABILIZE_SEC}秒)...", flush=True)
    for i in range(20):
        await asyncio.sleep(1)
        track = await find_my_music_track(page)
        if track:
            print(f"  [wait] track 出現 ({i + 1} 秒) → +{POST_PROCESSING_STABILIZE_SEC}秒安定待ち", flush=True)
            await asyncio.sleep(POST_PROCESSING_STABILIZE_SEC)
            return track
    raise RuntimeError("processing は完了したが track が 20 秒で出現せず")


async def upload_bgm_track(page, file_path):
    """マイミュージックが空のときに BGM ファイルをアップロード送信。

    送信のみ。完了待ちは wait_for_upload_completion に委譲。

    優先順 (learnings.md Section 2.7 と同じ二段フォールバック):
      パターン 1: input[type="file"][accept*="audio"] に set_input_files() (推奨)
      パターン 2: 「音楽をアップロード」ボタンクリック → FileChooser → set_files()
    """
    if not Path(file_path).exists():
        raise RuntimeError(f"BGM ファイルが存在しない: {file_path}")
    print(f"[3/6] マイミュージックが空 → {file_path} をアップロード", flush=True)

    # パターン 1: input[type=file] に直接 set
    audio_inputs = page.locator('input[type="file"][accept*="audio"]')
    n_inputs = await audio_inputs.count()
    uploaded = False
    if n_inputs > 0:
        try:
            await audio_inputs.first.set_input_files(file_path)
            uploaded = True
            print(f"[3/6] input[type=file][accept*=audio] に set_input_files() でアップロード送信", flush=True)
        except Exception as e:
            print(f"⚠ input 直接設定失敗 → FileChooser にフォールバック: {e}", flush=True)

    # パターン 2: ボタンクリック → FileChooser
    if not uploaded:
        upload_btn = page.locator('button:has-text("音楽をアップロード")')
        if await upload_btn.count() == 0:
            raise RuntimeError(
                "「音楽をアップロード」ボタンも audio 用 input[type=file] も見つからない。"
                "マイ ミュージック タブが正しく開いているか確認"
            )
        async with page.expect_file_chooser(timeout=10_000) as fc_info:
            await upload_btn.click()
        chooser = await fc_info.value
        await chooser.set_files(file_path)
        print(f"[3/6] FileChooser 経由でアップロード送信", flush=True)

    # 完了待ち
    print(f"[3/6] アップロード完了待ち (最大 {UPLOAD_TIMEOUT_SEC}秒)...", flush=True)
    return await wait_for_upload_completion(page)


async def select_or_upload_track(page):
    """マイミュージック内の Audiio*.wav を timeline に追加。

    分岐:
      A. 完成済み track あり → 即 click
      B. processing 中 track あり → 完了待ち → click（手動アップ等で processing 中の状態）
      C. 何も無い → upload → 完了待ち → click
    """
    track = await find_my_music_track(page)
    if track:
        print(f"[3/6] 既存 BGM トラック検出 @({track['cx']},{track['cy']})", flush=True)
    elif await is_upload_processing(page):
        print(f"[3/6] processing 中の track が既に存在 → 完了待ち", flush=True)
        track = await wait_for_upload_completion(page)
    else:
        track = await upload_bgm_track(page, BGM_FILE_PATH)

    print(f"[3/6] track をクリック ({track['cx']},{track['cy']}) → timeline 追加", flush=True)
    await page.mouse.click(track["cx"], track["cy"])
    # timeline 反映待ち
    for i in range(10):
        await asyncio.sleep(1)
        if await is_track_in_timeline(page):
            print(f"[3/6] BGM トラックを timeline に追加した ({i + 1} 秒)", flush=True)
            return
    raise RuntimeError("timeline に BGM が追加されなかった（10秒タイムアウト・クリック対象が違う?）")


async def find_audio_bar_position(page):
    """timeline 下部の audio bar の右クリック対象座標を返す。

    実装方針 (2026-05-08 改修):
      Pattern 1 (主軸): div.tw-left-0 直下の div.tw-z-10 で横長要素を探す。
        Chrome DevTools Recorder で記録された正解セレクタ (recording 2026-05-08)。
      Pattern 2 (fallback): tw-cursor-pointer クラスを持つ横長要素 (旧実装)。
        DOM 構造変化に備えて残す。

    クリック x 座標は **x >= 600 から狙う**:
      左側 (x=20-540 程度) に「シーンを追加」 button (tw-size-10) が overlay されており、
      z-index 的に button が前面 → x < 600 で右クリックすると button にヒットして
      context menu が出ない。bar は viewport の右側まで延びているので x=600 以降なら
      button 領域を避けつつ bar 領域内になる。

    過去の失敗 (〜2026-05-07):
      - `^Audiio_+\\.wav$` exact match で誤った親要素を取得
      - 「width 最大」だけでは z-index で隠れた position を返す
      - x=500 でも `tw-size-10` button (40x40) にヒット → x=600 まで上げて安定化
      - 2026-05-08: cursor-pointer 単独だと find できなくなる事象発生
        → recorder で確認した tw-left-0/tw-z-10 を主軸に変更
    """
    info = await page.evaluate(
        r"""() => {
            let best = null;

            // Pattern 1 (主軸・2026-05-08 recorder JSON で確認): div.tw-left-0 内の div.tw-z-10
            for (const container of document.querySelectorAll('div.tw-left-0')) {
                for (const el of container.querySelectorAll('div.tw-z-10')) {
                    const r = el.getBoundingClientRect();
                    if (r.y < 700 || r.y > 950) continue;
                    if (r.width < 400) continue;
                    if (r.height < 5 || r.height > 60) continue;
                    if (r.x > 1100) continue;
                    if (!best || r.width > best.w) {
                        best = {x: r.x, y: r.y, w: r.width, h: r.height, source: 'tw-left-0/tw-z-10'};
                    }
                }
            }

            // Pattern 2 (fallback・旧実装): cursor-pointer
            if (!best) {
                for (const el of document.querySelectorAll('*')) {
                    const cls = (el.className || '').toString();
                    if (!/cursor-pointer/.test(cls)) continue;
                    const r = el.getBoundingClientRect();
                    if (r.y < 800 || r.y > 950) continue;
                    if (r.width < 400) continue;
                    if (r.height < 5 || r.height > 60) continue;
                    if (r.x > 1100) continue;
                    if (!best || r.width > best.w) {
                        best = {x: r.x, y: r.y, w: r.width, h: r.height, source: 'cursor-pointer'};
                    }
                }
            }

            if (!best) return null;
            // 「シーンを追加」button (x=20-540 / tw-size-10) を避けて x>=600
            const target_x = Math.max(600, Math.min(1500, best.x + 350));
            return {
                cx: Math.round(target_x),
                cy: Math.round(best.y + best.h / 2),
                bar_x: Math.round(best.x),
                bar_y: Math.round(best.y),
                bar_w: Math.round(best.w),
                bar_h: Math.round(best.h),
                source: best.source,
            };
        }"""
    )
    if not info:
        raise RuntimeError("timeline の audio bar が見つからない (tw-left-0/tw-z-10 / cursor-pointer 共に)")
    print(f"  [bar] [{info['source']}] @({info['bar_x']},{info['bar_y']}) {info['bar_w']}x{info['bar_h']} → 右クリック ({info['cx']},{info['cy']})", flush=True)
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
            await select_or_upload_track(page)

        cx, cy = await find_audio_bar_position(page)
        await open_context_menu(page, cx, cy)
        await set_volume(page, TARGET_VOLUME)
        await turn_on_loop(page)

        print(f"\n✅ BGM 設定完了。menu 開いたまま終了します。", flush=True)
        print(f"   naru の確認後、生成ボタンを手動で押してください。", flush=True)
        # browser.close() を呼ばない方が menu が残る (Playwright は disconnect)


if __name__ == "__main__":
    asyncio.run(main())
