// @ts-check
/**
 * A-2: MF クラウド請求書の「メール送信」を Playwright で自動実行する。
 * MF API に送信エンドポイントが無い（確定）ため、人間が押している送信ボタンを代行する。
 * 差出人は MF 公式（do_not_reply@moneyforward.com）のまま＝理想のユーザー体験を維持。
 *
 *   実行: node send-invoice.js --billing-number <請求書番号> [--headed]
 *   前提: npm run login 済み（.auth/mf-state.json にセッション保存済み）
 *
 * 手順（MF UI・2026-06 時点。UI変更時は debug/ のダンプを見て下のセレクタを直す）:
 *   1. 請求書一覧 https://invoice.moneyforward.com/billings を開く
 *   2. 請求書番号で対象行を見つけて開く
 *   3. 「メール送信」系ボタン → 送信モーダル → 送信実行
 *   4. 完了表示を確認（最終検証は呼び出し側が API の email_status で行う）
 *
 * 失敗時: debug/<時刻>-<段階>.png とボタン/リンク候補一覧を出力して exit 1。
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = resolve(__dirname, '.auth/mf-state.json');
const DEBUG_DIR = resolve(__dirname, 'debug');

const args = process.argv.slice(2);
/** @param {string} name */
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const billingNumber = argValue('--billing-number');
const headed = args.includes('--headed');
if (!billingNumber) {
  console.error('使い方: node send-invoice.js --billing-number <請求書番号> [--headed]');
  process.exit(1);
}
if (!existsSync(STATE_PATH)) {
  console.error(`セッションがありません: ${STATE_PATH}\n→ 先に \`npm run login\` で MF にログインしてください。`);
  process.exit(1);
}

const ts = new Date().toISOString().replace(/[:.]/g, '-');
/** 失敗時のデバッグダンプ。 @param {import('playwright').Page} page @param {string} stage @param {string} msg */
async function failDump(page, stage, msg) {
  mkdirSync(DEBUG_DIR, { recursive: true });
  const png = resolve(DEBUG_DIR, `${ts}-${stage}.png`);
  await page.screenshot({ path: png, fullPage: true }).catch(() => {});
  const candidates = await page
    .locator('button, a, [role="button"], input[type="submit"]')
    .evaluateAll((els) =>
      els
        .map((e) => (e.textContent || /** @type {HTMLInputElement} */ (e).value || '').trim())
        .filter((t) => t && t.length < 40)
    )
    .catch(() => []);
  const txt = resolve(DEBUG_DIR, `${ts}-${stage}-candidates.txt`);
  writeFileSync(txt, `URL: ${page.url()}\n\n[クリック候補]\n${[...new Set(candidates)].join('\n')}\n`);
  console.error(`❌ ${stage}: ${msg}`);
  console.error(`   スクリーンショット: ${png}`);
  console.error(`   候補一覧:           ${txt}`);
  process.exitCode = 1;
}

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ storageState: STATE_PATH });
const page = await context.newPage();
page.setDefaultTimeout(15000);

try {
  // 1) 請求書一覧
  await page.goto('https://invoice.moneyforward.com/billings');
  await page.waitForLoadState('networkidle');
  if (/sign_in|id\.moneyforward\.com|login/.test(page.url())) {
    await failDump(page, 'login-check', 'セッション切れです。`npm run login` で再ログインしてください。');
    process.exit(1);
  }

  // 1.5) チュートリアル吹き出しが出ていたら閉じる（トライアル口座の初回表示）
  const skip = page.getByText('スキップ', { exact: true }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});

  // 2) 対象請求書の行を選択（実構造 2026-06-10 プローブ確定:
  //    行本体は div.listItem___xxx。外側の listItemContainer___xxx を掴むと選択が切り替わらないため
  //    「listItem___」(三重アンダースコア付き) で行本体だけにマッチさせる）
  const row = page.locator('div[class*="listItem___"]').filter({ hasText: `【No.${billingNumber}】` }).first();
  if (!(await row.count())) {
    await failDump(page, 'find-billing', `請求書番号 ${billingNumber}（【No.${billingNumber}】）が一覧に見つかりません（ページングや検索が必要かも）。`);
    process.exit(1);
  }
  const rowText = (await row.textContent()) || '';
  if (/送付済み/.test(rowText)) {
    console.log(`ℹ️ 請求書番号 ${billingNumber} は既に「送付済み」です。二重送信を避けるため何もしません。`);
    await browser.close();
    process.exit(0);
  }

  // 3)〜4) 行選択 → プレビュー反映待ち →「メール」→ モーダルの請求書番号を照合。
  //    選択直後はプレビュー（＝モーダルの対象）が前の請求書のままのことがあるため、
  //    isActive 付与を待ち、描画待ちを挟み、番号不一致なら一覧から最大2回やり直す。
  let matched = false;
  for (let attempt = 1; attempt <= 2 && !matched; attempt++) {
    if (attempt > 1) {
      await page.goto('https://invoice.moneyforward.com/billings');
      await page.waitForLoadState('networkidle');
    }
    await page.locator('div[class*="listItem___"]').filter({ hasText: `【No.${billingNumber}】` }).first().click();
    // 選択が確定するのを待つ（クリックした行に isActive が付く）
    await page
      .locator('div[class*="listItem___"][class*="isActive"]')
      .filter({ hasText: `【No.${billingNumber}】` })
      .first()
      .waitFor({ state: 'visible' });
    await page.waitForTimeout(1500); // プレビュー描画待ち（モーダルは選択中プレビューを対象にする）

    // 「メール」ボタン（アイコン付きラベルのため role名完全一致では取れない。
    //  同列の他ボタン: 郵送 / デジタルインボイス / PDF / 印刷 / 複製 / 変換 — 「メール」を含むのはこれだけ）
    const mailBtn = page
      .locator('button, a, [role="button"]')
      .filter({ hasText: 'メール' })
      .filter({ hasNotText: 'デジタル' })
      .first();
    if (!(await mailBtn.count())) {
      await failDump(page, 'open-send', '「メール」ボタンが見つかりません。candidates.txt を確認してください。');
      process.exit(1);
    }
    await mailBtn.click();

    // 送信モーダル「請求書の送付」（実DOM 2026-06-10 プローブ確定: ルート= div.backdrop___xxx）
    await page.getByText('請求書の送付', { exact: true }).first().waitFor({ state: 'visible' });
    await page.waitForTimeout(500);

    // 安全装置: モーダルの請求書番号が指定と一致するか照合（誤送信防止の最終ゲート）
    const modalText = (await page.locator('div[class*="backdrop___"]').first().innerText()) || '';
    const m = modalText.match(/請求書番号\s*(\d+)/);
    if (m && m[1] === String(billingNumber)) {
      matched = true;
    } else if (attempt < 2) {
      console.log(`⚠️ モーダルの請求書番号(${m ? m[1] : '不明'})が指定(${billingNumber})と不一致 → 一覧からやり直します`);
    } else {
      await failDump(page, 'modal-mismatch',
        `モーダルの請求書番号(${m ? m[1] : '不明'})が指定(${billingNumber})と一致しません。誤送信防止のため中止します。`);
      process.exit(1);
    }
  }

  // 5) 確定ボタン <input type="submit" value="送信する">（実DOMプローブ確定）。
  //    注意: React は value を DOM プロパティで設定するため CSS 属性セレクタ [value="送信する"] は
  //    一致しない。a11yツリー（accessible name = value プロパティ）で取るのが正。
  const backdrop = page.locator('div[class*="backdrop___"]').first();
  let confirm = backdrop.getByRole('button', { name: '送信する' }).first();
  if (!(await confirm.count())) confirm = backdrop.locator('input[type="submit"]').first();
  await confirm.waitFor({ state: 'visible' });
  await confirm.click();

  // 5) 完了の気配を待つ（トースト/モーダル消滅）。確証は API email_status 側で取る。
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  console.log(`✅ 請求書番号 ${billingNumber} の送信操作を実行しました（最終確認は API の email_status で）。`);
} catch (e) {
  await failDump(page, 'unexpected', e instanceof Error ? e.message : String(e));
} finally {
  await browser.close();
}
