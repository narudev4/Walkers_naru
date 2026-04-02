/**
 * Gemini議事録 自動リネーマー
 *
 * Google Meetで生成されたGeminiメモのタイトルを
 * カレンダーのイベント名と照合して自動でリネームする
 *
 * 使い方:
 *   1. setupTrigger() を実行 → 30分おきに自動実行開始
 *   2. batchRenameAll() を手動実行 → 既存の未リネームメモを一括処理
 *   3. testDryRun() を実行 → リネームせず照合結果だけログに出力
 */

// ============================================================
// 設定
// ============================================================
const CONFIG = {
  // チェックするカレンダーID（優先度順）
  calendars: [
    'fullsrodd@gmail.com',             // 個人カレンダー（顧客MTGが多い）
    'daiki.furutani@walker-s.co.jp',   // 仕事カレンダー
  ],

  // Geminiメモを識別するパターン
  geminiPattern: 'に開始した会議 - Gemini によるメモ',

  // リネーム済みの目印（タイトル先頭がこれなら処理済み）
  renamedPrefix: '【',

  // カレンダー照合の時間ウィンドウ（分）
  // Meetの開始時刻とカレンダーイベント開始時刻のズレ許容範囲
  matchWindowMinutes: 20,

  // 除外するカレンダーイベント名（ルーティン系）
  excludePatterns: [
    '睡眠', 'コンサータ', 'ブロック', '連絡を返す',
    'タスク消化', 'タスクを確認', '薬効切れる',
    '請求書発行', '翌日家賃', '予定とタスクを確認',
    'コンサータ薬効', '移動',
  ],

  // 除外するイベント（完全一致）
  excludeExact: [],

  // トリガー間隔（分）
  triggerIntervalMinutes: 30,

  // 処理対象の日数（何日前まで遡るか）
  lookbackDays: 30,

  // リネーム後の移動先フォルダID
  destinationFolderId: '1XkOvPCMuixK06SUHVhZhwVCR-8slfAGu', // Walkers_議事録
};


// ============================================================
// メイン関数
// ============================================================

/**
 * 自動処理（トリガーから呼ばれる）
 * Step 1: 未移動の検知と移動（前回リネーム済みで移動失敗したもの）
 * Step 2: 新しいミーティングのリネーム（元フォルダで実行）
 * Step 3: リネームしたミーティングの移動
 */
function autoRenameGeminiNotes() {
  // Step 1: 未移動ファイルの救済
  const rescued = rescueUnmovedFiles_();

  // Step 2: 新規ファイルのリネーム（移動はまだしない）
  const files = findUnrenamedGeminiNotes_();
  const renamedFiles = []; // リネーム成功したファイルを保持
  let skipped = 0;

  if (files.length > 0) {
    Logger.log(`=== Step 2: ${files.length}件のGeminiメモをリネーム ===`);
    files.forEach(file => {
      try {
        const result = renameFile_(file);
        if (result) {
          renamedFiles.push(file);
        } else {
          skipped++;
        }
      } catch (e) {
        Logger.log(`[ERROR] ${file.getName()}: ${e.message}`);
        skipped++;
      }
    });
    Logger.log(`Step 2 完了: ${renamedFiles.length}件リネーム, ${skipped}件スキップ`);
  }

  // Step 3: リネームしたファイルを移動
  if (renamedFiles.length > 0) {
    Logger.log(`=== Step 3: ${renamedFiles.length}件を移動 ===`);
    renamedFiles.forEach(file => {
      moveFileToDest_(file.getId(), file.getName());
    });
  }

  if (rescued === 0 && files.length === 0) {
    Logger.log('処理対象のファイルはありません。');
  }
}

/**
 * 手動一括リネーム（初回実行用）
 */
function batchRenameAll() {
  autoRenameGeminiNotes();
}

/**
 * ドライラン（リネームせず照合結果だけ表示）
 */
function testDryRun() {
  const files = findUnrenamedGeminiNotes_();
  if (files.length === 0) {
    Logger.log('対象のGeminiメモはありません。');
    return;
  }

  Logger.log(`=== ドライラン: ${files.length}件 ===`);
  files.forEach(file => {
    const fileName = file.getName();
    const meetingTime = extractMeetingTime_(fileName);
    if (!meetingTime) {
      Logger.log(`[SKIP] 日時抽出不可: ${fileName}`);
      return;
    }

    const match = findMatchingEvent_(meetingTime);
    if (match) {
      const newTitle = buildNewTitle_(match.title, meetingTime);
      Logger.log(`[MATCH] ${fileName}`);
      Logger.log(`   → ${newTitle} (${match.calendarId})`);
    } else {
      Logger.log(`[NO MATCH] ${fileName} (${meetingTime})`);
    }
  });
}

/**
 * トリガー設定（初回のみ実行）
 */
function setupTrigger() {
  // 既存トリガーを削除
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'autoRenameGeminiNotes') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 新規トリガー作成
  ScriptApp.newTrigger('autoRenameGeminiNotes')
    .timeBased()
    .everyMinutes(CONFIG.triggerIntervalMinutes)
    .create();

  Logger.log(`トリガー設定完了: ${CONFIG.triggerIntervalMinutes}分ごとに自動実行`);
}

/**
 * トリガー削除
 */
function removeTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'autoRenameGeminiNotes') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  Logger.log(`${removed}件のトリガーを削除しました。`);
}


/**
 * 未移動ファイル救済（手動実行用ラッパー）
 */
function rescueUnmovedFiles() {
  const moved = rescueUnmovedFiles_();
  Logger.log(`手動救済完了: ${moved}件移動`);
}

// ============================================================
// 内部関数
// ============================================================

/**
 * 未リネームのGeminiメモを検索
 */
function findUnrenamedGeminiNotes_() {
  const results = [];
  const query = `title contains "${CONFIG.geminiPattern}" and mimeType = "application/vnd.google-apps.document" and trashed = false`;

  const files = DriveApp.searchFiles(query);
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();

    // リネーム済みはスキップ
    if (name.startsWith(CONFIG.renamedPrefix)) continue;

    // パターン確認
    if (!name.includes(CONFIG.geminiPattern)) continue;

    // lookbackDays以内のファイルのみ
    const meetingTime = extractMeetingTime_(name);
    if (meetingTime) {
      const daysDiff = (new Date() - meetingTime) / (1000 * 60 * 60 * 24);
      if (daysDiff > CONFIG.lookbackDays) continue;
    }

    results.push(file);
  }

  // 日時順にソート
  results.sort((a, b) => {
    const timeA = extractMeetingTime_(a.getName());
    const timeB = extractMeetingTime_(b.getName());
    if (!timeA) return 1;
    if (!timeB) return -1;
    return timeA - timeB;
  });

  return results;
}

/**
 * ファイル名からミーティング開始時刻を抽出
 * 例: " 2026/02/26 17:59 JST に開始した会議 - Gemini によるメモ"
 */
function extractMeetingTime_(fileName) {
  const match = fileName.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s+JST/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  return new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute)
  );
}

/**
 * カレンダーから該当時刻のイベントを検索
 */
function findMatchingEvent_(meetingTime) {
  const windowMs = CONFIG.matchWindowMinutes * 60 * 1000;
  const searchStart = new Date(meetingTime.getTime() - windowMs);
  const searchEnd = new Date(meetingTime.getTime() + 60 * 60 * 1000); // 1時間後まで

  let bestMatch = null;
  let bestTimeDiff = Infinity;

  for (const calId of CONFIG.calendars) {
    try {
      const calendar = CalendarApp.getCalendarById(calId);
      if (!calendar) {
        Logger.log(`[WARN] カレンダー未接続: ${calId}`);
        continue;
      }

      const events = calendar.getEvents(searchStart, searchEnd);

      for (const event of events) {
        const title = event.getTitle().trim();

        // 除外パターンチェック
        if (CONFIG.excludePatterns.some(p => title.includes(p))) continue;
        if (CONFIG.excludeExact.includes(title)) continue;

        // 時間差を計算（イベント開始時刻とMeet開始時刻の差）
        const eventStart = event.getStartTime();
        const timeDiff = Math.abs(eventStart.getTime() - meetingTime.getTime());

        if (timeDiff < bestTimeDiff) {
          bestTimeDiff = timeDiff;
          bestMatch = {
            title: title,
            startTime: eventStart,
            calendarId: calId,
            timeDiffMinutes: Math.round(timeDiff / 60000),
          };
        }
      }
    } catch (e) {
      Logger.log(`[WARN] カレンダー取得エラー (${calId}): ${e.message}`);
    }
  }

  return bestMatch;
}

/**
 * 新しいタイトルを組み立て
 * 形式: 【イベント名】MTG (M/D)
 */
function buildNewTitle_(eventTitle, meetingTime) {
  const month = meetingTime.getMonth() + 1;
  const day = meetingTime.getDate();
  const dateStr = `${month}/${day}`;

  let title = eventTitle.trim();

  // 既に【】で囲まれている場合はそのまま使う
  if (title.startsWith('【')) {
    return `${title} (${dateStr})`;
  }

  // 末尾の「MTG」「ミーティング」「定例」等を除去（二重にならないよう）
  title = title
    .replace(/\s*MTG$/i, '')
    .replace(/\s*ミーティング$/, '')
    .replace(/\s*定例ミーティング$/, '')
    .replace(/\s*定例$/, '')
    .trim();

  // 「様」がタイトルに含まれる場合（顧客名のみ）→ MTGをつける
  // 「社内」「作業会」「ブレスト」等はそのまま
  const isClientMeeting = title.includes('様') || title.includes('株式会社');
  const suffix = isClientMeeting ? 'MTG' : '';

  if (suffix) {
    return `【${title}】${suffix} (${dateStr})`;
  }
  return `【${title}】(${dateStr})`;
}

/**
 * 1ファイルをリネームのみ（移動はしない）
 * @returns {boolean} リネームしたらtrue
 */
function renameFile_(file) {
  const fileName = file.getName();
  const meetingTime = extractMeetingTime_(fileName);

  if (!meetingTime) {
    Logger.log(`[SKIP] 日時抽出不可: ${fileName}`);
    return false;
  }

  const match = findMatchingEvent_(meetingTime);

  if (!match) {
    Logger.log(`[NO MATCH] ${fileName} (${Utilities.formatDate(meetingTime, 'JST', 'M/d HH:mm')})`);
    return false;
  }

  const newTitle = buildNewTitle_(match.title, meetingTime);
  file.setName(newTitle);
  Logger.log(`[RENAMED] ${newTitle}  ←  ${fileName}`);
  return true;
}

/**
 * リネーム済みだが移動先にないファイルを検出して移動
 * Drive API v3で検索し、親フォルダが移動先でないものを移動
 * @returns {number} 移動した件数
 */
function rescueUnmovedFiles_() {
  let moved = 0;
  let pageToken = null;

  do {
    const res = Drive.Files.list({
      q: `name starts with '${CONFIG.renamedPrefix}' and mimeType = 'application/vnd.google-apps.document' and trashed = false and not '${CONFIG.destinationFolderId}' in parents`,
      fields: 'nextPageToken, files(id, name, parents)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 100,
      pageToken: pageToken,
    });

    const files = res.files || [];
    for (const file of files) {
      // 議事録リネーム済みファイルのみ対象（末尾が (M/D) パターン）
      if (!/\(\d{1,2}\/\d{1,2}\)\s*$/.test(file.name)) {
        continue;
      }
      moveFileToDest_(file.id, file.name);
      moved++;
    }

    pageToken = res.nextPageToken;
  } while (pageToken);

  if (moved > 0) {
    Logger.log(`=== Step 1: ${moved}件の未移動ファイルを救済 ===`);
  }
  return moved;
}

/**
 * Drive API v3でファイルを移動先フォルダへ移動（共有ドライブ対応）
 * @param {string} fileId
 * @param {string} fileName ログ用
 */
function moveFileToDest_(fileId, fileName) {
  try {
    // 現在の親フォルダを取得
    const fileMeta = Drive.Files.get(fileId, {
      fields: 'parents',
      supportsAllDrives: true,
    });
    const currentParents = (fileMeta.parents || []).join(',');

    // 親フォルダを差し替えて移動
    Drive.Files.update({}, fileId, null, {
      addParents: CONFIG.destinationFolderId,
      removeParents: currentParents,
      supportsAllDrives: true,
    });
    Logger.log(`[MOVED] ${fileName}`);
  } catch (e) {
    Logger.log(`[MOVE FAILED] ${fileName}: ${e.message}`);
    Logger.log(`  → 次回 Step 1 で再試行されます`);
  }
}
