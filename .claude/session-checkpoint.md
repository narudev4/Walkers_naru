# Session Checkpoint

> このファイルはAIが自動更新する。新セッションで「前回の続きから」と言えば復旧に使われる。

Updated: 2026-04-13 (記事1〜10 QA完了、11〜29残り)

## Current Task

**CroixAsia-news のコンテンツ移行QA。1記事ずつSTGと本番を比較し、移行ミスがないか確認する。**

## QA進捗

| # | 記事 | 結果 | 日付 |
|---|------|------|------|
| 1 | nemcaro-apparel-team-launch | ✅ OK | 2026-04-13 |
| 2 | 2026_newyear | ✅ OK | 2026-04-13 |
| 3 | croix-studyjam | ✅ OK | 2026-04-13 |
| 4 | nemcaro | ✅ OK | 2026-04-13 |
| 5 | relaxest_ebisu | ✅ OK | 2026-04-13 |
| 6 | relaxest_sumire | ✅ OK | 2026-04-13 |
| 7 | itakeru | ✅ OK | 2026-04-13 |
| 8 | クロア創業15周年 | ✅ OK | 2026-04-13 |
| 9 | 販売中止のお知らせ | ✅ OK | 2026-04-13 |
| 10 | RELAX WORLD MUSIC | ✅ OK | 2026-04-13 |
| 11〜29 | 未着手 | | |

## 次セッションでの再開手順

1. 管理シートから記事11以降のURLを取得
   - スプレッドシートID: `10lf_cD8tmNGN1K70J4JnRy2SfKPnFr_HHO3tPH5OGdM`
   - シート: `CroixAsia-News-pm細谷` (gid=383853367)
   - A列=No, B列=タイトル, C列=URL(本番), D列=移行先URL(STG), E列=walkersチェック, F列=walkers確認者
2. Playwrightで STG と本番の両方を開いてコンテンツを比較
3. 結果を報告 → naruさんがブラウザで確認 → OKなら進捗記録

## QAルール

- **チェックする**: テキスト欠落・文字化け、画像抜け、リンク切れ、見出し崩れ、figcaption欠落、iframe欠落
- **チェックしない**: デザイン差異、テーマ違い、ヘッダー・フッター、新サイト追加要素、STGドメインURL
- STGはHTTPのみ → **WebFetch使えない、Playwright必須**
- Basic認証はURL埋め込み: `http://test:test2025@stg.croix.asia/...`

## QA手順（CRITICAL）

**navigate直後にスクリーンショット/画像チェックをしてはならない。必ずスクロール→画像ロード待ち→チェックの順。**

各記事のチェック手順:
1. STGにアクセス（http://、Basic認証URL埋め込み）
2. **スクロールJS実行**（lazy load発火 + 画像ロード待ち）:
```js
async () => {
  const step = () => new Promise(r => { window.scrollBy(0, 800); setTimeout(r, 150); });
  const maxSteps = Math.ceil(document.body.scrollHeight / 800) + 6;
  for (let i = 0; i < maxSteps; i++) await step();
  window.scrollTo(0, 0);
  const imgs = [...document.querySelectorAll('img')];
  await Promise.all(imgs.map(img => {
    if (img.loading === 'lazy') img.loading = 'eager';
    if (img.complete) return Promise.resolve();
    return new Promise(r => {
      img.addEventListener('load', r, { once: true });
      img.addEventListener('error', r, { once: true });
      setTimeout(r, 3000);
    });
  }));
}
```
3. コンテンツ情報取得（画像数・iframe数・見出し・テキスト長）
4. 本番でも同じ手順を実行
5. 両者を比較して結果判定

## チェック用JS（コンテンツ情報取得）

```js
() => {
  const c = document.querySelector('.media_detail_content') || document.querySelector('.entry-content') || document.querySelector('article') || document.body;
  const imgs = [...c.querySelectorAll('img')].map(img => ({ src: img.src?.substring(0, 80), alt: img.alt, w: img.naturalWidth, h: img.naturalHeight }));
  const iframes = [...c.querySelectorAll('iframe')].map(f => ({ src: f.src?.substring(0, 100) }));
  const headings = [...c.querySelectorAll('h1,h2,h3,h4')].map(h => ({ tag: h.tagName, text: h.innerText?.substring(0, 60) }));
  const textLen = (c.innerText || '').length;
  return { imgCount: imgs.length, iframeCount: iframes.length, textLen, imgs, iframes, headings };
}
```

## 参照ファイル

- 共通ルール: `05_development/migration_qa/CLAUDE.md`
- サイト定義: `05_development/migration_qa/sites/croix-news.toml`
