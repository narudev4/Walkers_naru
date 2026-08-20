# WS3: walkers-code-review による実装×仕様の突合レビュー

あなたは落合コーポレーション案件のレビュー担当。9/1 の業者様向け（B2B）試験運用を前に、**実装が仕様（真理源スプレッドシート）と食い違っていないか**を、スキル `walkers-code-review` の観点巡回で洗う。

**進め方の大原則**: 人間への質問はしない。確認できない観点は `blocked`（理由と残存リスク付き）として先へ進む（CLAUDE.md のヒアリング原則より本指示が優先）。

## 実行方法

1. スキル定義 `/Users/naru/Walkers_naru/walkers-code-review/SKILL.md` と `references/checkpoints.md` を読み、手順に**忠実に**従う（状態ファイル初期化 → 観点を 1 つずつ巡回。まとめて完了扱いにしない）。
2. 初期化コマンド（誤コピー防止のため具体化。`<skill-dir>`=`/Users/naru/Walkers_naru/walkers-code-review`）:
   ```bash
   node <skill-dir>/scripts/review-state.mjs init \
     --checkpoints <skill-dir>/references/checkpoints.md \
     --state <temp-dir>/review-state.json \
     --mode full \
     --scope "ochiai-integrations workers + shopify src（B2B 9/1 試験運用前の仕様突合）" \
     --base "HEAD" --head "HEAD" \
     --profiles "web,api,payments"
   ```
3. **対象範囲（明示列挙）**:
   - 含める: `ochiai-integrations/workers/src/`・`ochiai-integrations/workers/test/`・`ochiai-integrations/workers/schema.sql`・`ochiai-integrations/workers/wrangler.toml`・`ochiai-integrations/shopify/src/`。
   - 除外: `node_modules/`・`ochiai-integrations/webhook/`（旧 Vercel・停止済み）・`ochiai-integrations/mf-automation/`（凍結・本番不使用）・`ochiai-integrations/moneyforward/`（ローカル検証用。Workers 側に同等実装あり）。
   - `ochiai-theme/` は任意（時間が余った場合のみ、B2B 価格表示・遮蔽まわりに限定）。
4. 仕様資料（D4 観点の突合元）:
   - 真理源スプシ（ID `1fExbd7s5B305TkWlFk5uNF4gWV-FJwtWbF2hxrDDvo4`）の「工程表」「画面一覧」「機能詳細」「質問事項」タブ。`mcp__google-workspace__read_sheet_values` で読む（読み取りのみ）。**このツールが使えない場合、UUID プレフィックス形式の Google 系コネクターへ代替してはならない**。D4 を `blocked` とし、以下のローカル資料のみで続行する。
   - ローカル: `launch-plan/37-ビジネスフロー一覧_20260818.md`・`launch-plan/20-掛け率仕様_古谷設計確定_20260804.md`・`launch-plan/18-入金消し込み設計_20260803.md`・`launch-plan/24-送料設計_K1叩き台_20260806.md`・`launch-plan/34-0820引き継ぎ計画_進捗と残作業_20260818.md`。
5. 重点確認（D4 で必ず対応付ける）: 支払区分 3 種の締め・期日計算／掛け率の読み先（顧客区分×商品区分メタオブジェクト・%→掛率変換 (100−%)÷100）／最低発注数 10／返品・キャンセルの締め除外／二重請求防止／MF 取引先の書き戻し。
6. **「未実装」を欠陥と断定する前に必ず工程表の最新ステータスと突合する**。例: 業者様向け送料（工程表 D-3）は 8/18 時点で未実装が正だが 8/19 に実装予定 — レビュー時点のスプシの記載で判断し、「工程表上も未着手」なら所見ではなく「仕様どおり未実装」と記録する。

## テスト実行のルール

- `npm test`（`ochiai-integrations/workers/` 内）はローカル完結なので実行してよい。失敗した場合は、コマンド・失敗理由・残存リスクを記録し、環境起因なら `blocked` とする。**リモート（本番 Workers・Shopify・MF・D1）への状態変更操作は一切しない**（読み取り API は可）。

## 成果物

- スキルのレポートテンプレートに従ったレビュー結果を `launch-plan/40-レビュー結果_20260819.md` に保存する。**`ochiai-integrations/` 配下には作らない**（launch-plan はレポート置き場として明示要求されている）。
- 所見には必ず「仕様の出典（スプシのタブ・行 or 文書名）」と「実装の位置（ファイル:行）」を対で付ける。
- Critical/High はスキルの絶対ルールどおり反証確認してから確定する。
- 所見の日本語は平易に（読者は naru と古谷さん。「冪等」等は一言説明を添える）。

## 時間切れ・観点が多すぎる場合

観点の途中でも、巡回済み観点の所見＋未巡回観点の一覧（`summary` 出力）を 40 に書き出して終了してよい。未巡回を「問題なし」と書かない。

## 完了時

`ListAgents` で `ochiai-hq` を探し、`SendMessage` で「成果物パス・Critical/High の件数と一行要約・blocked 観点数・未巡回観点数」を送る。**ochiai-hq が見つからない・ツール自体が使えない場合も同じ扱い**とし、同内容を成果物末尾に「## hq への報告」として書く。
