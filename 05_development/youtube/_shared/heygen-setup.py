#!/usr/bin/env python3
"""
HeyGen セットアップ: PPTXアップロード + 音声アップロード + アバター配置 統合スクリプト

使い方:
  # 作業ディレクトリ: 05_development/youtube/
  # Phase 0: PPTXアップロード（ドラフト作成）
  HEYGEN_SLUG=bubble-matchingapp-case HEYGEN_PPTX_PATH=projects/bubble-matchingapp-case/slides.pptx python3 _shared/heygen-setup.py

  # Phase 1+2: 音声アップ + アバター配置（従来通り）
  HEYGEN_SLUG=what-is-make python3 _shared/heygen-setup.py

環境変数:
  HEYGEN_SLUG      : 動画スラッグ（必須, 例: what-is-make）
  HEYGEN_PPTX_PATH : PPTXファイルのパス（設定時のみPhase 0実行→停止）
  HEYGEN_START     : 開始シーン番号（デフォルト: 1）
  HEYGEN_END       : 終了シーン番号（デフォルト: 全シーン）
  HEYGEN_DRY       : "1" でドライラン（操作せず確認のみ）

前提:
  - 全Phase共通: CDP Chrome が http://localhost:9222 で起動中（HeyGenにログイン済み）
    ※ 非標準ポートの場合は HEYGEN_CDP_URL=http://localhost:<port> で指定
  - Phase 0: ppt-to-video ページ or HeyGen内の任意ページが開いていれば自動遷移
  - Phase 1+2: HeyGenエディタ（create-v4）が開かれていること（Phase 0完了後の状態）
               projects/{slug}/audio/scenes/sceneNN_*.wav が存在すること
"""

import asyncio
import glob
import json
import math
import os
import re
import subprocess
import sys
import time as _time
import urllib.request
import urllib.error
from playwright.async_api import async_playwright

# === 設定 ===
BASE_DIR = "/Users/naru/Walkers_naru/05_development/youtube/projects"


CDP_LAUNCHER = "/Users/naru/Walkers_naru/05_development/scripts/chrome-cdp-launcher.sh"


def _probe_cdp_ports():
    """全候補ポートを走査しCDPエンドポイントを返す。HeyGenページあり優先、次にfallback。"""
    candidates = list(range(9222, 9231)) + [65300]
    fallback = None
    for port in candidates:
        try:
            req = urllib.request.Request(f"http://localhost:{port}/json", method="GET")
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status == 200:
                    import json as _json
                    pages = _json.loads(resp.read())
                    has_heygen = any("create-v4" in (p.get("url", "") or "") for p in pages)
                    if has_heygen:
                        return port, True
                    if fallback is None:
                        fallback = port
        except (urllib.error.URLError, OSError):
            continue
    return fallback, False


def _launch_cdp_chrome():
    """chrome-cdp-launcher.sh start を呼び出してCDP Chromeを起動する。"""
    import subprocess
    if not os.path.exists(CDP_LAUNCHER):
        print(f"⚠️ CDPランチャーが見つかりません: {CDP_LAUNCHER}", flush=True)
        return False
    print(f"CDP Chrome未起動 → {CDP_LAUNCHER} start で起動中...", flush=True)
    try:
        res = subprocess.run([CDP_LAUNCHER, "start"], timeout=30, capture_output=True, text=True)
        if res.stdout:
            for line in res.stdout.strip().splitlines():
                print(f"  [launcher] {line}", flush=True)
        if res.returncode != 0:
            print(f"⚠️ ランチャー失敗 (exit {res.returncode}): {res.stderr.strip()[:200]}", flush=True)
            return False
        return True
    except Exception as e:
        print(f"⚠️ ランチャー起動エラー: {e}", flush=True)
        return False


def detect_cdp_url():
    """CDP Chromeのポートを自動検出する。未起動ならchrome-cdp-launcher.shで起動する。"""
    cdp_env = os.environ.get("HEYGEN_CDP_URL", "")
    if cdp_env:
        return cdp_env

    port, has_heygen = _probe_cdp_ports()
    if port and has_heygen:
        print(f"CDP検出: localhost:{port} (HeyGenページあり)", flush=True)
        return f"http://localhost:{port}"
    if port:
        print(f"CDP検出: localhost:{port} (HeyGenページなし — 要確認)", flush=True)
        return f"http://localhost:{port}"

    # どのポートでも応答なし → 自動起動
    if os.environ.get("HEYGEN_NO_AUTOLAUNCH", "0") != "1":
        if _launch_cdp_chrome():
            # 起動後もう一度走査（最大15秒）
            import time as _t
            deadline = _t.time() + 15
            while _t.time() < deadline:
                port, has_heygen = _probe_cdp_ports()
                if port:
                    tag = "HeyGenページあり" if has_heygen else "起動直後"
                    print(f"CDP検出: localhost:{port} ({tag})", flush=True)
                    return f"http://localhost:{port}"
                _t.sleep(1.0)

    print("⚠️ CDPポート未検出。デフォルト9222を使用。", flush=True)
    return "http://localhost:9222"


CDP_URL = detect_cdp_url()

SLUG = os.environ.get("HEYGEN_SLUG", "")
PPTX_PATH = os.environ.get("HEYGEN_PPTX_PATH", "")
START_SCENE = int(os.environ.get("HEYGEN_START", "1"))
END_SCENE_ENV = int(os.environ.get("HEYGEN_END", "0"))  # 0 = 全シーン
DRY_RUN = os.environ.get("HEYGEN_DRY", "0") == "1"
VERIFY_MODE = os.environ.get("HEYGEN_VERIFY", "0") == "1"
VERIFY_VISUAL = os.environ.get("HEYGEN_VERIFY_VISUAL", "0") == "1"

# claude CLI パス（視覚検証で使用）
CLAUDE_BIN = "/opt/homebrew/bin/claude"

# フィルムストリップ定数
SCROLL_WIDTH = 5632
CLIENT_WIDTH = 704


# ===== ファイル管理 =====

def find_audio_files(slug):
    audio_dir = f"{BASE_DIR}/{slug}/audio/scenes"
    files = sorted(glob.glob(f"{audio_dir}/scene*.wav"))
    return files


def load_progress(slug):
    path = f"{BASE_DIR}/{slug}/heygen-setup-progress.json"
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {"completed": [], "failed": [], "verified": {}, "healed": [], "status": "new"}


def save_progress(slug, progress):
    path = f"{BASE_DIR}/{slug}/heygen-setup-progress.json"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(progress, f, indent=2, ensure_ascii=False)


# ===== PIDロック（二重起動防止）=====

def _lock_path():
    return f"{BASE_DIR}/{SLUG}/heygen-setup.lock"


def acquire_lock():
    """プロセスロックを取得。別プロセスが実行中なら即終了。"""
    lp = _lock_path()
    if os.path.exists(lp):
        try:
            with open(lp) as f:
                info = json.load(f)
            pid = info.get("pid")
            if pid:
                try:
                    os.kill(pid, 0)  # プロセス生存チェック（シグナル送信なし）
                    print(f"❌ 別プロセス(PID {pid})が実行中。先にkillしてください。", flush=True)
                    print(f"   kill {pid} && rm {lp}", flush=True)
                    sys.exit(1)
                except OSError:
                    pass  # 既に終了したプロセスのstale lock → 上書きOK
        except (json.JSONDecodeError, KeyError):
            pass  # 壊れたロックファイル → 上書きOK

    os.makedirs(os.path.dirname(lp), exist_ok=True)
    with open(lp, "w") as f:
        json.dump({
            "pid": os.getpid(),
            "slug": SLUG,
            "started_at": _time.strftime("%Y-%m-%d %H:%M:%S"),
        }, f, indent=2)
    print(f"🔒 PIDロック取得 (PID {os.getpid()})", flush=True)


def release_lock():
    """プロセスロックを解放。"""
    lp = _lock_path()
    if os.path.exists(lp):
        try:
            with open(lp) as f:
                info = json.load(f)
            if info.get("pid") == os.getpid():
                os.remove(lp)
                print(f"🔓 PIDロック解放", flush=True)
        except Exception:
            pass


# ===== モーダルdismiss =====

async def dismiss_modals(page):
    """rc-dialog-wrapなどのモーダルを閉じる。シーン処理前に毎回呼ぶ。
    注意: 'Go Back'は押さない（エディタから離脱してしまう）。
    ロックモーダルは display:none で非表示にする。
    """
    has_modal = await page.evaluate('''() => {
        const wrap = document.querySelector('.rc-dialog-wrap');
        return wrap && wrap.offsetParent !== null;
    }''')
    if not has_modal:
        return False

    # モーダルのテキストを確認
    modal_text = await page.evaluate('''() => {
        const wrap = document.querySelector('.rc-dialog-wrap');
        return wrap ? wrap.textContent.substring(0, 200) : '';
    }''')
    print(f"  [modal] 検出: {modal_text[:60]}...", flush=True)

    # ロックモーダル（"draft is being edited"）→ display:noneで非表示化
    if "being edited" in modal_text or "編集中" in modal_text:
        await page.evaluate('''() => {
            document.querySelectorAll('.rc-dialog-wrap').forEach(el => {
                el.style.display = 'none';
            });
            // 背後のマスクも消す
            document.querySelectorAll('.rc-dialog-mask').forEach(el => {
                el.style.display = 'none';
            });
        }''')
        print(f"  [modal] ロックモーダルを非表示化しました", flush=True)
        await asyncio.sleep(0.5)
        return True

    # その他のモーダル → Escapeで閉じる
    await page.keyboard.press("Escape")
    await asyncio.sleep(0.5)
    print(f"  [modal] Escapeで閉じました", flush=True)
    return True


# ===== シーンナビゲーション =====

async def click_first_scene(page):
    """タイムラインの最初のサムネをクリックし、そのscene IDを返す（失敗時None）"""
    # タイムラインの scrollable コンテナを左端にスクロール
    await page.evaluate("""() => {
        const item = document.querySelector('[data-scene-item]');
        if (!item) return;
        let el = item.parentElement;
        while (el) {
            if (el.scrollWidth > el.clientWidth + 10) { el.scrollLeft = 0; break; }
            el = el.parentElement;
        }
    }""")
    await asyncio.sleep(0.8)
    # 一番左のサムネをクリックしてIDを返す
    scene_id = await page.evaluate("""() => {
        const items = [...document.querySelectorAll('[data-scene-item]')];
        if (!items.length) return null;
        items.sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
        items[0].click();
        return items[0].getAttribute('data-scene-id');
    }""")
    await asyncio.sleep(2.0)
    return scene_id


async def click_next_scene(page, current_scene_id):
    """current_scene_id の右隣のサムネをクリックして、新しいシーンIDを返す"""
    for attempt in range(3):
        result = await page.evaluate(f"""() => {{
            const items = [...document.querySelectorAll('[data-scene-item]')];
            items.sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);

            // 現在のシーンIDを探す
            const curIdx = items.findIndex(el => el.getAttribute('data-scene-id') === '{current_scene_id}');
            if (curIdx < 0) return {{ok: false, reason: 'current not found'}};

            const nextIdx = curIdx + 1;
            if (nextIdx >= items.length) {{
                // 次が画面外 → タイムラインをスクロール
                let container = items[0].parentElement;
                while (container) {{
                    if (container.scrollWidth > container.clientWidth + 10) {{
                        container.scrollLeft += 150;
                        break;
                    }}
                    container = container.parentElement;
                }}
                return {{ok: false, reason: 'scrolled'}};
            }}
            const nextId = items[nextIdx].getAttribute('data-scene-id');
            items[nextIdx].scrollIntoView({{inline: 'center'}});
            items[nextIdx].click();
            return {{ok: true, nextId: nextId}};
        }}""")

        if result.get('ok'):
            await asyncio.sleep(2.0)
            return result.get('nextId')

        # スクロールしたのでリトライ
        await asyncio.sleep(0.8)

    return None


async def get_current_scene_id(page):
    """タイムラインから最初のdata-scene-itemのIDを返す（フォールバック用）"""
    return await page.evaluate("""() => {
        const items = [...document.querySelectorAll('[data-scene-item]')];
        items.sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
        return items.length > 0 ? items[0].getAttribute('data-scene-id') : null;
    }""")


# ===== 音声アップロード =====

async def _read_right_panel_scene_num(page):
    return await page.evaluate("""() => {
        for (const el of document.querySelectorAll('*')) {
            const t = el.textContent.trim();
            const r = el.getBoundingClientRect();
            if (r.x > 1200 && r.width < 400 && r.height < 50) {
                const m = t.match(/(?:シーン|Scene)\\s*(\\d+)/i);
                if (m && parseInt(m[1]) > 0) return parseInt(m[1]);
            }
        }
        return null;
    }""")


async def click_next_unprocessed_script(page, expected_num=None):
    """左パネルで指定シーン(expected_num)の行をクリックする。

    各行の左端にあるシーン番号 span (w≈20, text="N") を直接検索してクリック。
    初回は左パネルコンテナを scrollTop=0 にリセットし、見つからなければ下へ
    スクロールしながら探索する。

    戻り値: (True, heygen_scene_num) or (False, None)
    """
    # 初回: 左パネルコンテナを scrollTop=0 にリセット
    await page.evaluate("""() => {
        const divs = [...document.querySelectorAll("div")];
        const container = divs.find(d => {
            const r = d.getBoundingClientRect();
            return r.x < 30 && r.width > 300 && r.width < 700 && d.scrollHeight > d.clientHeight + 50;
        });
        if (container) container.scrollTop = 0;
    }""")
    await asyncio.sleep(0.6)

    for attempt in range(30):
        result = await page.evaluate(f"""() => {{
            const vh = window.innerHeight;
            const numStr = "{expected_num}";
            const divs = [...document.querySelectorAll("div")];
            const container = divs.find(d => {{
                const r = d.getBoundingClientRect();
                return r.x < 30 && r.width > 300 && r.width < 700 && d.scrollHeight > d.clientHeight + 50;
            }});

            // 行左端のシーン番号 span を検索
            for (const s of document.querySelectorAll("span")) {{
                if (s.textContent.trim() !== numStr) continue;
                const r = s.getBoundingClientRect();
                if (r.x > 30 || r.width > 40 || r.width < 8) continue;
                if (r.height < 10 || r.height > 40) continue;
                if (r.y < 60 || r.y > vh - 60) continue;
                // 行の中心（x=240付近）をクリック対象とする
                return {{found: true, x: Math.round(r.x + 240), y: Math.round(r.y + r.height/2),
                        numX: Math.round(r.x), numY: Math.round(r.y), numW: Math.round(r.width)}};
            }}

            // 見つからなければスクロールダウン
            if (container) {{
                const maxScroll = container.scrollHeight - container.clientHeight;
                if (container.scrollTop < maxScroll - 5) {{
                    container.scrollTop += 400;
                    return {{scrolled: true, top: Math.round(container.scrollTop)}};
                }}
                return {{exhausted: true, top: Math.round(container.scrollTop), max: Math.round(maxScroll)}};
            }}
            return {{exhausted: true}};
        }}""")

        if not result:
            break

        if result.get('found'):
            click_y = result['y']
            print(f"  [nav] シーン{expected_num}番号ヒット y={click_y} (numX={result.get('numX')} w={result.get('numW')})", flush=True)
            await page.mouse.click(result['x'], click_y)
            await asyncio.sleep(0.3)

            # 右パネルのシーン番号をポーリング（最大6秒）
            heygen_num = None
            deadline = asyncio.get_event_loop().time() + 6.0
            while asyncio.get_event_loop().time() < deadline:
                await asyncio.sleep(0.4)
                heygen_num = await _read_right_panel_scene_num(page)
                if heygen_num == expected_num:
                    break

            if heygen_num == expected_num:
                print(f"  [nav] HeyGenシーン{heygen_num}に移動 ✓", flush=True)
                return True, heygen_num
            print(f"  [nav] 期待{expected_num} ≠ 実際{heygen_num} — リトライ", flush=True)
            await asyncio.sleep(0.5)
            continue

        if result.get('scrolled'):
            await asyncio.sleep(0.5)
            continue

        if result.get('exhausted'):
            print(f"  [nav] スクロール末端 (top={result.get('top')}/{result.get('max')}) — シーン{expected_num}未検出", flush=True)
            break

        break

    print(f"  [nav] 未処理シーンが見つかりません (期待値={expected_num})", flush=True)
    return False, None


async def click_scene_script(page, scene_num):
    """左パネルでシーンNのスクリプト入力行をクリック。"""
    # 番号検索でスクロール+クリック（回数制限: 末尾の誤操作防止）
    # scene01, scene02... 形式のファイル名を検索（HeyGen PPTアップ時のUI対応）
    scene_prefix = f"scene{scene_num:02d}"
    for scroll_try in range(25):
        result = await page.evaluate(f"""() => {{
            const divs = [...document.querySelectorAll("div")];
            const numStr = "{scene_num}";
            const scenePrefix = "{scene_prefix}";

            const container = divs.find(d => {{
                const r = d.getBoundingClientRect();
                return r.x < 30 && r.width > 300 && r.width < 700 && d.scrollHeight > d.clientHeight + 50;
            }});

            for (const d of divs) {{
                const t = d.textContent.trim();
                const r = d.getBoundingClientRect();
                if (r.x >= 10 && r.x < 80 && r.width > 300 && r.height > 15 && r.height < 100
                    && r.y > 50 && r.y < 850) {{
                    // sceneNN_ 形式にマッチ（PPTアップロード時のファイル名）
                    if (t.startsWith(scenePrefix)) {{
                        return {{found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)}};
                    }}
                    // 従来の番号プレフィックス形式にもフォールバック
                    if (t.startsWith(numStr)) {{
                        const nextChar = t.charAt(numStr.length);
                        if (nextChar >= "0" && nextChar <= "9") continue;
                        return {{found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)}};
                    }}
                    // シーン1がアクティブ状態（拡張プレースホルダー h≈64）: "音声をアップロード"を含む最初の行
                    if (numStr === "1" && r.y < 220 && (t.includes("音声をアップロード") || t.includes("Upload audio"))) {{
                        return {{found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)}};
                    }}
                }}
            }}

            if (container) {{
                if ({scroll_try} === 0) container.scrollTop = 0;
                else container.scrollTop += 400;
                // scrollHeightの95%を超えたら停止（「シーンを追加」ボタン誤クリック防止）
                if (container.scrollTop > container.scrollHeight * 0.95) {{
                    return {{found: false, scrolled: false}};
                }}
                return {{found: false, scrolled: true}};
            }}
            return {{found: false, scrolled: false}};
        }}""")

        if result and result.get('found'):
            await page.mouse.click(result['x'], result['y'])
            await asyncio.sleep(2.5)
            return True

        if result and result.get('scrolled'):
            await asyncio.sleep(0.3)
            continue
        break

    print(f"  [nav] シーン{scene_num}への移動失敗", flush=True)
    return False


async def upload_audio(page, scene_num, wav_path):
    """
    シーンに音声をアップロード。
    前提: click_scene_script() でシーンNが選択済み（「音声をアップロード」ボタンが出現済み）。
    失敗時は即Falseを返す。既にアップ済みならスキップしてTrue。
    """
    filename = os.path.basename(str(wav_path))

    # モーダルが邪魔していたら先に閉じる
    await dismiss_modals(page)

    # Step 1: Upload audioタブボタンをJS dispatchEventでクリック
    # ※ 新UIではタブボタンがx座標負（viewport外）に配置されるため
    #   Playwright の visible 判定・座標クリックが効かない。
    #   JS dispatchEvent で直接クリックする。
    clicked = False
    for _try in range(4):
        clicked = await page.evaluate("""() => {
            const btns = [...document.querySelectorAll('button')];
            for (const b of btns) {
                const t = b.textContent.trim();
                if (t === 'Upload audio' || t === '音声をアップロード') {
                    b.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                    return true;
                }
            }
            return false;
        }""")
        if clicked:
            break
        print(f"  [audio] Upload audioタブ待機中... ({_try+1}/4)", flush=True)
        await dismiss_modals(page)
        if _try >= 1:
            await click_scene_script(page, scene_num)
            await asyncio.sleep(2.0)
        else:
            await asyncio.sleep(1.0)
    if not clicked:
        # ボタンがない＝音声が既に設定済み（ボタンはアップ済みで非表示になる）
        print(f"  [audio] アップロードボタンなし → 既にアップ済みと判断", flush=True)
        return True
    await asyncio.sleep(2.5)

    # Step 2: hidden audio input に直接 set_input_files
    # (CDP接続のheadless ChromeではFileChooserが発火しないため直接セット)
    # audio inputが出現しない場合、再度Upload audioタブをクリックしてリトライ
    audio_input = page.locator('input[type="file"][accept*="audio"]').first
    for _retry in range(3):
        try:
            await audio_input.wait_for(state="attached", timeout=5000)
            break
        except Exception:
            if _retry < 2:
                print(f"  [audio] audio input待機中... リトライ{_retry+1}", flush=True)
                # Upload audioタブを再クリック
                await page.evaluate("""() => {
                    const btns = [...document.querySelectorAll('button')];
                    for (const b of btns) {
                        const t = b.textContent.trim();
                        if (t === 'Upload audio' || t === '音声をアップロード') {
                            b.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                            return true;
                        }
                    }
                    return false;
                }""")
                await asyncio.sleep(2.5)
            else:
                print(f"  [audio] set_input_files失敗: audio inputが出現しません", flush=True)
                await page.keyboard.press("Escape")
                return False
    try:
        await audio_input.set_input_files(str(wav_path))
        print(f"  [audio] ファイルセット: {filename}", flush=True)
    except Exception as e:
        print(f"  [audio] set_input_files失敗: {e}", flush=True)
        await page.keyboard.press("Escape")
        return False

    # Step 3: 「Add audio」/「音声を追加」ボタン出現をポーリング待機してJSクリック
    # （WAVデコード・ダイアログレンダ完了まで数秒かかるため固定sleepではなくポーリングする）
    add_clicked = False
    deadline = asyncio.get_event_loop().time() + 30.0
    while asyncio.get_event_loop().time() < deadline:
        add_clicked = await page.evaluate("""() => {
            const btns = [...document.querySelectorAll('button')];
            for (const b of btns) {
                const t = b.textContent.trim();
                if (t === 'Add audio' || t === '音声を追加') {
                    const r = b.getBoundingClientRect();
                    if (r.width < 1 || r.height < 1) continue;
                    b.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
                    return true;
                }
            }
            return false;
        }""")
        if add_clicked:
            break
        await asyncio.sleep(0.5)
    if not add_clicked:
        print(f"  [audio] Add audioボタンが30秒以内に出現しません", flush=True)
        await page.keyboard.press("Escape")
        return False
    print(f"  [audio] Add audioクリック（JS）", flush=True)

    # Step 4: Add audioが非表示になるまで待つ（最大30秒）
    try:
        await page.wait_for_selector(
            'button:has-text("Add audio"), button:has-text("音声を追加")',
            state="hidden", timeout=30000
        )
        print(f"  [audio] ✓ アップロード確定", flush=True)
        return True
    except Exception:
        # ボタンが消えなくても、audio inputが消えていればアップロード成功の可能性
        audio_count = await page.evaluate("""() => {
            return document.querySelectorAll('input[type="file"][accept*="audio"]').length;
        }""")
        if audio_count == 0:
            print(f"  [audio] ✓ アップロード確定（audio input消失で判定）", flush=True)
            return True
        print(f"  [audio] 確定タイムアウト（30秒）", flush=True)
        return False


# ===== 音声検証・自己修復 =====

async def verify_scene_audio_dom(page, scene_num, expected_filename):
    """
    左パネルのシーンブロックから実際の音声ファイル名を読み取り、期待値と比較する。
    Returns:
        True           - 正しいファイルが確認できた
        False          - ファイルなし or 別ファイルが入っている
        "ambiguous"    - .wavっぽいがファイル名が切れていて断定不可
    """
    # 右パネルで正しいシーンにいるか確認
    detected_num = await page.evaluate("""() => {
        for (const el of document.querySelectorAll('*')) {
            const t = el.textContent.trim();
            const r = el.getBoundingClientRect();
            if (r.x > 1200 && r.y < 120 && r.y > 50 && r.width < 400 && r.height < 30) {
                const m = t.match(/(?:シーン|Scene)\\s*(\\d+)/i);
                if (m) return parseInt(m[1]);
            }
        }
        return null;
    }""")
    if detected_num is not None and detected_num != scene_num:
        print(f"  [verify] ⚠️ 右パネルのシーン番号が不一致: 期待={scene_num}, 実際={detected_num}", flush=True)
        return False

    # 左パネルのスクリプトエリアで .wav ファイル名テキストを読み取る
    wav_info = await page.evaluate("""() => {
        const results = [];
        for (const el of document.querySelectorAll('span, div, p')) {
            const t = el.textContent.trim();
            const r = el.getBoundingClientRect();
            // 左パネル（x < 500）、スクリプトエリア（y > 60, y < 500）、短いテキスト
            if (r.x < 500 && r.x > 20 && r.y > 60 && r.y < 500
                && t.includes('.wav') && t.length < 60 && el.children.length === 0) {
                results.push(t);
            }
        }
        return results;
    }""")

    if not wav_info:
        print(f"  [verify] .wavテキスト見つからず", flush=True)
        return False

    # expected_filename の sceneNN_ プレフィックスで照合
    expected_prefix = re.match(r'(scene\d+_)', expected_filename)
    expected_prefix = expected_prefix.group(1) if expected_prefix else expected_filename

    for text in wav_info:
        # 完全一致
        if expected_filename in text:
            return True
        # 別のsceneNN_*.wavが入っている → 確定ミスマッチ
        m = re.search(r'scene\d+_[a-z0-9_]+\.wav', text)
        if m and m.group(0) != expected_filename:
            actual = m.group(0)
            print(f"  [verify] ❌ ミスマッチ: 期待={expected_filename}, 実際={actual}", flush=True)
            return False
        # .wavは見えるがファイル名が切れている
        if '.wav' in text and expected_prefix in text:
            return True  # プレフィックス一致 → ほぼ確定
        if '.wav' in text:
            print(f"  [verify] ?  曖昧: テキスト='{text}', 期待={expected_filename}", flush=True)
            return "ambiguous"

    return False


async def remove_scene_audio(page, scene_num):
    """シーンの音声を削除する（×ボタンをクリック）。成功: True, 失敗: False"""
    # .wavファイル名の横にある×ボタンを探してクリック
    close_pos = await page.evaluate("""() => {
        const wavSpans = [...document.querySelectorAll('span, div')].filter(el => {
            const t = el.textContent.trim();
            const r = el.getBoundingClientRect();
            return r.x < 500 && r.x > 20 && r.y > 60 && r.y < 400
                && t.includes('.wav') && t.length < 60 && el.children.length === 0;
        });
        for (const span of wavSpans) {
            const container = span.closest('div');
            if (!container) continue;
            // 親要素内の×ボタン
            const closeBtn = container.parentElement?.querySelector(
                'svg[class*="close"], [class*="remove"], [aria-label="close"]'
            ) || container.parentElement?.querySelector('button');
            if (closeBtn) {
                const r = closeBtn.getBoundingClientRect();
                return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
            }
        }
        return null;
    }""")

    if not close_pos:
        print(f"  [heal] ×ボタンが見つかりません", flush=True)
        return False

    await page.mouse.click(close_pos['x'], close_pos['y'])
    await asyncio.sleep(1.5)
    await dismiss_modals(page)
    await asyncio.sleep(0.5)
    return True


async def self_heal_audio(page, scene_num, wav_path, max_retries=2):
    """
    間違った音声を削除→正しいファイルを再アップロード→検証。
    Returns: True if healed, False if all retries failed.
    """
    expected_fn = os.path.basename(wav_path)
    for attempt in range(max_retries):
        print(f"  [heal] 自己修復 {attempt+1}/{max_retries}...", flush=True)

        # 1. 既存音声を削除
        removed = await remove_scene_audio(page, scene_num)
        if not removed:
            # 削除ボタンがない → テキストをクリアして状態リセット
            await click_scene_script(page, scene_num)
            await asyncio.sleep(1.0)

        # 2. シーンに戻って再アップロード
        await click_scene_script(page, scene_num)
        await asyncio.sleep(1.5)

        ok = await upload_audio(page, scene_num, wav_path)
        if not ok:
            print(f"  [heal] 再アップロード失敗", flush=True)
            continue

        await asyncio.sleep(1.0)

        # 3. 再検証
        result = await verify_scene_audio_dom(page, scene_num, expected_fn)
        if result is True:
            print(f"  [heal] ✓ 修復成功: {expected_fn}", flush=True)
            return True
        print(f"  [heal] 検証結果: {result}", flush=True)

    print(f"  [heal] ❌ {max_retries}回リトライ後も修復できず", flush=True)
    return False


async def verify_scene_audio_claude(page, scene_num, expected_filename, slug):
    """
    claude -p でスクリーンショットを解析し、音声ファイル名を視覚的に確認する。
    DOM検証が"ambiguous"の場合のフォールバック。
    Returns: True / False
    """
    ss_dir = f"{BASE_DIR}/{slug}/debug"
    os.makedirs(ss_dir, exist_ok=True)
    ss_path = f"{ss_dir}/verify_scene{scene_num:02d}.png"

    try:
        await page.screenshot(path=ss_path)
    except Exception as e:
        print(f"  [claude-verify] スクリーンショット失敗: {e}", flush=True)
        return False

    prompt = (
        f"画像ファイル {ss_path} を読んでください。\n"
        f"HeyGenエディタの画面です。左パネルのスクリプトエリアに表示されている"
        f".wavファイル名を全て答えてください。\n"
        f'JSON形式で: {{"filenames": ["scene01_title.wav"]}} '
        f'または見つからない場合 {{"filenames": []}}'
    )

    try:
        result = subprocess.run(
            [CLAUDE_BIN, "-p", prompt,
             "--allowedTools", "Read",
             "--max-turns", "2"],
            capture_output=True, text=True, timeout=60
        )
        output = result.stdout.strip()

        # JSONを抽出
        json_match = re.search(r'\{[^}]*"filenames"\s*:\s*\[[^\]]*\][^}]*\}', output)
        if json_match:
            data = json.loads(json_match.group(0))
            found_files = data.get("filenames", [])
            if expected_filename in found_files:
                print(f"  [claude-verify] ✓ 視覚確認OK: {expected_filename}", flush=True)
                return True
            elif found_files:
                print(f"  [claude-verify] ❌ 視覚確認NG: 期待={expected_filename}, 実際={found_files}", flush=True)
                return False
            else:
                print(f"  [claude-verify] ? ファイル名検出できず", flush=True)
                return False
        else:
            print(f"  [claude-verify] JSON解析失敗: {output[:200]}", flush=True)
            return False
    except subprocess.TimeoutExpired:
        print(f"  [claude-verify] タイムアウト（60秒）", flush=True)
        return False
    except Exception as e:
        print(f"  [claude-verify] エラー: {e}", flush=True)
        return False


async def capture_scene_screenshot(page, scene_num, slug):
    """
    シーン完了後にスクリーンショットを保存。
    全シーン完了後にまとめて目視確認 or claude -p 検証で使う。
    """
    ss_dir = f"{BASE_DIR}/{slug}/verify"
    os.makedirs(ss_dir, exist_ok=True)
    ss_path = f"{ss_dir}/scene{scene_num:02d}.png"
    try:
        await page.screenshot(path=ss_path)
        print(f"  [screenshot] ✓ {ss_path}", flush=True)
        return ss_path
    except Exception as e:
        print(f"  [screenshot] 失敗: {e}", flush=True)
        return None


# ===== アバター配置 =====

async def get_elements(page):
    """キャンバスとキャンバス内部の要素を返す（タイムラインサムネイル除外）。
    [0]=キャンバス（最大面積）、[1:]=キャンバス内の要素（面積降順）。
    リサイズ後のアバター（76x76 DOM px）がタイムラインサムネより小さくても正しく検出する。"""
    return await page.evaluate('''() => {
        const els = Array.from(document.querySelectorAll('[data-element-id]'));
        const items = els.map(el => {
            const r = el.getBoundingClientRect();
            return { id: el.getAttribute('data-element-id'), x: r.x, y: r.y, w: r.width, h: r.height };
        }).filter(i => i.w > 10 && i.h > 10);

        // キャンバス = 最大面積の要素
        items.sort((a, b) => (b.w * b.h) - (a.w * a.h));
        const canvas = items[0];
        if (!canvas) return [];

        // キャンバスの矩形内にある要素のみ抽出（タイムライン・右パネル除外）
        const inside = items.filter(i =>
            i.id !== canvas.id &&
            i.x >= canvas.x - 5 &&
            i.y >= canvas.y - 5 &&
            (i.x + i.w) <= (canvas.x + canvas.w + 5) &&
            (i.y + i.h) <= (canvas.y + canvas.h + 5)
        );

        const result = [canvas, ...inside.sort((a, b) => (b.w * b.h) - (a.w * a.h))];
        return result.map(i => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h }));
    }''')


async def get_error(page, canvas_el_id=None, avatar_el_id=None):
    """現在のアバター位置誤差（右上角からのずれ）を返す。ピクセル単位（整数丸め）。
    canvas_el_id/avatar_el_idが指定されていれば直接クエリ（面積ソート回避）。"""
    if canvas_el_id and avatar_el_id:
        return await page.evaluate(f"""() => {{
            const c = document.querySelector('[data-element-id="{canvas_el_id}"]');
            const a = document.querySelector('[data-element-id="{avatar_el_id}"]');
            if (!c || !a) return null;
            const cr = c.getBoundingClientRect();
            const ar = a.getBoundingClientRect();
            return {{err_x: Math.round((cr.x + cr.width) - (ar.x + ar.width)),
                     err_y: Math.round(cr.y - ar.y),
                     ax: ar.x, ay: ar.y, aw: ar.width, ah: ar.height}};
        }}""")
    return await page.evaluate('''() => {
        const result = [];
        document.querySelectorAll('[data-element-id]').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width > 30 && r.height > 30 && r.y > 100 && r.y < 750) {
                result.push({x: r.x, y: r.y, w: r.width, h: r.height});
            }
        });
        result.sort((a, b) => (b.w * b.h) - (a.w * a.h));
        if (result.length < 2) return null;
        const c = result[0]; const a = result[1];
        return {err_x: Math.round((c.x + c.w) - (a.x + a.w)), err_y: Math.round(c.y - a.y),
                ax: a.x, ay: a.y, aw: a.w, ah: a.h};
    }''')


def safe_click_point(avatar, canvas):
    """アバタークリック座標をキャンバス内に収める（右パネル誤クリック防止）"""
    canvas_right = canvas['x'] + canvas['w']
    safe_x = min(avatar['x'] + avatar['w'] // 2, canvas_right - 30)
    safe_x = max(safe_x, avatar['x'] + 20)
    safe_x = min(safe_x, canvas_right - 30)  # max()後に再clamp（大きくはみ出し対策）
    safe_y = avatar['y'] + avatar['h'] // 2
    return int(safe_x), int(safe_y)


async def click_and_get_se(page, click_x, click_y, max_tries=3):
    """クリックしてSE（右下）リサイズハンドルの座標を取得"""
    for i in range(max_tries):
        await page.mouse.click(click_x, click_y)
        await asyncio.sleep(0.7)
        se = await page.evaluate('''() => {
            const se = document.querySelector('.moveable-direction.moveable-se');
            if (!se) return null;
            const r = se.getBoundingClientRect();
            return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
        }''')
        if se:
            return se
        if i < max_tries - 1:
            await asyncio.sleep(0.3)
    return None


async def resize_avatar_moveable(page, avatar_id, target_size=200):
    """Moveable.request() APIでアバターをぴったりtarget_size HeyGen単位にリサイズする。

    発見: HeyGenのmoveableインスタンスはrequest('resizable')をサポートし、
    offsetWidth/offsetHeight にHeyGen内部座標（px）を直接指定できる。
    ドラッグでは閾値以下の微調整が不可能だが、この方法なら1px単位で正確。
    """
    result = await page.evaluate(f"""() => {{
        const mbox = document.querySelector('.moveable-control-box');
        if (!mbox) return {{ok: false, reason: 'no moveable-control-box'}};
        const fiberKey = Object.keys(mbox).find(k => k.startsWith('__reactFiber'));
        if (!fiberKey) return {{ok: false, reason: 'no fiber'}};
        let fiber = mbox[fiberKey];
        for (let i = 0; i < 20 && fiber; i++) {{
            // パス1: fiber.ref.current.moveable（旧HeyGen）
            if (fiber.ref && typeof fiber.ref === 'object' && fiber.ref.current && fiber.ref.current.moveable) {{
                const mv = fiber.ref.current.moveable;
                try {{
                    const req = mv.request('resizable');
                    req.request({{offsetWidth: {target_size}, offsetHeight: {target_size}}});
                    req.requestEnd();
                    return {{ok: true, via: 'ref.current.moveable'}};
                }} catch(e) {{ return {{ok: false, reason: 'ref: ' + e.message}}; }}
            }}
            // パス2: fiber.stateNode.moveable（新HeyGen）
            if (fiber.stateNode && typeof fiber.stateNode === 'object' && fiber.stateNode.moveable) {{
                const mv = fiber.stateNode.moveable;
                try {{
                    const req = mv.request('resizable');
                    req.request({{offsetWidth: {target_size}, offsetHeight: {target_size}}});
                    req.requestEnd();
                    return {{ok: true, via: 'stateNode.moveable'}};
                }} catch(e) {{ return {{ok: false, reason: 'stateNode: ' + e.message}}; }}
            }}
            // パス3: fiber.stateNode自体がmoveable（request直持ち）
            if (fiber.stateNode && typeof fiber.stateNode.request === 'function') {{
                try {{
                    const req = fiber.stateNode.request('resizable');
                    req.request({{offsetWidth: {target_size}, offsetHeight: {target_size}}});
                    req.requestEnd();
                    return {{ok: true, via: 'stateNode.request'}};
                }} catch(e) {{ /* continue */ }}
            }}
            fiber = fiber.return;
        }}
        return {{ok: false, reason: 'moveable instance not found (20 levels)'}};
    }}""")
    return result.get('ok', False)


async def try_moveable_draggable(page, avatar_el_id, target_tx, target_ty, scale):
    """moveable.request('draggable')でアバターを移動する。

    重要: deltaX/deltaYはDOMピクセル単位。HeyGen座標×scaleで変換する。
    target_tx/target_ty: HeyGen座標でのtranslate目標値
    scale: canvas_dom_width / 1920
    """
    return await page.evaluate(f"""() => {{
        // アバター要素を取得（キャンバス上のもの、タイムラインではなく）
        const els = document.querySelectorAll('[data-element-id="{avatar_el_id}"]');
        let el = null;
        for (const e of els) {{
            const r = e.getBoundingClientRect();
            if (r.width > 10 && r.y < 700) {{ el = e; break; }}
        }}
        if (!el) return {{moved: false, reason: 'element not found on canvas'}};

        // 現在のtransformからtranslate値を読み取り
        const m = el.style.transform.match(/translate\\(([\\deE.+-]+)px,\\s*([\\deE.+-]+)px\\)/);
        if (!m) return {{moved: false, reason: 'no translate in transform: ' + el.style.transform}};
        const cur_tx = parseFloat(m[1]);
        const cur_ty = parseFloat(m[2]);

        // HeyGen座標のdelta → DOMピクセルのdeltaに変換
        const delta_dom_x = ({target_tx} - cur_tx) * {scale};
        const delta_dom_y = ({target_ty} - cur_ty) * {scale};

        // moveable取得
        const mbox = document.querySelector('.moveable-control-box');
        if (!mbox) return {{moved: false, reason: 'no moveable-control-box'}};
        const fKey = Object.keys(mbox).find(k => k.startsWith('__reactFiber'));
        if (!fKey) return {{moved: false, reason: 'no fiber'}};
        let f = mbox[fKey];
        let mv = null;
        for (let i = 0; i < 20 && f; i++) {{
            if (f.stateNode && f.stateNode.moveable) {{ mv = f.stateNode.moveable; break; }}
            if (f.ref && f.ref.current && f.ref.current.moveable) {{ mv = f.ref.current.moveable; break; }}
            if (f.stateNode && typeof f.stateNode.request === 'function') {{ mv = f.stateNode; break; }}
            f = f.return;
        }}
        if (!mv) return {{moved: false, reason: 'moveable not found'}};

        const before = el.style.transform;
        try {{
            const req = mv.request('draggable');
            req.request({{deltaX: delta_dom_x, deltaY: delta_dom_y}});
            req.requestEnd();
        }} catch(e) {{ return {{moved: false, reason: 'request error: ' + e.message}}; }}

        const after = el.style.transform;
        const m2 = after.match(/translate\\(([\\deE.+-]+)px,\\s*([\\deE.+-]+)px\\)/);
        return {{
            moved: before !== after,
            before, after,
            new_tx: m2 ? parseFloat(m2[1]) : null,
            new_ty: m2 ? parseFloat(m2[2]) : null
        }};
    }}""")


async def place_avatar(page, scene_num):
    """
    アバターを200x200 HeyGen単位にリサイズし、右上角に配置する。

    リサイズ: moveable.request('resizable')（HeyGen単位で直接指定）
    移動: moveable.request('draggable')（deltaをDOMピクセルで指定、scale変換）
    補正: ArrowKey（1キー=1HeyGen単位、残差補正用）
    """
    elements = await get_elements(page)
    if len(elements) < 2:
        return False, f"要素不足({len(elements)})"

    canvas = elements[0]
    avatar = next((e for e in elements if e['id'] != canvas['id']), None)
    if not avatar:
        return False, "アバターなし"

    # --- アバター選択 ---
    click_x, click_y = safe_click_point(avatar, canvas)
    await page.mouse.click(click_x, click_y)
    await asyncio.sleep(0.7)

    # SEハンドル確認（選択状態の検証）
    se_info = await page.evaluate('''() => {
        const se = document.querySelector('.moveable-direction.moveable-se');
        if (!se) return null;
        const r = se.getBoundingClientRect();
        return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
    }''')
    if not se_info:
        # リトライ
        await page.mouse.click(click_x, click_y)
        await asyncio.sleep(1.0)
        se_info = await page.evaluate('''() => {
            const se = document.querySelector('.moveable-direction.moveable-se');
            if (!se) return null;
            const r = se.getBoundingClientRect();
            return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
        }''')
        if not se_info:
            return False, "SEハンドル未検出（選択失敗）"

    # --- リサイズ: moveable.request() で正確に200x200に ---
    # 現在のHeyGenサイズを確認（inline style の width/height = HeyGen内部座標）
    avatar_el_id = avatar['id']
    current_heygen = await page.evaluate(f"""() => {{
        const el = document.querySelector('[data-element-id="{avatar_el_id}"]');
        if (!el) return null;
        const w = parseInt(el.style.width);
        const h = parseInt(el.style.height);
        return {{w, h}};
    }}""")

    if current_heygen and (current_heygen['w'] != 200 or current_heygen['h'] != 200):
        print(f"  [resize] 現在: {current_heygen['w']}x{current_heygen['h']} → 200x200", flush=True)
        ok = await resize_avatar_moveable(page, avatar['id'], 200)
        if not ok:
            print(f"  [resize] moveable.request() 失敗", flush=True)
            return False, "リサイズ失敗(moveable.request)"
        await asyncio.sleep(0.8)

        # 検証
        verify = await page.evaluate(f"""() => {{
            const el = document.querySelector('[data-element-id="{avatar_el_id}"]');
            if (!el) return null;
            return {{w: parseInt(el.style.width), h: parseInt(el.style.height)}};
        }}""")
        if not verify or verify['w'] != 200 or verify['h'] != 200:
            print(f"  [resize] 検証失敗: {verify}", flush=True)
            return False, f"リサイズ検証失敗({verify})"
        print(f"  [resize] ✓ 200x200 確認", flush=True)
    else:
        print(f"  [resize] すでに200x200", flush=True)

    # --- 移動: moveable.request('draggable') + ArrowKey微調整 ---
    canvas_el_id = canvas['id']
    scale = canvas['w'] / 1920  # DOMピクセル/HeyGen単位
    target_tx = 1920 - 200  # = 1720 (右端揃え)
    target_ty = 0           # 上端揃え

    # 現在のtransform translate値を読み取り
    cur_transform = await page.evaluate(f"""() => {{
        const els = document.querySelectorAll('[data-element-id="{avatar_el_id}"]');
        for (const el of els) {{
            const r = el.getBoundingClientRect();
            if (r.width > 10 && r.y < 700) {{
                const m = el.style.transform.match(/translate\\(([\\deE.+-]+)px,\\s*([\\deE.+-]+)px\\)/);
                if (m) return {{tx: parseFloat(m[1]), ty: parseFloat(m[2])}};
            }}
        }}
        return null;
    }}""")
    if not cur_transform:
        return False, "transform取得失敗"
    print(f"  [move] translate({cur_transform['tx']:.0f},{cur_transform['ty']:.0f}) → ({target_tx},{target_ty}) scale={scale:.4f}", flush=True)

    # アバターを再クリック（リサイズ後の位置で選択を確保）
    a_rect = await page.evaluate(f"""() => {{
        const els = document.querySelectorAll('[data-element-id="{avatar_el_id}"]');
        for (const el of els) {{
            const r = el.getBoundingClientRect();
            if (r.width > 10 && r.y < 700) return {{x: r.x + r.width/2, y: r.y + r.height/2}};
        }}
        return null;
    }}""")
    if a_rect:
        await page.mouse.click(int(a_rect['x']), int(a_rect['y']))
        await asyncio.sleep(0.5)

    # moveable.request('draggable') で一発移動（deltaはDOMピクセル）
    move_result = await try_moveable_draggable(page, avatar_el_id, target_tx, target_ty, scale)
    await asyncio.sleep(0.5)

    dx_remain = 0
    dy_remain = 0
    if move_result and move_result.get('moved'):
        new_tx = move_result.get('new_tx', '?')
        new_ty = move_result.get('new_ty', '?')
        print(f"  [move] ✓ moveable → translate({new_tx},{new_ty})", flush=True)
        # transform精度チェック（丸め誤差2px以内ならOK）
        if isinstance(new_tx, (int, float)) and isinstance(new_ty, (int, float)):
            if abs(new_tx - target_tx) < 2 and abs(new_ty - target_ty) < 2:
                return True, f"完了(moveable: translate({new_tx:.0f},{new_ty:.0f}))"
            # 残差をArrowKeyで補正
            dx_remain = round(target_tx - new_tx)
            dy_remain = round(target_ty - new_ty)
            if abs(dx_remain) > 0 or abs(dy_remain) > 0:
                print(f"  [move] 残差補正: dx={dx_remain}, dy={dy_remain}", flush=True)
    else:
        print(f"  [move] moveable失敗: {move_result}", flush=True)
        # フォールバック: transformから全距離をArrowKeyで
        dx_remain = round(target_tx - cur_transform['tx'])
        dy_remain = round(target_ty - cur_transform['ty'])
        print(f"  [move] ArrowKey全距離: dx={dx_remain}, dy={dy_remain}", flush=True)

    # ArrowKey補正（moveable残差 or 全距離）
    if abs(dx_remain) > 0 or abs(dy_remain) > 0:
        # 再クリックで選択確保
        a_rect2 = await page.evaluate(f"""() => {{
            const els = document.querySelectorAll('[data-element-id="{avatar_el_id}"]');
            for (const el of els) {{
                const r = el.getBoundingClientRect();
                if (r.width > 10 && r.y < 700) return {{x: r.x + r.width/2, y: r.y + r.height/2}};
            }}
            return null;
        }}""")
        if a_rect2:
            await page.mouse.click(int(a_rect2['x']), int(a_rect2['y']))
            await asyncio.sleep(0.3)

        if dx_remain != 0:
            key_x = "ArrowRight" if dx_remain > 0 else "ArrowLeft"
            for i in range(abs(dx_remain)):
                await page.keyboard.press(key_x)
        if dy_remain != 0:
            key_y = "ArrowDown" if dy_remain > 0 else "ArrowUp"
            for i in range(abs(dy_remain)):
                await page.keyboard.press(key_y)
        await asyncio.sleep(0.3)

    # 最終検証（DOM bounding rect ベース）
    err = await get_error(page, canvas_el_id, avatar_el_id)
    if err and err['err_x'] == 0 and err['err_y'] == 0:
        return True, "完了"
    # DOM丸め誤差が1px以内なら許容
    if err and abs(err['err_x']) <= 1 and abs(err['err_y']) <= 1:
        return True, f"完了(err={err['err_x']},{err['err_y']}≈0)"
    return False, f"精度不足(err={err['err_x'] if err else '?'},{err['err_y'] if err else '?'})"


# ===== Phase 0: PPTXアップロード (Playwright CDP) =====


async def phase_0_upload_pptx_cdp():
    """
    Playwright CDP経由でPPTXをアップロードしてドラフト動画を作成する。

    操作順序（HeyGenの仕様: オプションはアップロード後に表示される）:
    1. ppt-to-video ページへ移動（既存タブ再利用）
    2. PPTXアップロード（input[type=file][accept*=pptx] に set_input_files）
    3. トグルOFF（スライドを編集可能な要素としてインポート）
    4. "Use speaker notes as your script" ボタンをクリック
    5. "No Avatar" ボタンで右パネル展開 → 「本番用：山口鳳汰」アバター選択
    6. "Create Video" → create-v4 URL 到達待機（最大90秒）

    前提: CDP Chrome (CDP_URL) 起動中、HeyGenログイン済み
    """
    print("\n--- Phase 0: PPTXアップロード (Playwright CDP) ---", flush=True)
    print(f"  CDP: {CDP_URL}", flush=True)
    print(f"  ファイル: {PPTX_PATH}", flush=True)

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(CDP_URL)
        ctx = browser.contexts[0]

        # Step 1: ppt-to-video ページを確保
        print("  [1/6] PPT/PDFページへ移動...", flush=True)
        page = None
        # 既にppt-to-videoが開いていればそれを使う
        for pg in ctx.pages:
            if "ppt-to-video" in pg.url:
                page = pg
                break
        # heygen.com の他ページがあればそれを流用
        if page is None:
            for pg in ctx.pages:
                if "heygen.com" in pg.url:
                    page = pg
                    break
        if page is None:
            page = await ctx.new_page()

        if "ppt-to-video" not in page.url:
            await page.goto("https://app.heygen.com/avatar/ppt-to-video", wait_until="domcontentloaded")
            await asyncio.sleep(3)

        # ログイン確認
        try:
            content_sample = await page.evaluate("() => document.body.innerText.slice(0, 500)")
        except Exception:
            content_sample = ""
        if "Continue with Google" in content_sample or "Sign in to HeyGen" in content_sample:
            print("❌ HeyGenにログインされていません", flush=True)
            return False
        print(f"  ✓ ページ到達: {page.url}", flush=True)

        # Step 2: PPTXアップロード（input[type=file] に直接セット）
        print("  [2/6] PPTXアップロード...", flush=True)
        file_input = page.locator('input[type="file"][accept*="pptx"]').first
        if await file_input.count() == 0:
            # fallback: .ppt だけで絞る
            file_input = page.locator('input[type="file"][accept*="ppt"]').first
        if await file_input.count() == 0:
            print("❌ ファイルinputが見つかりません", flush=True)
            await page.screenshot(path="/tmp/heygen-phase0-no-input.png")
            return False
        await file_input.set_input_files(PPTX_PATH)
        print(f"  ✓ アップロード実行: {os.path.basename(PPTX_PATH)}", flush=True)

        # アップロード完了を待つ（設定UIが出現するまで）
        # role=switch か "Use speaker notes" ボタンが出たらOK
        try:
            await page.wait_for_selector(
                '[role="switch"], button:has-text("Use speaker notes"), button:has-text("スピーカー")',
                timeout=60_000,
            )
        except Exception as e:
            print(f"❌ アップロード後の設定UIが出現しません（60秒）: {e}", flush=True)
            await page.screenshot(path="/tmp/heygen-phase0-post-upload.png")
            return False
        await asyncio.sleep(2)
        print("  ✓ 設定UIが出現", flush=True)

        # Step 3: インポートトグルをOFF（デフォルトON）
        print("  [3/6] インポートトグルをOFFに...", flush=True)
        toggle_on = page.locator('[role="switch"][aria-checked="true"]').first
        if await toggle_on.count() > 0:
            await toggle_on.click()
            await asyncio.sleep(1.5)
            # 確認: aria-checked が false になっているか
            state_after = await page.locator('[role="switch"]').first.get_attribute("aria-checked")
            print(f"  ✓ トグル切替 (aria-checked={state_after})", flush=True)
        else:
            print("  ⚠️ ONトグルが見つかりません（既にOFFの可能性・スキップ）", flush=True)

        # Step 4: "Use speaker notes as your script" クリック
        print("  [4/6] Speaker notes選択...", flush=True)
        speaker_btn = page.locator(
            'button:has-text("Use speaker notes as your script"), '
            'button:has-text("Use speaker notes"), '
            'button:has-text("スピーカーノートをスクリプトとして使用")'
        ).first
        if await speaker_btn.count() == 0:
            print("❌ Speaker notesボタンが見つかりません", flush=True)
            await page.screenshot(path="/tmp/heygen-phase0-no-speaker.png")
            return False
        await speaker_btn.click()
        await asyncio.sleep(1)
        print("  ✓ Speaker notesクリック", flush=True)

        # Step 5: No Avatarカードをクリック → 右パネル展開 → アバター選択
        print("  [5/6] アバター選択...", flush=True)
        no_avatar = page.locator('button:has-text("No Avatar"), button:has-text("Add avatar"), button:has-text("アバターを追加")').first
        if await no_avatar.count() == 0:
            print("❌ No Avatarカードが見つかりません", flush=True)
            await page.screenshot(path="/tmp/heygen-phase0-no-avatar-card.png")
            return False
        await no_avatar.click()
        await asyncio.sleep(2)
        print("  ✓ 右パネル展開", flush=True)

        # "My Avatars" タブに切り替え（アクティブでない場合のみ）
        my_tab = page.locator('button:has-text("My Avatars"), button:has-text("自分のアバター")').first
        if await my_tab.count() > 0:
            try:
                # 現在アクティブか判定（aria-selected or data-state or aria-pressed）
                is_active = await my_tab.evaluate(
                    "(el) => el.getAttribute('aria-selected')==='true' || "
                    "el.getAttribute('data-state')==='active' || "
                    "el.getAttribute('aria-pressed')==='true' || "
                    "el.className.includes('active') || "
                    "getComputedStyle(el).borderBottomWidth !== '0px'"
                )
                if not is_active:
                    await my_tab.click()
                    await asyncio.sleep(1.5)
            except Exception:
                pass

        # パネル内アバターリストのレンダリング完了を待つ（本番用アバター出現まで最大15秒）
        print("  アバターカード読み込み中...", flush=True)
        try:
            await page.locator(
                'img[alt*="本番用"][alt*="山口鳳汰"][alt*="背景リアル"]'
            ).first.wait_for(state="attached", timeout=15_000)
        except Exception:
            # 見つからなければデバッグ情報を出す
            await page.screenshot(path="/tmp/heygen-phase0-avatar-panel.png")
            alts = await page.evaluate(
                "() => Array.from(document.querySelectorAll('img[alt]'))"
                ".map(i => i.alt).filter(a => a && a.length < 80).slice(0, 30)"
            )
            print("❌ 本番用アバターが見つかりません。パネル内img alt:", flush=True)
            for a in alts:
                print(f"    {a!r}", flush=True)
            return False

        # 「本番用：山口鳳汰(背景リアル&スーツ見えるver)」アバターカード
        avatar_img = page.locator(
            'img[alt*="本番用"][alt*="山口鳳汰"][alt*="背景リアル"][alt*="スーツ見える"]'
        ).first
        if await avatar_img.count() == 0:
            avatar_img = page.locator('img[alt*="本番用"][alt*="山口鳳汰"][alt*="背景リアル"]').first

        # scroll into view (virtualized list 対策)
        try:
            await avatar_img.scroll_into_view_if_needed(timeout=5000)
        except Exception:
            pass
        await asyncio.sleep(0.5)

        # カードコンテナ（cursor-pointer持つ先祖div）をクリック
        avatar_card = avatar_img.locator(
            'xpath=ancestor::div[contains(@class,"cursor-pointer")][1]'
        )
        if await avatar_card.count() > 0:
            await avatar_card.click()
        else:
            # fallback: imgの親divを直接クリック
            await avatar_img.locator("xpath=..").click()
        await asyncio.sleep(1.5)
        print("  ✓ アバター選択完了", flush=True)

        # Step 6: Create Videoクリック → create-v4 URL到達待機
        print("  [6/6] Create Video...", flush=True)
        create_btn = page.locator(
            'button:has-text("Create Video"), button:has-text("動画を作成")'
        ).first
        if await create_btn.count() == 0:
            print("❌ Create Videoボタンが見つかりません", flush=True)
            await page.screenshot(path="/tmp/heygen-phase0-no-create-btn.png")
            return False

        # disabled チェック
        is_disabled = await create_btn.is_disabled()
        if is_disabled:
            print("⚠️ Create Videoボタンが無効化されています。アバター選択状態を確認", flush=True)
            await page.screenshot(path="/tmp/heygen-phase0-create-disabled.png")
            return False

        await create_btn.click()
        print("  ✓ Create Videoクリック", flush=True)

        # エディタ遷移待機（最大90秒）
        print("  エディタ遷移を待機中...", flush=True)
        try:
            await page.wait_for_url(
                lambda url: "create-v4" in url,
                timeout=90_000,
            )
        except Exception:
            print(f"❌ create-v4 URL到達タイムアウト（90秒）: 現在URL={page.url}", flush=True)
            await page.screenshot(path="/tmp/heygen-phase0-timeout.png")
            return False

        print(f"  ✓ エディタに遷移: {page.url[:100]}", flush=True)

        # エディタ変換完了を待機（Converting... 消失 + シーン1「音声をアップロード」出現）
        # URL は create-v4 になっていても変換中の場合があり、その状態で Phase 1+2 を走らせると
        # シーンナビが DOM に出ておらずシーン1の検出に失敗する。ここで操作可能になるまで待つ。
        print("  エディタ変換完了を待機中...", flush=True)
        try:
            await page.wait_for_function(
                """() => {
                    const text = document.body.innerText;
                    if (/Converting your presentation|変換中/i.test(text)) return false;
                    const btns = Array.from(document.querySelectorAll('button'));
                    return btns.some(b => /音声をアップロード|Upload audio/i.test(b.textContent));
                }""",
                timeout=180_000,
            )
            print("  ✓ エディタ変換完了（操作可能状態）", flush=True)
        except Exception:
            print("  ⚠️ エディタ変換完了シグナルを検出できませんでした（180秒） — Phase 1+2側で再確認", flush=True)
            # 失敗扱いにはしない: Phase 1+2 の nav リトライで救える可能性がある

        print("\n✓ Phase 0完了！", flush=True)
        return True


# ===== メイン =====

async def main():
    if not SLUG:
        print("エラー: HEYGEN_SLUG 環境変数を設定してください", flush=True)
        print("例: HEYGEN_SLUG=what-is-make python3 _shared/heygen-setup.py", flush=True)
        sys.exit(1)

    # Phase 0モード: PPTXアップロード
    if PPTX_PATH:
        print(f"\n{'#'*60}", flush=True)
        print(f"  HeyGen Phase 0: PPTXアップロード", flush=True)
        print(f"  スラッグ: {SLUG}", flush=True)
        print(f"  PPTX: {PPTX_PATH}", flush=True)
        print(f"  ドライラン: {'YES' if DRY_RUN else 'NO'}", flush=True)
        print(f"{'#'*60}\n", flush=True)

        # ファイル存在確認
        if not os.path.exists(PPTX_PATH):
            print(f"❌ PPTXファイルが見つかりません: {PPTX_PATH}", flush=True)
            sys.exit(1)

        # DRY_RUN: ブラウザ接続せずにファイル確認+予定表示のみ
        if DRY_RUN:
            size_mb = os.path.getsize(PPTX_PATH) / (1024 * 1024)
            print(f"  [DRY RUN] PPTXファイル確認OK: {os.path.basename(PPTX_PATH)} ({size_mb:.1f}MB)", flush=True)
            print(f"  [DRY RUN] 実行予定: HeyGenにアップロード → ドラフト作成", flush=True)
            return

        ok = await phase_0_upload_pptx_cdp()
        if not ok:
            print("\n❌ Phase 0失敗", flush=True)
            sys.exit(1)
        print("\nPhase 0完了。エディタが開いたらPhase 1+2を実行してください。", flush=True)
        return

    # === スイープ検証モード ===
    if VERIFY_MODE:
        audio_files = find_audio_files(SLUG)
        if not audio_files:
            print(f"エラー: 音声ファイルが見つかりません", flush=True)
            sys.exit(1)
        total = len(audio_files)
        end = END_SCENE_ENV if END_SCENE_ENV > 0 else total

        print(f"\n{'#'*60}", flush=True)
        print(f"  HeyGen スイープ検証モード", flush=True)
        print(f"  スラッグ: {SLUG}", flush=True)
        print(f"  シーン数: {total}", flush=True)
        print(f"  処理範囲: {START_SCENE} 〜 {end}", flush=True)
        print(f"  視覚検証: {'YES' if VERIFY_VISUAL else 'NO'}", flush=True)
        print(f"{'#'*60}\n", flush=True)

        report = {"slug": SLUG, "total": total, "scenes": {}, "summary": {}}

        async with async_playwright() as p:
            browser = await p.chromium.connect_over_cdp(CDP_URL)
            ctx = browser.contexts[0]
            page = None
            for pg in ctx.pages:
                if "heygen.com" in pg.url and "create-v4" in pg.url:
                    page = pg
                    break
            if not page:
                print("❌ HeyGenページが見つかりません", flush=True)
                return

            print(f"✓ ページ: {page.url[:80]}", flush=True)

            ok_count = 0
            ng_count = 0
            ambiguous_count = 0

            for scene_num in range(START_SCENE, end + 1):
                idx = scene_num - 1
                audio_path = audio_files[idx]
                expected_fn = os.path.basename(audio_path)

                print(f"\n[verify] シーン{scene_num}/{end}: {expected_fn}", flush=True)

                # シーンに移動
                if not await click_scene_script(page, scene_num):
                    print(f"  [verify] 移動失敗", flush=True)
                    report["scenes"][str(scene_num)] = {"status": "nav_failed", "expected": expected_fn}
                    ng_count += 1
                    continue

                await asyncio.sleep(1.0)

                # DOM検証
                result = await verify_scene_audio_dom(page, scene_num, expected_fn)

                if result is True:
                    print(f"  [verify] ✓ OK", flush=True)
                    report["scenes"][str(scene_num)] = {"status": "ok", "expected": expected_fn, "method": "dom"}
                    ok_count += 1
                elif result == "ambiguous":
                    if VERIFY_VISUAL:
                        visual_ok = await verify_scene_audio_claude(page, scene_num, expected_fn, SLUG)
                        if visual_ok:
                            print(f"  [verify] ✓ OK (claude)", flush=True)
                            report["scenes"][str(scene_num)] = {"status": "ok", "expected": expected_fn, "method": "claude"}
                            ok_count += 1
                        else:
                            print(f"  [verify] ❌ NG (claude)", flush=True)
                            report["scenes"][str(scene_num)] = {"status": "ng", "expected": expected_fn, "method": "claude"}
                            ng_count += 1
                    else:
                        print(f"  [verify] ? 曖昧", flush=True)
                        report["scenes"][str(scene_num)] = {"status": "ambiguous", "expected": expected_fn}
                        ambiguous_count += 1
                else:
                    print(f"  [verify] ❌ NG", flush=True)
                    report["scenes"][str(scene_num)] = {"status": "ng", "expected": expected_fn, "method": "dom"}
                    ng_count += 1

            report["summary"] = {"ok": ok_count, "ng": ng_count, "ambiguous": ambiguous_count}

            # レポート出力
            report_path = f"{BASE_DIR}/{SLUG}/heygen-verification-report.json"
            os.makedirs(os.path.dirname(report_path), exist_ok=True)
            with open(report_path, "w") as f:
                json.dump(report, f, indent=2, ensure_ascii=False)

            print(f"\n{'='*60}", flush=True)
            print(f"  検証結果: OK={ok_count} NG={ng_count} 曖昧={ambiguous_count}", flush=True)
            print(f"  レポート: {report_path}", flush=True)
            print(f"{'='*60}", flush=True)
        return

    # 音声ファイル確認
    audio_files = find_audio_files(SLUG)
    if not audio_files:
        print(f"エラー: 音声ファイルが見つかりません", flush=True)
        print(f"  期待パス: {BASE_DIR}/{SLUG}/audio/scenes/scene*.wav", flush=True)
        sys.exit(1)

    total = len(audio_files)
    end = END_SCENE_ENV if END_SCENE_ENV > 0 else total

    print(f"\n{'#'*60}", flush=True)
    print(f"  HeyGen セットアップ（音声 + アバター）", flush=True)
    print(f"  スラッグ: {SLUG}", flush=True)
    print(f"  シーン数: {total}", flush=True)
    print(f"  処理範囲: {START_SCENE} 〜 {end}", flush=True)
    print(f"  ドライラン: {'YES' if DRY_RUN else 'NO'}", flush=True)
    print(f"{'#'*60}\n", flush=True)

    # 進捗読み込み
    progress = load_progress(SLUG)
    if progress["completed"]:
        print(f"レジューム: {len(progress['completed'])}/{total} 完了済み", flush=True)
        print(f"  完了済み: {progress['completed']}", flush=True)

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(CDP_URL)
        ctx = browser.contexts[0]

        # HeyGenエディタページを探す
        page = None
        for pg in ctx.pages:
            if "heygen.com" in pg.url and "create-v4" in pg.url:
                page = pg
                break
        if not page:
            print("❌ HeyGenページが見つかりません（create-v4のURLが開かれているか確認）", flush=True)
            return

        print(f"✓ ページ: {page.url[:80]}", flush=True)

        success_count = 0
        fail_count = 0

        # --- シーン番号読み取り ---
        async def read_heygen_scene_num(pg):
            """右パネルの「アバター & ボイス (シーン N)」からHeyGenの実際のシーン番号を読む"""
            return await pg.evaluate("""() => {
                // 「アバター & ボイス (シーン N)」のテキストを持つ要素を探す
                for (const el of document.querySelectorAll('*')) {
                    const t = el.textContent.trim();
                    const r = el.getBoundingClientRect();
                    // 右パネル上部（x>1200, y<120, 小さい要素）
                    if (r.x > 1200 && r.y < 120 && r.y > 50 && r.width < 400 && r.height < 30) {
                        const m = t.match(/(?:シーン|Scene)\\s*(\\d+)/i);
                        if (m) return parseInt(m[1]);
                    }
                }
                return null;
            }""")

        for scene_num in range(START_SCENE, end + 1):
            if scene_num in progress["completed"]:
                print(f"  [SKIP] シーン{scene_num}: 完了済み", flush=True)
                continue

            idx = scene_num - 1
            audio_path = audio_files[idx]

            print(f"\n{'='*50}", flush=True)
            print(f"シーン{scene_num}/{end}: {os.path.basename(audio_path)}", flush=True)
            print(f"{'='*50}", flush=True)

            # Escapeで前の状態をクリア
            await page.keyboard.press("Escape")
            await asyncio.sleep(0.5)

            # 左パネルのスクリプト行をクリックしてシーンに移動
            # 番号検索は仮想スクロール境界(16+)で失敗するため、
            # 「スクリプトを入力してください」未処理マーカーで次行を拾う
            print(f"  [nav] シーン{scene_num}に移動...", flush=True)
            ok, heygen_num = await click_next_unprocessed_script(page, scene_num)
            if not ok:
                print(f"❌ シーン{scene_num}への移動失敗。中断。", flush=True)
                progress["failed"].append(scene_num)
                progress["status"] = "stopped"
                save_progress(SLUG, progress)
                break
            if heygen_num is None or heygen_num != scene_num:
                print(f"⚠ HeyGenシーン{heygen_num} ≠ scene_num={scene_num} — ずれ懸念で中断", flush=True)
                progress["failed"].append(scene_num)
                progress["status"] = "stopped"
                save_progress(SLUG, progress)
                break

            if DRY_RUN:
                print(f"  [DRY RUN] スキップ", flush=True)
                continue

            # モーダルが出ていたら閉じる
            await dismiss_modals(page)

            # [1/3] 音声アップロード（upload_audio内で既にアップ済み検出→スキップ）
            expected_fn = os.path.basename(audio_path)
            print(f"  [1/3] 音声アップロード...", flush=True)
            audio_ok = await upload_audio(page, scene_num, audio_path)
            if not audio_ok:
                fail_count += 1
                progress["failed"].append(scene_num)
                progress["status"] = "stopped"
                save_progress(SLUG, progress)
                print(f"\n{'!'*50}", flush=True)
                print(f"  停止: シーン{scene_num}で音声アップロード失敗。ずれ防止のため中断。", flush=True)
                print(f"  修正後、HEYGEN_START={scene_num} で再開してください。", flush=True)
                print(f"{'!'*50}", flush=True)
                break

            await asyncio.sleep(1.0)
            await page.keyboard.press("Escape")
            await asyncio.sleep(1.0)

            # [3/3] アバター配置
            print(f"  [3/3] アバター配置...", flush=True)
            avatar_ok = False
            avatar_msg = ""
            # リトライ: 最大3回（スクリーンショットで状態記録）
            for _avatar_try in range(3):
                # キャンバス要素がロードされるまで待機
                for _wait in range(5):
                    els = await get_elements(page)
                    if len(els) >= 2:
                        break
                    await asyncio.sleep(1.0)
                ok, msg = await place_avatar(page, scene_num)
                if ok:
                    avatar_ok = True
                    avatar_msg = msg
                    break
                avatar_msg = msg
                if _avatar_try < 2:
                    print(f"  [avatar] リトライ{_avatar_try+1}/3: {msg}", flush=True)
                    ss_dir = f"{BASE_DIR}/{SLUG}/debug"
                    os.makedirs(ss_dir, exist_ok=True)
                    ss_path = f"{ss_dir}/scene{scene_num:02d}_try{_avatar_try+1}.png"
                    try:
                        await page.screenshot(path=ss_path)
                        print(f"  [avatar] スクリーンショット: {ss_path}", flush=True)
                    except Exception:
                        pass
                    await page.keyboard.press("Escape")
                    await asyncio.sleep(1.0)

            if avatar_ok:
                print(f"  [OK] シーン{scene_num}: {avatar_msg}", flush=True)

                # スクリーンショット保存（後でまとめて検証用）
                ss = await capture_scene_screenshot(page, scene_num, SLUG)
                if ss:
                    progress.setdefault("screenshots", {})[str(scene_num)] = ss

                success_count += 1
                progress["completed"].append(scene_num)
                save_progress(SLUG, progress)
            else:
                ss_dir = f"{BASE_DIR}/{SLUG}/debug"
                os.makedirs(ss_dir, exist_ok=True)
                ss_path = f"{ss_dir}/scene{scene_num:02d}_fail.png"
                try:
                    await page.screenshot(path=ss_path)
                    print(f"  [avatar] スクリーンショット: {ss_path}", flush=True)
                except Exception:
                    pass
                print(f"  [WARN] シーン{scene_num}アバター配置失敗: {avatar_msg}", flush=True)
                print(f"  → 音声は入っています。続行します。", flush=True)
                fail_count += 1
                progress["failed"].append(scene_num)
                save_progress(SLUG, progress)

            # 5シーンごとに進捗報告
            if scene_num % 5 == 0:
                print(f"\n[進捗] {scene_num}/{end} 処理 (成功:{success_count} 失敗:{fail_count})", flush=True)

            # 次のシーンへは次ループの click_scene_script() で移動する

            await asyncio.sleep(0.3)

        # 結果サマリー
        print(f"\n{'='*60}", flush=True)
        print(f"  完了サマリー", flush=True)
        print(f"  成功: {success_count}", flush=True)
        print(f"  失敗: {fail_count}", flush=True)
        print(f"  完了済み合計: {len(progress['completed'])}/{total}", flush=True)
        if progress.get("failed"):
            print(f"  失敗シーン: {progress['failed']}", flush=True)
        ss_count = len(progress.get("screenshots", {}))
        if ss_count > 0:
            print(f"  スクリーンショット: {ss_count}枚 → {BASE_DIR}/{SLUG}/verify/", flush=True)
        print(f"{'='*60}", flush=True)

        if len(progress["completed"]) == total:
            progress["status"] = "done"
            save_progress(SLUG, progress)
            print("\n全シーン完了!", flush=True)


if __name__ == "__main__":
    if SLUG:
        acquire_lock()
    try:
        asyncio.run(main())
    finally:
        if SLUG:
            release_lock()
