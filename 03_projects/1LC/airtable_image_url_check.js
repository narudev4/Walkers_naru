// ============================================================
//  1LC 物件画像URL規則 検証スクリプト（Airtable Scripting 拡張で実行）
//  目的:
//   ① Airtable の実データ（チタン物件一覧）から物件番号を自動取得
//   ② 番号 → 画像URL  gp/{頭文字}/{数字上3桁}/{番号}_1.jpg  を生成
//   ③ fetch で実在チェックし、URL直生成(A方式)が全物件で成立するか裏取り
//   ④ 同時に「Airtable Script の fetch で daijin.cc を直接叩けるか(CORS)」も判定
//      → 叩ける = 画像取得までScript内で完結 / 弾かれる = 外部バッチが必要
//
//  使い方: Airtable → Extensions → Scripting → コード貼付 → Run
//          （delete script と同じ場所。読み取りのみ・データは変更しません）
// ============================================================

const TABLE_ID = "tbllNssTBXGexHysb"; // チタン物件一覧
const SAMPLE   = 20;                   // 検証サンプル件数（負荷を抑えて少なめ）
const NUM_RE   = /^[A-Z]\d{6,}$/;      // 物件番号の形（例 A2867835642）

const table = base.getTable(TABLE_ID);
const query = await table.selectRecordsAsync();
const recs  = query.records;

// --- ① 物件番号フィールドを自動検出（A+数字 形式の値を持つフィールド） ---
let numField = null;
for (const f of table.fields) {
  const sample = recs.slice(0, 60).map(r => {
    try { return (r.getCellValueAsString(f.name) || "").trim(); } catch (e) { return ""; }
  });
  if (sample.filter(s => NUM_RE.test(s)).length >= 3) { numField = f.name; break; }
}

output.markdown(`## 1LC 画像URL規則 検証`);
if (!numField) {
  // 見つからなければ先頭レコードの全フィールドを出して手動確認できるように
  output.markdown(`❌ 物件番号フィールドを自動検出できませんでした。先頭レコードの中身を出します。番号フィールド名を教えてください。`);
  const r0 = recs[0];
  output.table(table.fields.map(f => ({
    field: f.name,
    value: (() => { try { return (r0.getCellValueAsString(f.name) || "").slice(0, 40); } catch (e) { return "(取得不可)"; } })()
  })));
  return;
}
output.markdown(`- 検出した物件番号フィールド: **${numField}**`);

// --- ② サンプリング（番号を持つレコードから先頭 SAMPLE 件） ---
const nums = [];
for (const r of recs) {
  const v = (r.getCellValueAsString(numField) || "").trim();
  if (NUM_RE.test(v) && !nums.includes(v)) nums.push(v);
  if (nums.length >= SAMPLE) break;
}
output.markdown(`- 検証サンプル: **${nums.length}件**（全 ${recs.length.toLocaleString()} レコード中）`);

function buildUrl(num) {
  const head   = num[0];              // 'A'
  const digits = num.slice(1);        // '2867835642'
  const dir3   = digits.slice(0, 3);  // '286'
  return `https://daijin.cc/realestate/gp/${head}/${dir3}/${num}_1.jpg`;
}

// --- ③ 各番号で実在チェック（直列・bodyは読まない） ---
let ok = 0, ng = 0, corsBlocked = 0;
const fails = [];
for (const num of nums) {
  const url = buildUrl(num);
  try {
    const res = await fetch(url, { method: "GET" });
    const ct  = res.headers.get("content-type") || "";
    if (res.ok && ct.startsWith("image/")) {
      ok++;
    } else {
      ng++;
      fails.push({ num, status: res.status, contentType: ct.slice(0, 30) });
    }
  } catch (e) {
    // CORS ブロックや name 解決失敗はここに来る
    ng++; corsBlocked++;
    fails.push({ num, error: String(e).slice(0, 60) });
  }
}

// --- ④ 結果 ---
output.markdown(`### 結果`);
output.markdown(`- ✅ 規則成立（画像取得 OK）: **${ok} / ${nums.length} 件**`);
output.markdown(`- ❌ 失敗（フォールバック対象）: **${ng} 件**`);
if (corsBlocked > 0) {
  output.markdown(`- ⚠️ うち **${corsBlocked} 件が fetch 例外**。全件これなら **CORS でブロック＝Airtable Script から daijin.cc を直接取得できない**可能性大。その場合は画像取得を外部バッチに分離する設計になります。`);
}
if (fails.length) {
  output.markdown(`#### 失敗の内訳`);
  output.table(fails);
}
output.markdown(`---`);
output.markdown(`**判定の見方**：OK が大多数なら A 方式（URL直生成）で本実装 GO。失敗が散発ならその物件だけフォールバック②③へ。全件 fetch 例外なら取得経路を外部バッチに変更。`);
