/**
 * 問い合わせパイプライン フォローアップ処理
 *
 * Phase 1 後半: 日調メールの「送信」を検知して Notion に登録する
 * Phase 2:      相手の返信から日程確定を検知して、確定メール下書き・Notion更新・
 *               カレンダー招待まで進める
 *
 * 設計方針:
 *   - naru が下書きを「送信した」ことを承認とみなす。下書きのまま破棄された案件は
 *     Notion に登録しない
 *   - カレンダー招待は社内メンバーのみ。クライアントは絶対に招待しない
 *   - 同席者が1人に絞れる場合のみ自動招待。2人とも空いている場合は naru に選ばせる
 *
 * 列の扱い:
 *   既存の STATUS_HEADERS（I〜L列）には触らない。ensureStatusColumns() が
 *   列位置を計算しているため、そこを動かすと既存データが壊れる。
 *   本ファイル用の列は N 列以降に確保する。
 */

var FOLLOWUP = {
  SHEET_NAME: 'お問い合わせ',

  // N 列から開始（M = gmail_message_id は InquiryPoller が使用）
  START_COL: 14,
  HEADERS: ['notion_page_id', 'summary', 'sent_at', 'confirmed_at', 'calendar_event_id'],

  KEY: {
    NOTION_PAGE_ID: 0,
    SUMMARY: 1,
    SENT_AT: 2,
    CONFIRMED_AT: 3,
    CALENDAR_EVENT_ID: 4
  },

  // 状態遷移
  STATUS: {
    DRAFTED: '下書き済',
    SENT: '送信済',
    CONFIRMED: '日程確定',
    MTG_SET: 'MTG設定済'
  },

  // 確定メールに載せる連絡先
  //
  // MTG URL は誰が主催するかで変わる（渡辺さん / naru / 古谷さん）。
  // 確定時点では主催者が決まらないため自動では選べない。
  // 下書きには既定値を入れておき、naru が送信前に必要なら差し替える。
  // Script Property で上書きできる:
  //   MEET_URL_DEFAULT  下書きに入れる既定URL（未設定なら下記の古谷さんリンク）
  //   MEET_URL_NARU     Chat 通知に選択肢として併記
  //   MEET_URL_WATANABE 同上
  MEET_URL_FALLBACK: 'https://meet.google.com/mad-rboj-efw',   // 古谷さんのリンク
  PHONE: '050-8893-2652',

  CONFIRM_SUBJECT_PREFIX: 'Re: ',

  // 返信を探す期間
  REPLY_LOOKBACK_DAYS: 21,

  // 1回の実行で処理する上限
  MAX_PER_RUN: 5
};

// ===== 列アクセス =====

function ensureFollowupColumns_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(FOLLOWUP.SHEET_NAME);
  if (!sheet) throw new Error('シート「' + FOLLOWUP.SHEET_NAME + '」が見つかりません');

  var lastCol = Math.max(sheet.getLastColumn(),
                         FOLLOWUP.START_COL + FOLLOWUP.HEADERS.length - 1);
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  for (var i = 0; i < FOLLOWUP.HEADERS.length; i++) {
    var col = FOLLOWUP.START_COL + i;
    if (headers[col - 1] !== FOLLOWUP.HEADERS[i]) {
      sheet.getRange(1, col).setValue(FOLLOWUP.HEADERS[i]).setFontWeight('bold');
    }
  }
  return sheet;
}

/**
 * entry_id で行を探す。既存の findInquiryRow() は status/draftId しか返さないため、
 * 行番号だけ取れれば良いこちら側で軽量版を持つ。
 */
function findRowByEntryId_(sheet, entryId) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var entryCol = headers.indexOf('entry_id') + 1;
  if (entryCol === 0) return -1;

  var ids = sheet.getRange(2, entryCol, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) {          // 新しい行から探す
    if (String(ids[i][0]) === String(entryId)) return i + 2;
  }
  return -1;
}

function setFollowupValue_(entryId, key, value) {
  try {
    var sheet = ensureFollowupColumns_();
    var row = findRowByEntryId_(sheet, entryId);
    if (row === -1) return;
    sheet.getRange(row, FOLLOWUP.START_COL + FOLLOWUP.KEY[key]).setValue(value);
  } catch (err) {
    Logger.log('setFollowupValue_ 失敗(' + key + '): ' + err.message);
  }
}

function getFollowupValue_(sheet, row, key) {
  return String(sheet.getRange(row, FOLLOWUP.START_COL + FOLLOWUP.KEY[key]).getValue() || '');
}

// ===== Phase 1 後半: 送信検知 → Notion 登録 =====

/**
 * 「下書き済」の行について、実際に送信されたかを Gmail で確認する。
 * 送信されていれば naru が内容を承認したとみなし、Notion に登録する。
 * トリガー: 10 分間隔
 */
function checkSentAndRegisterNotion() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) return;

  try {
    var sheet = ensureFollowupColumns_();
    var last = sheet.getLastRow();
    if (last < 2) return;

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var col = {};
    headers.forEach(function (h, i) { col[h] = i; });
    var statusCol = ensureStatusColumns(sheet);

    var rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    var processed = 0;

    for (var i = rows.length - 1; i >= 0 && processed < FOLLOWUP.MAX_PER_RUN; i--) {
      var r = rows[i];
      if (String(r[statusCol - 1] || '') !== FOLLOWUP.STATUS.DRAFTED) continue;

      var email = String(r[col['メールアドレス']] || '');
      if (!email) continue;

      var formType = String(r[col['form_type']] || 'inquiry');
      if (!isMailSent_(email, formType)) continue;   // まだ下書きのまま

      var rowNum = i + 2;
      var inquiry = {
        name: String(r[col['お名前']] || ''),
        company: String(r[col['貴社名']] || ''),
        email: email,
        phone: String(r[col['電話番号']] || ''),
        message: String(r[col['お問い合わせ内容']] || ''),
        entryId: String(r[col['entry_id']] || '')
      };
      var summary = getFollowupValue_(sheet, rowNum, 'SUMMARY');

      try {
        var pageId = createNotionSalesRecordV2_(inquiry, summary);
        setFollowupValue_(inquiry.entryId, 'NOTION_PAGE_ID', pageId);
        setFollowupValue_(inquiry.entryId, 'SENT_AT', new Date());
        updateInquiryStatus(inquiry.entryId, FOLLOWUP.STATUS.SENT, '', new Date(),
                            'Notion登録済(' + pageId.slice(0, 8) + ')');
        notifyChat('✅ 送信を検知し Notion に登録しました\n' +
                   inquiry.company + ' / ' + inquiry.name + '様\n' +
                   '概要: ' + truncate(summary || inquiry.message, 200));
        processed++;
      } catch (err) {
        logError(err, null);
        notifyChat('⚠ Notion 登録に失敗しました（' + inquiry.company + '）\n' +
                   truncate(err.message, 200) + '\n手動で営業DBに登録してください');
        updateInquiryStatus(inquiry.entryId, FOLLOWUP.STATUS.SENT, '', new Date(),
                            'Notion登録失敗: ' + truncate(err.message, 100));
        processed++;
      }
    }

    if (processed > 0) Logger.log('checkSentAndRegisterNotion: ' + processed + '件処理');
  } catch (err) {
    logError(err, null);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 日調メールが実際に送信されたかを判定する。
 * 下書きの有無ではなく送信済みフォルダを見る（下書きは破棄されることもあるため）。
 */
function isMailSent_(email, formType) {
  // 資料請求と問い合わせで返信の件名が違う
  var subject = (formType === DOCREQ.FORM_TYPE) ? DOCREQ.SUBJECT : INQUIRY.SUBJECT;
  var q = 'in:sent to:' + email + ' subject:"' + subject + '"';
  var threads = GmailApp.search(q, 0, 1);
  return threads.length > 0;
}

/**
 * Notion 営業DB へ登録し、作成したページIDを返す。
 * 既存の createNotionSalesRecord() との差分:
 *   - 要約（Gemini 生成）をプロジェクト概要に入れる
 *   - 営業担当者は日調時点では確定しないので入れない（Phase 2 で同席者が決まってから）
 *   - ページIDを返して、後続の更新に使えるようにする
 */
function createNotionSalesRecordV2_(inquiry, summary) {
  var token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('NOTION_TOKEN が未設定');

  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var overview = summary || truncate(inquiry.message, 500);

  var payload = {
    parent: { database_id: INQUIRY.NOTION_DB_ID },
    properties: {
      '法人名・屋号など': { title: [{ text: { content: inquiry.company || inquiry.name } }] },
      '担当者名': { email: inquiry.name },
      '日調送信日': { date: { start: today } },
      'PJステータス': { select: { name: '日調中' } },
      'プロジェクト概要': { rich_text: [{ text: { content: truncate(overview, 1900) } }] },
      'リード獲得日': { date: { start: today } }
    }
  };

  var res = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token, 'Notion-Version': '2022-06-28' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('Notion API ' + res.getResponseCode() + ': ' + truncate(res.getContentText(), 300));
  }
  return JSON.parse(res.getContentText()).id;
}

// ===== Phase 2: 日程確定の検知 =====

/**
 * 「送信済」の行について、相手からの返信を確認する。
 * 日程が確定していれば確定メール下書き・Notion更新・カレンダー招待まで進める。
 * トリガー: 10 分間隔
 */
function checkScheduleConfirmed() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10 * 1000)) return;

  try {
    var sheet = ensureFollowupColumns_();
    var last = sheet.getLastRow();
    if (last < 2) return;

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var col = {};
    headers.forEach(function (h, i) { col[h] = i; });
    var statusCol = ensureStatusColumns(sheet);

    var rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    var processed = 0;

    for (var i = rows.length - 1; i >= 0 && processed < FOLLOWUP.MAX_PER_RUN; i--) {
      var r = rows[i];
      if (String(r[statusCol - 1] || '') !== FOLLOWUP.STATUS.SENT) continue;

      var email = String(r[col['メールアドレス']] || '');
      if (!email) continue;

      var reply = findLatestReply_(email);
      if (!reply) continue;   // まだ返信なし

      var inquiry = {
        name: String(r[col['お名前']] || ''),
        company: String(r[col['貴社名']] || ''),
        email: email,
        entryId: String(r[col['entry_id']] || '')
      };

      var verdict = detectConfirmedSchedule_(reply.body);
      processed++;

      if (verdict.status === 'declined') {
        updateInquiryStatus(inquiry.entryId, '見送り', '', new Date(),
                            truncate(verdict.reason, 200));
        notifyChat('📕 先方から見送りのご連絡がありました\n' +
                   inquiry.company + ' / ' + inquiry.name + '様\n' +
                   '理由: ' + truncate(verdict.reason, 200));
        continue;
      }

      if (verdict.status !== 'confirmed' || !verdict.datetime) {
        // まだ調整中。状態は変えず、naru に気づかせるだけ
        notifyChat('💬 返信がありましたが日程はまだ確定していません（要確認）\n' +
                   inquiry.company + ' / ' + inquiry.name + '様\n' +
                   '判定: ' + truncate(verdict.reason, 200) + '\n' +
                   reply.link);
        updateInquiryStatus(inquiry.entryId, FOLLOWUP.STATUS.SENT, '', new Date(),
                            '返信あり(未確定): ' + truncate(verdict.reason, 150));
        continue;
      }

      handleConfirmed_(inquiry, verdict, reply);
    }

    if (processed > 0) Logger.log('checkScheduleConfirmed: ' + processed + '件処理');
  } catch (err) {
    logError(err, null);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 相手からの最新の返信を取得する。
 * naru 自身の送信は除外し、相手が最後に書いたものだけを返す。
 */
function findLatestReply_(email) {
  var q = 'from:' + email + ' newer_than:' + FOLLOWUP.REPLY_LOOKBACK_DAYS + 'd';
  var threads = GmailApp.search(q, 0, 5);
  var latest = null;

  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var from = msgs[m].getFrom();
      if (from.indexOf(email) === -1) continue;
      if (!latest || msgs[m].getDate() > latest.date) {
        latest = {
          date: msgs[m].getDate(),
          body: msgs[m].getPlainBody().slice(0, 4000),
          link: 'https://mail.google.com/mail/u/0/#all/' + msgs[m].getId()
        };
      }
    }
  }
  return latest;
}

/**
 * 返信本文から日程が確定したかを判定する。
 * 誤って「確定」と判定するとカレンダーに誤った予定が入るため、
 * 少しでも曖昧なら pending に倒す。
 */
function detectConfirmedSchedule_(replyBody) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return { status: 'unknown', reason: 'GEMINI_API_KEY 未設定' };

  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd (E)');

  var prompt =
    'あなたは日程調整メールの返信を読んで、打ち合わせ日程が確定したかどうかを判定します。\n\n' +
    '# 前提\n' +
    '本日は ' + today + ' です。年をまたぐ表記（例: 1月の日付が来年を指す）に注意してください。\n\n' +
    '# 判定基準\n' +
    '- confirmed: 相手が具体的な日時を1つに絞って承諾している（例「7月27日15時でお願いします」「水曜の14時に伺います」）\n' +
    '- pending: 複数の候補を挙げている／質問をしている／日時が曖昧（例「来週前半でお願いできますか」「午後なら空いています」）／こちらの再調整が必要\n' +
    '- declined: 見送り・お断りの意思表示がある\n\n' +
    '# 重要\n' +
    '**少しでも曖昧なら必ず pending にしてください。** 確定と誤判定するとカレンダーに誤った予定が入り、\n' +
    '相手にも影響します。確実に1つの日時に絞られている場合だけ confirmed にしてください。\n' +
    '日付だけで時刻が書かれていない場合も pending です。\n\n' +
    '# 返信本文\n' + replyBody + '\n\n' +
    '# 出力\n' +
    '次の JSON のみを返してください。前後に説明やコードフェンスを付けないでください。\n' +
    '{"status": "confirmed" または "pending" または "declined", "datetime": "YYYY-MM-DD HH:MM", "reason": "判定理由を1文で"}\n' +
    'datetime は status が confirmed のときだけ埋めてください。それ以外は空文字にしてください。';

  try {
    var res = fetchGemini(prompt, apiKey);
    if (res.getResponseCode() !== 200) {
      return { status: 'unknown', reason: 'Gemini HTTP ' + res.getResponseCode() };
    }
    var data = JSON.parse(res.getContentText());
    if (!data.candidates || !data.candidates[0]) {
      return { status: 'unknown', reason: 'Gemini candidates 空' };
    }
    var parsed = JSON.parse(data.candidates[0].content.parts[0].text);
    return {
      status: String(parsed.status || 'unknown'),
      datetime: String(parsed.datetime || ''),
      reason: String(parsed.reason || '')
    };
  } catch (err) {
    return { status: 'unknown', reason: 'detectConfirmedSchedule_ 例外: ' + err.message };
  }
}

// ===== Phase 2: 確定後の処理 =====

function handleConfirmed_(inquiry, verdict, reply) {
  var start = parseJstDateTime_(verdict.datetime);
  if (!start) {
    notifyChat('⚠ 日程確定と判定しましたが日時を解釈できませんでした（要手動対応）\n' +
               inquiry.company + ' / ' + inquiry.name + '様\n' +
               'Gemini の抽出値: ' + verdict.datetime + '\n' + reply.link);
    return;
  }
  var end = new Date(start.getTime() + 60 * 60 * 1000);

  // ① 確定メール下書き
  var body = buildConfirmMailBody_(inquiry, start);
  var draft = GmailApp.createDraft(inquiry.email, INQUIRY.SUBJECT, body, { cc: INQUIRY.CC });
  var draftUrl = 'https://mail.google.com/mail/u/0/#drafts/' + draft.getMessage().getId();

  // ② 同席可能者を判定
  var partners = whoIsAvailable_(start, end);
  var furutaniFree = partners.some(function (p) { return p.label === '古谷'; });
  var watanabeFree = partners.some(function (p) { return p.label === '渡辺'; });

  // ③ カレンダー登録
  // 渡辺さんは初回MTGの予定を把握しておく必要があるため、空き状況に関わらず必ず招待する。
  // 古谷さんはその時間に空いている場合のみ招待する。
  var calNote = '';
  var eventId = '';
  try {
    eventId = createInternalEvent_(inquiry, start, end, furutaniFree);
    calNote = '\n📅 カレンダー登録済（naru + 渡辺さん' +
              (furutaniFree ? ' + 古谷さん' : '') + '）';
    setFollowupValue_(inquiry.entryId, 'CALENDAR_EVENT_ID', eventId);
    if (!watanabeFree) {
      calNote += '\n⚠ 渡辺さんはこの時間に別の予定があります（把握目的のため招待はしています）';
    }
    if (!furutaniFree) {
      calNote += '\n※古谷さんはこの時間に予定があるため招待していません';
    }
  } catch (err) {
    calNote = '\n⚠ カレンダー登録に失敗: ' + truncate(err.message, 120);
    logError(err, null);
  }

  // ④ Notion 更新
  var notionNote = '';
  var pageId = '';
  try {
    var sheet = ensureFollowupColumns_();
    var row = findRowByEntryId_(sheet, inquiry.entryId);
    if (row !== -1) pageId = getFollowupValue_(sheet, row, 'NOTION_PAGE_ID');
    if (pageId) {
      // 営業担当者は空欄のままにする（naru 指示 2026-07-26）。
      // naru 自身が出ることもあり、同席カレンダーの空き状況だけでは決まらないため、
      // Notion 上で naru が設定する。
      updateNotionToMtgScheduled_(pageId, start, '');
    } else {
      notionNote = '\n⚠ Notion ページIDが未記録のため更新できませんでした';
    }
  } catch (err) {
    notionNote = '\n⚠ Notion 更新に失敗: ' + truncate(err.message, 120);
    logError(err, null);
  }

  // ⑤ 記録と通知
  setFollowupValue_(inquiry.entryId, 'CONFIRMED_AT', start);
  updateInquiryStatus(inquiry.entryId,
                      eventId ? FOLLOWUP.STATUS.MTG_SET : FOLLOWUP.STATUS.CONFIRMED,
                      draft.getId(), new Date(),
                      '確定: ' + formatJstDateTime_(start));

  notifyChat('🗓 日程が確定しました（確定メールの下書きを作成済み・要送信）\n' +
             inquiry.company + ' / ' + inquiry.name + '様\n' +
             '日時: ' + formatJstDateTime_(start) + '\n' +
             '下書き: ' + draftUrl + '\n' +
             meetUrlNote_() +
             calNote + notionNote);
}

/**
 * 下書きに入れる MTG URL。主催者が決まらないので既定値を使う。
 */
function meetUrl_() {
  return PropertiesService.getScriptProperties().getProperty('MEET_URL_DEFAULT') ||
         FOLLOWUP.MEET_URL_FALLBACK;
}

/**
 * Chat 通知に出す MTG URL の注意書き。
 * 主催者候補のリンクが Script Property に登録されていれば選択肢として併記する。
 */
function meetUrlNote_() {
  var p = PropertiesService.getScriptProperties();
  var note = '⚠ MTG URL は主催者に応じて差し替えてください（下書きの既定値: ' + meetUrl_() + '）';
  var naruUrl = p.getProperty('MEET_URL_NARU');
  var wataUrl = p.getProperty('MEET_URL_WATANABE');
  if (naruUrl) note += '\n   naru: ' + naruUrl;
  if (wataUrl) note += '\n   渡辺さん: ' + wataUrl;
  return note;
}

function buildConfirmMailBody_(inquiry, start) {
  return inquiry.company + '\n' +
    inquiry.name + '様\n' +
    '\n' +
    'お世話になっております。\n' +
    '株式会社Walkersの細谷です。\n' +
    '\n' +
    'ご連絡ありがとうございます。\n' +
    '\n' +
    formatJstDateTime_(start) + '\n' +
    'とのこと承知いたしました。\n' +
    '\n' +
    '差し支えなければお時間になりましたら下記までお越しいただけますと幸いです。\n' +
    meetUrl_() + '\n' +
    '\n' +
    'なお、緊急のご連絡につきましては、以下の番号までお電話いただけますようお願い申し上げます。\n' +
    FOLLOWUP.PHONE + '\n' +
    '\n' +
    '何卒よろしくお願いいたします。\n' +
    '\n' +
    '───────────────────\n' +
    '【あなたの事業を成功させる強力なパートナー】\n' +
    '株式会社Walkers\n' +
    'Naru Hosoya\n' +
    'Email: naru.hosoya@walker-s.co.jp\n' +
    'URL: https://walker-s.co.jp/\n' +
    '───────────────────\n';
}

/**
 * 確定時刻に同席できるのが誰かを判定する。
 * 空き枠計算と同じルール（2時間以上の予定・終日・transparent は貫通）を使う。
 */
function whoIsAvailable_(start, end) {
  var out = [];
  var pairs = [
    { label: '古谷', ids: INQUIRY.CAL_FURUTANI },
    { label: '渡辺', ids: INQUIRY.CAL_WATANABE }
  ];
  for (var i = 0; i < pairs.length; i++) {
    var cals = getCalendarsSafe(pairs[i].ids);
    var blocks = collectHardBlocks(cals, start, end);
    var free = subtractIntervals([[start.getTime(), end.getTime()]], blocks);
    if (coversInterval(free, [start.getTime(), end.getTime()])) out.push(pairs[i]);
  }
  return out;
}

/**
 * 社内メンバーのみを招待する予定を作成する。
 * クライアントは絶対に招待しない（既存運用ルール）。
 *
 * 渡辺さんは初回MTGの予定を把握しておく必要があるため常に招待する（naru 指示 2026-07-26）。
 * 古谷さんはその時間に空いている場合のみ招待する。
 */
function createInternalEvent_(inquiry, start, end, includeFurutani) {
  var guests = ['naru.hosoya@walker-s.co.jp'].concat(INQUIRY.CAL_WATANABE);
  if (includeFurutani) guests = guests.concat(INQUIRY.CAL_FURUTANI);
  var cal = CalendarApp.getDefaultCalendar();
  var ev = cal.createEvent(
    (inquiry.company || inquiry.name) + '様',
    start, end,
    {
      description: meetUrl_() + '\n\n【お問い合わせ内容】\n' +
                   truncate(inquiry.message || '', 1000),
      guests: guests.join(','),
      sendInvites: true
    });
  return ev.getId();
}

function updateNotionToMtgScheduled_(pageId, start, partnerLabel) {
  var token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('NOTION_TOKEN が未設定');

  var props = {
    'PJステータス': { select: { name: '初回mtg前' } },
    '次回MTG日': { date: { start: Utilities.formatDate(start, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX") } }
  };
  if (partnerLabel) props['営業担当者'] = { select: { name: partnerLabel } };

  var res = UrlFetchApp.fetch('https://api.notion.com/v1/pages/' + pageId, {
    method: 'patch',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token, 'Notion-Version': '2022-06-28' },
    payload: JSON.stringify({ properties: props }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('Notion API ' + res.getResponseCode() + ': ' + truncate(res.getContentText(), 300));
  }
}

// ===== 日時ユーティリティ =====

/** "YYYY-MM-DD HH:MM"（JST）を Date にする。解釈できなければ null */
function parseJstDateTime_(s) {
  if (!s) return null;
  var m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})/);
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0);
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatJstDateTime_(d) {
  return Utilities.formatDate(d, 'Asia/Tokyo', 'M月d日(E) HH:mm') + '〜' +
         Utilities.formatDate(new Date(d.getTime() + 60 * 60 * 1000), 'Asia/Tokyo', 'HH:mm');
}

// ===== 運用 =====

/**
 * フォローアップ用トリガーを設定する。既存の他トリガーには触らない。
 */
function setupFollowupTriggers() {
  var names = ['checkSentAndRegisterNotion', 'checkScheduleConfirmed'];
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (names.indexOf(triggers[i].getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('checkSentAndRegisterNotion').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('checkScheduleConfirmed').timeBased().everyMinutes(10).create();
  Logger.log('フォローアップのトリガーを設定しました（各10分間隔）');
}

/**
 * 動作確認用。書き込みは行わず、いま何が処理対象になるかだけを出す。
 */
function dryRunFollowup() {
  var sheet = ensureFollowupColumns_();
  var last = sheet.getLastRow();
  if (last < 2) { Logger.log('データなし'); return; }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = {};
  headers.forEach(function (h, i) { col[h] = i; });
  var statusCol = ensureStatusColumns(sheet);
  var rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();

  var drafted = 0, sent = 0;
  for (var i = 0; i < rows.length; i++) {
    var st = String(rows[i][statusCol - 1] || '');
    var email = String(rows[i][col['メールアドレス']] || '');
    if (st === FOLLOWUP.STATUS.DRAFTED && email) {
      drafted++;
      var ft = String(rows[i][col['form_type']] || 'inquiry');
      Logger.log('[下書き済/' + ft + '] ' + rows[i][col['貴社名']] + ' / ' + email +
                 ' → 送信検知: ' + (isMailSent_(email, ft) ? '送信済み(Notion登録対象)' : 'まだ下書き'));
    }
    if (st === FOLLOWUP.STATUS.SENT && email) {
      sent++;
      var reply = findLatestReply_(email);
      Logger.log('[送信済] ' + rows[i][col['貴社名']] + ' / ' + email +
                 ' → 返信: ' + (reply ? formatJstDateTime_(reply.date) + ' にあり' : 'なし'));
    }
  }
  Logger.log('下書き済 ' + drafted + '件 / 送信済 ' + sent + '件（書き込みはしていません）');
}
