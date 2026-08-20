# モック実装へのポインタ

実装本体は CLAUDE.md の規約に従い `output/deploy/` 配下に置く。
本案件ディレクトリからはここのポインタで参照する。

## 実装本体

[output/deploy/pref-fukuoka-eco-mockup/](../../output/deploy/pref-fukuoka-eco-mockup/)

## 主要 URL（ローカル開発）

| URL | 機能 | 主な見どころ |
|---|---|---|
| `/` | ホーム | 4 機能タイル + ふりがな対応の児童向けトーン |
| `/textbook` | 副読本目次 | 全 56 ページ・4 章 13 節の構造、「ごみの処理」のみクリック可 |
| `/textbook/gomi` | ごみの処理 p.20-21 | 副読本のサンプル完成版。**検索バー**・用語ポップアップ・動画・キャラ吹き出し・関連ページ |
| `/vr` | VR 自然探検 | 実写パノラマ・ドラッグ見回し・生き物ホットスポット |
| `/quest/challenges` | 環境クエスト | 10 問デッキ→アバター完全体→複数セット |
| `/quest/stamp` | スタンプラリー | 生物・現象 図鑑、カメラ撮影、外来種ボーナス |

## 5/28 デモ動線（提案）

1. `/` で「4 機能あります」を 30 秒
2. `/textbook` で「副読本まるごとデジタル化、56 ページ 4 章」を 30 秒
3. `/textbook/gomi` で「サンプル 1 見開きの作り込み」を 2-3 分（検索・用語・動画・キャラ）
4. `/vr` で「自然学習」を 1 分（ドラッグで見回す、生き物クリック）
5. `/quest/challenges` で「楽しく学べる」を 1 分（10 問・アバター成長）
6. `/quest/stamp` で「野外活動」を 30 秒（カメラ起動デモ）

## 起動方法

```bash
cd output/deploy/pref-fukuoka-eco-mockup
npm run dev
# → http://localhost:3000 （または autoPort で別ポート）
```

または Claude Preview を使う場合:
- `.claude/launch.json` の "fukuoka-eco-mockup" を `preview_start` で起動

## デプロイ状況

- Vercel プレビュー: 既存（旧版時点）
- 本番デプロイ: **5/28 MTG 後に naru が判断 → 必要なら `.claude/refs/vercel-deploy.md` の正規手順で実施**
- ⚠️ `vercel --yes` や `vercel --prod --yes` は禁止（CLAUDE.md ルール）

## 議事録要件 → 機能反映マップ

→ [CONTEXT.md セクション 5](./CONTEXT.md#5-520-mtg--モック-仕様反映マップ) 参照

## 関連リソース

- 副読本原本 PDF: `output/deploy/pref-fukuoka-eco-mockup/public/minna-no-kankyo-r8.pdf`
- 副読本目次データ: `output/deploy/pref-fukuoka-eco-mockup/src/lib/textbookToc.ts`
- ふりがなユーティリティ: `output/deploy/pref-fukuoka-eco-mockup/src/lib/furigana.tsx`
- AGENTS.md（プロジェクト固有の Next.js 注意事項）: `output/deploy/pref-fukuoka-eco-mockup/AGENTS.md`
