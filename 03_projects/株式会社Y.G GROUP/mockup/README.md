# MAREN会員プラットフォーム モックアップ

- URL: https://maren-membership.vercel.app
- Basic認証: `walkers` / `a7c2xujl3c`
- ソース: `output/deploy/maren-membership/`
- 技術: Next.js 16.2.12（App Router）/ TypeScript / Tailwind CSS v4 / Vercel
- 認証ゲート: `src/proxy.ts`（v16で middleware.ts から改名。関数名 `proxy`・configのexport名は `config` のまま）

## 画面一覧（12）

### 会員向け（スマホ／LINEミニアプリ内で起動する想定）
| # | パス | 内容 |
|---|---|---|
| 01 | `/member/onboarding` | LINEログイン→電話番号認証→属性アンケート→完了。4ステップを実際にクリックで進められる。WhatsApp・カカオトークのログインボタンも配置（フェーズ1bのため非活性） |
| 02 | `/member` | デジタル会員証・保有ポイント・ランク進捗・お知らせ・来店履歴 |
| 03 | `/member/checkin` | NFCタッチとQR読み取りの2モード。QRは60秒カウントダウンで実際に再生成される。不正防止の理由を4点明示 |
| 04 | `/member/rank` | ランク階段（生地→熟成→磨練→事上）。「全クリしない」設計の説明。チタン製リアルカードの申請 |
| 05 | `/member/coupons` | 所持／交換のタブ。店頭提示画面はモーダルで再現 |
| 06 | `/member/stores` | 国内5店舗＋チューリッヒ。日本語／English 切替が実際に動く |
| 07 | `/member/settings` | 機種変更の引き継ぎ手順、言語、通知チャネル |

### 本部・店長向け（PC・業務コンソール）
| # | パス | 内容 |
|---|---|---|
| 08 | `/admin/analytics` | 来店推移・性別・年代・国籍・来店頻度・ランク分布。期間/店舗フィルタ、表ビュー切替 |
| 09 | `/admin/campaigns` | セグメント指定で到達予定人数がリアルタイムに変わる。配信履歴と自動配信 |
| 10 | `/admin/members` | 会員一覧の検索・ランク絞り込み、右ペインに会員詳細 |
| 11 | `/admin/help` | 店舗オペレーション／会員対応／本部向けのQ&A。キーワード検索 |

`/` はテストハブ。フェーズ1a／フェーズ1b／将来拡張の3分類で表示。

## デザイン

成果物タイプは会員アプリ=B（魅せる）、管理コンソール=A（業務システム）として作り分けた。同じモック内で混ぜていない。

- コンセプト: ブランド名の由来「事上磨練」＝練り磨く
- 会員アプリ: 墨 `#14110F` のダーク＋琥珀 `#C8811F`（鶏油の色）＋生成り `#EDE7DB`。端末フレーム内に表示
- 管理コンソール: 生成り `#F4F1EA` のライト＋永続サイドバー＋高密度テーブル。宣伝コピーなし
- フォント: 見出し Shippori Mincho B1 ／ 本文 Zen Kaku Gothic New ／ 欧文 Cormorant Garamond。**管理コンソールの数字はゴシックのライニング数字**（Cormorantのオールドスタイル数字は表の走査性を落とすため）

## チャートの配色検証

dataviz の6チェック（明度帯・彩度床・CVD分離・通常視力床・コントラスト）を `validate_palette.js` で通している。

- 性別3色 `#c8811f,#2a6fb5,#c2417f` → **ALL PASS**
- 国籍5色 `#c8811f,#2a6fb5,#b5342a,#2e8b57,#8b4fc4` → PASS（緑↔赤の deutan ΔE 6.2 は WARN 帯のため、直接ラベル＋2pxギャップで補完）
- 国籍は当初6カテゴリだったが隣接ペアの分離基準を満たさず、欧州＋北米を「欧米」に畳んで5カテゴリにした
- 年代・来店頻度・ランク分布・来店推移は単一系列のため単色（琥珀）

## 更新手順

```bash
cd output/deploy/maren-membership
npm run build && npx vercel --yes --prod
```
