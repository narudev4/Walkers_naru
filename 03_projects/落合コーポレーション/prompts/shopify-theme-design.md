# Shopify B2Bテーマ HPデザイン反映（画像なし先行版）

## ゴール

落合コーポレーションのShopify B2Bストア（Riseテーマ）のデザインを、HPと統一する。
画像素材（ロゴ・商品写真）は未取得のためプレースホルダーで対応し、CSS level の変更を先行実装する。

## ストア情報

- ストア: ochiai-corp-dev.myshopify.com（開発ストア）
- テーマ: Rise（テーマID確認要）
- B2Bデモテーマ: 「B2B Demo」#181445329197
- HP（デザイン元）: https://ochiai-shuttlecock-2b5e01.vercel.app/

## 適用するデザイン仕様

### カラーパレット

| 役割 | HEX | 用途 |
|------|-----|------|
| Primary Dark | #222222 | ヒーロー・セクション背景・CTA背景 |
| Footer | #111111 | フッター背景 |
| Accent Blue | #4A90E2 | CTAボタン・お問い合わせボタン |
| White | #FFFFFF | テキスト(暗背景)・メイン背景 |
| Alt Background | #F5F5F5 | セクション交互背景 |

### フォント

- **Oswald**（Google Fonts）: 英語見出し・ナビ・ブランド表記。Weight 700, letter-spacing 2.8-4.2px, 大文字
- **Noto Sans JP**（Google Fonts）: 本文・日本語全般。Weight 400(本文)/500(見出し)

### タイポグラフィスケール

| 要素 | フォント | サイズ | ウェイト | letter-spacing |
|------|---------|--------|---------|----------------|
| Body | Noto Sans JP | 16px | 400 | 0.8px |
| H2 (大) | Noto Sans JP | 40px | 500 | 0.8px |
| H2 (標準) | Noto Sans JP | 32px | 500 | 0.64px |
| H3 | Noto Sans JP | 26-32px | 500 | 0.52-0.64px |
| ボタン | — | 14px | 500 | — |

line-height: 1.8（本文）

### コンポーネント

- **ヘッダー**: 透明背景、fixed、padding 24px 0
- **CTAボタン**: bg #4A90E2, color white, border-radius 16px, padding 12px 20px
- **フッター**: bg #111111, padding 100px 0 48px

## 実装手順

### 1. Google Fonts 読み込み

theme.liquid の `<head>` に Oswald + Noto Sans JP の Google Fonts `<link>` を追加。

### 2. テーマカスタマイザー設定

Shopify Admin > テーマ > カスタマイズ から以下を変更:
- Colors: 背景 #FFFFFF / テキスト #222222 / アクセント #4A90E2 / ボタン #4A90E2
- Typography: 見出し Oswald / 本文 Noto Sans JP（カスタマイザーで設定可能な範囲）

### 3. CSS カスタム変数の上書き

`assets/` 配下のCSSまたは `snippets/custom-styles.liquid` を作成し、Riseテーマの CSS 変数を HP仕様で上書き:

```css
:root {
  /* Colors */
  --color-background: #FFFFFF;
  --color-foreground: #222222;
  --color-accent: #4A90E2;
  --color-button: #4A90E2;
  --color-button-text: #FFFFFF;
  
  /* Typography */
  --font-heading-family: 'Oswald', sans-serif;
  --font-body-family: 'Noto Sans JP', sans-serif;
  --font-body-weight: 400;
  --font-heading-weight: 700;
  --font-body-size: 1.6rem;
  --body-line-height: 1.8;
  
  /* Letter spacing */
  --heading-letter-spacing: 0.08em;
}
```

### 4. ヘッダーのスタイル調整

- 背景を透明に
- ナビリンク: Oswald 14px 700 letter-spacing 2.8px uppercase
- お問い合わせボタン: bg #4A90E2 / border-radius 16px

### 5. フッターのスタイル調整

- 背景色: #111111
- テキスト色: #FFFFFF
- パディング: 100px 0 48px

### 6. セクション背景の交互配色

- メインセクション: #FFFFFF
- サブセクション: #F5F5F5
- ダークセクション（CTA等）: #222222

### 7. ボタンスタイル統一

全 `.button`, `.btn` 系:
- Primary: bg #4A90E2, color #FFFFFF, border-radius 16px
- Secondary: border 1px solid #222222, color #222222, border-radius 16px

### 8. 画像プレースホルダー

ロゴ・ヒーロー画像・商品写真は現状のまま or Shopify デフォルトのプレースホルダーを使用。
素材取得後（7/6 MTG以降）に差し替え。

## 注意事項

- Rise テーマの既存 CSS 変数名を事前に確認し、正しい変数名で上書きすること
- テーマエディタで設定可能な項目はエディタ経由で変更（CSS直書きより保守性が高い）
- b2b-wholesale-price.liquid 等のカスタムスニペットも新カラーに合わせる
- 変更は新しいテーマコピーで行い、既存の「B2B Demo」テーマを壊さない

## 完了基準

- [ ] フォント: Oswald + Noto Sans JP が全ページで適用されている
- [ ] カラー: #222222 / #4A90E2 / #F5F5F5 の3色が正しく使われている
- [ ] ヘッダー: 透明背景 + Oswald ナビ + 青CTAボタン
- [ ] フッター: #111111 背景
- [ ] ボタン: border-radius 16px + #4A90E2
- [ ] HPと並べて目視で「同じブランド」と感じるレベル（画像以外）
