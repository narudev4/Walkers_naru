// @ts-check
/** ストアのテーマ一覧と role を確認（MAIN が公開中テーマ）。実行: node --env-file=.env src/list-themes.js */
import { adminGraphQL } from './shopifyClient.js';

const Q = `{ themes(first: 20) { nodes { id name role } } }`;
const d = await adminGraphQL(Q);
for (const t of d.themes.nodes) {
  console.log(`${t.role.padEnd(14)} ${t.name}   ${t.id}`);
}
