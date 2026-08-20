---
description: セッション履歴・決定履歴・リポ状態を横断して「naru の盲点・繰り返しパターン・死んだルール」を抽出する週次ふりかえり。意思決定プロファイル（第二の脳）の更新と CLAUDE.md/hooks の改善提案まで行う。改善の適用は必ず naru 承認後。
---

# retrospect（週次ふりかえり・第二の脳エンジン）

トリガー: 「/retrospect」「ふりかえり」「振り返り」「レトロ」

## 目的

naru が一人では原理的にできない「自分の盲点の観測」を AI が代行する。
出力は3つ: **①週次ふりかえりレポート ②意思決定プロファイルの更新案 ③CLAUDE.md / hooks / スキルへの改善差分案**。
**③の適用は必ず naru の承認後**（このスキル自身は CLAUDE.md や settings.json を書き換えない — 提案止まり）。

## 定数

| キー | 値 |
|---|---|
| transcript 置き場 | `~/.claude/projects/-Users-naru-Walkers-naru/*.jsonl`（セッションごとに1ファイル。**巨大なので全文を main context に読まない**） |
| 意思決定プロファイル | `00_context/memories/decision-profile.md` |
| レポート出力 | `00_context/memories/retrospectives/{YYYY}-W{週番号}.md` |
| 管理スプシ「ふりかえり」タブ | `1K9r9NIdZG0C6DT9GV7edyZ6rl2nrcAARCZchwWMU9fQ` |
| パイプラインDB | `1tXlCsQGGCNxrmN4HqW2btLpx9YKY0fgzH86wwtXBsGU`（NA・実行ログ） |

## 実行手順

### Step 1: データ収集（直近7日 — 初回は14日）

1. **naru の生の発言を抽出**（最重要データ）: 直近7日に更新された transcript JSONL から python で抽出し、scratchpad の `retro-user-turns.txt` にまとめる
   - **抽出フィルタ（厳守 — 2026-07-07 実測に基づく）**: 各行 JSON で `type == "user"` **かつ** `isSidechain == false` **かつ** `message.content` が文字列（配列の場合は `text` 要素のみ採用し tool_result 要素は捨てる）。さらに `<command-` で始まるもの・`<system-reminder` を含むものは除外。これを守らないと AI 生成物が混入し分析全体が汚染される
   - **対象ファイルの絞り込み**: 7日以内更新の JSONL は数百ファイルあり得る（sidechain 含む）。メインセッション（サイズ上位 or ファイル名がセッション UUID 単体のもの）に絞り、除外したファイル数をレポートに明記。セッションごとに先頭 200 turn で打ち切り（打ち切りも明記）
2. リポの変化: `git log --oneline --since="7 days ago"` ＋ `git status` の未コミット数
3. 記録の変化: DAILY.md・decisions.md の直近7日分
4. パイプラインの実績: パイプラインDB の実行ログ・NA タブ（生成数/完了数/滞留/ブロック）
5. ルールの現状: CLAUDE.md・`~/.claude/settings.json` と `.claude/settings.json` の hooks 定義

### Step 2: 分析（サブエージェントに委譲 — main context を守る）

Step 1 の素材 2〜5 も scratchpad の個別ファイルに保存する（`retro-git.txt` / `retro-daily.txt` / `retro-pipeline.txt` / `retro-rules.txt`）。Agent ツールで分析エージェントを起動し、**この5ファイルのパスをプロンプトに列挙して**（再収集させない）以下を抽出させる:

1. **繰り返し**: naru が2回以上聞いた質問・2回以上出した同種の指示 → 文書化・スキル化候補
2. **ズレ**: naru の指示と AI の初回成果物がズレて修正が入ったパターン → CLAUDE.md/decision-profile に足すべき前提
3. **宙吊り**: 質問されたのに未回答のまま流れた確認・放置された宣言（「後でやる」）→ 意思決定キュー候補
4. **死んだルール**: 今週一度も発火しなかった/発火したのに毎回無視された CLAUDE.md ルール・hooks → 廃止候補（**廃止条件を満たしたかで判定**）
5. **盲点の再発**: ふりかえりタブの既知盲点（出口未記録・作りっぱなし・ルール堆積・無音故障・学び死蔵）の再発兆候
6. **意思決定パターン**: 即決したもの/保留したもの/差し戻したものの傾向 → decision-profile 更新案（「naru なら Yes」パターンの候補と根拠発言の引用）

### Step 3: 出力

1. レポートを `retrospectives/{YYYY}-W{週}.md` に保存（週番号は **ISO 週**: `date +%G-W%V`。ディレクトリが無ければ `mkdir -p`）（構成: 今週の数字 → 良かった構造 → 盲点の再発 → 改善提案（それぞれ差分形式・承認欄付き）→ decision-profile 更新案）
2. 管理スプシ「ふりかえり」タブに1行追記（**既存ヘッダー行を read してから列に合わせる**。列: 日付/盲点・発見/証拠/対策/状態/naruメモ）
3. decision-profile.md の更新**案**をレポート内に diff 形式で提示（直接編集しない — naru が「反映して」と言ったら適用）
4. チャットに要約（発見 Top3 + 承認が必要な提案一覧）を報告

## 安全規約

- CLAUDE.md・settings.json・SKILL.md・decision-profile.md への変更は**提案のみ**。適用は naru の明示承認後
- **本スキルが書き込んでよいのは2箇所だけ**: `retrospectives/` 配下のレポートと、管理スプシ「ふりかえり」タブへの行追記
- transcript には顧客情報・認証情報が含まれ得る → 抽出物はレポートに**要約のみ**転記（生ログの長い引用禁止）、scratchpad の中間ファイルは終了時に削除
- 過去の naru の発言を引用する際は文脈を保つ（切り取りで意図を歪めない）

## 運用

- 週1回（金曜夕方 or 月曜朝）に手動起動が基本。morning-routine への組み込みは運用が安定してから提案
- 初回実行はこのスキル自身の検証を兼ねる: レポートに「このスキルの手順で曖昧だった箇所」を自己申告させること

## 変更履歴

- 2026-07-07: 初版（Fable5 最終セッションで設計。盲点分析の基準線は管理スプシ「ふりかえり」タブ参照）
