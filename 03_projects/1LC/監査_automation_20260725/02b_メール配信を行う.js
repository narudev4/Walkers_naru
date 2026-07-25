// ========================================
// メール配信 v3 — hero/subs 構造 + 表示用フィールド補完版
// Airtable Automation Script (Step 2)
//
// v2_email_script.js からの変更点:
//   - enrich(): テンプレートが要求する表示用フィールドを補完
//       name_display     … 建物名 → 「所在地の種別」フォールバック
//       station_location … 「沿線・駅 ／ 所在地」結合
//       yield_display    … 利回り（null なら '-'）
//       price_display    … 価格（null なら '-'）
//   - ENABLE_IMAGES: 画像の透かし文字問題が解決するまで false
//   - TemplateId: v3 本番テンプレート
//
// Automation 設定の input（v2 と同一）:
//   heroJson / subsJson / conditionsSummary ← Step 1 の output
//   name / email / edit_link ← トリガーの顧客情報
//   matchedCount ← Step 1 の output
// ========================================

const POSTMARK_API_TOKEN = '<<REDACTED_POSTMARK_TOKEN>>';
const TEMPLATE_ID = 45535824; // v3-production-recommendation (alias: lc-v3-prod)
const ENABLE_IMAGES = false; // 透かし問題（あみがけ）解決後に true へ

const inputs = input.config();

const heroJson = inputs.heroJson;
const subsJson = inputs.subsJson;
const conditionsSummary = inputs.conditionsSummary;
const name = inputs.name;
const email = inputs.email;
const edit_link = inputs.edit_link;
const matchedCount = parseInt(inputs.matchedCount) || 0;

if (matchedCount === 0 || !heroJson) {
  console.log("No matched records. Skipping email.");
  output.set('postmarkSkipped', true);
  output.set('matchedCount', 0);
} else {
  let hero = JSON.parse(heroJson);
  let subs = subsJson ? JSON.parse(subsJson) : [];

  // Mustachio 用: 空文字列/undefined を null に統一 + 表示用フィールド補完
  const enrich = (obj) => {
    let p = {};
    for (let [k, v] of Object.entries(obj)) {
      p[k] = (v === "" || v === undefined) ? null : v;
    }
    if (!ENABLE_IMAGES) p.image = null;
    p.name_display = p.name
      || (p.location && p.kind ? `${p.location}の${p.kind}` : null)
      || (p.location ? `${p.location}の物件` : null)
      || p.kind
      || '収益物件';
    p.station_location = [p.station, p.location].filter(Boolean).join(' ／ ');
    p.yield_display = p.yield_rate || '-';
    p.price_display = p.price || '-';
    return p;
  };

  hero = enrich(hero);
  subs = subs.map(enrich);

  const templateModel = {
    str_name: name,
    edit_link: edit_link,
    conditions_summary: conditionsSummary || "ご指定の条件",
    hero: hero,
    subs: subs.length > 0 ? subs : null
  };

  const emailData = {
    From: 'info@1lcinc.com',
    To: email,
    TemplateId: TEMPLATE_ID,
    TemplateModel: templateModel
  };

  console.log("TemplateModel:", JSON.stringify(templateModel, null, 2));

  const response = await fetch('https://api.postmarkapp.com/email/withTemplate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Postmark-Server-Token': POSTMARK_API_TOKEN
    },
    body: JSON.stringify(emailData)
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}, ${await response.text()}`);
  }

  const responseData = await response.json();
  console.log('Email sent:', responseData);
  output.set('postmarkResponse', responseData);
  output.set('matchedCount', matchedCount);
  output.set('postmarkSkipped', false);
}