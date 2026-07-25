let { record_id, matchedRecords } = input.config();

console.log("record_id:", record_id);
console.log("matchedRecords:", matchedRecords);

let targetTable = base.getTable("★物件紹介履歴");

for (let record of matchedRecords) {
  console.log("record:", record);
  try {
    await targetTable.createRecordAsync({
      "★企業一覧_マッチング用": [{ id: record_id }],
      "★物件紹介_企業用" : [{ id: record}]
    });
  } catch (error) {
    console.error("挿入エラー:", error);
  }
}
