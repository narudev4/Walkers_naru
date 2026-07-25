// ========================================
// 物件マッチング v2 — 個別フィールド出力版
// Airtable Automation Script (Step 1)
//
// 変更点:
//   - matchedRecords.push() で個別フィールドを出力
//   - hero(1件目) / subs(2件目以降) をJSON文字列で出力
//   - 画像付き物件を優先的にhero候補に
//   - conditions_summary を自動生成
//   - マッチングロジック(7条件)は一切変更なし
// ========================================

let {
  kinds, budgetUpper, budgetLower, structures,
  profitUpper, profitLower, years, to_stations,
  name, email, formURL, history, record_id, area
} = input.config();

let table = base.getTable("チタン物件一覧");
let query = await table.selectRecordsAsync();
let currentYear = new Date().getFullYear();
let matchedRecords = [];
let infoList = [];
let debugLog = [];

// 履歴の確認（現行と同じロジック）
let historyInfos = [];
if (Array.isArray(history)) {
  historyInfos = history.map(item => typeof item === 'string' ? item : item.name).filter(Boolean);
} else if (history) {
  historyInfos = [typeof history === 'string' ? history : history.name].filter(Boolean);
}

// エリアチェック用
let areaPattern = new RegExp(`^(${area.join('|')})`);
let budgetLowerNum = parseFloat(budgetLower);
let budgetUpperNum = parseFloat(budgetUpper);
let profitLowerNum = parseFloat(profitLower);
let profitUpperNum = parseFloat(profitUpper);

for (let record of query.records) {
  if (matchedRecords.length >= 5) break;

  try {
    // --- マッチング判定用 (raw values, 現行と同一) ---
    let recordKinds = record.getCellValueAsString("種別");
    let recordStructure = record.getCellValueAsString("建物構造");
    let recordToStation = parseFloat(record.getCellValue("バス・徒歩(整形)"));
    let recordProfit = parseFloat(record.getCellValue("利回り"));
    let recordPrice = parseFloat(record.getCellValue("価格"));
    let recordYearBuilt = parseInt(record.getCellValue("築年(整形)"));
    let recordArea = record.getCellValueAsString("所在地");
    let url = record.getCellValueAsString("公開用URL");
    let info = record.getCellValueAsString("メール埋め込み");
    let airtable_record_id = record.getCellValue("RECORD_ID");

    let age = currentYear - recordYearBuilt;

    // マッチング条件 (7条件AND — 変更なし)
    if (
      !historyInfos.includes(info) &&
      areaPattern.test(recordArea) &&
      (kinds.includes(recordKinds) || kinds.includes("こだわらない")) &&
      (structures.includes(recordStructure) || structures.includes("こだわらない")) &&
      recordPrice >= budgetLowerNum &&
      recordPrice <= budgetUpperNum &&
      recordProfit >= profitLowerNum &&
      recordProfit <= profitUpperNum &&
      age > parseFloat(years) &&
      url
    ) {
      // --- v2: 表示用フィールドを個別取得 ---
      let buildingName = record.getCellValueAsString("建物名") || null;
      let station = record.getCellValueAsString("沿線・駅") || null;
      let imageRaw = record.getCellValueAsString("画像");
      let imageTrimmed = imageRaw && imageRaw.trim() ? imageRaw.trim() : null;
      let image = imageTrimmed && !/junbi73\.gif|zumenari\.gif|tel2\.jpg$/i.test(imageTrimmed) ? imageTrimmed : null;
      let yieldRateRaw = record.getCellValueAsString("利回り(システム用)");
      let yieldRate = yieldRateRaw ? yieldRateRaw.replace(/%$/, '') : null;
      let priceRaw = record.getCellValueAsString("価格(表示)");
      let displayPrice = priceRaw ? priceRaw.replace(/万円$/, '') : null;
      let structure = record.getCellValueAsString("構造(システム用)") || null;
      let year = record.getCellValueAsString("築年") || null;
      let kind = record.getCellValueAsString("種別(システム用)") || null;

      matchedRecords.push({
        name: buildingName,
        image: image,
        station: station,
        location: recordArea,
        yield_rate: yieldRate,
        price: displayPrice,
        structure: structure,
        year: year,
        kind: kind,
        url: url,
        airtable_record_id: airtable_record_id
      });

      infoList.push(info);
    }
  } catch (e) {
    debugLog.push(`ERROR at record ${record.id}: ${e}`);
    continue;
  }
}

// 画像URLの生存チェック（404対策）
for (let rec of matchedRecords) {
  if (rec.image) {
    try {
      let headRes = await fetch(rec.image, { method: 'HEAD' });
      if (!headRes.ok) rec.image = null;
    } catch (e) {
      rec.image = null;
    }
  }
}

// 画像付き物件を先頭にソート（ヒーロー候補優先）
matchedRecords.sort((a, b) => {
  if (a.image && !b.image) return -1;
  if (!a.image && b.image) return 1;
  return 0;
});

// hero / subs 分離
let hero = matchedRecords.length > 0 ? matchedRecords[0] : null;
let subs = matchedRecords.length > 1 ? matchedRecords.slice(1) : [];

// conditions_summary 自動生成
let conditionParts = [];
if (area.length > 0) conditionParts.push(area[0]);
if (kinds.length > 0 && !kinds.includes("こだわらない")) conditionParts.push(kinds[0]);
if (profitLowerNum > 0) conditionParts.push(`利回り${profitLowerNum}%以上`);
let conditionsSummary = conditionParts.join(" / ") || "ご指定の条件";

// --- 出力 ---
output.set("heroJson", hero ? JSON.stringify(hero) : "");
output.set("subsJson", subs.length > 0 ? JSON.stringify(subs) : "");
output.set("conditionsSummary", conditionsSummary);
output.set("matchedCount", matchedRecords.length);
output.set("matchedRecords", matchedRecords);
output.set("infos", infoList.join(""));

// Webhook（履歴作成用 — 形式は変わるが airtable_record_id は維持）
await fetch('https://hooks.airtable.com/workflows/v1/genericWebhook/appksEWIuKl7N2ftS/wflSLXN8hEunC6nyW/wtrieNHoewZCLqjrr', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ record_id, matchedRecords })
});
