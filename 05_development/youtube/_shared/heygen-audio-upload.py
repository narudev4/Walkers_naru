#!/usr/bin/env python3
"""
HeyGen 音声アップロード自動化スクリプト（改善版 v2）

使い方:
  browser-use python --file _shared/heygen-audio-upload.py

前提:
  - browser-use がHeyGenエディタを開いた状態（--profile walker-s.co.jp）
  - PPTXアップロード済み（スライドが左パネルに並んでいる）
  - projects/{slug}/audio/scenes/ に scene01_*.wav 〜 sceneNN_*.wav が存在

環境変数:
  HEYGEN_SLUG  : 動画スラッグ（例: what-is-make）
  HEYGEN_START : 開始シーン番号（デフォルト: 1、レジューム用）
  HEYGEN_END   : 終了シーン番号（デフォルト: 全シーン）
  HEYGEN_DRY   : "1" でドライラン（クリックせず状態確認のみ）

改善点（v1からの変更）:
  1. スライド特定: プレースホルダ方式 → スライド番号span要素ベース
  2. 手動アップ不要: scene01から全てスクリプトで処理
  3. Add audio確定待ち: 最大20秒（10回×2秒）でリトライ
  4. 検証ステップ: ファイル名表示を確認してから次へ。失敗なら即停止
  5. scrollIntoView: 毎回スライドを画面中央に配置
  6. レジューム対応: progress.json で中断再開
"""

import subprocess
import json
import glob
import os
import sys
import time

# === 設定 ===
BASE_DIR = "/Users/naru/Walkers_naru/05_development/youtube/projects"
BU = "/Users/naru/.browser-use-env/bin/browser-use"

SLUG = os.environ.get("HEYGEN_SLUG", "")
START_SCENE = int(os.environ.get("HEYGEN_START", "1"))
END_SCENE = int(os.environ.get("HEYGEN_END", "0"))  # 0 = 全シーン
DRY_RUN = os.environ.get("HEYGEN_DRY", "0") == "1"

# タイミング設定
SLIDE_CLICK_WAIT = 1.5       # スライドクリック後の待ち
UPLOAD_BTN_WAIT = 1.0        # アップロードボタンクリック後の待ち
AUDIO_CONFIRM_WAIT = 2.0     # Add audio確定のポーリング間隔
AUDIO_CONFIRM_MAX = 10       # Add audio確定の最大リトライ回数（×2秒=最大20秒）
BETWEEN_SCENES_WAIT = 2.0    # シーン間の待ち時間


def bu(*args):
    """browser-use CLI を実行して結果を返す"""
    cmd = [BU] + list(args)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        print(f"  [TIMEOUT] {' '.join(cmd)}")
        return ""
    except Exception as e:
        print(f"  [ERROR] {' '.join(cmd)}: {e}")
        return ""


def bu_eval(js):
    """JavaScript を実行"""
    return bu("eval", js)


def wait(sec):
    time.sleep(sec)


# === メイン処理 ===

def find_audio_files(slug):
    """音声ファイル一覧を取得（ソート済み）"""
    audio_dir = f"{BASE_DIR}/{slug}/{slug}-audio/scenes"
    files = sorted(glob.glob(f"{audio_dir}/scene*.wav"))
    return files


def load_progress(slug):
    """進捗ファイルを読み込み"""
    path = f"{BASE_DIR}/{slug}/heygen-upload-progress.json"
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {"completed": [], "failed": [], "status": "new"}


def save_progress(slug, progress):
    """進捗ファイルを保存"""
    path = f"{BASE_DIR}/{slug}/heygen-upload-progress.json"
    with open(path, "w") as f:
        json.dump(progress, f, indent=2, ensure_ascii=False)


def click_slide(scene_num, total_scenes):
    """
    左パネルでスライドをクリックする（v2: span要素ベース）

    HeyGenの左パネルには各スライドに「N / Total」形式のspan要素がある。
    scrollIntoViewで画面中央に配置してからクリック。
    """
    # スライド番号テキストで要素を特定してスクロール＆クリック
    js = f"""
    (() => {{
        // 左パネルのスライドサムネイルを全取得
        const slides = document.querySelectorAll('[class*="slide"], [class*="scene"], [class*="thumbnail"]');

        // 方法1: "N / Total" テキストを含むspan要素を探す
        const spans = document.querySelectorAll('span');
        for (const span of spans) {{
            const text = span.textContent.trim();
            if (text === '{scene_num} / {total_scenes}' || text === '{scene_num}/{total_scenes}') {{
                const slideEl = span.closest('[class*="slide"], [class*="scene"], [class*="thumbnail"], [role="button"], [data-testid]') || span.parentElement.parentElement;
                slideEl.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
                return JSON.stringify({{ found: true, method: 'span', text: text }});
            }}
        }}

        // 方法2: data属性やインデックスで探す
        const allSlides = document.querySelectorAll('[class*="SceneCard"], [class*="scene-card"], [class*="slide-item"]');
        if (allSlides.length >= {scene_num}) {{
            const target = allSlides[{scene_num} - 1];
            target.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
            return JSON.stringify({{ found: true, method: 'index', count: allSlides.length }});
        }}

        return JSON.stringify({{ found: false, spans_checked: spans.length, slides_found: allSlides.length }});
    }})()
    """
    result = bu_eval(js)
    print(f"  [slide-find] {result}")

    wait(0.5)

    # スライドをクリック（scrollIntoView後にクリック）
    js_click = f"""
    (() => {{
        // span要素経由でクリック
        const spans = document.querySelectorAll('span');
        for (const span of spans) {{
            const text = span.textContent.trim();
            if (text === '{scene_num} / {total_scenes}' || text === '{scene_num}/{total_scenes}') {{
                const slideEl = span.closest('[class*="slide"], [class*="scene"], [class*="thumbnail"], [role="button"], [data-testid]') || span.parentElement.parentElement;
                slideEl.click();
                return 'clicked-span';
            }}
        }}

        // フォールバック: インデックスベース
        const allSlides = document.querySelectorAll('[class*="SceneCard"], [class*="scene-card"], [class*="slide-item"]');
        if (allSlides.length >= {scene_num}) {{
            allSlides[{scene_num} - 1].click();
            return 'clicked-index';
        }}

        return 'not-found';
    }})()
    """
    click_result = bu_eval(js_click)
    print(f"  [slide-click] {click_result}")
    return "clicked" in click_result


def click_upload_audio_button():
    """
    右パネルの「音声をアップロード」ボタンをクリック（React onClick発火）

    HeyGenはReactで構成されているため、通常のclickでは
    file inputが生成されない。__reactProps$.onClickで発火する。
    """
    js = """
    (() => {
        // 「Upload audio」または「音声をアップロード」ボタンを探す
        const buttons = document.querySelectorAll('button, [role="button"], div[class*="upload"], div[class*="Upload"]');
        for (const btn of buttons) {
            const text = btn.textContent.toLowerCase();
            if (text.includes('upload audio') || text.includes('音声をアップロード') || text.includes('upload your audio')) {
                // React onClickを発火
                const keys = Object.keys(btn);
                const reactKey = keys.find(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'));
                if (reactKey && btn[reactKey] && btn[reactKey].onClick) {
                    btn[reactKey].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
                    return JSON.stringify({ clicked: true, method: 'react', text: btn.textContent.trim().substring(0, 50) });
                }
                // フォールバック: 通常クリック
                btn.click();
                return JSON.stringify({ clicked: true, method: 'normal', text: btn.textContent.trim().substring(0, 50) });
            }
        }
        return JSON.stringify({ clicked: false });
    })()
    """
    result = bu_eval(js)
    print(f"  [upload-btn] {result}")
    try:
        data = json.loads(result)
        return data.get("clicked", False)
    except:
        return False


def upload_audio_file(audio_path):
    """
    ファイルアップロードダイアログに音声ファイルをセット

    file input要素を探してbrowser-use uploadコマンドで送信。
    """
    # file input要素のインデックスを取得
    js = """
    (() => {
        const inputs = document.querySelectorAll('input[type="file"]');
        if (inputs.length === 0) return JSON.stringify({ found: false });
        // 最後に追加されたfile inputを使う（HeyGenは動的に生成する）
        const last = inputs[inputs.length - 1];
        // browser-use用のインデックスを取得
        const allElements = document.querySelectorAll('*');
        let idx = -1;
        for (let i = 0; i < allElements.length; i++) {
            if (allElements[i] === last) { idx = i; break; }
        }
        return JSON.stringify({ found: true, count: inputs.length, accept: last.accept || 'any' });
    })()
    """
    result = bu_eval(js)
    print(f"  [file-input] {result}")

    # browser-use の state でファイルinputのインデックスを取得
    # ファイルを直接セットする方がbrowser-use uploadより確実
    abs_path = os.path.abspath(audio_path)
    js_set = f"""
    (() => {{
        const inputs = document.querySelectorAll('input[type="file"]');
        if (inputs.length === 0) return 'no-input';
        const input = inputs[inputs.length - 1];
        // accept属性を一時的に緩和
        input.removeAttribute('accept');
        return 'ready:' + inputs.length;
    }})()
    """
    ready = bu_eval(js_set)
    print(f"  [file-ready] {ready}")

    if "no-input" in ready:
        return False

    # browser-use upload でファイルを送信
    # file input の browser-use index を特定
    state_output = bu("state")

    # state出力からfile inputのインデックスを探す
    file_input_idx = None
    for line in state_output.split('\n'):
        if 'type="file"' in line.lower() or 'input' in line.lower():
            # [idx] input ... のようなフォーマットを探す
            import re
            match = re.search(r'\[(\d+)\].*input.*file', line, re.IGNORECASE)
            if match:
                file_input_idx = match.group(1)

    if file_input_idx:
        upload_result = bu("upload", file_input_idx, abs_path)
        print(f"  [upload] idx={file_input_idx}: {upload_result[:100]}")
        return True

    # フォールバック: JSでファイルをセット（DataTransfer API）
    print("  [upload] file input index not found in state, using JS fallback")
    js_upload = f"""
    (() => {{
        const input = document.querySelectorAll('input[type="file"]');
        if (input.length === 0) return 'no-input';
        const lastInput = input[input.length - 1];
        // triggerイベントを発火してHeyGenにファイル選択を通知
        const event = new Event('change', {{ bubbles: true }});
        lastInput.dispatchEvent(event);
        return 'dispatched';
    }})()
    """
    bu_eval(js_upload)
    return True


def wait_for_audio_confirmation(audio_filename, scene_num):
    """
    音声アップロードの確定を待つ（v2: 最大20秒、厳格検証）

    「Add audio」確定ボタンの処理完了を、ファイル名表示で確認。
    失敗したらFalseを返す（呼び出し元で即停止判定）。
    """
    basename = os.path.basename(audio_filename).replace('.wav', '')

    for attempt in range(AUDIO_CONFIRM_MAX):
        wait(AUDIO_CONFIRM_WAIT)

        # 右パネルにファイル名または波形が表示されているか確認
        js = f"""
        (() => {{
            const body = document.body.innerText;
            // ファイル名が表示されている = アップロード成功
            if (body.includes('{basename}')) return JSON.stringify({{ confirmed: true, method: 'filename' }});

            // 波形UIが表示されている = アップロード成功
            const waveforms = document.querySelectorAll('[class*="waveform"], [class*="audio-wave"], canvas[class*="audio"]');
            // 右パネル内の波形を確認
            const rightPanel = document.querySelector('[class*="right"], [class*="property"], [class*="inspector"]');
            if (rightPanel) {{
                const rpWaves = rightPanel.querySelectorAll('canvas, [class*="wave"]');
                if (rpWaves.length > 0) return JSON.stringify({{ confirmed: true, method: 'waveform' }});
            }}

            // 「Upload audio」ボタンがまだ表示されている = まだ未確定
            const uploadBtns = document.querySelectorAll('button, [role="button"]');
            let hasUploadBtn = false;
            for (const btn of uploadBtns) {{
                if (btn.textContent.toLowerCase().includes('upload audio')) {{
                    hasUploadBtn = true;
                    break;
                }}
            }}

            // アップロードモーダルが開いている = 処理中
            const modals = document.querySelectorAll('[class*="modal"], [class*="dialog"], [role="dialog"]');
            if (modals.length > 0) return JSON.stringify({{ confirmed: false, status: 'modal-open', attempt: {attempt + 1} }});

            return JSON.stringify({{ confirmed: false, status: hasUploadBtn ? 'upload-btn-visible' : 'unknown', attempt: {attempt + 1} }});
        }})()
        """
        result = bu_eval(js)
        print(f"  [confirm {attempt + 1}/{AUDIO_CONFIRM_MAX}] {result}")

        try:
            data = json.loads(result)
            if data.get("confirmed"):
                return True
        except:
            pass

    return False


def process_scene(scene_num, total_scenes, audio_path):
    """1シーン分の音声アップロード処理"""
    filename = os.path.basename(audio_path)
    print(f"\n{'='*50}")
    print(f"Scene {scene_num}/{total_scenes}: {filename}")
    print(f"{'='*50}")

    if DRY_RUN:
        print("  [DRY RUN] スキップ")
        return True

    # Step 1: スライドをクリック
    print("  [1/4] スライドをクリック...")
    if not click_slide(scene_num, total_scenes):
        print("  [FAIL] スライドが見つかりません")
        return False
    wait(SLIDE_CLICK_WAIT)

    # Step 2: 「音声をアップロード」ボタンをクリック
    print("  [2/4] アップロードボタンをクリック...")
    if not click_upload_audio_button():
        print("  [FAIL] アップロードボタンが見つかりません")
        return False
    wait(UPLOAD_BTN_WAIT)

    # Step 3: 音声ファイルをアップロード
    print(f"  [3/4] 音声ファイルをアップロード: {filename}")
    if not upload_audio_file(audio_path):
        print("  [FAIL] ファイルアップロードに失敗")
        return False

    # Step 4: 確定を待つ（最大20秒）
    print("  [4/4] アップロード確定を待機（最大20秒）...")
    if not wait_for_audio_confirmation(audio_path, scene_num):
        print(f"  [FAIL] Scene {scene_num}: 確定タイムアウト（20秒経過）")
        print("  >>> 即停止: ずれ防止のため後続シーンは処理しません <<<")
        return False

    print(f"  [OK] Scene {scene_num} 完了")
    return True


def main():
    if not SLUG:
        print("エラー: HEYGEN_SLUG 環境変数を設定してください")
        print("例: HEYGEN_SLUG=what-is-make browser-use python --file _shared/heygen-audio-upload.py")
        sys.exit(1)

    # 音声ファイル一覧
    audio_files = find_audio_files(SLUG)
    if not audio_files:
        print(f"エラー: 音声ファイルが見つかりません: {BASE_DIR}/{SLUG}/{SLUG}-audio/scenes/scene*.wav")
        sys.exit(1)

    total = len(audio_files)
    end = END_SCENE if END_SCENE > 0 else total

    print(f"\n{'#'*60}")
    print(f"  HeyGen 音声アップロード v2")
    print(f"  スラッグ: {SLUG}")
    print(f"  シーン数: {total}")
    print(f"  処理範囲: {START_SCENE} 〜 {end}")
    print(f"  ドライラン: {'YES' if DRY_RUN else 'NO'}")
    print(f"{'#'*60}\n")

    # 進捗読み込み
    progress = load_progress(SLUG)
    if progress["completed"]:
        print(f"レジューム: {len(progress['completed'])}/{total} 完了済み")
        print(f"  完了済み: {progress['completed']}")

    # 処理ループ
    success_count = 0
    fail_count = 0

    for scene_num in range(START_SCENE, end + 1):
        # 完了済みスキップ
        if scene_num in progress["completed"]:
            print(f"  [SKIP] Scene {scene_num}: 完了済み")
            continue

        audio_path = audio_files[scene_num - 1]
        ok = process_scene(scene_num, total, audio_path)

        if ok:
            success_count += 1
            progress["completed"].append(scene_num)
            save_progress(SLUG, progress)
        else:
            fail_count += 1
            progress["failed"].append(scene_num)
            progress["status"] = "stopped"
            save_progress(SLUG, progress)
            # 即停止（ずれ防止）
            print(f"\n{'!'*60}")
            print(f"  停止: Scene {scene_num} で失敗。ずれ防止のため処理を中断。")
            print(f"  修正後、HEYGEN_START={scene_num} で再開してください。")
            print(f"{'!'*60}")
            break

        # シーン間の待ち
        if scene_num < end:
            wait(BETWEEN_SCENES_WAIT)

    # 結果サマリー
    print(f"\n{'='*60}")
    print(f"  結果サマリー")
    print(f"  成功: {success_count}")
    print(f"  失敗: {fail_count}")
    print(f"  完了済み合計: {len(progress['completed'])}/{total}")
    if progress.get("failed"):
        print(f"  失敗シーン: {progress['failed']}")
    print(f"{'='*60}")

    if len(progress["completed"]) == total:
        progress["status"] = "done"
        save_progress(SLUG, progress)
        print("\n全シーン完了!")

    # スクリーンショットで最終状態確認
    bu("screenshot")


if __name__ == "__main__":
    main()
