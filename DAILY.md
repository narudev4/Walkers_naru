# 日報・作業ログ

<!-- 15分刻みの工程表テンプレート -->
<!-- daily-schedule スキルが自動生成します -->

## 2026-05-20 anything Shopify モックアップ構築

- ストア: https://anything-oz074mzp.myshopify.com/  /  テーマ: Horizon
- 商品6点・在庫・burst画像/  Smart Collections 9件・各画像設定
- index.json: announcement / hero(trench coat) / marquee / NEW ARRIVALS / brand story / SHOP BY TYPE / JOURNAL / footer
- header: ロゴ中央寄せ・国/言語非表示  /  footer: ANYTHING JOURNAL ニュースレター日本語化
- News blog: 記事「ANYTHING、6月オープンに向けて」POST 済み
- 構築スクリプト: `03_projects/anithing/mockup/scripts/01〜24`
- バックアップ: `scripts/_backup_theme/`

### MTG 時の説明事項（保留中）
- 通貨表示: USD のまま（`read/write_markets` スコープ不足。本番では Markets 設定で JPY 切替）
- グローバルナビ（Home/Catalog/Contact）: `write_online_store_navigation` スコープ不足のため英語ママ
- ストアパスワード: 解除 or 共有が必要

### QA 検出 → 全て修正済み
1. cl_types セクションが縦並びに崩壊（8944px）→ `settings.collection_list` に変更、5列グリッド復活（519px）
2. NEW ARRIVALS 画像比率バラバラ → `image_ratio: portrait` 統一
3. NEW ARRIVALS 重複（3商品 × 3）→ 全6商品に `new` タグ付与
4. Hero クロップ（モデル胴体しか見えない）→ `section_height: full-screen`
- PC/モバイル/PDP/コレクションページ 全て横スクロールなし・layout 正常

### 次セッションへの引き継ぎ
- ✅ Shopify モックは渡辺さん確認待ち（https://anything-oz074mzp.myshopify.com/）
- 🔜 提案書作成: Google Drive にあるテンプレを使う
  - Claude Code 再起動後に `mcp__google-workspace__*` 経由で Drive を検索
  - workspace-mcp の古いプロセス（ポート 8000-8004 占有してた5個）は kill 済み
