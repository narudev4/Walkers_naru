// @ts-check
/**
 * 固定ページ作成（会社概要・お問合せ・法定ページ）。
 * 同 handle のページが既存ならスキップ（冪等）。
 * 実行: node --env-file=.env src/setup-pages.js
 */
import { adminGraphQL } from './shopifyClient.js';

/** @type {{ title: string; handle: string; templateSuffix: string | null; body: string }[]} */
const PAGES = [
  {
    title: '会社概要',
    handle: 'about',
    templateSuffix: null,
    body: '<p>このページは現在準備中です。会社概要の内容は後日掲載いたします。</p>',
  },
  {
    title: 'お問合せ',
    handle: 'contact',
    templateSuffix: 'contact',
    body: '<p>このページは現在準備中です。お問合せフォームをご利用ください。</p>',
  },
  {
    title: '特定商取引法に基づく表記',
    handle: 'legal-notice',
    templateSuffix: null,
    body: '<p>このページは現在準備中です。特定商取引法に基づく表記は後日掲載いたします。</p>',
  },
  {
    title: 'プライバシーポリシー',
    handle: 'privacy-policy',
    templateSuffix: null,
    body: '<p>このページは現在準備中です。プライバシーポリシーは後日掲載いたします。</p>',
  },
  {
    title: '利用規約',
    handle: 'terms-of-service',
    templateSuffix: null,
    body: '<p>このページは現在準備中です。利用規約は後日掲載いたします。</p>',
  },
];

// --- 既存ページを handle で検索 ---

const QUERY_BY_HANDLE = `query($q: String!) {
  pages(first: 1, query: $q) {
    edges { node { id title handle } }
  }
}`;

const CREATE_PAGE = `mutation($page: PageCreateInput!) {
  pageCreate(page: $page) {
    page {
      id
      title
      handle
    }
    userErrors {
      field
      message
      code
    }
  }
}`;

async function run() {
  console.log('=== 固定ページ作成 ===\n');

  for (const p of PAGES) {
    // 既存チェック
    const existing = await adminGraphQL(QUERY_BY_HANDLE, { q: `handle:${p.handle}` });
    const found = existing.pages.edges[0]?.node;
    if (found && found.handle === p.handle) {
      console.log(`[SKIP] "${p.title}" (handle=${p.handle}) — 既存 ${found.id}`);
      continue;
    }

    // 作成
    /** @type {Record<string, any>} */
    const page = {
      title: p.title,
      handle: p.handle,
      body: p.body,
    };
    if (p.templateSuffix) {
      page.templateSuffix = p.templateSuffix;
    }

    const result = await adminGraphQL(CREATE_PAGE, { page });
    const errors = result.pageCreate.userErrors;

    if (errors && errors.length) {
      console.error(`[ERROR] "${p.title}": ${JSON.stringify(errors)}`);
      continue;
    }

    const created = result.pageCreate.page;
    console.log(`[OK]   "${created.title}" (handle=${created.handle}) — ${created.id}`);
  }

  console.log('\n完了');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
