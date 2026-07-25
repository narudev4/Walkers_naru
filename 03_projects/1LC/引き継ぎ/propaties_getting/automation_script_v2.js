/*****************************************************************
 * エリア別物件取得 — v2.4: ランタイム汚染対策 + エリア優先順序
 *
 * v2.3 からの修正:
 *   - 外部 fetch のネットワーク障害（socket hang up 等）で
 *     Airtable ランタイムが汚染され selectRecordsAsync 含む
 *     全ネットワーク操作が無効化される問題への対策:
 *     1. selectRecordsAsync を外部 fetch より先に実行
 *     2. 重要エリア（東京都等）を先頭に処理
 *     3. fetch 例外で汚染フラグを立て以降の fetch をスキップ
 *     4. 汚染時は書き込みもスキップ（無駄なエラー防止）
 *****************************************************************/

const BATCH     = 50;
const API_URL   = "https://www.1lcinc.com/syuuekibukken/php/json_output.php";
const API_LIMIT = 50;
const PRICE_MIN = 5000;
const PRICE_MAX = 200000;

/* ── fetch quota 管理 ── */
const FETCH_BUDGET = 47;
let fetchesUsed    = 0;

/* ── ランタイム汚染フラグ ── */
let poisoned = false;

/* 大規模エリア用の固定価格帯 */
const SUB_RANGES = [
    [5000,  8000],
    [8001,  11000],
    [11001, 15000],
    [15001, 22000],
    [22001, 40000],
    [40001, 80000],
    [80001, 200000]
];

/* 重要エリア優先順（物件数が多い順・取りこぼし影響が大きい順） */
const PRIORITY = [
    "東京都", "埼玉県", "城東エリア", "神奈川県", "城西エリア",
    "大阪府", "千葉県", "城南エリア", "城北エリア", "東京23区以外",
    "大阪市", "福岡県", "横浜市", "愛知県", "名古屋市",
    "都心3区", "兵庫県", "福岡市", "川崎市", "北九州市"
];

async function doFetch(area, minP, maxP) {
    try {
        const res = await fetch(API_URL, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
                fm: "baibai", url: "https://1lcinc-syuuekibukken.com",
                inai: 2, jusyoc: area.c, yachik: minP, yachij: maxP
            })
        });
        if (!res.ok) {
            console.log(`⚠ ${area.n}: HTTP ${res.status}（${minP}〜${maxP}万）— スキップ`);
            return null;
        }
        const text = await res.text();
        try {
            const data = JSON.parse(text);
            return Array.isArray(data) ? data : null;
        } catch (_) {
            console.log(`⚠ ${area.n}: JSON パース失敗（${minP}〜${maxP}万）— スキップ`);
            return null;
        }
    } catch (e) {
        console.log(`🔴 ${area.n}: fetch 例外 ${e.message}（${minP}〜${maxP}万）— ランタイム汚染検知`);
        poisoned = true;
        return null;
    }
}

async function fetchArea(area) {
    if (poisoned) {
        console.log(`⚠ ${area.n}: ランタイム汚染済 — スキップ`);
        return [];
    }
    if (fetchesUsed >= FETCH_BUDGET) {
        console.log(`⚠ ${area.n}: fetch budget 超過（${fetchesUsed}/${FETCH_BUDGET}）— スキップ`);
        return [];
    }

    fetchesUsed++;
    const data = await doFetch(area, PRICE_MIN, PRICE_MAX);
    if (!data) return [];

    if (data.length < API_LIMIT) return data;

    console.log(`↳ ${area.n}: ${data.length}件上限 → 価格帯別に再取得（残 budget: ${FETCH_BUDGET - fetchesUsed}）`);
    let all = [];
    for (const [lo, hi] of SUB_RANGES) {
        if (poisoned || fetchesUsed >= FETCH_BUDGET) {
            console.log(`⚠ ${area.n}: ${poisoned ? "汚染検知" : "budget 不足"} — 残りの価格帯スキップ`);
            break;
        }
        fetchesUsed++;
        const sub = await doFetch(area, lo, hi);
        if (sub) {
            all.push(...sub);
            if (sub.length >= API_LIMIT) {
                console.log(`⚠ ${area.n}: ${lo}〜${hi}万でも${sub.length}件上限（一部切り捨て）`);
            }
        }
    }
    console.log(`  ${area.n}: 分割取得完了 ${all.length}件`);
    return all;
}

/* ── 0) テーブル参照 + 既存レコード先行ロード ── */
const areaTable     = base.getTable("物件エリア");
const titaniumTable = base.getTable("チタン物件一覧");

const areaRecords = await areaTable.selectRecordsAsync();

console.log("既存レコード先行ロード");
const existRecs = await titaniumTable.selectRecordsAsync({
    fields: ["公開用URL", "エリア"]
});
console.log(`既存レコード: ${existRecs.records.length}件`);

const areas = areaRecords.records
    .map(r => ({
        n: r.getCellValue("エリア名"),
        i: r.id,
        c: r.getCellValue("住所コード（ref）")
    }))
    .filter(a => a.c);

areas.sort((a, b) => {
    const ai = PRIORITY.indexOf(a.n);
    const bi = PRIORITY.indexOf(b.n);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
});
console.log(`エリア処理順: ${areas.map(a => a.n).join(", ")}`);

const toMS = str =>
    str ? str.split(/[、,／/]/).map(s => s.trim()).filter(Boolean).map(name => ({ name })) : [];

/* ── 1) 取得物件を URL ごとに統合 ── */
const urlStore = {};
const allUrls  = new Set();

for (const a of areas) {
    const data = await fetchArea(a);
    if (data.length) {
        console.log(`${a.n}: ${data.length}件取得`);
        for (const d of data) {
            const _p = parseInt((d.価格 || "").replace(/[万円,]/g, ""));
            if (_p > 0 && _p < 5000) continue;
            const url = d.URL;
            allUrls.add(url);
            if (!urlStore[url]) {
                const fields = {
                    "公開用URL": url, "画像": d.画像, "所在地": d.所在地,
                    "沿線・駅": d["沿線・駅"], "バス・徒歩": d["バス・徒歩"],
                    "価格": parseInt(d.価格.replace(/[万円,]/g, "")) * 10000 || null,
                    "土地面積": parseFloat(d["土地面積"]?.replace("㎡", "")) || null,
                    "建物面積": parseFloat(d["建物面積"]?.replace("㎡", "")) || null,
                    "建物構造": toMS(d["建物構造"]),
                    "利回り": d["利回り"] ? parseFloat(d["利回り"].replace("%", "")) : null,
                    "種別": toMS(d["種別"]), "築年": d["築年"]
                };
                if (d["積算価格の妥当性"] !== "") fields["積算価格の妥当性"] = Number(d["積算価格の妥当性"]);
                if (d["土地比率"] !== "") fields["土地比率"] = Number(d["土地比率"]);
                if (d["建物比率"] !== "") fields["建物比率"] = Number(d["建物比率"]);
                urlStore[url] = { id: null, areaIds: [], fields: fields };
            }
            if (!urlStore[url].areaIds.includes(a.i)) urlStore[url].areaIds.push(a.i);
        }
    }
}
console.log(`全エリア合計 URL 数: ${allUrls.size}（fetch 使用: ${fetchesUsed}/${FETCH_BUDGET}）`);
if (poisoned) console.log("⚠ ランタイム汚染あり — 書き込みフェーズをスキップします");

/* ── 1.5) 先行ロード済みレコードと照合 ── */
console.log("既存レコード照合");
const existingRecords = existRecs.records.filter(record => {
    const url = record.getCellValue("公開用URL");
    return url && allUrls.has(url);
});
console.log(`既存レコード一致: ${existingRecords.length}件`);

const urlMeta = {};
for (const r of existingRecords) {
    const u = r.getCellValue("公開用URL");
    if (u) {
        urlMeta[u] = {
            id:      r.id,
            areaIds: (r.getCellValue("エリア") || []).map(l => l.id)
        };
    }
}

/* ── 2) creates / updates に変換 ── */
const creates = [];
const updates = [];
for (const url in urlStore) {
    const obj  = urlStore[url];
    const meta = urlMeta[url];
    if (meta) {
        const mergedAreaIds = [...new Set([...meta.areaIds, ...obj.areaIds])];
        updates.push({
            id: meta.id,
            fields: { ...obj.fields, "エリア": mergedAreaIds.map(id => ({ id })) }
        });
    } else {
        creates.push({
            fields: { ...obj.fields, "エリア": obj.areaIds.map(id => ({ id })) }
        });
    }
}
console.log(`新規作成: ${creates.length}件 / 更新: ${updates.length}件`);

/* ── 3) Airtable 書き込み ── */
if (poisoned) {
    console.log(`⚠ ランタイム汚染のため書き込みスキップ（取得済み ${allUrls.size} URL は次回反映）`);
} else {
    console.log("Airtable反映開始");
    while (updates.length) {
        const batch = updates.splice(0, BATCH);
        try {
            await titaniumTable.updateRecordsAsync(batch);
            console.log(`更新完了: ${batch.length}件`);
        } catch (error) {
            console.log(`更新エラー: ${error.message}`);
        }
    }
    while (creates.length) {
        const batch = creates.splice(0, BATCH);
        try {
            await titaniumTable.createRecordsAsync(batch);
            console.log(`新規作成完了: ${batch.length}件`);
        } catch (error) {
            console.log(`新規作成エラー: ${error.message}`);
        }
    }
}
console.log("完了");
