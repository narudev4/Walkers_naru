---
description: YouTube AI動画 一括制作パイプライン
---

# YouTube AI動画 一括制作パイプライン

記事URLから **台本→スライド→音声→音声分割→概要欄チャプター→HeyGen 動画生成準備** までを一括実行する統合スキル。

**STEP 1〜5.5 は確認なしで完全自動進行する**。各 STEP 完了時は結果ファイルを開いて表示するだけで、即座に次の STEP へ進む。

**STEP 6（HeyGen 動画生成）は半自動だが「半自動」の主語は yt-produce（=Claude）**。PPTX アップロード・**アバター選択**（本番用：山口鳳汰(背景リアル&スーツ見えるver)）・Create Video・音声アップロード・アバター位置調整は `_shared/heygen-setup.py` で、**BGM 追加・Volume 1%・Loop ON は `_shared/heygen-bgm-setup.py` で**それぞれ自動化済み。**Claude が Bash ツールで両スクリプトを直接実行する（`run_in_background=true` で起動 → Monitor で完走確認）。ユーザーに「ターミナルで実行してください」と手順案内して終わるのは禁止。** エラー時は `HEYGEN_START=N` で最大5回まで自動リトライし、それでも詰まった場合のみ報告。最終的なプレビュー確認 → 生成ボタン押下 → HeyGen 側の 2〜4 時間レンダリング待機のみ、ユーザーが自分のタイミングで実行する（yt-produce は待機しない）。

**STEP 7（YouTube 投稿）は完全手動なので `/yt-upload` という別スキルに委譲する。** yt-produce は STEP 6 完了時に「次は /yt-upload を実行してください」と案内して終了する。

ユーザーが途中の生成物を修正したい場合は、自分で実行を中断して指示すれば良い設計。

## 入力

$ARGUMENTS に記事URLが渡される。

- URLの場合: フルパイプライン実行
- 引数なしの場合: ユーザーにURLまたはテーマをヒアリング

## パイプライン全体像

```
記事URL
  ↓ [STEP 1] 🤖 /yt-scrape
article.md
  ↓ [STEP 2] 🤖 /yt-script
script.md
  ↓ [STEP 3] 🤖 /yt-slides   ← 並列実行 →   [STEP 4] 🤖 /yt-voice
slides.json → slides.pptx                      full.wav
                                               ↓ [STEP 5] 🤖 /yt-split-audio
                                             scenes/*.wav
  ↓ [STEP 5.5] 🤖 概要欄チャプター生成
  ↓ [STEP 6] 👤+🤖 HeyGen動画生成（半自動・最後の生成ボタンはユーザーが押す）
video.mp4
✅ yt-produce 完了

  ↓ 別スキルへ（ユーザーが手動で起動）
  · /yt-upload — YouTube投稿
```

**設計方針:**
- **STEP 1〜5.5 は完全自動進行**（ユーザー確認なし）。各 STEP 完了時はファイルを開いて結果を表示するだけで、次の STEP へ即座に進む。
- **STEP 6 は半自動**。heygen-setup.py 起動などの手順を案内し、ユーザーがプレビュー確認 → 生成ボタンを押して「完成した」と言うまで待機する。
- **STEP 7（YouTube 投稿）は別スキル `/yt-upload` に委譲**。yt-produce は STEP 6 完了時に案内するのみ。
- ユーザーが途中の生成物を修正したい場合は、自分で実行を中断して指示すれば良い。

## 実行手順（STEP 1〜5.5 自動 / STEP 6 半自動）

### STEP 1: 記事スクレイピング 🤖

```
入力: URL
出力: projects/{slug}/article.md
```

WebFetch or Chrome MCPで記事を取得し、Markdown化する。

**完了後のメッセージ:**
```
✅ STEP 1 完了: 記事を取得しました。
→ STEP 2（台本生成）に自動で進みます。
```

---

### STEP 2: 台本生成 🤖

```
入力: article.md
出力: projects/{slug}/script.md
```

記事の見出し構造に追従した台本を生成。概要欄・チャプター・HeyGen対応表も含む。

**完了後のメッセージ:**
```
✅ STEP 2 完了: 台本を生成しました（{N}スライド / 約{M}分）。

📄 台本ファイル: projects/{slug}/script.md
   （自動でファイルを開きます）

→ STEP 3（スライド生成）と STEP 4（音声生成）を並列で自動実行します。
   修正したい場合は実行を中断して指示してください。
```

**確認待ちなし。即座に STEP 3+4 へ進む。**
ファイルは `~/bin/mo` で開いて参照可能にしておくが、応答を待たずに次の処理を開始する。

---

### STEP 3+4: スライド生成 + 音声生成 🤖

**この2つは並列で実行する（Agent ツール `run_in_background: true` を推奨）。**

```
# 並列タスクA: スライド生成
入力: script.md
出力: projects/{slug}/slides.pptx

# 並列タスクB: 音声生成（ElevenLabs API）
入力: script.md
出力: projects/{slug}/audio/full.wav
```

**実装上のポイント:**
- メインスレッドが Agent 起動後に他のタスク（次の準備、リファクタ、説明）を進められるよう、両方とも `run_in_background: true` で送る。
- 両 Agent から完了通知が来たら、揃った時点で次の STEP 5 に進む。
- 片方が遅れていてももう片方は先に表示する（音声側だけ結合点情報を出す等は可）。

**スライド生成サブエージェント起動時に必ず含める制約（CRITICAL — 過去事故防止）:**

過去にサブエージェントが暴走して「`num="結"`」「section title 3 行構成」を勝手に作って動画品質が破綻した実例あり。スライド生成 Agent への起動プロンプトには **必ず以下のすべてを明記する**:

1. **「`.claude/skills/yt-slides/SKILL.md` を **必ず** Read で読む」**（参考ではなく必須）
2. **「過去プロジェクト `projects/claudecode-entrepreneur/slides.json` を Read して構造を **完全踏襲** する。独自構造を作らない」**
3. **「`num` フィールドは厳密に: section は `01`-`99`、cards/comparison/table/flow は `①`-`⑨` または空文字 `""` のみ。**漢字（'結'/'序'/'破'/'急'）や独自ラベル絶対禁止**」**
4. **「`section.title` は **2 行以下** に必ず収める。3 行以上は禁止。1 行目に「事例①」のような独立カテゴリラベルを置くのも禁止」**
5. **「`yt_slide_engine.py --verify` が PASS しても、JSON 内の num 値や title 行数を必ずセルフ目視確認する。`--verify` は画像 blob 健全性しか見ない」**

エンジン側にも `validate_slides_json()` で num 値域・title 行数チェックが入っており、違反時は ValueError で停止する。これは安全網であって、サブエージェントへの指示の代わりではない。**起動プロンプトで縛らないと、サブエージェントは自由解釈で再び暴走する**（過去実例あり）。

**両方完了後のメッセージ:**
```
✅ STEP 3 完了: スライドを生成しました（{N}枚 / verify {PASS|FAIL}）
✅ STEP 4 完了: 音声を生成しました（{M}分{S}秒）

📊 スライド: projects/{slug}/slides.pptx （自動で開きます）
🔊 音声: projects/{slug}/audio/full.wav  （自動でFinderで開きます）

📋 チャンク結合点（参考情報・確認は任意）:
{チャンク結合点テーブル / リスク判定 高/中/低}

→ STEP 5（音声分割）を自動で実行します。
   修正したい場合は実行を中断して指示してください。
```

**確認待ちなし。即座に STEP 5 へ進む。**
チャンク結合点テーブルや CTA 末尾チェック項目は参考情報として表示するのみ。
ユーザーが内容に問題を見つけた場合は、自分で実行を止めて修正指示を出せばよい。

---

### STEP 5: 音声分割 🤖

```
入力: full.wav + script.md
出力: projects/{slug}/audio/scenes/scene01〜{N}.wav + scene{N+1}_cta1〜scene{N+8}_cta8.wav
```

Whisper mediumで文字起こし → 台本の冒頭フレーズで正確にカット。
**CTA音声も8スライド分に自動分割する（確認不要・必ず実行）。**

**完了後のメッセージ:**
```
✅ STEP 5 完了: 音声を{N}シーン + CTA 8シーンに分割しました。

📁 保存先: projects/{slug}/audio/scenes/
   （自動でFinderで開きます）

| # | ファイル | 長さ | 冒頭テキスト |
|---|---------|------|------------|
| 1 | scene01_title.wav | 37.6秒 | 皆様こんにちは... |
| 2 | scene02_toc.wav | 16.4秒 | 本動画では... |
...

→ STEP 5.5（概要欄チャプター生成）に自動で進みます。
```

---

### STEP 5.5: 概要欄チャプター生成（実音声ベース） 🤖

STEP 5の分割結果から、各sceneのWAV秒数を取得し累積タイムスタンプを計算。
YouTube概要欄用のチャプター一覧を生成し、台本の概要欄テンプレートを実測値で更新する。

```
入力: scenes/*.wav の秒数
出力: 台本の概要欄チャプターを実測値で上書き

手順:
1. 各scene WAVのファイルサイズから秒数を算出（(bytes - 44) / 2 / 44100）
2. 累積タイムスタンプを計算
3. セクションタイトルスライド（sec01, sec02...）の開始時刻をチャプターとする
4. 形式: `M:SS セクション名`（YouTube準拠）
5. 台本ファイルの概要欄テンプレート内【目次】セクションを実測値で更新
6. ユーザーにチャプター一覧を表示（クリップボードにもコピー）
```

**完了後のメッセージ:**
```
✅ STEP 5.5 完了: 概要欄チャプターを実測値で生成しました。

📋 YouTube概要欄用チャプター:
{チャプター一覧}

→ STEP 6（HeyGen動画生成）に進みます（PPTX・音声アップ・アバター位置・BGM すべて自動・最後の生成ボタンのみ手動）。
```

---

### STEP 6: HeyGen動画生成 👤+🤖

> **STEP 0（必須・ブロッキング）**: このSTEP 6に入る前、または `_shared/heygen-setup.py` / `heygen-audio-upload.py` を触る前に、**必ず** `_shared/heygen-automation-learnings.md` を Read ツールで通読すること。
>
> - Why: シーンナビの仮想スクロール、React click 吸収、モーダル多層、FileChooser 2パターン、moveable.request リサイズ等、既知の罠がすべてそこに集約されている。読まずに着手すると同じ罠を踏む（過去に発生済み）。
> - How to apply: STEP 6 を開始する最初の応答の冒頭で必ず Read を実行する。「読んだ」と宣言してから自動化コマンドの実行案内に進む。スキップ禁止。
> - Fail-safe: ユーザーから HeyGen 関連の指示（「アバター位置」「音声アップ」「setup.py」等のキーワード）を受けた時点でも同じルールを適用する。

> **エラーで止まった時のルール（CRITICAL・絶対厳守）**
>
> **`_shared/heygen-setup.py` は憶測での編集禁止。** 途中で止まった・失敗シーンが出た場合、
> **`HEYGEN_START=N` で再実行する**（N は止まったシーン番号）。
>
> **ルールはこれだけ:**
> - ✅ `HEYGEN_START=N` で **最大5回再実行**（カウント起点: `HEYGEN_START=N` を叩いて失敗した回数。5回失敗で報告 = 6回目はやらない）
> - ✅ 5回試しても同じ場所で詰まる場合のみユーザーに報告
> - ❌ コードを編集しない（憶測での sleep 削除・scroll 高速化等は禁止。最適化版で実装済）
> - ❌ 5回未満でユーザーに相談しない（相談不要、もう一度叩け）
>
> **理由**: エラーの多くは HeyGen の UI 状態の一時的ズレ（右パネルが前シーンを残したまま等）で、
> 再実行で勝手に解消する（learnings Section 11 で実証。実例: 2回目で抜けて 28/28 完走）。
> 憶測での修正は過去に踏んだ罠を再発させるリスクが高い。
> ユーザーから明示的に改善を頼まれた場合のみコード変更可（実機検証必須・learnings.md に追記）。
> 現状版には速度最適化 (α+β / Section 10)、仮想スクロール対策 (Section 6)、moveable.request (Section 2.4)、Phase 0 Playwright CDP化 (Section 8) が入っている — 戻さないこと。

**手動作業: 最後の生成ボタン押下のみ**
**自動化済み:**
- PPTX アップロード + アバター選択（本番用：山口鳳汰）+ Create Video + 音声アップロード + アバター位置調整（200x200 / 右上角）→ `heygen-setup.py`
- BGM 追加 + Volume 1% + Loop music ON → `heygen-bgm-setup.py`

### CDP Chrome について（事前準備は不要）

`heygen-setup.py` は CDP 未検出時に自動で `chrome-cdp-launcher.sh start` を呼ぶ仕組み（[heygen-setup.py:111](../../../_shared/heygen-setup.py#L111)）。**ユーザー側で Chrome を起動する必要はない。**

ランチャー仕様（[scripts/chrome-cdp-launcher.sh](../../../../scripts/chrome-cdp-launcher.sh)）:
- 既存 Chrome の **Profile 4（walker-s.co.jp）を `/tmp/chrome-cdp-walkers/` に rsync コピー**してそのコピーを使う（HeyGen ログイン Cookie ごと引き継ぐ）
- **non-headless** で起動（headless だと HeyGen の FileChooser が発火しない既知の罠あり）
- 普段使いの Chrome とは別ディレクトリ・別プロセス → **既存 Chrome を閉じる必要なし**
- 既起動チェックあり（PID ファイル管理で冪等）
- 起動コマンド本体: `--remote-debugging-port=9222 --user-data-dir=/tmp/chrome-cdp-walkers --profile-directory=Default`

**手動操作（必要なら）:**
| 操作 | コマンド |
|---|---|
| 起動 | `bash /Users/naru/Walkers_naru/05_development/scripts/chrome-cdp-launcher.sh start` |
| 停止 | `bash /Users/naru/Walkers_naru/05_development/scripts/chrome-cdp-launcher.sh stop` |
| ポート確認 | `bash /Users/naru/Walkers_naru/05_development/scripts/chrome-cdp-launcher.sh port` |
| 自動起動を無効化 | `HEYGEN_NO_AUTOLAUNCH=1` 環境変数 |

**前提:** Profile 4 で walker-s.co.jp Google アカウント / HeyGen にログイン済みであること（普段の Chrome のセッション）。これさえ満たせば cron から `heygen-setup.py` を叩くだけで全部回る。

**実行プロトコル（Claude が Bash ツールで自動実行する。手順案内だけ出して止まるのは禁止）:**

各 Phase は `Bash(run_in_background=true)` で起動 → `Monitor` で完走を待つ。完走通知が来たら次の Phase に進む。

```
🎬 STEP 6: HeyGen動画生成（自動実行中）

PPTX→アバター選択→音声アップ→位置調整、BGM 追加・Volume 1%・Loop ON まで Claude が連続で叩きます。
CDP Chrome は未起動なら heygen-setup.py 内で自動起動。ユーザーが手で触るのは「最後の生成ボタン」だけ。

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 Claude が自動実行する3ステップ:

  【1】🤖 Phase 0: PPTXアップロード + アバター選択 + Create Video
     コマンド（Claude が Bash で叩く）:
       HEYGEN_SLUG={slug} HEYGEN_PPTX_PATH=projects/{slug}/slides.pptx /Users/naru/.pyenv/versions/3.13.0/bin/python3 _shared/heygen-setup.py
     ・PPTX をアップ → アバター「本番用：山口鳳汰(背景リアル&スーツ見えるver)」を自動選択 → ESC で拡大モーダル閉じ → Create Video → エディタ遷移 → 変換完了で停止
     ・✅ アバター選択後の ESC 自動送信は heygen-setup.py に組み込み済み（learnings.md Section 13）
     ・⚠ それでも Create Video ボタンが詰まる場合は CDP Chrome 再起動 → リトライ。最大5回まで再実行
     ・⚠ アップロード時「スライドの内容を編集可能な要素としてインポート」が出たら必ずOFFにすること（スクリプトが処理する）

  【2】🤖 Phase 1+2: 音声アップロード + アバター位置調整
     コマンド（Claude が Bash で叩く）:
       HEYGEN_SLUG={slug} /Users/naru/.pyenv/versions/3.13.0/bin/python3 _shared/heygen-setup.py
     ・全シーンに音声をアップロードし、アバターを 200x200 HeyGen単位で右上角に自動配置
     ・途中で「⚠ HeyGenシーン{N-1} ≠ scene_num={N} — ずれ懸念で中断」が出たら HEYGEN_START={N} で最大5回リトライ（CRITICAL ルール）
     ・5回失敗で報告。ドライラン確認は HEYGEN_DRY=1

  【3】🤖 BGM 設定: マイミュージックから既存トラック選択 + Volume 1% + Loop ON
     コマンド（Claude が Bash で叩く）:
       /Users/naru/.pyenv/versions/3.13.0/bin/python3 _shared/heygen-bgm-setup.py
     ・マイ ミュージックの既存 Audiio*.wav を timeline に追加（既にあればスキップ）
     ・audio bar を右クリック → context menu → Volume を 1% にドラッグ → Loop music を ON
     ・menu 開いたまま終了するので、ユーザーは画面で目視確認してから生成ボタンへ
     ・⚠ 前提: HeyGen の マイ ミュージック に Audiio*.wav が永続保存されていること（初回のみ手動アップロード必要）

━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚫 やってはいけないこと:
  - 「ターミナルで実行してください」「以下のコマンドを叩いてください」と手順だけ出して停止する
  - ユーザー名義の作業として書く（「👤 あなたの作業」のような表現）
  - Phase 完了通知を待たず次の Phase を起動する（Monitor で完走確認してから次へ）
  - **Phase 1+2 完走後に「BGM 設定に進めて良いですか？」と確認する**（不要・自動継続。Phase 1+2 が成功で完走したら即座に Phase 3 (heygen-bgm-setup.py) を起動する）

✅ 完了報告フォーマット（3 Phase 全完走後にユーザーへ送る）:
  - 完成シーン数 / 失敗シーン数
  - BGM 設定状態
  - 「プレビュー目視確認 → 生成ボタン押下 → 2〜4時間待機 をユーザーが行ってください」
  - 「動画完成後は /yt-upload を実行」

→ ここで yt-produce 終了。
```

---

## 後続スキル（yt-produce のスコープ外）

YouTube 投稿は完全に手動作業中心なので別スキルで管理する:

| 次のスキル | 役割 | 自動化レベル |
|---|---|---|
| `/yt-upload` | YouTube Studio へのアップロード（概要欄・サムネ・「改変されたコンテンツ」チェック・公開設定） | 手動 |

各スキルの操作手順は、それぞれの SKILL.md で管理されている。yt-produce 側で重複管理しない。

---

## 進捗表示

各STEP完了ごとに進捗を更新表示する（TodoWrite と併用）:

```
🎬 YouTube AI動画制作パイプライン (yt-produce)
━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ STEP 1: 記事取得           🤖 完了
✅ STEP 2: 台本生成           🤖 完了
✅ STEP 3: スライド生成       🤖 完了
✅ STEP 4: 音声生成           🤖 完了
✅ STEP 5: 音声分割           🤖 完了
✅ STEP 5.5: 概要欄チャプター 🤖 完了
⏳ STEP 6: HeyGen動画生成    🤖 自動実行中（Phase 0/1+2/BGM を Claude が連続で叩く）

🎉 yt-produce 完了 → 次は /yt-upload で YouTube 投稿
```

- STEP 1〜5.5 は完全自動進行
- STEP 6 も自動進行（Claude が Bash で heygen-setup.py + heygen-bgm-setup.py を直接叩く）。ユーザーが手動でやるのはプレビュー目視確認 → 生成ボタン押下のみ
- STEP 7（YouTube 投稿）は別スキル `/yt-upload` に委譲

## エラーハンドリング

**自動進行中にエラーが発生した場合は、即停止してユーザーに報告すること。** 憶測でリトライ・コード修正を行ってはいけない（特に `_shared/heygen-setup.py` は CLAUDE.md の記述通り憶測編集禁止）。下表の「対応」に該当する既知パターンに限り、自動でフォールバックして良い。

| エラー | 対応 |
|-------|------|
| WebFetch失敗 | Chrome MCP or Playwright MCPにフォールバック |
| ElevenLabs APIキーなし | `credentials/elevenlabs_api_key.txt` を確認。なければユーザーにヒアリング |
| ElevenLabs 5000文字超 | セクション遷移の位置で分割 → 複数APIコール → FFmpeg結合 |
| CTA音声崩壊 | CTA部分だけ再生成。テンプレート音声（`_shared/templates/cta_audio_pcm.wav`）があればそれを使用 |
| Whisper分割精度が低い | 全セグメント一覧を出力し、手動でカットポイントを調整 |
| スライド生成エラー | slides.jsonを確認し、エンジン（yt_slide_engine.py）を再実行 |

## 出力ファイル一覧

```
projects/
└── {slug}/
    ├── article.md                 # 記事テキスト
    ├── script.md                  # 台本
    ├── slides.json                # スライドデータ（単一ソース）
    ├── slides.pptx                # スライド（エンジン生成）
    └── audio/
        ├── full.wav               # 全体音声
        ├── full_pcm.wav           # PCM変換版（Whisper用）
        └── scenes/
            ├── scene01_title.wav  # シーン別音声
            ├── scene02_toc.wav
            └── ...
```

## コスト（1動画あたり）

| 項目 | 金額 |
|-----|------|
| ElevenLabs（約7,000文字） | 約210円 |
| HeyGen Avatar IV（約19分） | 約2,850円 |
| **合計** | **約3,060円** |

## 所要時間

| 区分 | 時間 |
|-----|------|
| 🤖 AI自動処理 | 約30分（BGM 自動化込み） |
| 👤 人間の手動作業 | 約30分（プレビュー確認 + 生成ボタンのみ。BGM 自動化前は約36分） |
| ⏳ HeyGen生成待ち | 2〜4時間（放置OK） |
| **実働合計** | **約1時間** |
