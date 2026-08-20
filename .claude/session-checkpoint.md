# Session Checkpoint

> このファイルはAIが自動更新する。新セッションで「前回の続きから」と言えば復旧に使われる。

Updated: 2026-07-22

## Current Task
落合コーポレーション Shopify ローンチ準備。8月末（8/29）公開目標。本日 7/22 MTG で先方共有タブを提示予定。次セッションは「B2B トンマナの競合調査」と「完全理解設計書（Fingate 超え）」から入る。

## Progress
- [x] 残作業インベントリ・テストシナリオ99ケース・ローンチ工程表 v2（Codex+Haiku クロスレビュー反映済み・56タスク）をスプシに作成
- [x] 先方共有タブ v4 完成（フェーズ▶構造+週ガント+Shopify規約根拠+確認事項8件）。古谷さんFB（トンマナ用語・句点・宏樹様表記・規約明記）反映済み
- [x] 一次情報調査3本（Shopify本契約/移譲・佐川連携・後払い/PayPay）→ launch-plan/03-briefing-qa.md に Q&A 13問+数値出所台帳
- [x] 案件 CLAUDE.md に文書チェック4原則（用語表/句点/確定未確定/読み戻し）を追加
- [ ] 工程表 v2 の naru 最終承認
- [ ] ストア種別確認（Dev Dashboard で client transfer store か dev store か。全工程の分岐点・1分）
- [ ] 確認事項の先方送付（シートは完成、送付待ち）
- [ ] B2B トンマナ: 競合調査から作り直し（Next.js 叩き台3案 /b2b-a,b,c は未レビュー保管）
- [ ] 完全理解設計書の作成（構成案は 05-next-session-brief.md）

## Files Modified
- 03_projects/落合コーポレーション/launch-plan/00〜05（インベントリ/工程表/テストシナリオ/Q&A/レビュー用/次セッションブリーフ）
- 03_projects/落合コーポレーション/CLAUDE.md（文書チェック4原則）
- 03_projects/落合コーポレーション/CONTEXT.md（§14 MF連携本番化前提・B2Cトンマナ未確定の訂正注記）
- スプシ（1qQMK...Dw4）: 「公開までの流れ（先方共有用）」「ローンチ工程表_draft」「ローンチ残作業一覧_draft」「テストシナリオ_draft」タブ
- output/deploy/ochiai-b2c-concept/src/app/b2b* （叩き台・未レビュー）

## Key Context
- 重要発見: 移譲できるのは client transfer store のみ／カスタムアプリ・webhook は移譲後に再作成が公式前提／e飛伝IIは終了済み（Ship&co or プラスシッピング推奨）／PayPay は KOMOJU 経由／後払い(Paidy)は先方要望済みで初回公開に含める前提
- B2C トンマナは未確定（7/15「案B選定」記録は naru が訂正。6案から選定中）
- 掛率実値（要件定義書 No.2）は値が壊れており demo 値運用中。沖縄B2B送料5万は先方回答済み（No.4）で再確認不要
- 用語: トンマナ（「デザイン」禁止）/ 宏樹様・ぽぽ様 / 業者様向け(B2B)・一般のお客様向け(B2C)
- 古谷さん FB: 「商品ごとの掛け率追加でチェック増の懸念」→ 設計書の変更影響マトリクスで返す（05-next-session-brief.md 参照）

## Next Steps
- 次セッション冒頭: launch-plan/05-next-session-brief.md を読む → B2B トンマナ競合調査（卸EC・スポーツメーカーB2B）から着手
- 並行: 完全理解設計書（データ辞書/根拠台帳/変更影響マトリクス/フロー図/用語辞書/運用チェックリスト）の起草 → Codex+Haiku レビュー → naru への逆レビューQA
- naru 確認待ち: 工程表 v2 承認・ストア種別確認・確認事項送付のタイミング
- 【別案件・前チェックポイントから引き継ぎ】1LC: 岩下様への Chatwork 報告が未完（AWS 部分＝古谷さん確認内容待ち）
