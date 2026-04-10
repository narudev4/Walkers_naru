---
description: YouTube AI動画 YouTube投稿
---

# YouTube AI動画 YouTube投稿

完成した動画ファイル・サムネイル・メタデータをYouTubeにアップロードする。

## 入力

$ARGUMENTS にスラッグまたは動画ファイルパスが渡される。

- スラッグの場合: 以下のファイルを自動検索
  - `output/youtube/{slug}/video.mp4` （動画）
  - `output/youtube/{slug}/thumbnail.png` （サムネイル）
  - `output/youtube/{slug}/script.md` （メタデータ源）
- 引数なしの場合: `output/youtube/` 内の最新ファイルを使用

## 前提条件

- YouTube Data API v3 のOAuth2認証が必要
- `credentials/youtube_oauth.json` にクライアントシークレットを配置
- 初回実行時にブラウザでOAuth認証フローを実行

## 処理フロー

### Phase 1: メタデータ準備

台本ファイル（`*-script.md`）から以下を抽出:

| 項目 | 抽出元 |
|-----|-------|
| タイトル | `## {動画タイトル}` |
| 概要欄 | `## 概要欄テンプレート` セクション |
| チャプター | `## 目次（概要欄用）` セクション |
| タグ | 概要欄末尾のハッシュタグ |
| カテゴリ | 28（Science & Technology） |

### Phase 2: アップロード

```python
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

def upload_to_youtube(video_path, title, description, tags, thumbnail_path=None):
    # OAuth2認証
    flow = InstalledAppFlow.from_client_secrets_file(
        "credentials/youtube_oauth.json", SCOPES
    )
    credentials = flow.run_local_server(port=8090)
    youtube = build("youtube", "v3", credentials=credentials)

    # 動画アップロード
    body = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags,
            "categoryId": "28",
            "defaultLanguage": "ja",
            "defaultAudioLanguage": "ja"
        },
        "status": {
            "privacyStatus": "private",  # まず非公開でアップロード
            "selfDeclaredMadeForKids": False
        }
    }

    media = MediaFileUpload(
        video_path,
        mimetype="video/mp4",
        resumable=True,
        chunksize=10 * 1024 * 1024  # 10MB chunks
    )

    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"アップロード進捗: {int(status.progress() * 100)}%")

    video_id = response["id"]
    print(f"✅ アップロード完了: https://youtube.com/watch?v={video_id}")

    # サムネイル設定
    if thumbnail_path:
        youtube.thumbnails().set(
            videoId=video_id,
            media_body=MediaFileUpload(thumbnail_path, mimetype="image/png")
        ).execute()
        print("✅ サムネイル設定完了")

    return video_id
```

### Phase 3: 投稿後確認

1. 動画URLを表示
2. ステータス確認（処理中 → 公開可能）
3. 公開設定の確認（private → public への変更はユーザー判断）

## 公開設定

| 設定 | デフォルト | 説明 |
|-----|----------|------|
| privacyStatus | **private** | まず非公開でアップロード |
| 公開への変更 | 手動 | ユーザーに確認後、APIで変更可能 |
| 予約投稿 | オプション | `publishAt` パラメータで指定可能 |

> ⚠️ 安全のため、デフォルトは必ず**非公開（private）**でアップロードする

## YouTube API未設定の場合（手動フォールバック）

APIが設定されていない場合:

1. YouTube Studioの手動アップロード手順を表示
2. 概要欄テキストをクリップボードにコピー
3. `open https://studio.youtube.com` でYouTube Studioを開く

## 出力

- アップロード成功時: YouTube動画URL
- フォールバック時: 手動アップロード手順 + クリップボードにメタデータ

## 品質チェック

- [ ] 動画ファイルが存在し、再生可能か（ffprobeで確認）
- [ ] タイトルが100文字以内か
- [ ] 概要欄が5000文字以内か
- [ ] タグが合計500文字以内か
- [ ] サムネイルが2MB以内か
- [ ] 非公開でアップロードされたか（公開ミス防止）
