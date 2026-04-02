# YouTube AI動画 HeyGen動画生成

PPTXスライドとシーン別音声ファイルから、HeyGenでアバター付き動画を生成する。

## 重要な前提（2026-03-25確認済み）

- **音声はElevenLabsで生成したWAVファイルをアップロードする方式**が最高品質（API連携は品質低下する）
- HeyGenに音声をアップロードすると**自動でリップシンク**される。特別な操作は不要
- PPTXアップロード時は**「スライドの内容を編集可能な要素としてインポート」を必ずOFFにすること**
- PPTXアップロード時は**「Use speaker notes as your script」**を選択（台本がスピーカーノートに埋め込まれている）
- **Quality + 1080p**で生成すること
- Consent Video（本人確認）: 英語の同意文を読み上げる。**明るい場所、白壁背景、顔全体がフレームに入る**ように撮影

## 入力

$ARGUMENTS にスラッグまたはディレクトリパスが渡される。

- スラッグの場合: 以下のファイルを自動検索
  - `output/youtube/{slug}-slides.pptx`
  - `output/youtube/{slug}-audio/scene*.wav`
- 引数なしの場合: `output/youtube/` 内の最新のスライドと音声を使用

## 前提条件

- HeyGen APIキーが必要: `credentials/heygen_api_key.txt` または環境変数 `HEYGEN_API_KEY`
- アバターIDが必要: `credentials/heygen_avatar_id.txt` または環境変数 `HEYGEN_AVATAR_ID`
- Consent Video（本人確認）が完了済みであること

## 処理フロー

### Phase 1: 素材準備
1. PPTXを読み込み、各スライドをPNG画像に変換
2. シーン別音声ファイルの存在を確認
3. スライド枚数と音声ファイル数の一致を確認

### Phase 2: HeyGen API呼び出し

```python
import requests

HEYGEN_API_BASE = "https://api.heygen.com/v2"

headers = {
    "X-Api-Key": api_key,
    "Content-Type": "application/json"
}

# 1. アバター一覧を取得して確認
response = requests.get(f"{HEYGEN_API_BASE}/avatars", headers=headers)

# 2. 動画生成リクエスト
payload = {
    "video_inputs": [],
    "dimension": {"width": 1920, "height": 1080}
}

for i, (slide_img, audio_file) in enumerate(zip(slides, audios)):
    scene = {
        "character": {
            "type": "avatar",
            "avatar_id": avatar_id,
            "avatar_style": "normal",
            "scale": 0.3,           # ワイプサイズ（30%）
            "offset": {
                "x": 0.35,          # 右寄せ
                "y": -0.35          # 上寄せ
            }
        },
        "voice": {
            "type": "audio",
            "audio_url": audio_url  # アップロード済みURL
        },
        "background": {
            "type": "image",
            "url": slide_url        # アップロード済みURL
        }
    }
    payload["video_inputs"].append(scene)

# 3. 動画生成を実行
response = requests.post(
    f"{HEYGEN_API_BASE}/video/generate",
    json=payload,
    headers=headers
)
video_id = response.json()["data"]["video_id"]
```

### Phase 3: 生成待ち & ダウンロード

```python
import time

# ステータスポーリング（最大30分）
for _ in range(180):  # 10秒 × 180 = 30分
    status_response = requests.get(
        f"{HEYGEN_API_BASE}/video_status.get?video_id={video_id}",
        headers=headers
    )
    status = status_response.json()["data"]["status"]

    if status == "completed":
        video_url = status_response.json()["data"]["video_url"]
        break
    elif status == "failed":
        error = status_response.json()["data"].get("error", "Unknown")
        raise Exception(f"動画生成失敗: {error}")

    time.sleep(10)

# ダウンロード
video_response = requests.get(video_url)
with open(output_path, "wb") as f:
    f.write(video_response.content)
```

## 素材アップロード（HeyGen Asset API）

スライド画像と音声ファイルはHeyGenにアップロードが必要:

```python
# アセットアップロード
upload_response = requests.post(
    f"{HEYGEN_API_BASE}/asset",
    headers={"X-Api-Key": api_key},
    files={"file": open(file_path, "rb")}
)
asset_url = upload_response.json()["data"]["url"]
```

## アバター配置設定（ワイプ）

| 設定 | 値 | 説明 |
|-----|---|------|
| `avatar_style` | `normal` | 通常表示 |
| `scale` | `0.3` | 画面の30%サイズ |
| `offset.x` | `0.35` | 右端寄り |
| `offset.y` | `-0.35` | 上端寄り |

※ Walkersチャンネルの動画フォーマットに合わせた右上ワイプ配置

## 音声アップロード自動化（完全自動・レジューム対応）

HeyGen UIでPPTXをアップロード済みの状態から、全シーン分の音声を**Chrome MCP**で完全自動アップロードする。
1コマンドで全シーン処理。自動バッチ分割・自動リトライ・レジューム対応。

### 前提条件
- HeyGenでPPTXアップロード済み（各シーンが左パネルに表示されている状態）
- `output/youtube/{slug}-audio/scenes/` に `scene01_*.wav` 〜 `sceneNN_*.wav` が存在
- Chrome MCPが接続済み
- HeyGenの動画作成画面がブラウザで開いている

### 処理フロー（全自動）

#### Step 0: 初期化 — タブID取得 & 音声ファイル検出

```
# タブ取得
mcp__Claude_in_Chrome__tabs_context_mcp(createIfEmpty=true)
# → tab_id を取得

# 音声ファイル一覧
audio_dir = f"output/youtube/{slug}-audio/scenes"
audio_files = sorted(glob.glob(f"{audio_dir}/scene*.wav"))
total = len(audio_files)

# 進捗ファイル読み込み（レジューム対応）
progress_path = f"output/youtube/{slug}-audio/upload_progress.json"
# 存在すれば読み込み、なければ初期化
progress = {
    "total": total,
    "completed": [],    # アップロード成功済みシーン番号
    "failed": [],       # 最終的に失敗したシーン番号
    "status": "running"
}
```

#### Step 1: 自動バッチ分割 & 実行

**10シーンずつ自動分割。完了済みシーンはスキップ。**

```
BATCH_SIZE = 10
MAX_RETRY = 3
INTERVAL_SEC = 4  # シーン間のインターバル

pending = [n for n in range(1, total + 1) if n not in progress["completed"]]

for batch_start in range(0, len(pending), BATCH_SIZE):
    batch = pending[batch_start:batch_start + BATCH_SIZE]
    print(f"--- バッチ開始: シーン {batch[0]}〜{batch[-1]} ---")

    for scene_num in batch:
        success = False
        for attempt in range(1, MAX_RETRY + 1):
            try:
                upload_scene(scene_num, tab_id, audio_files)
                success = True
                progress["completed"].append(scene_num)
                save_progress(progress_path, progress)
                print(f"✅ Scene {scene_num}/{total} (attempt {attempt})")
                break
            except Exception as e:
                print(f"⚠️ Scene {scene_num} attempt {attempt} failed: {e}")
                if attempt < MAX_RETRY:
                    wait(5)  # リトライ前に5秒待機

        if not success:
            progress["failed"].append(scene_num)
            save_progress(progress_path, progress)
            print(f"❌ Scene {scene_num}/{total}: {MAX_RETRY}回リトライ後も失敗")

    # バッチ間に5秒休憩（Chrome MCP安定化）
    wait(5)
```

#### Step 2: 1シーンのアップロード処理（upload_scene関数）

```
def upload_scene(scene_num, tab_id, audio_files):
    audio_path = audio_files[scene_num - 1]
    abs_path = os.path.abspath(audio_path)

    # --- A: シーンをクリック ---
    result = mcp__Claude_in_Chrome__find(query=f"シーン {scene_num}", tabId=tab_id)
    # findで見つからない場合 → read_pageでref検索にフォールバック
    if not result:
        page = mcp__Claude_in_Chrome__read_page(tabId=tab_id)
        # ページ全体からシーン番号のrefを特定
    mcp__Claude_in_Chrome__computer(action="left_click", ref=scene_ref, tabId=tab_id)
    wait(1)

    # --- B: 「音声をアップロード」ボタンをクリック ---
    result = mcp__Claude_in_Chrome__find(query="音声をアップロード", tabId=tab_id)
    # 見つからない場合 → 右パネルをスクロールして再検索
    if not result:
        mcp__Claude_in_Chrome__computer(action="scroll", direction="down", amount=3, tabId=tab_id)
        result = mcp__Claude_in_Chrome__find(query="音声をアップロード", tabId=tab_id)
    mcp__Claude_in_Chrome__computer(action="left_click", ref=upload_btn_ref, tabId=tab_id)
    wait(1)

    # --- C: ファイルをアップロード ---
    mcp__Claude_in_Chrome__file_upload(filePaths=[abs_path], tabId=tab_id)

    # --- D: アップロード完了待ち ---
    # 音声波形が表示されるまで待機（最大15秒）
    for check in range(5):
        wait(3)
        # 波形UIまたはファイル名が表示されていれば成功
        result = mcp__Claude_in_Chrome__find(query=os.path.basename(audio_path), tabId=tab_id)
        if result:
            return True
    # 波形が確認できなくてもエラーがなければ成功とみなす
    return True
```

#### Step 3: 完了確認 & レポート

```
# 進捗サマリー
print(f"\n{'='*40}")
print(f"アップロード完了: {len(progress['completed'])}/{total}")
if progress["failed"]:
    print(f"失敗シーン: {progress['failed']}")
else:
    print("全シーン成功 🎉")
progress["status"] = "done"
save_progress(progress_path, progress)

# スクリーンショットで最終確認
mcp__Claude_in_Chrome__computer(action="screenshot", tabId=tab_id)
```

### レジューム（中断からの再開）

中断・クラッシュ後に同じコマンドを再実行すると:
1. `upload_progress.json` から完了済みシーンを読み込み
2. 未完了シーンのみ処理を再開
3. 前回失敗したシーンも再チャレンジ

```
# レジューム時のログ例:
# "進捗ファイル検出: 18/36完了済み。シーン19から再開します"
```

### 手動リトライ（特定シーンのみ）

自動リトライでも失敗したシーンがある場合:
```
# $ARGUMENTS に "retry 5,12,23" のように指定
# → シーン5, 12, 23のみ個別アップロード
```

### 注意事項

- 1シーンあたり**4秒のインターバル**（サーバー負荷対策）
- **アップロード中にページ遷移やリロードをしないこと**
- 失敗が連続する場合はChrome MCPの接続状態を確認
- **アップロード後、生成ボタンは手動で押す**（最終確認のため）
- HeyGenのUI変更時はスクリーンショットを撮って要素を再特定

### トラブルシューティング

| 問題 | 対策 |
|-----|------|
| 「音声をアップロード」ボタンが見つからない | 右パネルを自動スクロール → read_pageでref検索 |
| file_uploadが動作しない | input[type=file]のrefを直接指定 |
| Chrome MCPが応答しない | 5秒待機後リトライ（3回まで） |
| シーン数が合わない | PPTXのスライド数と音声ファイル数を再確認 |
| 中断した | 再実行で自動レジューム（progress.json参照） |

## HeyGen APIが使えない場合（手動フォールバック）

Chrome MCP自動化もAPIも使えない場合の最終手段:

1. `output/youtube/{slug}-heygen-guide.md` にアップロード手順書を出力
2. スライド画像とシーン別音声ファイルをまとめたフォルダを開く
3. HeyGen Studioでの操作手順をステップバイステップで記載

## 出力先

- 動画: `output/youtube/{slug}-video.mp4`
- 手順書（フォールバック）: `output/youtube/{slug}-heygen-guide.md`
- 完成後は `open` コマンドで動画を再生 or 手順書を開く

## 背景BGM設定（必須）

HeyGenで動画生成前に、必ず背景BGMを追加すること。

| 設定 | 値 | 理由 |
|-----|---|------|
| BGMジャンル | Corporate / Upbeat系 | ビジネス動画に適した雰囲気 |
| **Volume** | **3%** | ナレーションが聞こえなくなるので必ず下げる |
| **Loop music** | **ON** | 動画全体をカバーするため |

## 品質チェック

- [ ] 動画の解像度が1920x1080か
- [ ] アバターが右上に正しく配置されているか
- [ ] リップシンクが音声と同期しているか
- [ ] スライドの切り替えがシーンと一致しているか
- [ ] 動画全体の長さが台本の想定尺に近いか
- [ ] **背景BGMが設定されているか（Volume 3%、Loop ON）**
