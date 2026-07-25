let { 
  kinds,
  budgetUpper,
  budgetLower,
  structures,
  //profitUpper,
  profitLower,
  years,
  to_stations,
  name,
  email,
  record_id,
  history,
  area // ← カンマ区切りの文字列として受け取る
} = input.config(); // 鬼の変数定義

let table = base.getTable("チタン物件一覧");
let view = table.getView("viwPDkWFB8zHPraRL");
let query = await view.selectRecordsAsync();

let currentYear = new Date().getFullYear();
let matchedRecords = [];
let infoList = [];
let debugLog = [];

//履歴の確認
let historyInfos = [];
if (Array.isArray(history)) {
  historyInfos = history.map(item => typeof item === 'string' ? item : item.name).filter(Boolean);
} else if (history) {
  historyInfos = [typeof history === 'string' ? history : history.name].filter(Boolean);
}

// ====== エリア（市区名）チェック用 正規表現 ======
let areaPattern = new RegExp(`^(${area.join('|')})`);
let budgetLowerNum = parseFloat(budgetLower);
let budgetUpperNum = parseFloat(budgetUpper);
let profitLowerNum = parseFloat(profitLower)*100;



for (let record of query.records) {
  if (matchedRecords.length >= 10) break; //重くならないように10個しかマッチングさせない。次のAutomationであまりを配信できる

  try {
    let recordKinds = record.getCellValueAsString("種別");
    let recordStructure = record.getCellValueAsString("建物構造");
    let recordToStation = parseFloat(record.getCellValue("バス・徒歩(整形)"));
    let recordProfit = parseFloat(record.getCellValue("利回り"));
    let recordPrice = parseFloat(record.getCellValue("価格"));
    let recordYearBuilt = parseInt(record.getCellValue("築年(整形)"));
    let recordArea = record.getCellValueAsString("所在地"); // ← チェック対象の住所
    let url = record.getCellValueAsString("変更後リンク");
    let info = record.getCellValueAsString("メール埋め込み");
    let airtable_record_id = record.getCellValue("RECORD_ID");

    let age = currentYear - recordYearBuilt;



    if (
      
      !historyInfos.includes(info) &&
      
      url &&
      recordPrice >= budgetLowerNum && // 価格を比較
      recordPrice <= budgetUpperNum &&
      recordProfit >= profitLowerNum && // 利回りを比較
      
      areaPattern.test(recordArea) && //エリア比較
      
      (
        kinds.includes(recordKinds) ||
        kinds.includes("こだわらない")
      ) &&
      
      (
        structures.includes(recordStructure) ||
        structures.includes("こだわらない")
      ) &&
      
      age <= parseFloat(years)
    ) {
      if (url || info) {
        matchedRecords.push({
          url_attachment: url,
          str_attachment: info,
          airtable_record_id: airtable_record_id
        });
        console.log(info);
        infoList.push(info);
      }
    }

  } catch (e) {
    debugLog.push(`ERROR at record ${record.id}: ${e}`);
    continue;
  }
}

const infosHtml = infoList.join("");

// 物件紹介提案を登録する
await fetch('https://hooks.airtable.com/workflows/v1/genericWebhook/appksEWIuKl7N2ftS/wflko7uZj184zCoea/wtrGouJBurSzZKi7v', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    record_id,
    matchedRecords
  })
});



// ====== 出力 ======
output.set("infos", infoList.join(""));
output.set("matchedCount", matchedRecords.length);
output.set("matchedRecords", matchedRecords);
