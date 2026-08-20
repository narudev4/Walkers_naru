// @ts-check
/** metafield / Metaobject のストアフロント公開状態を確認。実行: node --env-file=.env src/check-visibility.js
 *  Liquid から customer/product の b2b metafield と discount_matrix Metaobject を読むには
 *  storefront アクセスが PUBLIC_READ である必要がある。 */
import { adminGraphQL } from './shopifyClient.js';

async function checkMetafields(ownerType) {
  const Q = `query($o: MetafieldOwnerType!) {
    metafieldDefinitions(first: 20, ownerType: $o, namespace: "b2b") {
      nodes { key access { storefront } }
    }
  }`;
  const d = await adminGraphQL(Q, { o: ownerType });
  console.log(`--- ${ownerType} metafields (namespace b2b) ---`);
  if (!d.metafieldDefinitions.nodes.length) console.log('  (定義なし)');
  for (const n of d.metafieldDefinitions.nodes) console.log(`  b2b.${n.key}: storefront=${n.access?.storefront}`);
}

await checkMetafields('CUSTOMER');
await checkMetafields('PRODUCT');

const MOD = `{ metaobjectDefinitionByType(type: "discount_matrix") { name access { storefront } } }`;
const m = await adminGraphQL(MOD);
console.log('--- discount_matrix Metaobject ---');
console.log(`  storefront=${m.metaobjectDefinitionByType?.access?.storefront}`);
