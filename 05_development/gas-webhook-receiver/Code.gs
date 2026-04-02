/**
 * Walkers HP Webhook Receiver
 * WPFormsのお問い合わせ・資料請求フォームをWebhookで受信し、
 * Google Sheetsにログ記録 + Gmail通知を行う
 *
 * Note: Google WorkspaceではdoPostが制限されるため、
 * doGetでデータをクエリパラメータとして受信する方式を採用
 */

// ===== メインエントリポイント =====

function doGet(e) {
  // dataパラメータがあればWebhook受信として処理
  var dataParam = (e && e.parameter && e.parameter.data) ? e.parameter.data : null;

  if (!dataParam) {
    // パラメータなし = ヘルスチェック
    return jsonResponse({
      status: 'ok',
      service: 'walkers-webhook-receiver',
      timestamp: new Date().toISOString()
    });
  }

  try {
    var data = JSON.parse(decodeURIComponent(dataParam));

    // セキュリティ: シークレットキー検証
    if (data.secret !== CONFIG.WEBHOOK_SECRET) {
      return jsonResponse({ status: 'error', message: 'unauthorized' });
    }

    // フィールドを name → value のマップに変換
    var fieldMap = buildFieldMap(data.fields || []);
    var formId = data.form_id;
    var formType = (formId === 222) ? 'お問い合わせ' : '資料請求';

    // 1. Google Sheets にログ記録
    logToSheet(formId, formType, fieldMap, data);

    // 2. 社内通知メール送信
    sendNotification(formId, formType, fieldMap);

    return jsonResponse({ status: 'ok', form_type: formType });
  } catch (err) {
    logError(err, e);
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// doPost もフォールバックとして残す（将来Workspace制限が解除された場合）
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.secret !== CONFIG.WEBHOOK_SECRET) {
      return jsonResponse({ status: 'error', message: 'unauthorized' });
    }
    var fieldMap = buildFieldMap(data.fields || []);
    var formId = data.form_id;
    var formType = (formId === 222) ? 'お問い合わせ' : '資料請求';
    logToSheet(formId, formType, fieldMap, data);
    sendNotification(formId, formType, fieldMap);
    return jsonResponse({ status: 'ok', form_type: formType });
  } catch (err) {
    logError(err, e);
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// ===== フィールド処理 =====

function buildFieldMap(fields) {
  var map = {};
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var key = normalizeFieldName(f.name || '');
    if (key) map[key] = f.value || '';
    if (f.name) map[f.name] = f.value || '';
  }
  return map;
}

function normalizeFieldName(name) {
  var mapping = {
    'お名前': 'name', '名前': 'name', 'Name': 'name',
    '貴社名': 'company', '会社名': 'company', 'Company': 'company',
    'メールアドレス': 'email', 'Email': 'email',
    '電話番号': 'phone', 'Phone': 'phone',
    'お問い合わせ内容': 'message',
    'ご興味のある事業内容': 'interests',
    'システム開発・Webサービス開発のご予算': 'budget_system',
    'モバイルアプリ開発のご予算': 'budget_mobile',
    'ホームページ・LP制作のご予算': 'budget_web',
    'お役立ち情報の配信を希望する': 'newsletter'
  };
  if (mapping[name]) return mapping[name];
  for (var key in mapping) {
    if (name.indexOf(key) !== -1) return mapping[key];
  }
  return '';
}

function getField(fieldMap, key) {
  return fieldMap[key] || '';
}

// ===== Google Sheets ログ =====

function logToSheet(formId, formType, fieldMap, rawData) {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheetName = (formId === 222) ? 'お問い合わせ' : '資料請求';
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (formId === 222) {
      sheet.appendRow(['timestamp', 'お名前', '貴社名', 'メールアドレス', '電話番号', 'お問い合わせ内容', 'entry_id', 'source_ip']);
    } else {
      sheet.appendRow(['timestamp', 'お名前', '貴社名', 'メールアドレス', '電話番号', 'ご興味のある事業内容', '予算(システム)', '予算(モバイル)', '予算(Web/LP)', 'メルマガ', 'entry_id', 'source_ip']);
    }
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var timestamp = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  if (formId === 222) {
    sheet.appendRow([timestamp, getField(fieldMap, 'name'), getField(fieldMap, 'company'), getField(fieldMap, 'email'), getField(fieldMap, 'phone'), getField(fieldMap, 'message'), rawData.entry_id || '', rawData.source_ip || '']);
  } else {
    sheet.appendRow([timestamp, getField(fieldMap, 'name'), getField(fieldMap, 'company'), getField(fieldMap, 'email'), getField(fieldMap, 'phone'), getField(fieldMap, 'interests'), getField(fieldMap, 'budget_system'), getField(fieldMap, 'budget_mobile'), getField(fieldMap, 'budget_web'), getField(fieldMap, 'newsletter'), rawData.entry_id || '', rawData.source_ip || '']);
  }

  // raw JSON も別シートに保存
  var rawSheet = ss.getSheetByName('raw_log') || ss.insertSheet('raw_log');
  if (rawSheet.getLastRow() === 0) {
    rawSheet.appendRow(['timestamp', 'form_id', 'raw_json']);
    rawSheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    rawSheet.setFrozenRows(1);
  }
  rawSheet.appendRow([timestamp, formId, JSON.stringify(rawData)]);
}

// ===== 通知メール =====

function sendNotification(formId, formType, fieldMap) {
  var name = getField(fieldMap, 'name') || '（不明）';
  var email = getField(fieldMap, 'email') || '（不明）';
  var company = getField(fieldMap, 'company') || '（未記入）';
  var phone = getField(fieldMap, 'phone') || '（未記入）';

  var subject = '【HP' + formType + '】' + company + ' ' + name + '様';
  var body = '新規' + formType + 'がありました。\n\n';
  body += '━━━━━━━━━━━━━━━━━━━━━━\n';
  body += 'お名前: ' + name + '\n';
  body += '貴社名: ' + company + '\n';
  body += 'メール: ' + email + '\n';
  body += '電話番号: ' + phone + '\n';

  if (formId === 222) {
    body += '\nお問い合わせ内容:\n' + (getField(fieldMap, 'message') || '（なし）') + '\n';
  } else {
    body += '\nご興味のある事業内容:\n' + (getField(fieldMap, 'interests') || '（未選択）') + '\n';
    var bs = getField(fieldMap, 'budget_system');
    var bm = getField(fieldMap, 'budget_mobile');
    var bw = getField(fieldMap, 'budget_web');
    if (bs || bm || bw) {
      body += '\nご予算:\n';
      if (bs) body += '  システム開発: ' + bs + '\n';
      if (bm) body += '  モバイルアプリ: ' + bm + '\n';
      if (bw) body += '  Web/LP制作: ' + bw + '\n';
    }
  }

  body += '━━━━━━━━━━━━━━━━━━━━━━\n';
  body += '受信時刻: ' + new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + '\n';

  for (var i = 0; i < CONFIG.NOTIFY_EMAILS.length; i++) {
    GmailApp.sendEmail(CONFIG.NOTIFY_EMAILS[i], subject, body);
  }
}

// ===== ユーティリティ =====

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function logError(err, event) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sheet = ss.getSheetByName('error_log') || ss.insertSheet('error_log');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['timestamp', 'error_message', 'stack', 'raw_input']);
      sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    }
    var rawInput = '';
    try { rawInput = event ? JSON.stringify(event.parameter || {}) : ''; } catch (e2) {}
    sheet.appendRow([new Date().toISOString(), err.message || String(err), err.stack || '', rawInput]);
  } catch (logErr) {
    Logger.log('Failed to log error: ' + logErr.message);
  }
}

// ===== テスト用 =====

function testWebhook() {
  var mockEvent = {
    parameter: {
      data: encodeURIComponent(JSON.stringify({
        secret: CONFIG.WEBHOOK_SECRET,
        form_id: 222,
        form_name: '[使用中]WalkersHP お問い合わせフォーム',
        fields: [
          { id: '1', name: 'お名前', value: 'テスト太郎', type: 'text' },
          { id: '2', name: '貴社名', value: 'テスト株式会社', type: 'text' },
          { id: '3', name: 'メールアドレス', value: 'test@example.com', type: 'email' },
          { id: '4', name: '電話番号', value: '090-1234-5678', type: 'phone' },
          { id: '5', name: 'お問い合わせ内容', value: 'Webhook受信テストです', type: 'textarea' }
        ],
        entry_id: 99999,
        timestamp: new Date().toISOString(),
        source_ip: '127.0.0.1'
      }))
    }
  };
  var result = doGet(mockEvent);
  Logger.log(result.getContent());
}
