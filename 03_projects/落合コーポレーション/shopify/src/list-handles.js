// @ts-check
/** 商品のhandle一覧（runbookのURL用）。実行: node --env-file=.env src/list-handles.js */
import { adminGraphQL } from './shopifyClient.js';
const d = await adminGraphQL(`{ products(first: 20) { nodes { title handle } } }`);
for (const p of d.products.nodes) console.log(`${p.handle}\t${p.title}`);
