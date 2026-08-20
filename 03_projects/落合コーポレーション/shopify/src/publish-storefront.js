// @ts-check
/** Liquid から読めるように metafield 定義を作成＋ストアフロント公開し、
 *  discount_matrix Metaobject も storefront 公開にする。
 *  実行: node --env-file=.env src/publish-storefront.js（冪等: 既存はスキップ） */
import { adminGraphQL } from './shopifyClient.js';

const DEF_CREATE = `mutation($def: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $def) {
    createdDefinition { id namespace key }
    userErrors { field message code }
  }
}`;

const defs = [
  { name: 'B2B Customer Type', namespace: 'b2b', key: 'customer_type', type: 'single_line_text_field', ownerType: 'CUSTOMER' },
  { name: 'B2B Discount Group', namespace: 'b2b', key: 'discount_group', type: 'single_line_text_field', ownerType: 'CUSTOMER' },
  { name: 'B2B Custom Overrides', namespace: 'b2b', key: 'custom_overrides', type: 'json', ownerType: 'CUSTOMER' },
  { name: 'B2B Category', namespace: 'b2b', key: 'category', type: 'single_line_text_field', ownerType: 'PRODUCT' },
];

for (const base of defs) {
  const def = { ...base, access: { storefront: 'PUBLIC_READ' } };
  const r = await adminGraphQL(DEF_CREATE, { def });
  const e = r.metafieldDefinitionCreate.userErrors;
  if (e && e.length) {
    console.log(`  ${base.ownerType} b2b.${base.key}: ${JSON.stringify(e.map((x) => x.code || x.message))}`);
  } else {
    console.log(`  ✅ ${base.ownerType} b2b.${base.key} 定義作成 (storefront PUBLIC_READ)`);
  }
}

// discount_matrix Metaobject を storefront 公開に
const mod = await adminGraphQL(`{ metaobjectDefinitionByType(type: "discount_matrix") { id access { storefront } } }`);
const moId = mod.metaobjectDefinitionByType?.id;
if (moId) {
  const UPD = `mutation($id: ID!, $def: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $def) {
      metaobjectDefinition { id access { storefront } }
      userErrors { field message }
    }
  }`;
  const r = await adminGraphQL(UPD, { id: moId, def: { access: { storefront: 'PUBLIC_READ' } } });
  const e = r.metaobjectDefinitionUpdate.userErrors;
  if (e && e.length) console.log(`  Metaobject update userErrors: ${JSON.stringify(e)}`);
  else console.log(`  ✅ discount_matrix storefront=${r.metaobjectDefinitionUpdate.metaobjectDefinition.access.storefront}`);
} else {
  console.log('  ⚠️ discount_matrix 定義が見つかりません');
}
