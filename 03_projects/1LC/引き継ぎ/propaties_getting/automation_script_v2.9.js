/*****************************************************************
 * エリア別物件取得 — v2.9: 未登録選択肢サニタイザ + 数値ガード + 安全弁
 *
 * 背景（2026-07-22〜25 の取得全停止事故を受けた恒久対策）:
 *   - select型フィールドに未登録の選択肢値（例: 土地権利「普通賃借」、
 *     建物構造「軽量気泡コンクリート」）が1件でも来ると、そのバッチが失敗し、
 *     Airtable Automation の仕様で以降の全書き込みが
 *     "Request processing is disabled" で全滅する
 *   - 失敗は console.log にしか出ず、Automation は「成功」表示のため
 *     3日間誰も気づけなかった（7/11 のＡＬＣ事故と同じ構造）
 *
 * v2.8 からの変更点:
 *   1. 土地権利フィールドのテキスト型化に対応（{name:...} → 文字列）
 *   2. select型サニタイザ: 書き込み前に登録済み選択肢と照合。
 *      NFKC正規化で表記ゆれ（全角ＡＬＣ等）は正式名に変換して通し、
 *      本当に未知の値だけ間引いて警告ログ + output.set で報告
 *   3. 数値ガード num(): NaN を絶対に書き込まない
 *      （価格null・カンマ入り数値・"要相談"等の文字列で全滅していた経路を遮断）
 *   4. URL欠落物件のスキップ（urlStore[undefined] への合流防止）
 *   5. 安全弁: 未登録値の比率が異常（20%超）なら書き込み中止
 *      （チタン側フォーマット変更等の系統的異常で全データを
 *        空欄化してしまう事故の防止）
 *   6. 新規作成0件時の警告ログ（デッドマンスイッチ連携用）
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

/* ── 数値ガード: 数値化できない値は null（NaN を書き込むとバッチごと死ぬため） ── */
const num = v => {
    if (v === null || v === undefined) return null;
    const s = String(v).normalize("NFKC").replace(/[,\s%]/g, "");
    if (s === "") return null;
    const x = Number(s);
    return Number.isFinite(x) ? x : null;
};

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

/* ── 0.5) select型フィールドの登録済み選択肢を実行時に取得（サニタイザ用） ──
 * 正規化名(NFKC) → 正式名 のマップ。表記ゆれ（全角ＡＬＣ等）は正式名に変換して通す。
 * choices が取得できないフィールドは従来通り素通し（間引かない=安全側） */
const normKey = s => String(s).normalize("NFKC").trim();
const selectWhitelist = {};
for (const f of titaniumTable.fields) {
    if (f.type === "singleSelect" || f.type === "multipleSelects") {
        const choices = (f.options && f.options.choices) ? f.options.choices : [];
        if (choices.length) {
            const m = new Map();
            for (const c of choices) m.set(normKey(c.name), c.name);
            selectWhitelist[f.name] = m;
        }
    }
}
console.log(`サニタイザ対象select型: ${Object.keys(selectWhitelist).join(", ") || "なし"}`);

const unknownTokens = {};   // フィールド名 → Map(未登録値 → 件数)
let tokenTotal = 0, tokenDropped = 0;

/* multiple select 用: 分割 → 照合 → 正式名で通す / 未知は間引いて記録 */
function sanitizeMS(fieldName, str) {
    const tokens = str ? str.split(/[、,／/]/).map(s => s.trim()).filter(Boolean) : [];
    const wl = selectWhitelist[fieldName];
    if (!wl) return tokens.map(name => ({ name }));   // 選択肢が読めない場合は従来動作
    const out = [];
    for (const t of tokens) {
        tokenTotal++;
        const canonical = wl.get(normKey(t));
        if (canonical) {
            out.push({ name: canonical });
        } else {
            tokenDropped++;
            if (!unknownTokens[fieldName]) unknownTokens[fieldName] = new Map();
            unknownTokens[fieldName].set(t, (unknownTokens[fieldName].get(t) || 0) + 1);
        }
    }
    return out;
}

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

/* ── 1) 取得物件を URL ごとに統合するヘルパー ── */
const urlStore = {};
const allUrls  = new Set();
let skippedNoUrl = 0;

function ingest(area, data) {
    for (const d of data) {
        const _p = num((d.価格 || "").replace(/[万円]/g, ""));
        if (_p !== null && _p > 0 && _p < 5000) continue;
        const url = d.URL;
        if (!url) { skippedNoUrl++; continue; }   // URL欠落はレコード化しない
        allUrls.add(url);
        if (!urlStore[url]) {
            const fields = {
                "公開用URL": url, "画像": d.画像, "所在地": d.所在地,
                "沿線・駅": d["沿線・駅"], "バス・徒歩": d["バス・徒歩"],
                "価格": _p !== null ? _p * 10000 : null,
                "土地面積": num((d["土地面積"] || "").replace(/㎡/g, "")),
                "建物面積": num((d["建物面積"] || "").replace(/㎡/g, "")),
                "建物構造": sanitizeMS("建物構造", d["建物構造"]),
                "利回り": num((d["利回り"] || "").replace(/%/g, "")),
                "種別": sanitizeMS("種別", d["種別"]), "築年": d["築年"],
                "土地権利": d["土地権利"] || null
            };
            const seisan = num(d["積算価格の妥当性"]); if (seisan !== null) fields["積算価格の妥当性"] = seisan;
            const tochi  = num(d["土地比率"]);         if (tochi  !== null) fields["土地比率"] = tochi;
            const tate   = num(d["建物比率"]);         if (tate   !== null) fields["建物比率"] = tate;
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
if (skippedNoUrl) console.log(`⚠ URL欠落でスキップした物件: ${skippedNoUrl}件`);

/* ── 1.6) 未登録選択肢の報告 + 安全弁 ── */
let abortWrites = false;
for (const fieldName in unknownTokens) {
    const list = [...unknownTokens[fieldName].entries()].map(([v, n]) => `「${v}」(${n}件)`).join(" / ");
    console.log(`🟡 未登録の選択肢値を検出（${fieldName}）: ${list} — 該当項目のみ空欄で登録します。Airtableでこの選択肢を追加すれば次回実行から自動で埋まります`);
}
const dropRate = tokenTotal ? tokenDropped / tokenTotal : 0;
if (tokenTotal >= 20 && dropRate > 0.2) {
    abortWrites = true;
    console.log(`🚨 書き込み中止: 未登録値の比率が異常（${tokenDropped}/${tokenTotal} = ${(dropRate * 100).toFixed(1)}%）。チタン側のフォーマット変更等の系統的異常の疑い。データ保護のため今回は書き込みません`);
}

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
        const landRight = obj.fields["土地権利"]; // 文字列 または null（テキスト型）
        if (landRight && landRight !== OWNERSHIP_LAND_RIGHT) {
            skippedByLandRight++;
            continue; // 所有権以外は新規作成しない（空欄は通す）
        }
        creates.push({
            fields: { ...obj.fields, "エリア": obj.areaIds.map(id => ({ id })) }
        });
    }
}
console.log(`新規作成: ${creates.length}件 / 更新: ${updates.length}件 / 土地権利で新規除外: ${skippedByLandRight}件`);

/* ── 3) Airtable 書き込み ── */
let createdCount = 0, updatedCount = 0, writeErrors = 0;
if (!abortWrites) {
    console.log("Airtable反映開始");
    while (updates.length) {
        const batch = updates.splice(0, BATCH);
        try {
            await titaniumTable.updateRecordsAsync(batch);
            updatedCount += batch.length;
            console.log(`更新完了: ${batch.length}件`);
        } catch (error) {
            writeErrors++;
            console.log(`更新エラー: ${error.message}`);
        }
    }
    while (creates.length) {
        const batch = creates.splice(0, BATCH);
        try {
            await titaniumTable.createRecordsAsync(batch);
            createdCount += batch.length;
            console.log(`新規作成完了: ${batch.length}件`);
        } catch (error) {
            writeErrors++;
            console.log(`新規作成エラー: ${error.message}`);
        }
    }
}
if (createdCount === 0 && allUrls.size > 0 && !abortWrites) {
    console.log("🟡 注意: 今回の実行で新規作成が0件でした（新着なしの可能性もありますが、連続する場合は異常です）");
}
console.log(`完了（新規${createdCount}件 / 更新${updatedCount}件 / 書込エラー${writeErrors}バッチ）`);

/* 後続アクション・通知連携用のサマリ出力（使えない環境でも無害） */
try {
    const unknownFlat = Object.entries(unknownTokens)
        .map(([f, m]) => `${f}: ${[...m.keys()].join("・")}`).join(" | ");
    output.set("created", createdCount);
    output.set("updated", updatedCount);
    output.set("writeErrors", writeErrors);
    output.set("unknownTokens", unknownFlat);
    output.set("aborted", abortWrites);
} catch (e) { /* output API が無い環境では無視 */ }
