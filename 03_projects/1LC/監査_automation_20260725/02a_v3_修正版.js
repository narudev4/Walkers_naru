// ========================================
// 物件マッチング v3.2 — 掲載終了の除外 + 新しい物件優先 + タイムアウトの構造的解消
// Airtable Automation Script (Step 1)
//
// v2 からの変更点:
//   【1】掲載終了（成約済）物件を候補から除外（ループ先頭で continue）
//        判定は「掲載終了」チェックボックスを見るだけ。
//        このフラグは掲載状況スイープ（sweep/02_sweep.py）が書き込む
//   【2】走査順を反転して新しい物件から探す
//        従来は Airtable 既定順（≒作成順＝古い順）で先頭から5件で
//        打ち切っていたため、掲載終了率が最も高い古い物件が
//        優先的に紹介されていた（2026-07-25 の実測で混入率43.1%）
//   【3】debugLog を output に出力（挙動は変わらない。障害時の可視化のため）
//
// v3 → v3.1 の変更（2026-07-26。実行時間の最適化）:
//     - sort()（getCellValue を伴い高コスト）を廃止し reverse() に変更
//     - 掲載終了の判定をループ先頭に移し、他の値を読む前に continue
//       （半数以上が掲載終了のため、走査コストが約半分になる）
//
// v3.1 → v3.2 の変更（2026-07-27。タイムアウトの構造的解消）:
//   実行履歴を最古（2026-02-03）まで遡って集計したところ、
//   **178回すべて "Failed to run"、成功は1件もなかった**。
//   エラーは毎回「Your script exceeded the 180s run time limit.」。
//
//   仕組み: 条件に合う物件が5件そろえば break するが、5件に満たない
//   投資家は全件走査するため180秒を超過する。スクリプトが落ちると
//   Automation 全体が停止するため、**その投資家より後ろの全員に
//   1通も届かない**（実測: 紹介許可ON 322人中 26〜44% にしか届いていない）。
//
//   全件走査を起こす投資家（＝地雷）は 2026-07-27 時点で102人。
//   内訳は築年数 9999（フォームの「下限無し」）81人、空欄17人ほか。
//   変更A で 102人 → 6人 に減り、変更B で残り6人も無害化される。
//
// ※ 数値が指定されている場合の不等号の向きは v2 のまま（age > years）。
//   フォームの選択肢は「◯年以内」なので本来は age <= years が正しく、
//   152人が逆の物件を受け取っているが、新規登録フォームの保存値が
//   未確認のため保留（岩下様へ確認中）。
//
// 【元に戻す方法】
//   監査_automation_20260725/02a_物件データのマッチング.js（v2の本番コード）
//   の全文をコードエディタに貼り付けて Finish editing → Update
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

// 【変更2】新しい物件から探す（従来は古い順＝掲載終了率が高い順だった）
// v3.1: 25,908件に対する sort() は 180秒の実行時間上限を圧迫するため、
//       getCellValue を伴わない reverse() に変更（既定順≒作成順なので反転＝新しい順）
let sortedRecords = query.records.slice().reverse();

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

// 【v3.2 変更A】築年数の「こだわらない」を条件なしとして扱う
// フォームの選択肢「下限無し」は 9999 で保存される（一括移行データは -1）。
// 従来は `age > 9999` となり1件も一致せず、5件で break できないため
// 全件走査 → 180秒超過 → Automation 全体が停止していた。
// 空欄・非数値も「未指定」として同様に条件なしとする。
// ※ 数値が入っている場合の不等号の向き（「◯年以内」が正しい）は
//   新規登録フォームの保存値の確認待ちのため v3.2 では変更していない。
const yearsNum = parseFloat(years);
const yearsUnbounded = !Number.isFinite(yearsNum) || yearsNum === 9999 || yearsNum === -1;

// 【v3.2 変更B】1人の投資家が実行時間を使い切らないための安全装置
// Airtable Automation のスクリプトは180秒で強制終了し、そこで
// Automation 全体が止まる（＝以降の投資家に1通も届かない）。
// 100秒で打ち切れば、その投資家の結果が減るだけで後続は必ず処理される。
const SCAN_BUDGET_MS = 100000;
const scanStartedAt = Date.now();
let scanTruncated = false;

let skippedEnded = 0;   // 掲載終了で除外した件数（ログ用）

for (let record of sortedRecords) {
  if (matchedRecords.length >= 5) break;
  if (Date.now() - scanStartedAt > SCAN_BUDGET_MS) { scanTruncated = true; break; }

  try {
    // 【変更1】掲載終了（成約済）は他の値を読む前に除外する
    // v3.1: 半数以上が掲載終了のため、先頭で弾くと走査コストが約半分になる
    if (record.getCellValue("掲載終了")) { skippedEnded++; continue; }

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

    // マッチング条件（v2の7条件 + 掲載終了の除外）
    if (
      !historyInfos.includes(info) &&
      areaPattern.test(recordArea) &&
      (kinds.includes(recordKinds) || kinds.includes("こだわらない")) &&
      (structures.includes(recordStructure) || structures.includes("こだわらない")) &&
      recordPrice >= budgetLowerNum &&
      recordPrice <= budgetUpperNum &&
      recordProfit >= profitLowerNum &&
      recordProfit <= profitUpperNum &&
      (yearsUnbounded || age > yearsNum) &&
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
// 【変更3】障害時に気づけるようログを出力（挙動には影響しない）
output.set("debugLog", debugLog.length > 0 ? debugLog.join(" | ") : "");
output.set("skippedEnded", skippedEnded);
output.set("scanTruncated", scanTruncated);

// Webhook（履歴作成用 — 形式は変わるが airtable_record_id は維持）
await fetch('https://hooks.airtable.com/workflows/v1/genericWebhook/appksEWIuKl7N2ftS/wflSLXN8hEunC6nyW/wtrieNHoewZCLqjrr', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ record_id, matchedRecords })
});
