// @ts-check
/**
 * スポーツ × カテゴリ 自動コレクション作成スクリプト
 *
 * 要件定義書 質問No.7 確定の構成に基づき、SmartCollection を作成する。
 * Product metafield (b2b.sport / b2b.category) による自動分類。
 *
 * 実行: node --env-file=.env src/setup-collections.js
 * 冪等: 同名コレクションが既に存在する場合はスキップ。
 */
import { adminGraphQL } from './shopifyClient.js';

// ─── コレクション定義 ───────────────────────────────────

const SPORTS = [
  {
    key: 'badminton',
    label: 'バドミントン',
    categories: [
      { key: 'wear', label: 'ウェア' },
      { key: 'racket', label: 'ラケット' },
      { key: 'shoes', label: 'シューズ' },
      { key: 'shuttle', label: 'シャトル' },
      { key: 'string', label: 'ストリング' },
      { key: 'accessory', label: 'アクセサリー' },
    ],
  },
  {
    key: 'tennis',
    label: 'テニス',
    categories: [
      { key: 'wear', label: 'ウェア' },
      { key: 'racket', label: 'ラケット' },
      { key: 'shoes', label: 'シューズ' },
      { key: 'ball', label: 'ボール' },
      { key: 'accessory', label: 'アクセサリー' },
    ],
  },
  {
    key: 'pickleball',
    label: 'ピックルボール',
    categories: [
      { key: 'wear', label: 'ウェア' },
      { key: 'padel', label: 'パデル' },
      { key: 'shoes', label: 'シューズ' },
      { key: 'ball', label: 'ボール' },
      { key: 'accessory', label: 'アクセサリー' },
    ],
  },
];

// ─── GraphQL ────────────────────────────────────────────

/** 既存コレクションのタイトル一覧を取得（ページネーション対応） */
async function fetchExistingCollectionTitles() {
  /** @type {Set<string>} */
  const titles = new Set();
  let cursor = null;
  let hasNext = true;

  while (hasNext) {
    const query = `query($cursor: String) {
      collections(first: 100, after: $cursor) {
        edges {
          node { title }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }`;
    const data = await adminGraphQL(query, { cursor });
    for (const edge of data.collections.edges) {
      titles.add(edge.node.title);
      cursor = edge.cursor;
    }
    hasNext = data.collections.pageInfo.hasNextPage;
  }
  return titles;
}

/**
 * metafield 定義 ID を取得する。
 * collectionCreate の ruleSet.rules で metafield 条件を使うには
 * metafieldDefinitionId が必要。
 * @param {string} namespace
 * @param {string} key
 * @returns {Promise<string>} metafieldDefinition の GID
 */
async function getMetafieldDefinitionId(namespace, key) {
  const query = `query($namespace: String!, $key: String!) {
    metafieldDefinitions(
      first: 1,
      ownerType: PRODUCT,
      namespace: $namespace,
      key: $key
    ) {
      edges {
        node { id namespace key }
      }
    }
  }`;
  const data = await adminGraphQL(query, { namespace, key });
  const edges = data.metafieldDefinitions.edges;
  if (!edges.length) {
    throw new Error(
      `Metafield 定義が見つかりません: ${namespace}.${key}。` +
      '先に Shopify 管理画面 → 設定 → カスタムデータ → 商品 で定義を作成してください。'
    );
  }
  return edges[0].node.id;
}

/**
 * SmartCollection を作成する。
 * @param {object} params
 * @param {string} params.title
 * @param {Array<{column: string, relation: string, condition: string, conditionObjectId?: string}>} params.rules
 * @param {boolean} params.disjunctive — true=OR, false=AND
 */
async function createSmartCollection({ title, rules, disjunctive }) {
  const mutation = `mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        title
        handle
        ruleSet { rules { column relation condition } }
      }
      userErrors { field message }
    }
  }`;

  const input = {
    title,
    ruleSet: {
      appliedDisjunctively: disjunctive,
      rules,
    },
  };

  const data = await adminGraphQL(mutation, { input });
  const result = data.collectionCreate;

  if (result.userErrors && result.userErrors.length) {
    console.error(`  [ERROR] ${title}: ${JSON.stringify(result.userErrors)}`);
    return null;
  }
  return result.collection;
}

// ─── メイン ─────────────────────────────────────────────

async function main() {
  console.log('=== 自動コレクション作成スクリプト ===\n');

  // 1. 既存コレクションを取得（重複チェック用）
  console.log('1. 既存コレクション取得中...');
  const existing = await fetchExistingCollectionTitles();
  console.log(`   ${existing.size} 件のコレクションを検出\n`);

  // 2. metafield 定義 ID を取得
  console.log('2. Metafield 定義 ID 取得中...');
  const sportDefId = await getMetafieldDefinitionId('b2b', 'sport');
  const categoryDefId = await getMetafieldDefinitionId('b2b', 'category');
  console.log(`   b2b.sport    → ${sportDefId}`);
  console.log(`   b2b.category → ${categoryDefId}\n`);

  // 3. コレクション作成
  console.log('3. コレクション作成...\n');

  let created = 0;
  let skipped = 0;

  for (const sport of SPORTS) {
    // ── 親コレクション（スポーツ単体） ──
    const parentTitle = sport.label;
    if (existing.has(parentTitle)) {
      console.log(`  [SKIP] ${parentTitle}（既存）`);
      skipped++;
    } else {
      const col = await createSmartCollection({
        title: parentTitle,
        disjunctive: false, // AND（条件1つなので実質関係なし）
        rules: [
          {
            column: 'PRODUCT_METAFIELD_DEFINITION',
            relation: 'EQUALS',
            condition: sport.key,
            conditionObjectId: sportDefId,
          },
        ],
      });
      if (col) {
        console.log(`  [OK]   ${col.title}  (handle: ${col.handle}, id: ${col.id})`);
        created++;
      }
    }

    // ── 子コレクション（スポーツ × カテゴリ） ──
    for (const cat of sport.categories) {
      const childTitle = `${sport.label} - ${cat.label}`;
      if (existing.has(childTitle)) {
        console.log(`  [SKIP] ${childTitle}（既存）`);
        skipped++;
        continue;
      }

      const col = await createSmartCollection({
        title: childTitle,
        disjunctive: false, // AND: sport AND category の両方一致
        rules: [
          {
            column: 'PRODUCT_METAFIELD_DEFINITION',
            relation: 'EQUALS',
            condition: sport.key,
            conditionObjectId: sportDefId,
          },
          {
            column: 'PRODUCT_METAFIELD_DEFINITION',
            relation: 'EQUALS',
            condition: cat.key,
            conditionObjectId: categoryDefId,
          },
        ],
      });
      if (col) {
        console.log(`  [OK]   ${col.title}  (handle: ${col.handle}, id: ${col.id})`);
        created++;
      }
    }

    console.log(''); // スポーツごとに空行
  }

  // 4. サマリ
  console.log('=== 完了 ===');
  console.log(`  作成: ${created} 件`);
  console.log(`  スキップ: ${skipped} 件（既存）`);
  console.log(`  合計: ${created + skipped} / ${SPORTS.reduce((n, s) => n + 1 + s.categories.length, 0)} 件`);
}

main().catch((err) => {
  console.error('\n致命的エラー:', err.message);
  process.exit(1);
});
