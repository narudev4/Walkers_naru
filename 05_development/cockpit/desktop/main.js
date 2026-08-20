// Cockpit — 案件セッション司令塔のデスクトップ殻
//
// サーバー(server.js)はこのアプリの中では動かさない。launchd 常駐のまま外に置く。
//   - アプリを閉じても案件セッションが死なない
//   - node-pty を Electron の ABI 向けに再ビルドせずに済む
// このプロセスがやるのは「窓・Dock バッジ・通知・サーバーの死活監視」だけ。
//
// 発火条件: naru が案件を並列で回すとき
// 廃止条件: 同等の機能が Claude Code 本体か MulmoTerminal に入ったら不要

const { app, BrowserWindow, Menu, Notification, shell, globalShortcut, dialog } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const URL_BASE = "http://127.0.0.1:34568";
const LAUNCHD_LABEL = "com.walkers.cockpit";
const STATUS_DIR = path.join(os.homedir(), ".claude", "session-status");
// このファイルが新しければ hook 側(session-status.py)は通知を出さない。
// アプリが起動している間は通知役をこちらが引き取り、二重に鳴らさないため。
const ALIVE_FLAG = path.join(STATUS_DIR, ".app-alive");
const MUTE_FLAG = path.join(STATUS_DIR, ".notify-off");
const BOUNDS_FILE = path.join(app.getPath("userData"), "window-bounds.json");

const NEEDS = new Set(["要入力", "許可待ち"]);
const POLL_MS = 4000;
const LOG_FILE = path.join(os.homedir(), "Library", "Logs", "cockpit-app.log");

// 通知が「出なかった」のか「出したが macOS に握り潰された」のかを後から切り分けるための記録。
// 画面を見ずに原因を追えるようにしておく。
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

let win = null;
let quitting = false;
let prevState = new Map();   // key -> state。状態が「変わった瞬間」だけ通知する
let firstPoll = true;
let lastBadge = -1;

// ---------------------------------------------------------------- サーバー
function kickServer() {
  return new Promise((resolve) => {
    execFile("/bin/launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${LAUNCHD_LABEL}`],
      () => resolve());
  });
}

async function ping(timeoutMs = 1500) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    const r = await fetch(`${URL_BASE}/api/notify`, { signal: ac.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

// 起動時と、落ちたときの復帰。launchd の KeepAlive が拾うまでの穴を埋める
async function ensureServer(maxWaitMs = 15000) {
  if (await ping()) return true;
  await kickServer();
  const until = Date.now() + maxWaitMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 600));
    if (await ping()) return true;
  }
  return false;
}

// ---------------------------------------------------------------- ウィンドウ
function loadBounds() {
  try { return JSON.parse(fs.readFileSync(BOUNDS_FILE, "utf8")); } catch { return null; }
}
function saveBounds() {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  try { fs.writeFileSync(BOUNDS_FILE, JSON.stringify(win.getBounds())); } catch {}
}

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    width: b?.width ?? 1500, height: b?.height ?? 950,
    x: b?.x, y: b?.y,
    minWidth: 900, minHeight: 560,
    title: "Cockpit",
    backgroundColor: "#141414",
    titleBarStyle: "hiddenInset",   // 信号機だけ残してタイトルバーを詰める
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.loadURL(URL_BASE);

  // 読み込み失敗＝サーバーが落ちている。復帰させてから読み直す
  win.webContents.on("did-fail-load", async (_e, code) => {
    if (code === -3) return;   // ABORTED(遷移キャンセル)は無視
    const ok = await ensureServer();
    if (ok && win && !win.isDestroyed()) win.loadURL(URL_BASE);
  });

  // 外部リンクは既定ブラウザへ。アプリ内で別ページに飛ばさない
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(URL_BASE)) { e.preventDefault(); shell.openExternal(url); }
  });

  for (const ev of ["resize", "move"]) win.on(ev, saveBounds);

  // 閉じる = 隠す。⌘Q(quitting)のときだけ本当に閉じる。
  // セッションはサーバー側で生きているので、閉じても失われないが、
  // 誤って閉じたときに開き直す手間を省く。
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    saveBounds();
    win.hide();
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------------------------------------------------------- 通知とバッジ
function heartbeat() {
  try {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
    fs.writeFileSync(ALIVE_FLAG, String(Date.now()));
  } catch {}
}

function notify(title, body, targetId) {
  if (fs.existsSync(MUTE_FLAG)) { log(`notify skipped (muted): ${title}`); return; }
  if (!Notification.isSupported()) { log(`notify unsupported: ${title}`); return; }
  const n = new Notification({ title, body, silent: false });
  n.on("show", () => log(`notify shown: ${title} / ${body}`));
  n.on("failed", (_e, err) => log(`notify FAILED: ${title} — ${err}`));
  n.on("click", () => {
    showWindow();
    if (targetId && win && !win.isDestroyed()) {
      // 左ペインの select() を直接叩いて、そのセッションを開く
      win.webContents.executeJavaScript(
        `typeof select==="function" && select(${JSON.stringify(targetId)})`
      ).catch(() => {});
    }
  });
  n.show();
}

async function poll() {
  heartbeat();
  let state;
  try {
    const r = await fetch(`${URL_BASE}/api/state`);
    if (!r.ok) return;
    state = await r.json();
  } catch { return; }

  // tmux 上のものと、tmux に乗っていないもの(外部端末)の両方を見る
  const rows = [
    ...(state.windows || []).map((w) => ({ key: w.id, id: w.id, label: w.label, state: w.state,
                                           at: w.updatedAt, body: w.title || w.summary || "" })),
    ...(state.external || []).map((s) => ({ key: `ext:${s.sessionId}`, id: null, label: s.label, state: s.state,
                                           at: s.updatedAt, body: s.summary || "" })),
  ];

  const need = rows.filter((r) => NEEDS.has(r.state));
  if (need.length !== lastBadge) {
    app.setBadgeCount(need.length);
    log(`badge ${lastBadge} → ${need.length} (${need.map((r) => r.label).join(", ") || "なし"})`);
    lastBadge = need.length;
  }

  // 初回は「今の状態」を覚えるだけ。起動直後に溜まっている分で一斉に鳴らさない
  if (!firstPoll) {
    for (const r of rows) {
      if (!NEEDS.has(r.state)) continue;
      const before = prevState.get(r.key);
      // 状態が変わった時に加えて、同じ待機状態のまま新しい要求が来た時も鳴らす。
      // 1ターン中に許可を何度も求められると updatedAt だけが進むので、
      // 状態の変化だけを見ていると2回目以降を取りこぼす。
      const isNew = !NEEDS.has(before?.state || "") || r.at > (before?.at || 0);
      if (isNew) notify(`${r.state} — ${r.label}`, r.body || "Claude が入力を待っています", r.id);
    }
  }
  firstPoll = false;
  prevState = new Map(rows.map((r) => [r.key, { state: r.state, at: r.at }]));
}

// ---------------------------------------------------------------- メニュー
function buildMenu() {
  const template = [
    {
      label: "Cockpit",
      submenu: [
        { label: "Cockpit について", role: "about" },
        { type: "separator" },
        {
          label: "サーバーを再起動",
          click: async () => {
            await kickServer();
            const ok = await ensureServer();
            if (ok) win?.reload();
            else dialog.showErrorBox("Cockpit", "サーバーを起動できませんでした。\n~/Library/Logs/cockpit.log を確認してください。");
          },
        },
        {
          label: "ログイン時に起動",
          type: "checkbox",
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
        },
        { type: "separator" },
        { label: "隠す", role: "hide" },
        { label: "終了", role: "quit" },
      ],
    },
    {
      label: "編集",
      submenu: [
        { label: "元に戻す", role: "undo" }, { label: "やり直す", role: "redo" },
        { type: "separator" },
        { label: "カット", role: "cut" }, { label: "コピー", role: "copy" },
        { label: "ペースト", role: "paste" }, { label: "すべて選択", role: "selectAll" },
      ],
    },
    {
      label: "表示",
      submenu: [
        { label: "再読み込み", role: "reload" },
        { label: "開発者ツール", role: "toggleDevTools" },
        { type: "separator" },
        { label: "実際のサイズ", role: "resetZoom" },
        { label: "拡大", role: "zoomIn" }, { label: "縮小", role: "zoomOut" },
        { type: "separator" },
        { label: "フルスクリーン", role: "togglefullscreen" },
      ],
    },
    { label: "ウインドウ", submenu: [{ label: "しまう", role: "minimize" }, { label: "閉じる", role: "close" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- 起動
const single = app.requestSingleInstanceLock();
if (!single) app.quit();

app.on("second-instance", showWindow);
app.on("activate", showWindow);          // Dock アイコンクリック
app.on("window-all-closed", () => {});   // ⌘W で終了させない

app.whenReady().then(async () => {
  buildMenu();
  heartbeat();

  const ok = await ensureServer();
  log(`起動: server=${ok ? "ok" : "NG"} notification=${Notification.isSupported()}`);
  createWindow();
  if (!ok) {
    dialog.showErrorBox("Cockpit",
      "サーバー(localhost:34568)に接続できません。\n" +
      "launchctl kickstart -k gui/$(id -u)/com.walkers.cockpit を試すか、\n" +
      "~/Library/Logs/cockpit.log を確認してください。");
  }

  setInterval(poll, POLL_MS);
  poll();

  // ⌃⌘C でどこからでも前面へ。よく使う組み合わせは避けている
  globalShortcut.register("Control+Command+C", showWindow);
});

app.on("before-quit", () => {
  quitting = true;
  saveBounds();
  try { fs.rmSync(ALIVE_FLAG, { force: true }); } catch {}   // hook 側の通知を復活させる
});

app.on("will-quit", () => globalShortcut.unregisterAll());
