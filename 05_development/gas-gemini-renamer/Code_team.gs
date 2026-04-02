/**
 * Gemini議事録 自動リネーマー (Team Edition)
 *
 * Google Meetで生成されたGeminiメモのタイトルを
 * カレンダーのイベント名と照合して自動リネーム＋共有フォルダ移動
 *
 * Web Appとしてデプロイし、チームメンバーが各自設定して利用
 *
 * デプロイ設定:
 *   Execute as: User accessing the web app
 *   Access: walker-s.co.jp ドメイン内のみ
 */

// ============================================================
// 定数・デフォルト設定
// ============================================================

/** 全ユーザー共通の定数 */
const SYSTEM = {
  geminiPattern: 'に開始した会議 - Gemini によるメモ',
  renamedPrefix: '【',
  triggerFunction: 'autoRenameAndMove',
  triggerIntervalMinutes: 30,
  maxLogs: 50,
};

/** ユーザー設定のデフォルト値 */
const DEFAULT_CONFIG = {
  calendars: [],
  sharedFolderId: '',
  excludePatterns: [
    '睡眠', 'ブロック', '連絡を返す',
    'タスク消化', 'タスクを確認',
    '予定とタスクを確認', '移動',
  ],
  matchWindowMinutes: 20,
  lookbackDays: 30,
};


// ============================================================
// Web App エントリポイント
// ============================================================

/**
 * Web Appにアクセスしたときにダッシュボードを表示
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('Gemini議事録リネーマー')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ============================================================
// ダッシュボードAPI（Dashboard.htmlから呼ばれる）
// ============================================================

/**
 * 現在のステータスを取得
 */
function getStatus() {
  const config = getUserConfig_();
  const email = Session.getActiveUser().getEmail();
  const hasActiveTrigger = checkTriggerExists_();

  return {
    email: email,
    enabled: hasActiveTrigger,
    config: config,
    recentLogs: getRecentLogs_(),
  };
}

/**
 * ユーザーのカレンダー一覧を取得
 */
function listMyCalendars() {
  const config = getUserConfig_();
  const selectedIds = config.calendars || [];

  const calendars = CalendarApp.getAllCalendars();
  return calendars.map(cal => ({
    id: cal.getId(),
    name: cal.getName(),
    primary: cal.isMyPrimaryCalendar(),
    selected: selectedIds.includes(cal.getId()),
  })).sort((a, b) => {
    if (a.primary) return -1;
    if (b.primary) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * ユーザー設定を保存
 */
function saveConfig(configJson) {
  const newConfig = JSON.parse(configJson);
  const current = getUserConfig_();

  const merged = {
    ...current,
    calendars: newConfig.calendars || current.calendars,
    sharedFolderId: newConfig.sharedFolderId !== undefined
      ? newConfig.sharedFolderId : current.sharedFolderId,
    excludePatterns: newConfig.excludePatterns || current.excludePatterns,
    matchWindowMinutes: newConfig.matchWindowMinutes || current.matchWindowMinutes,
    lookbackDays: newConfig.lookbackDays || current.lookbackDays,
  };

  saveUserConfig_(merged);
  return { success: true, config: merged };
}

/**
 * ドライラン（リネーム＋移動せず照合結果だけ返す）
 */
function runDryRun() {
  const config = getUserConfig_();

  if (!config.calendars || config.calendars.length === 0) {
    return { error: 'カレンダーが設定されていません。先にカレンダーを選択してください。' };
  }

  const files = findUnrenamedGeminiNotes_(config);
  const results = [];

  files.forEach(file => {
    const fileName = file.getName();
    const meetingTime = extractMeetingTime_(fileName);

    if (!meetingTime) {
      results.push({
        status: 'SKIP',
        originalName: fileName,
        reason: '日時抽出不可',
      });
      return;
    }

    const match = findMatchingEvent_(meetingTime, config);
    if (match) {
      const newTitle = buildNewTitle_(match.title, meetingTime);
      results.push({
        status: 'MATCH',
        originalName: fileName,
        newName: newTitle,
        calendarId: match.calendarId,
        timeDiff: match.timeDiffMinutes,
      });
    } else {
      results.push({
        status: 'NO_MATCH',
        originalName: fileName,
        meetingTime: Utilities.formatDate(meetingTime, 'JST', 'M/d HH:mm'),
      });
    }
  });

  return {
    total: files.length,
    results: results,
  };
}

/**
 * 今すぐ1回実行（ダッシュボードから呼ばれる）
 */
function runOnce() {
  return autoRenameAndMove();
}


// ============================================================
// トリガー管理
// ============================================================

/**
 * ユーザー用の自動実行トリガーを作成
 */
function setupUserTrigger() {
  // 既存トリガーを削除してから新規作成
  removeUserTrigger();

  ScriptApp.newTrigger(SYSTEM.triggerFunction)
    .timeBased()
    .everyMinutes(SYSTEM.triggerIntervalMinutes)
    .create();

  logExecution_({
    type: 'TRIGGER',
    message: `自動実行を有効化（${SYSTEM.triggerIntervalMinutes}分間隔）`,
  });

  return { success: true };
}

/**
 * ユーザー用トリガーを削除
 */
function removeUserTrigger() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === SYSTEM.triggerFunction) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });

  if (removed > 0) {
    logExecution_({
      type: 'TRIGGER',
      message: `自動実行を無効化（${removed}件のトリガーを削除）`,
    });
  }

  return { success: true, removed: removed };
}


// ============================================================
// メイン処理（トリガーから呼ばれる）
// ============================================================

/**
 * 自動リネーム＋共有フォルダ移動
 * ・30分トリガーで自動実行される
 * ・runOnce() からも手動呼び出し可
 */
function autoRenameAndMove() {
  const config = getUserConfig_();

  if (!config.calendars || config.calendars.length === 0) {
    Logger.log('カレンダーが未設定のためスキップ');
    return { renamed: 0, moved: 0, skipped: 0, error: 'カレンダー未設定' };
  }

  const files = findUnrenamedGeminiNotes_(config);
  if (files.length === 0) {
    return { renamed: 0, moved: 0, skipped: 0 };
  }

  let renamed = 0;
  let moved = 0;
  let skipped = 0;
  const details = [];

  files.forEach(file => {
    try {
      const result = processFile_(file, config);
      if (result.renamed) {
        renamed++;
        details.push(result.newTitle);
        if (result.moved) moved++;
      } else {
        skipped++;
      }
    } catch (e) {
      Logger.log(`[ERROR] ${file.getName()}: ${e.message}`);
      skipped++;
    }
  });

  const summary = { renamed, moved, skipped };

  if (renamed > 0 || skipped > 0) {
    logExecution_({
      type: 'RUN',
      message: `${renamed}件リネーム（${moved}件移動）, ${skipped}件スキップ`,
      details: details,
    });
  }

  return summary;
}


// ============================================================
// 内部関数
// ============================================================

/**
 * ユーザー設定を取得（PropertiesServiceから読み込み）
 */
function getUserConfig_() {
  const props = PropertiesService.getUserProperties();
  const raw = props.getProperty('config');

  if (!raw) return { ...DEFAULT_CONFIG };

  try {
    const saved = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...saved };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * ユーザー設定を保存
 */
function saveUserConfig_(config) {
  const props = PropertiesService.getUserProperties();
  props.setProperty('config', JSON.stringify(config));
}

/**
 * トリガーが存在するかチェック
 */
function checkTriggerExists_() {
  return ScriptApp.getProjectTriggers().some(
    t => t.getHandlerFunction() === SYSTEM.triggerFunction
  );
}

/**
 * 未リネームのGeminiメモを検索
 */
function findUnrenamedGeminiNotes_(config) {
  const results = [];
  const query = `title contains "${SYSTEM.geminiPattern}" and mimeType = "application/vnd.google-apps.document" and trashed = false`;

  const files = DriveApp.searchFiles(query);
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();

    // リネーム済みはスキップ
    if (name.startsWith(SYSTEM.renamedPrefix)) continue;

    // パターン確認
    if (!name.includes(SYSTEM.geminiPattern)) continue;

    // lookbackDays以内のファイルのみ
    const meetingTime = extractMeetingTime_(name);
    if (meetingTime) {
      const daysDiff = (new Date() - meetingTime) / (1000 * 60 * 60 * 24);
      if (daysDiff > config.lookbackDays) continue;
    }

    results.push(file);
  }

  // 日時順にソート（古い順）
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
 * 例: "2026/02/26 17:59 JST に開始した会議 - Gemini によるメモ"
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
function findMatchingEvent_(meetingTime, config) {
  const windowMs = config.matchWindowMinutes * 60 * 1000;
  const searchStart = new Date(meetingTime.getTime() - windowMs);
  const searchEnd = new Date(meetingTime.getTime() + 60 * 60 * 1000);

  let bestMatch = null;
  let bestTimeDiff = Infinity;

  for (const calId of config.calendars) {
    try {
      const calendar = CalendarApp.getCalendarById(calId);
      if (!calendar) continue;

      const events = calendar.getEvents(searchStart, searchEnd);

      for (const event of events) {
        const title = event.getTitle().trim();

        // 除外パターンチェック
        if (config.excludePatterns.some(p => title.includes(p))) continue;

        // 時間差を計算
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

  // 末尾の「MTG」「ミーティング」「定例」等を除去
  title = title
    .replace(/\s*MTG$/i, '')
    .replace(/\s*ミーティング$/, '')
    .replace(/\s*定例ミーティング$/, '')
    .replace(/\s*定例$/, '')
    .trim();

  // 顧客ミーティングの場合はMTGサフィックスをつける
  const isClientMeeting = title.includes('様') || title.includes('株式会社');
  const suffix = isClientMeeting ? 'MTG' : '';

  if (suffix) {
    return `【${title}】${suffix} (${dateStr})`;
  }
  return `【${title}】(${dateStr})`;
}

/**
 * 1ファイルを処理（リネーム＋共有フォルダ移動）
 * @returns {{ renamed: boolean, moved: boolean, newTitle?: string }}
 */
function processFile_(file, config) {
  const fileName = file.getName();
  const meetingTime = extractMeetingTime_(fileName);

  if (!meetingTime) {
    return { renamed: false, moved: false };
  }

  const match = findMatchingEvent_(meetingTime, config);
  if (!match) {
    return { renamed: false, moved: false };
  }

  // リネーム
  const newTitle = buildNewTitle_(match.title, meetingTime);
  file.setName(newTitle);
  Logger.log(`[RENAMED] ${newTitle}  ←  ${fileName}`);

  // 共有フォルダへ移動（設定されている場合のみ）
  let moved = false;
  if (config.sharedFolderId) {
    try {
      moved = moveToSharedFolder_(file, config.sharedFolderId);
    } catch (e) {
      Logger.log(`[WARN] フォルダ移動失敗: ${e.message}`);
    }
  }

  return { renamed: true, moved: moved, newTitle: newTitle };
}

/**
 * ファイルを共有フォルダに移動
 */
function moveToSharedFolder_(file, folderId) {
  if (!folderId) return false;

  try {
    const targetFolder = DriveApp.getFolderById(folderId);
    file.moveTo(targetFolder);
    Logger.log(`[MOVED] → ${targetFolder.getName()}`);
    return true;
  } catch (e) {
    Logger.log(`[WARN] フォルダ移動失敗 (${folderId}): ${e.message}`);
    return false;
  }
}

/**
 * 実行ログを保存（UserPropertiesに永続化）
 */
function logExecution_(entry) {
  const props = PropertiesService.getUserProperties();
  let logs = [];

  try {
    const raw = props.getProperty('logs');
    if (raw) logs = JSON.parse(raw);
  } catch (e) { /* ignore */ }

  logs.unshift({
    time: new Date().toISOString(),
    ...entry,
  });

  // 最大件数を超えたら古いものを削除
  if (logs.length > SYSTEM.maxLogs) {
    logs = logs.slice(0, SYSTEM.maxLogs);
  }

  props.setProperty('logs', JSON.stringify(logs));
}

/**
 * 最近のログを取得
 */
function getRecentLogs_() {
  const props = PropertiesService.getUserProperties();
  try {
    const raw = props.getProperty('logs');
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return [];
}
