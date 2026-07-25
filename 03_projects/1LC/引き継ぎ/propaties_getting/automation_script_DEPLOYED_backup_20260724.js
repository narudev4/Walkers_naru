/*****************************************************************
 * 【本番デプロイ中コードのバックアップ】2026-07-24 取得
 * Airtable Automation「エリア別物件取得」の Run a script 実コード
 * 土地権利フィールドのテキスト型化 修正の直前状態
 * （中身は v2.8 とほぼ一致。土地権利を single select 書式 {name:...} で書き込んでいる）
 *****************************************************************/
const BATCH     = 50;
const API_URL   = "https://www.1lcinc.com/syuuekibukken/php/json_output.php";
const HKENSU    = 1000;
const PRICE_MIN = 5000;
const PRICE_MAX = 200000;
const OWNERSHIP_LAND_RIGHT = "所有権";

/* ── fetch quota 管理（Airtable Automation の fetch 回数上限50回/実行に対する安全装置） ── */
const FETCH_BUDGET = 45;  // エリア数38 + フェーズ2再試行分の余地
let fetchesUsed    = 0;

/* 重要エリア優先順（先に処理しておけば、万一fetch予算が尽きても実害が小さい） */
const PRIORITY = [
    "東京都", "埼玉県", "城東エリア", "神奈川県", "城西エリア",
    "大阪府", "千葉県", "城南エリア", "城北エリア", "東京23区以外",
    "大阪市", "福岡県", "横浜市", "愛知県", "名古屋市",
    "都心3区", "兵庫県", "福岡市", "川崎市", "北九州市"
];

async function doFetch(area, minP, maxP) {
    if (fetchesUsed >= FETCH_BUDGET) {
        console.log(`⚠ ${area.n}: fetch budget 超過（${fetchesUsed}/${FETCH_BUDGET}）— スキップ`);
        return null;
    }
    fetchesUsed++;
    try {
        const res = await fetch(API_URL, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
                fm: "baibai", url: "https://1lcinc-syuuekibukken.com",
                inai: 2, jusyoc: area.c, yachik: minP, yachij: maxP,
                hkensu: HKENSU
            })
        });
        if (!res.ok) {
            console.log(`⚠ ${area.n}: HTTP ${res.status} — このエリアのみ今回は見送り`);
            return null;
        }
        const text = await res.text();
        try {
            const data = JSON.parse(text);
            return Array.isArray(data) ? data : null;
        } catch (_) {
            console.log(`⚠ ${area.n}: JSON パース失敗 — このエリアのみ今回は見送り`);
            return null;
        }
    } catch (e) {
        console.log(`🔴 ${area.n}: fetch 例外 ${e.message} — このエリアのみ今回は見送り（他エリアは続行）`);
        return null;
    }
}

async function fetchArea(area) {
    const data = await doFetch(area, PRICE_MIN, PRICE_MAX);
    if (data === null) return null; // 失敗（0件成功と区別するためnullで返す）
    if (data.length >= HKENSU) {
        console.log(`🚨 ${area.n}: 取得件数(${data.length})が HKENSU(${HKENSU})に到達 — まだ上限に達している可能性`);
    } else {
        console.log(`${area.n}: ${data.length}件取得（打ち切りなし）`);
    }
    return data;
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

/* ── 1) 取得物件を URL ごとに統合するヘルパー ── */
const urlStore = {};
const allUrls  = new Set();

function ingest(area, data) {
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
                "種別": toMS(d["種別"]), "築年": d["築年"],
                "土地権利": d["土地権利"] ? { name: d["土地権利"] } : null
            };
            if (d["積算価格の妥当性"] !== "") fields["積算価格の妥当性"] = Number(d["積算価格の妥当性"]);
            if (d["土地比率"] !== "") fields["土地比率"] = Number(d["土地比率"]);
            if (d["建物比率"] !== "") fields["建物比率"] = Number(d["建物比率"]);
            urlStore[url] = { id: null, areaIds: [], fields: fields };
        }
        if (!urlStore[url].areaIds.includes(area.i)) urlStore[url].areaIds.push(area.i);
    }
}

/* ── 1.1) フェーズ1: 全エリアを1回ずつ試行 ── */
const failedAreas = [];
for (const a of areas) {
    const data = await fetchArea(a);
    if (data === null) {
        failedAreas.push(a);
    } else if (data.length) {
        ingest(a, data);
    }
}
console.log(`フェーズ1完了: 成功${areas.length - failedAreas.length}/失敗${failedAreas.length}（fetch使用 ${fetchesUsed}/${FETCH_BUDGET}）`);

/* ── 1.2) フェーズ2: 失敗エリアのみ、残り予算で再試行 ── */
if (failedAreas.length && fetchesUsed < FETCH_BUDGET) {
    console.log(`フェーズ2開始（再試行対象: ${failedAreas.map(a => a.n).join(", ")}）`);
    const stillFailed = [];
    for (const a of failedAreas) {
        const data = await fetchArea(a);
        if (data === null) {
            stillFailed.push(a.n);
        } else if (data.length) {
            ingest(a, data);
        }
    }
    if (stillFailed.length) {
        console.log(`🚨 再試行後も失敗: ${stillFailed.join(", ")}（次回の定期実行で再取得されます）`);
    } else {
        console.log("フェーズ2ですべて回収完了");
    }
} else if (failedAreas.length) {
    console.log(`🚨 fetch budget 不足のため再試行できず: ${failedAreas.map(a => a.n).join(", ")}（次回の定期実行で再取得されます）`);
}

console.log(`全エリア合計 URL 数: ${allUrls.size}（fetch 使用: ${fetchesUsed}/${FETCH_BUDGET}）`);

/* ── 1.5) 既存レコードと照合 ── */
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

/* ── 2) creates / updates に変換 ──
 * 既存レコードは無条件で更新（土地権利の値も含めて埋める）。
 * 新規作成のみ「土地権利が空欄 or 所有権」の場合に限定する。 */
const creates = [];
const updates = [];
let skippedByLandRight = 0;
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
        const landRight = obj.fields["土地権利"]; // {name: "..."} または null
        if (landRight && landRight.name !== OWNERSHIP_LAND_RIGHT) {
            skippedByLandRight++;
            continue; // 所有権以外は新規作成しない（空欄は通す）
        }
        creates.push({
            fields: { ...obj.fields, "エリア": obj.areaIds.map(id => ({ id })) }
        });
    }
}
console.log(`新規作成: ${creates.length}件 / 更新: ${updates.length}件 / 土地権利で新規除外: ${skippedByLandRight}件`);

/* ── 3) Airtable 書き込み（失敗エリアの有無に関わらず必ず実行） ── */
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
console.log("完了");
