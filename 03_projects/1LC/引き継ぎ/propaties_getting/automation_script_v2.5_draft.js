/*****************************************************************
 * エリア別物件取得 — v2.5(ドラフト): hkensu パラメータで50件上限を解消
 *
 * 背景（2026-07-11 チタン様連絡）:
 *   チタンAPIに hkensu={件数} パラメータを追加すると、
 *   1リクエストで50件超のデータが取得できるとエンジニアから回答あり。
 *   ローカル検証（東京都・価格帯5000〜200000万円）で実証済み:
 *     - hkensu無し    → 50件で打ち切り（従来の仕様）
 *     - hkensu=200    → 200件（まだ打ち切り）
 *     - hkensu=500    → 248件（打ち切りなし = 真の全件）
 *   送信方式（POST + JSON body）・jusyoc配列渡しは現行のまま変更不要。
 *   レスポンスのJSON構造（フィールド名）も変化なし。
 *
 * v2.4 からの変更点:
 *   1. 価格帯7分割ロジック（SUB_RANGES）を全廃 → 1エリア1リクエストに統一
 *   2. hkensu={HKENSU} を全リクエストに付与し、50件上限自体を引き上げ
 *   3. Airtable Automation の fetch 回数上限（50回/実行）に対し、
 *      エリア数38に対してこれまでの FETCH_BUDGET=47 は不要になったため、
 *      安全マージンのみのシンプルなガードに縮小
 *   4. 返却件数が HKENSU と同数（＝まだ打ち切られている疑い）の場合に
 *      警告ログを出す仕組みを新設（将来の取りこぼし再発を検知するため）
 *   5. ランタイム汚染対策（selectRecordsAsync 先行実行 / fetch例外検知 /
 *      汚染時の書き込みスキップ）はそのまま維持
 *
 * 未検証・要確認:
 *   - 東京都以外の全エリアでの実件数（HKENSU=500 で足りない大規模エリアが
 *     無いか）。本ドラフトでは安全側に倒して HKENSU=500 としているが、
 *     警告ログが出た場合は値を引き上げて再実行する運用を想定。
 *   - Airtable Automation 環境での実行時間（180秒制限）に収まるか
 *     （ローカル検証では東京都248件で約2秒。38エリア×レスポンス肥大化を
 *     考慮しても余裕はあるはずだが、本番環境での実測が必要）。
 *   - 欠落していた約3,200件（チタン様MTGで言及）は、本スクリプトの通常実行で
 *     既存の「URL単位で create/update を判定するロジック」により自動的に
 *     新規createされる想定。専用の再取得処理は設けていない。
 *****************************************************************/

const BATCH     = 50;
const API_URL   = "https://www.1lcinc.com/syuuekibukken/php/json_output.php";
const HKENSU    = 500;   // 東京都実測248件に対し安全マージンを持たせた値
const PRICE_MIN = 5000;
const PRICE_MAX = 200000;

/* ── fetch quota 管理（Airtable Automation の fetch 回数上限50回/実行に対する安全装置） ── */
const FETCH_BUDGET = 45;  // エリア数38 + 若干の再試行余地
let fetchesUsed    = 0;

/* ── ランタイム汚染フラグ（v2.4から維持） ── */
let poisoned = false;

/* 重要エリア優先順（物件数が多い順・万一途中終了した場合の影響を抑える） */
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
                inai: 2, jusyoc: area.c, yachik: minP, yachij: maxP,
                hkensu: HKENSU
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

    // hkensu を付与してもなお件数が HKENSU と一致 = まだ打ち切られている疑い
    if (data.length >= HKENSU) {
        console.log(`🚨 ${area.n}: 取得件数(${data.length})が HKENSU(${HKENSU})に到達 — まだ上限に達している可能性。HKENSU引き上げを検討してください`);
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

/* ── 1) 取得物件を URL ごとに統合 ── */
const urlStore = {};
const allUrls  = new Set();

for (const a of areas) {
    const data = await fetchArea(a);
    if (data.length) {
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
