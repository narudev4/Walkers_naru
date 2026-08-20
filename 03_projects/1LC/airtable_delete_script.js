// ============================================================
//  1LC Airtable 承認セット 一括削除スクリプト（使い捨て）
//  ※指定ビューに表示されている全レコードを 50件ずつ削除します。
//  実行前チェック: バックアップ済み(スナップショット6/15 12:30)・正しいビュー
//  順番: ① ★物件紹介履歴 を実行 → 終わったら ② チタンに変えて再実行
//   ① ★物件紹介履歴 : TABLE_ID="tblMieyctX1o6LI7X" / VIEW_ID="viwMmHjysYqs0ZkAb"
//   ② チタン物件一覧 : TABLE_ID="tbllNssTBXGexHysb" / VIEW_ID="viwv0Q1hKb52UEWFb"
// ============================================================

const TABLE_ID = "tblMieyctX1o6LI7X";   // ← ①。②のときは "tbllNssTBXGexHysb"
const VIEW_ID  = "viwMmHjysYqs0ZkAb";   // ← ①。②のときは "viwv0Q1hKb52UEWFb"

const table = base.getTable(TABLE_ID);
const view  = table.getView(VIEW_ID);

const query = await view.selectRecordsAsync();
const ids = query.records.map(r => r.id);

output.markdown(`### 対象テーブル: **${table.name}**`);
output.markdown(`ビュー: **${view.name}** ／ 削除対象: **${ids.length.toLocaleString()} 件**`);

if (ids.length === 0) {
  output.text("削除対象が0件です。終了します。");
} else {
  const answer = await input.buttonsAsync(
    `${ids.length.toLocaleString()} 件を削除します。よろしいですか？（戻したい場合はスナップショット6/15 12:30から復元）`,
    [
      { label: "削除する", variant: "danger" },
      { label: "やめる", variant: "default" },
    ]
  );

  if (answer !== "削除する") {
    output.text("中止しました。1件も削除していません。");
  } else {
    let done = 0, n = 0;
    while (done < ids.length) {
      const batch = ids.slice(done, done + 50); // deleteRecordsAsync は最大50件/回
      await table.deleteRecordsAsync(batch);
      done += batch.length;
      n++;
      if (n % 20 === 0 || done === ids.length) {
        output.text(`削除済み ${done.toLocaleString()} / ${ids.length.toLocaleString()} 件`);
      }
    }
    output.markdown(`### ✅ 完了：${ids.length.toLocaleString()} 件を削除しました`);
  }
}
