/**
 * WalkersHP 問い合わせ Gmail ポーリング（層1・ステップ①）
 *
 * Gmail に届いたフォーム通知メールを検出し、パースしてスプレッドシートに
 * 「未判定」として積む。判定は層2（Windows の claude -p）が行う。
 *
 * 受信方式として webhook を使わない理由は DESIGN.md 参照
 * （2026-06-10 に WP 側の送信が停止し、4ヶ月以上気づけなかった実績がある）。
 *
 * 依存: Parse.gs の parseInquiry(), Config.gs の CONFIG.SHEET_ID
 * トリガー: pollInquiries を 5 分間隔の時間主導トリガーで実行する
 */

var POLLER = {
  SHEET_NAME: 'お問い合わせ',

  // 件名は全件同一なので Gmail が 1 スレッドに束ねる。
  // スレッド単位ではなくメッセージ単位で処理すること。
  SEARCH_QUERY: 'from:support@walker-s.co.jp subject:"【WalkersHP】お問い合わせが届きました"',

  // 遡る日数。初回移行時のみ広げ、定常運用では 3 日で足りる
  // （5 分間隔で回るので取りこぼしは実質発生しない）。
  LOOKBACK_DAYS: 3,

  // 1 回の実行で処理する上限。GAS の 6 分制限に収めるための保険。
  MAX_PER_RUN: 30,

  // 同じ相手を重複して積まない判定期間（日）。
  // 転送が複数回来ても1件として扱うためのもの。
  // これを過ぎたら「2回目の問い合わせ」として通す。
  DUP_WINDOW_DAYS: 7,

  // 列番号（1-based）。既存の列構成を壊さないこと。
  COL: {
    TIMESTAMP: 1,   // A
    NAME: 2,        // B
    COMPANY: 3,     // C
    EMAIL: 4,       // D
    PHONE: 5,       // E
    CONTENT: 6,     // F
    ENTRY_ID: 7,    // G  webhook 由来。ポーリングでは空
    SOURCE_IP: 8,   // H  同上
    STATUS: 9,      // I  未判定 / inquiry / sales / 下書き済 / error
    DRAFT_ID: 10,   // J
    PROCESSED_AT: 11, // K
    MEMO: 12,       // L
    GMAIL_ID: 13,   // M  冪等性キー（Gmail messageId）
    // N〜R は InquiryFollowup.gs が使用
    //   N notion_page_id / O summary / P sent_at / Q confirmed_at / R calendar_event_id
    FORM_TYPE: 19   // S  inquiry（問い合わせ） / docrequest（資料請求）
  },

  LAST_COL: 19,

  FORM_TYPE: {
    INQUIRY: 'inquiry',
    DOCREQUEST: 'docrequest'
  },

  // 対応状況は「空」で書き込む。
  // 既存プロジェクト walkers-inquiry-draft-worker の retrySweep() が
  // 「対応状況が空の行」を拾って判定・下書き作成まで行うため、
  // ここで値を入れると永久に拾われなくなる。
  STATUS: {
    ERROR: 'エラー: パース失敗'
  }
};

/**
 * 時間主導トリガーから呼ぶエントリポイント。
 */
function pollInquiries() {
  var lock = LockService.getScriptLock();
  // 前回の実行が終わっていない場合は黙って抜ける（二重処理防止）
  if (!lock.tryLock(10 * 1000)) {
    Logger.log('pollInquiries: 別の実行が進行中のためスキップ');
    return;
  }

  try {
    var sheet = getInquirySheet_();
    var known = loadKnownMessageIds_(sheet);

    var recent = loadRecentKeys_(sheet);
    var stats = { skipped: 0, failed: 0, duplicated: 0 };

    // 問い合わせフォームと資料請求フォームの両方を1サイクルで処理する
    var rows = collectRows_(searchInquiryMessages_(), known, recent,
                            POLLER.FORM_TYPE.INQUIRY,
                            parseInquiry, buildRow_, stats);
    rows = rows.concat(collectRows_(searchDocRequestMessages_(), known, recent,
                                    POLLER.FORM_TYPE.DOCREQUEST,
                                    parseDocRequest, buildDocRequestRow_, stats));

    if (rows.length > 0) {
      appendRows_(sheet, rows);
    }

    var failed = stats.failed;
    Logger.log('pollInquiries: 追加 ' + rows.length + ' 件 / 既存スキップ ' +
               stats.skipped + ' 件 / 重複スキップ ' + stats.duplicated +
               ' 件 / パース失敗 ' + failed + ' 件');

    if (failed > 0) {
      notifyNaru_('問い合わせのパースに失敗しました（' + failed + '件）',
        'スプレッドシートの「お問い合わせ」タブで 対応状況=error の行を確認してください。\n' +
        'フォームの項目構成が変わった可能性があります。\n\n' + inquirySheetUrl_());
    }

  } catch (err) {
    logPollerError_(err);
    notifyNaru_('問い合わせポーリングが失敗しました',
      String(err && err.message ? err.message : err) + '\n\n' +
      (err && err.stack ? err.stack : ''));
  } finally {
    lock.releaseLock();
  }
}

/**
 * 検出したメッセージをパースして行データにする。
 * 問い合わせと資料請求で parser / rowBuilder だけを差し替えて共用する。
 *
 * 重複排除を2段構えにしている:
 *   1. Gmail messageId — 同じメールを二度積まない
 *   2. メールアドレス + 種別 — 同じ相手を短期間に二度積まない
 *
 * 2 が必要なのは、資料請求が渡辺さんの手動転送で届いており、
 * 転送が複数回行われると messageId が別になるため（2026-07-26 に実際に発生し、
 * 同じ相手に日調メールの下書きが2通できた）。
 *
 * known / recent はいずれも破壊的に更新する（同一実行内での重複も防ぐため）。
 */
function collectRows_(messages, known, recent, formType, parser, rowBuilder, stats) {
  var rows = [];
  for (var i = 0; i < messages.length && rows.length < POLLER.MAX_PER_RUN; i++) {
    var msg = messages[i];
    var id = msg.getId();
    if (known[id]) { stats.skipped++; continue; }

    var parsed = null;
    try {
      parsed = parser(msg.getPlainBody());
    } catch (err) {
      parsed = null;
    }

    if (!parsed) {
      // パース失敗も記録する。黙って捨てると気づけない。
      rows.push(buildErrorRow_(msg, id));
      stats.failed++;
      known[id] = true;
      continue;
    }

    var dupKey = String(parsed.email).toLowerCase() + '|' + formType;
    if (recent[dupKey]) {
      stats.duplicated++;
      known[id] = true;
      continue;
    }

    rows.push(rowBuilder(msg, id, parsed));
    known[id] = true;
    recent[dupKey] = true;
  }
  return rows;
}

/**
 * 直近 DUP_WINDOW_DAYS 以内に積んだ「メールアドレス + 種別」の集合を返す。
 * 同じ相手からの再問い合わせは期間を過ぎれば通す（本当に2回目の相談かもしれないため）。
 */
function loadRecentKeys_(sheet) {
  var last = sheet.getLastRow();
  var recent = {};
  if (last < 2) return recent;

  var values = sheet.getRange(2, 1, last - 1, POLLER.LAST_COL).getValues();
  var cutoff = Date.now() - POLLER.DUP_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  for (var i = 0; i < values.length; i++) {
    var ts = values[i][POLLER.COL.TIMESTAMP - 1];
    var t = (ts instanceof Date) ? ts.getTime() : new Date(ts).getTime();
    if (isNaN(t) || t < cutoff) continue;

    var email = String(values[i][POLLER.COL.EMAIL - 1] || '').toLowerCase();
    if (!email) continue;
    var ft = String(values[i][POLLER.COL.FORM_TYPE - 1] || POLLER.FORM_TYPE.INQUIRY);
    recent[email + '|' + ft] = true;
  }
  return recent;
}

/**
 * Gmail から対象メッセージを取得する（新しい順）。
 * スレッドが 1 本に束ねられているため、スレッドを展開してメッセージ単位で扱う。
 */
function searchInquiryMessages_() {
  var query = POLLER.SEARCH_QUERY + ' newer_than:' + POLLER.LOOKBACK_DAYS + 'd';
  var threads = GmailApp.search(query, 0, 50);
  var out = [];

  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      // スレッドには naru 自身の返信も混ざるため、送信元で絞る
      var from = msgs[m].getFrom();
      if (from.indexOf('support@walker-s.co.jp') === -1) continue;
      if (msgs[m].getSubject().indexOf('【WalkersHP】お問い合わせが届きました') === -1) continue;
      out.push(msgs[m]);
    }
  }

  // 古い順に処理する（受信順にシートへ積みたい）
  out.sort(function (a, b) { return a.getDate() - b.getDate(); });
  return out;
}

function getInquirySheet_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sheet = ss.getSheetByName(POLLER.SHEET_NAME);
  if (!sheet) throw new Error('シート「' + POLLER.SHEET_NAME + '」が見つかりません');

  // M 列（gmail_message_id）と S 列（form_type）のヘッダーを確保する。
  // 既存の A〜L と、InquiryFollowup が使う N〜R には触らない。
  var header = sheet.getRange(1, 1, 1, POLLER.LAST_COL).getValues()[0];
  if (header[POLLER.COL.GMAIL_ID - 1] !== 'gmail_message_id') {
    sheet.getRange(1, POLLER.COL.GMAIL_ID).setValue('gmail_message_id')
         .setFontWeight('bold');
  }
  if (header[POLLER.COL.FORM_TYPE - 1] !== 'form_type') {
    sheet.getRange(1, POLLER.COL.FORM_TYPE).setValue('form_type')
         .setFontWeight('bold');
  }
  return sheet;
}

/**
 * 既にシートに存在する Gmail messageId を集める（冪等性チェック用）。
 */
function loadKnownMessageIds_(sheet) {
  var last = sheet.getLastRow();
  var known = {};
  if (last < 2) return known;

  var values = sheet.getRange(2, POLLER.COL.GMAIL_ID, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var v = values[i][0];
    if (v) known[String(v)] = true;
  }
  return known;
}

function buildRow_(msg, gmailId, p) {
  var row = new Array(POLLER.LAST_COL);
  for (var i = 0; i < row.length; i++) row[i] = '';

  row[POLLER.COL.TIMESTAMP - 1] = formatJst_(msg.getDate());
  row[POLLER.COL.NAME - 1]      = p.name;
  row[POLLER.COL.COMPANY - 1]   = p.company;
  row[POLLER.COL.EMAIL - 1]     = p.email;
  row[POLLER.COL.PHONE - 1]     = p.phone;
  row[POLLER.COL.CONTENT - 1]   = p.content;

  // entry_id には Gmail の messageId を入れる。
  // 既存の findInquiryRow() / updateInquiryStatus() が entry_id で行を特定するため、
  // ここが空だと下書き作成後に状態を書き戻せない。
  row[POLLER.COL.ENTRY_ID - 1]  = gmailId;
  row[POLLER.COL.GMAIL_ID - 1]  = gmailId;
  row[POLLER.COL.FORM_TYPE - 1] = POLLER.FORM_TYPE.INQUIRY;

  // 対応状況は空のまま。retrySweep が拾う条件がそれ。
  return row;
}

/**
 * 資料請求フォームの行を作る。
 * 問い合わせと違いフィールドが可変なので、フォームの回答をまとめて
 * 「お問い合わせ内容」列に入れる。判定・要約・返信メール末尾の再掲にこれを使う。
 */
function buildDocRequestRow_(msg, gmailId, p) {
  var row = new Array(POLLER.LAST_COL);
  for (var i = 0; i < row.length; i++) row[i] = '';

  // お名前 / 貴社名 / メールアドレス / 電話番号 は専用列があるので本文からは除く
  var skip = { 'お名前': 1, '貴社名': 1, 'メールアドレス': 1, '電話番号': 1 };
  var lines = [];
  for (var k = 0; k < p.order.length; k++) {
    var key = p.order[k];
    if (skip[key]) continue;
    lines.push(key + ': ' + p.fields[key]);
  }

  row[POLLER.COL.TIMESTAMP - 1] = formatJst_(msg.getDate());
  row[POLLER.COL.NAME - 1]      = p.name;
  row[POLLER.COL.COMPANY - 1]   = p.company;
  row[POLLER.COL.EMAIL - 1]     = p.email;
  row[POLLER.COL.PHONE - 1]     = p.phone;
  row[POLLER.COL.CONTENT - 1]   = lines.join('\n');
  row[POLLER.COL.ENTRY_ID - 1]  = gmailId;
  row[POLLER.COL.GMAIL_ID - 1]  = gmailId;
  row[POLLER.COL.FORM_TYPE - 1] = POLLER.FORM_TYPE.DOCREQUEST;
  return row;
}

/**
 * 資料請求フォームの通知メールを検出する。
 *
 * 注意: 元メールの宛先に naru は入っておらず、現在は渡辺さんが手動転送している。
 * そのため「support@ からの直送」と「転送されたもの」の両方を拾う。
 * 転送に依存する経路は転送が止まれば検知できないため、
 * 本来は元メールの宛先に naru を追加してもらうのが根本解決（DESIGN.md 参照）。
 */
function searchDocRequestMessages_() {
  var q = 'subject:"' + DOCREQ.NOTICE_SUBJECT + '" newer_than:' + POLLER.LOOKBACK_DAYS + 'd';
  var threads = GmailApp.search(q, 0, 50);
  var out = [];

  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var subject = msgs[m].getSubject() || '';
      if (subject.indexOf(DOCREQ.NOTICE_SUBJECT) === -1) continue;
      // 本文にフォームの見出しが無いものは対象外（Chat通知の転送などを除く）
      if (msgs[m].getPlainBody().indexOf('資料請求フォームから送信がありました') === -1) continue;
      out.push(msgs[m]);
    }
  }
  out.sort(function (a, b) { return a.getDate() - b.getDate(); });
  return out;
}

function buildErrorRow_(msg, gmailId) {
  var row = new Array(POLLER.LAST_COL);
  for (var i = 0; i < row.length; i++) row[i] = '';

  row[POLLER.COL.TIMESTAMP - 1] = formatJst_(msg.getDate());
  row[POLLER.COL.CONTENT - 1]   = msg.getPlainBody().slice(0, 5000);
  row[POLLER.COL.ENTRY_ID - 1]  = gmailId;
  row[POLLER.COL.GMAIL_ID - 1]  = gmailId;

  // パース失敗行は対応状況を埋めておく。空にすると retrySweep が
  // 中身の無いデータで下書きを作ろうとしてしまう。
  row[POLLER.COL.STATUS - 1]    = POLLER.STATUS.ERROR;
  row[POLLER.COL.MEMO - 1]      = 'パース失敗: フォームの項目構成が変わった可能性';
  return row;
}

function appendRows_(sheet, rows) {
  var start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, POLLER.LAST_COL).setValues(rows);
}

function formatJst_(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
}

function inquirySheetUrl_() {
  return 'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '/edit';
}

/**
 * naru にのみ通知する。顧客への送信は絶対に行わない。
 *
 * 通知先は Google Chat の「問い合わせ」スペース（Script Property: CHAT_WEBHOOK_URL）。
 * Chat が使えない場合はメールにフォールバックする。通知が完全に消えると
 * パイプラインが止まったことに気づけなくなるため、必ずどちらかで届ける。
 */
function notifyNaru_(subject, body) {
  var text = '⚠ [問い合わせポーラー] ' + subject + '\n\n' + body;

  // Chat 送信は同一プロジェクトの notifyChat()（InquiryDraft.gs）に委譲する。
  // 自前で UrlFetchApp を呼ばないのは、権限まわりを1箇所に集約するため。
  try {
    notifyChat(text);
    return;
  } catch (err) {
    Logger.log('Chat 通知に失敗: ' + err.message);
  }

  // Chat が使えない場合はメールにフォールバックする。
  // 通知が完全に消えるとパイプラインが止まったことに気づけなくなる。
  try {
    GmailApp.sendEmail('naru.hosoya@walker-s.co.jp',
      '[問い合わせパイプライン] ' + subject, body);
  } catch (err2) {
    Logger.log('通知の送信に失敗: ' + err2.message);
  }
}

/**
 * 通知の疎通確認用。実行すると Chat スペースにテストメッセージが1件届く。
 */
function testNotify() {
  notifyNaru_('通知テスト',
    'これは疎通確認です。このメッセージが Chat に届いていれば通知経路は正常です。\n' +
    inquirySheetUrl_());
  Logger.log('送信しました。Chat スペースを確認してください。');
}

function logPollerError_(err) {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sheet = ss.getSheetByName('error_log') || ss.insertSheet('error_log');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['timestamp', 'error_message', 'stack', 'raw_input']);
      sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    }
    sheet.appendRow([new Date().toISOString(),
                     '[poller] ' + (err.message || String(err)),
                     err.stack || '', '']);
  } catch (e) {
    Logger.log('error_log への記録に失敗: ' + e.message);
  }
}

// ===== 運用ユーティリティ =====

/**
 * 停滞検知。
 *
 * 対応状況が空の行は retrySweep（既存プロジェクト側・5分毎）が拾うはずなので、
 * 30 分以上空のままなら retrySweep が動いていない。
 * 「問い合わせが 0 件」と「パイプラインが止まっている」を区別するために必要。
 *
 * retrySweep は timestamp が 24 時間以内の行しか拾わないため、
 * それより古い行は対象外にする（永久に通知が鳴り続けるのを防ぐ）。
 *
 * トリガー: 1 時間ごとに実行する。
 */
function checkStalePending() {
  var STALE_MINUTES = 30;
  var RETRY_SWEEP_WINDOW_HOURS = 24;

  var sheet = getInquirySheet_();
  var last = sheet.getLastRow();
  if (last < 2) return;

  var values = sheet.getRange(2, 1, last - 1, POLLER.LAST_COL).getValues();
  var now = new Date().getTime();
  var stale = [];

  for (var i = 0; i < values.length; i++) {
    // 対応状況が埋まっていれば処理済み
    if (String(values[i][POLLER.COL.STATUS - 1] || '')) continue;

    var ts = values[i][POLLER.COL.TIMESTAMP - 1];
    var t = (ts instanceof Date) ? ts.getTime() : new Date(ts).getTime();
    if (isNaN(t)) continue;

    var ageMs = now - t;
    if (ageMs > RETRY_SWEEP_WINDOW_HOURS * 60 * 60 * 1000) continue; // retrySweep の対象外
    if (ageMs < STALE_MINUTES * 60 * 1000) continue;                  // まだ待って良い

    stale.push((i + 2) + '行目: ' + values[i][POLLER.COL.COMPANY - 1] +
               ' ' + values[i][POLLER.COL.NAME - 1]);
  }

  if (stale.length > 0) {
    notifyNaru_('処理が ' + STALE_MINUTES + ' 分以上滞留しています（' + stale.length + '件）',
      '既存プロジェクト walkers-inquiry-draft-worker の retrySweep が\n' +
      '動いていない可能性があります（トリガー設定と実行ログを確認してください）。\n\n' +
      stale.join('\n') + '\n\n' + inquirySheetUrl_());
  }
}

/**
 * 手動実行用。トリガーを設定する（重複作成を防ぐため既存を消してから作る）。
 */
function setupTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'pollInquiries' || fn === 'checkStalePending') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('pollInquiries').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('checkStalePending').timeBased().everyHours(1).create();
  Logger.log('トリガーを設定しました: pollInquiries(5分) / checkStalePending(1時間)');
}

/**
 * 動作確認用。シートには書き込まず、検出結果とパース結果をログに出すだけ。
 */
function dryRunPoll() {
  var sheet = getInquirySheet_();
  var known = loadKnownMessageIds_(sheet);
  var recent = loadRecentKeys_(sheet);

  var sets = [
    { label: '問い合わせ', msgs: searchInquiryMessages_(),
      ft: POLLER.FORM_TYPE.INQUIRY, parser: parseInquiry },
    { label: '資料請求', msgs: searchDocRequestMessages_(),
      ft: POLLER.FORM_TYPE.DOCREQUEST, parser: parseDocRequest }
  ];

  var newCount = 0, dupCount = 0;
  for (var s = 0; s < sets.length; s++) {
    var set = sets[s];
    Logger.log('--- ' + set.label + ': 検出 ' + set.msgs.length + ' 件 ---');
    for (var i = 0; i < set.msgs.length; i++) {
      var msg = set.msgs[i];
      if (known[msg.getId()]) continue;
      var p = set.parser(msg.getPlainBody());
      if (!p) {
        Logger.log('FAIL ' + formatJst_(msg.getDate()) + ' | パース失敗');
        newCount++;
        continue;
      }
      var key = String(p.email).toLowerCase() + '|' + set.ft;
      if (recent[key]) {
        Logger.log('DUP  ' + formatJst_(msg.getDate()) + ' | ' + p.company +
                   ' | ' + p.email + ' → 直近' + POLLER.DUP_WINDOW_DAYS + '日に処理済みのためスキップ');
        dupCount++;
        continue;
      }
      Logger.log('NEW  ' + formatJst_(msg.getDate()) + ' | ' + p.company +
                 ' | ' + p.name + ' | ' + p.email);
      recent[key] = true;
      newCount++;
    }
  }
  Logger.log('既存: ' + Object.keys(known).length + ' 件 / 未処理の新規: ' + newCount +
             ' 件 / 重複スキップ: ' + dupCount + ' 件（書き込みはしていません）');
}
