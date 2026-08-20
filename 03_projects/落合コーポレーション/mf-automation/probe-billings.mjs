import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: '.auth/mf-state.json' });
const page = await context.newPage();
await page.goto('https://invoice.moneyforward.com/billings');
await page.waitForLoadState('networkidle');
// リスト行っぽい要素のテキストを全部出す（行構造の実地確認）
const dump = await page.evaluate(() => {
  const out = [];
  // 左ペインの行候補: リンク/リスト要素で金額や No. を含むもの
  document.querySelectorAll('a, li, [class*="list"] > div').forEach((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t && t.length < 120 && /No\.|¥|円/.test(t)) out.push(`<${el.tagName.toLowerCase()} class="${(el.className||'').toString().slice(0,60)}"> ${t}`);
  });
  return [...new Set(out)].slice(0, 40);
});
console.log(dump.join('\n'));
console.log('\n--- 「メール」ボタンの存在確認 ---');
for (const name of ['メール', '郵送', 'PDF']) {
  const c = await page.getByRole('button', { name, exact: true }).count();
  const c2 = await page.getByRole('link', { name, exact: true }).count();
  console.log(`${name}: button=${c} link=${c2}`);
}
await browser.close();
