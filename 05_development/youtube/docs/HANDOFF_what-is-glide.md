# 引き継ぎ資料: Glide紹介動画（what-is-glide）

## 概要

記事 https://walker-s.co.jp/media/what-is-glide/ からYouTube動画を制作中。
`/yt-produce` パイプラインのSTEP 5まで完了済み。**STEP 6（HeyGen手動作業）から再開**してください。

---

## 進捗状況

| STEP | 内容 | 状態 |
|------|------|------|
| STEP 1 | 記事スクレイピング | ✅ 完了 |
| STEP 2 | 台本生成（37スライド・約14分） | ✅ 完了・確認済み |
| STEP 3 | スライド生成（37枚PPTX） | ✅ 完了・確認済み |
| STEP 4 | 音声生成（ElevenLabs・887.8秒） | ✅ 完了・確認済み |
| STEP 5 | 音声分割（37シーンWAV） | ✅ 完了 |
| STEP 5.5 | 概要欄チャプター（実測値） | ✅ 完了・台本に反映済み |
| **STEP 6** | **HeyGen動画生成** | **⬚ ここから再開** |
| STEP 7 | サムネイル生成 | ⬚ 未着手 |
| STEP 8 | YouTube投稿 | ⬚ 未着手 |

---

## ファイル一覧

すべて `projects/what-is-glide/` 配下にあります。

| ファイル | 内容 |
|---------|------|
| `article.md` | 記事Markdownテキスト |
| `script.md` | 台本（概要欄チャプター実測値反映済み） |
| `slides.pptx` | スライド37枚（STEP 6でHeyGenにアップロードする） |
| `audio/full.wav` | 全体音声（887.8秒 = 約14分48秒） |
| `audio/scenes/scene01〜37.wav` | シーン別音声37ファイル（STEP 6でHeyGenにアップロードする） |

---

## STEP 6: HeyGen動画生成（ここから再開）

### やること（7ステップ）

**【1】PPTXをHeyGenにアップロード**
- HeyGen（https://app.heygen.com）を開く
- 「Create Video」→ `slides.pptx` をアップロード
- **「スライドの内容を編集可能な要素としてインポート」→ 必ずOFF**
- 「Use speaker notes as your script」を選択

**【2】音声をアップロード**
- ClaudeCodeに「音声アップロードを自動化して」と言えばChrome MCPで自動実行される
- 手動の場合: 各シーンの「音声をアップロード」から `audio/scenes/scene01〜37.wav` を順番にアップロード

**【3】アバター設定**
- アバター: 山口鳳汰(背景リアル&スーツ見えるver)
- レイアウト: 円 / 半径: 98px / ズーム: 139%
- モーションエンジン: アバター IV
- 「既存のアバターを置き換え」→「選択」で全シーン適用

**【4】アバター位置調整**
- 各シーンでアバターを**右上端**にドラッグ
- ※「既存のアバターを置き換え」では位置がコピーされないため各シーンで手動調整

**【5】背景BGMを追加**
- Background Musicから好みのBGMを選択（Corporate / Upbeat系推奨）
- **Volume: 3%**
- **Loop music: ON**

**【6】プレビュー確認**
- いくつかのシーンを再生して確認:
  - [ ] スライドが正しく表示されているか（**ダブルクリックして確認**）
  - [ ] アバターが右上に配置されているか
  - [ ] 音声がスライドと一致しているか
  - [ ] BGMが小さく流れているか

**【7】生成ボタンを押す**
- 右上の「✓ 生成」ボタンをクリック
- Quality + 1080p を選択
- 生成開始（2〜4時間。放置OK）

---

## STEP 7以降の進め方

HeyGen動画が完成したら、ClaudeCodeに以下のように伝えてください:

```
/yt-produce の続き。what-is-glide のSTEP 7（サムネイル生成）から再開して。
STEP 5まで完了済み、STEP 6のHeyGen動画生成も完了した。
台本: projects/what-is-glide/script.md
```

ClaudeCodeが `/yt-produce` スキルを持っているので、STEP 7（サムネイル）→ STEP 8（YouTube投稿手順の案内）まで自動で進みます。

---

## 概要欄チャプター（実測値・台本に反映済み）

```
0:00 オープニング
1:42 Glide(グライド)とは？
3:10 Glideの4つの特徴
6:02 Glideの4つの注意点
8:29 Glideの料金プラン
9:38 Glideの使い方
12:27 まとめ・お問い合わせ
```

---

## 注意事項

- スライド・音声は確認済みなので**再生成不要**
- HeyGenの音声アップロード自動化は `/yt-heygen` スキルに手順が書かれている
- 何か問題が起きたら `script.md` の台本と `slides.pptx` のスライド番号の対応を確認すること
