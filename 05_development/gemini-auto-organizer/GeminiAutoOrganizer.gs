/**
 * ============================================================
 *  Gemini Auto Organizer  v2.0
 *  - Gemini議事録を自動検知 → リネーム → 共有フォルダ移動
 *  - チームメンバー全員が各自のアカウントで設定
 * ============================================================
 *
 *  【セットアップ手順】
 *  1. script.google.com で新規プロジェクト作成
 *  2. このコードを貼り付け
 *  3. CONFIG セクションの SHARED_FOLDER_ID を設定
 *  4. initialSetup() を実行（トリガー自動登録）
 *  5. 権限を許可して完了
 * ============================================================
 */

// ======================== CONFIG ========================
const CONFIG = {
  // 共有フォルダID（チーム共通）
  // → Google Driveで共有フォルダを開き、URLの末尾のIDをコピー
  SHARED_FOLDER_ID: "1mDVCodDM4ftVqRpa5tvSbyt-sxfnigxg",

  // チェック間隔（分）: 10分ごとに新しい議事録をチェック
  CHECK_INTERVAL_MINUTES: 10,

  // 処理済みマーク用プロパティキー
  PROCESSED_KEY: "gemini_organized",

  // カレンダーID（空欄 = プライマリカレンダー）
  // 複数カレンダーを使う場合は配列で指定
  CALENDAR_IDS: [],

  // リネーム形式: {title} = カレンダー予定名, {date} = (M/D)
  NAME_FORMAT: "{title} ({date})",

  // ログスプレッドシートID（空欄 = ログなし）
  LOG_SHEET_ID: "",

  // デバッグモード
  DEBUG: false,
};

// ======================== MAIN ========================

/**
 * メイン処理: 新しいGemini議事録を検知→リネーム→移動
 * トリガーから自動実行される
 */
function processNewGeminiNotes() {
  const notes = findUnprocessedGeminiNotes_();
  if (notes.length === 0) {
    log_("新しいGemini議事録はありません");
    return;
  }

  log_(`${notes.length}件の未処理議事録を検出`);

  const sharedFolder = getSharedFolder_();
  if (!sharedFolder) {
    log_("ERROR: 共有フォルダが見つかりません。SHARED_FOLDER_ID を確認してください");
    return;
  }

  let success = 0;
  let failed = 0;

  for (const file of notes) {
    try {
      const result = processOneNote_(file, sharedFolder);
      if (result) {
        success++;
        log_(`✅ ${result.oldName} → ${result.newName}`);
      }
    } catch (e) {
      failed++;
      log_(`❌ ${file.getName()}: ${e.message}`);
    }
  }

  log_(`処理完了: ${success}件成功 / ${failed}件失敗`);
}

/**
 * 1件の議事録を処理
 */
function processOneNote_(file, sharedFolder) {
  const oldName = file.getName();
  const meetingDatetime = extractDatetime_(oldName);

  if (!meetingDatetime) {
    log_(`WARN: 日時を抽出できません: ${oldName}`);
    markAsProcessed_(file);
    return null;
  }

  // カレンダーから対応する予定を検索
  const event = findMatchingCalendarEvent_(meetingDatetime);
  const newName = generateNewName_(event, meetingDatetime);

  // リネーム
  file.setName(newName);

  // 共有フォルダに移動（元の場所からは削除）
  const currentParents = file.getParents();
  sharedFolder.addFile(file);
  while (currentParents.hasNext()) {
    currentParents.next().removeFile(file);
  }

  // 処理済みマーク
  markAsProcessed_(file);

  return { oldName, newName };
}

// ======================== 検知 ========================

/**
 * 未処理のGemini議事録を検索
 * パターン1: "YYYY/MM/DD HH:MM JST に開始した会議 - Gemini によるメモ"
 * パターン2: "会議名 - YYYY/MM/DD HH:MM JST - Gemini によるメモ"
 */
function findUnprocessedGeminiNotes_() {
  const queries = [
    'title contains "に開始した会議 - Gemini によるメモ"',
    'title contains "JST - Gemini によるメモ"',
  ];

  const allFiles = new Map(); // ID → File で重複排除

  for (const q of queries) {
    const fullQuery = `${q} and mimeType = "application/vnd.google-apps.document" and trashed = false`;
    try {
      const files = DriveApp.searchFiles(fullQuery);
      while (files.hasNext()) {
        const file = files.next();
        if (!isProcessed_(file)) {
          allFiles.set(file.getId(), file);
        }
      }
    } catch (e) {
      log_(`検索エラー (${q}): ${e.message}`);
    }
  }

  return Array.from(allFiles.values());
}

// ======================== カレンダー照合 ========================

/**
 * 指定日時に対応するカレンダー予定を検索
 * ±30分の範囲で最も近い予定を返す
 */
function findMatchingCalendarEvent_(datetime) {
  const searchStart = new Date(datetime.getTime() - 30 * 60 * 1000);
  const searchEnd = new Date(datetime.getTime() + 60 * 60 * 1000);

  let bestMatch = null;
  let bestDistance = Infinity;

  const calendarIds = CONFIG.CALENDAR_IDS.length > 0
    ? CONFIG.CALENDAR_IDS
    : [CalendarApp.getDefaultCalendar().getId()];

  for (const calId of calendarIds) {
    try {
      const cal = CalendarApp.getCalendarById(calId);
      if (!cal) continue;

      const events = cal.getEvents(searchStart, searchEnd);
      for (const event of events) {
        const distance = Math.abs(event.getStartTime().getTime() - datetime.getTime());
        if (distance < bestDistance) {
          bestDistance = distance;
          bestMatch = event;
        }
      }
    } catch (e) {
      log_(`カレンダー検索エラー (${calId}): ${e.message}`);
    }
  }

  return bestMatch;
}

// ======================== リネーム ========================

/**
 * 新しいファイル名を生成
 * カレンダー予定が見つかった場合: 予定名ベース
 * 見つからない場合: 日時ベース
 */
function generateNewName_(event, datetime) {
  const dateStr = `${datetime.getMonth() + 1}/${datetime.getDate()}`;

  if (event) {
    let title = event.getTitle().trim();

    // 既に【】形式の場合はそのまま使う
    if (title.startsWith("【")) {
      return `${title} (${dateStr})`;
    }

    // カレンダー予定名をそのまま使う
    return CONFIG.NAME_FORMAT
      .replace("{title}", title)
      .replace("{date}", dateStr);
  }

  // カレンダー予定が見つからない場合
  const timeStr = Utilities.formatDate(datetime, "Asia/Tokyo", "HH:mm");
  return `【不明】MTG (${dateStr} ${timeStr})`;
}

// ======================== ユーティリティ ========================

/**
 * ファイル名から日時を抽出
 */
function extractDatetime_(filename) {
  // パターン1: "2026/01/23 17:00 JST に開始した会議"
  const pattern1 = /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s+JST/;
  const match1 = filename.match(pattern1);
  if (match1) {
    return new Date(
      parseInt(match1[1]),
      parseInt(match1[2]) - 1,
      parseInt(match1[3]),
      parseInt(match1[4]),
      parseInt(match1[5])
    );
  }

  // パターン2: "会議名 - 2026/01/23 17:00 JST - Gemini"
  const pattern2 = /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s+JST/;
  const match2 = filename.match(pattern2);
  if (match2) {
    return new Date(
      parseInt(match2[1]),
      parseInt(match2[2]) - 1,
      parseInt(match2[3]),
      parseInt(match2[4]),
      parseInt(match2[5])
    );
  }

  return null;
}

/**
 * 処理済みかチェック
 */
function isProcessed_(file) {
  try {
    const props = PropertiesService.getScriptProperties();
    return props.getProperty(`processed_${file.getId()}`) === "true";
  } catch (e) {
    return false;
  }
}

/**
 * 処理済みマーク
 */
function markAsProcessed_(file) {
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty(`processed_${file.getId()}`, "true");
  } catch (e) {
    log_(`マーク失敗: ${e.message}`);
  }
}

/**
 * 共有フォルダ取得
 */
function getSharedFolder_() {
  try {
    return DriveApp.getFolderById(CONFIG.SHARED_FOLDER_ID);
  } catch (e) {
    return null;
  }
}

/**
 * ログ出力
 */
function log_(message) {
  const timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
  console.log(`[${timestamp}] ${message}`);

  // スプレッドシートにもログ
  if (CONFIG.LOG_SHEET_ID) {
    try {
      const ss = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
      let sheet = ss.getSheetByName("Logs");
      if (!sheet) {
        sheet = ss.insertSheet("Logs");
        sheet.appendRow(["Timestamp", "User", "Message"]);
      }
      sheet.appendRow([new Date(), Session.getActiveUser().getEmail(), message]);
    } catch (e) {
      // ログ書き込み失敗は無視
    }
  }
}

// ======================== セットアップ ========================

/**
 * 初回セットアップ: トリガー登録 + 動作確認
 * 手動で1回だけ実行する
 */
function initialSetup() {
  // 既存トリガーを削除
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === "processNewGeminiNotes") {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // 新しいトリガーを登録
  ScriptApp.newTrigger("processNewGeminiNotes")
    .timeDriven()
    .everyMinutes(CONFIG.CHECK_INTERVAL_MINUTES)
    .create();

  log_("✅ セットアップ完了！");
  log_(`   - チェック間隔: ${CONFIG.CHECK_INTERVAL_MINUTES}分`);
  log_(`   - 共有フォルダID: ${CONFIG.SHARED_FOLDER_ID}`);

  // 動作確認
  const folder = getSharedFolder_();
  if (folder) {
    log_(`   - 共有フォルダ名: ${folder.getName()}`);
  } else {
    log_("   ⚠️ 共有フォルダにアクセスできません。IDを確認してください");
  }

  // カレンダーアクセス確認
  try {
    const cal = CalendarApp.getDefaultCalendar();
    log_(`   - デフォルトカレンダー: ${cal.getName()}`);
  } catch (e) {
    log_("   ⚠️ カレンダーにアクセスできません");
  }

  // 未処理の議事録をカウント
  const notes = findUnprocessedGeminiNotes_();
  log_(`   - 未処理の議事録: ${notes.length}件`);

  if (notes.length > 0) {
    log_("\n📌 未処理の議事録が見つかりました。processNewGeminiNotes() を実行すると処理されます");
  }
}

/**
 * 手動実行: 未処理の議事録を一括処理
 */
function processAll() {
  processNewGeminiNotes();
}

/**
 * デバッグ: 未処理の議事録を確認（移動はしない）
 */
function dryRun() {
  const notes = findUnprocessedGeminiNotes_();
  log_(`=== ドライラン: ${notes.length}件の未処理議事録 ===`);

  for (const file of notes) {
    const oldName = file.getName();
    const datetime = extractDatetime_(oldName);

    if (!datetime) {
      log_(`  ⏭️ ${oldName} → 日時抽出不可`);
      continue;
    }

    const event = findMatchingCalendarEvent_(datetime);
    const newName = generateNewName_(event, datetime);
    const eventTitle = event ? event.getTitle() : "(カレンダー予定なし)";

    log_(`  📄 ${oldName}`);
    log_(`     → ${newName}`);
    log_(`     カレンダー: ${eventTitle}`);
  }
}

/**
 * リセット: 全ての処理済みマークをクリア
 * 再処理したい場合に使用
 */
function resetAllProcessedMarks() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  let count = 0;

  for (const key in allProps) {
    if (key.startsWith("processed_")) {
      props.deleteProperty(key);
      count++;
    }
  }

  log_(`${count}件の処理済みマークをリセットしました`);
}
