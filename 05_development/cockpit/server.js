// walkers-cockpit — 案件セッションの司令塔
//
// 左に全セッションの状態とサマリー、中央にターミナル、下から宛先を選んで指示を投げる。
// セッション実体は tmux(-L cockpit)。サーバーが落ちてもセッションは生き残る。
// 状態とサマリーは ~/.claude/session-status/(session-status.py が書く) から読む。
//
// 起動: node server.js   → http://localhost:34568
//
// 発火条件: naru が案件を並列で回すとき
// 廃止条件: 同等の機能が Claude Code 本体か MulmoTerminal に入ったら不要

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import pty from "node-pty";
import { WebSocketServer } from "ws";

// nohup/launchd 起動だと PATH が最小限になり "tmux" を解決できない(posix_spawnp failed)。
// 実在する絶対パスに解決してから使う。
const TMUX_BIN = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"]
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || "tmux";

// launchd は環境をほぼ空で子プロセスを起動する。LANG が無いと tmux は非 UTF-8 とみなし、
// -F の区切りタブや日本語パスを "_" に潰す(実測: "cockpit\t0\t_idle" → "cockpit_0__idle")。
// 一覧のパースが丸ごと壊れるので、無ければここで補う。
if (!process.env.LANG && !process.env.LC_ALL) process.env.LANG = "en_US.UTF-8";

const PORT = 34568;
const SOCKET = "cockpit";                       // tmux -L cockpit（他ツールと干渉しない）
const TMUX_SESSION = "cockpit";
const PROJECTS = "/Users/naru/Walkers_naru/03_projects";
const STATUS_DIR = path.join(os.homedir(), ".claude", "session-status");
// 通知は hook(session-status.py)が直接 macOS に出す。ここはその ON/OFF 用の旗。
const MUTE_FLAG = path.join(STATUS_DIR, ".notify-off");
const NOTIFIER = "/opt/homebrew/bin/terminal-notifier";
const PUBLIC = path.join(import.meta.dirname, "public");

// 一度 cockpit に引き取った外部セッション。二重に引き取らないための記録(プロセス内のみ)
const adopted = new Set();

// cockpit が起動したウィンドウ名 → そのセッションID。
// 起動時に --session-id / --resume で ID を確定させるので、
// 「どのウィンドウがどの会話か」が後から確実に分かる(タイトル表示に使う)。
const windowSession = new Map();

// session-id → タイトル(jsonl の先頭から取る)。ファイル読みが要るのでキャッシュする。
const titleCache = new Map();

// ---------------------------------------------------------------- tmux
// cockpit 自身のソケットだけでなく、MulmoTerminal(-L mulmoterminal)や素の tmux(default)も
// 束ねて扱う。tmux 経由でさえあれば send-keys で指示を送れるので、
// 「別ツールで開いたセッション」もここから操作できる。
function tmuxOn(socket, args) {
  return new Promise((resolve) => {
    execFile(TMUX_BIN, ["-L", socket, ...args], { maxBuffer: 8 << 20 }, (err, stdout) =>
      resolve(err ? null : stdout)
    );
  });
}
const tmux = (args) => tmuxOn(SOCKET, args);

// /private/tmp/tmux-<uid>/ にあるソケットを実在するものだけ拾う
function listSockets() {
  const dir = `/private/tmp/tmux-${process.getuid()}`;
  try { return fs.readdirSync(dir).filter((n) => !n.startsWith(".")); } catch { return [SOCKET]; }
}

// tmux の既定値のままだとブラウザ内ターミナルとして使い物にならない。
// 設定値は MulmoTerminal (MIT, Copyright (c) 2026 Receptron) の server/infra/tmux.ts を参照した。
//   - escape-time 0      : 既定 500ms の Esc 待ちが「操作が重い」の正体
//   - mouse on           : ホイールでスクロールバックを遡れるようにする
//   - destroy-unattached off : ブラウザを閉じてもセッションを消さない
//   - set-clipboard + Ms : 中のプログラムの OSC52 を外側の xterm へ通す
//   - Su(OSC 8)          : ハイパーリンクを外側へ通す
const MS_OVERRIDE = "xterm*:Ms=\\E]52;%p1%s;%p2%s\\007";
const OSC8_OVERRIDE = "xterm*:Su=\\E]8;;%p1%s\\E\\\\";
const TMUX_OPTIONS = [
  ["escape-time", "0"],
  ["status", "off"],
  ["history-limit", "20000"],
  ["window-size", "latest"],
  ["aggressive-resize", "on"],
  ["destroy-unattached", "off"],
  ["mouse", "on"],
  ["set-clipboard", "on"],
];

async function applyTmuxConfig() {
  for (const [k, v] of TMUX_OPTIONS) await tmux(["set-option", "-g", k, v]);
  for (const ov of [MS_OVERRIDE, OSC8_OVERRIDE]) {
    await tmux(["set-option", "-ag", "terminal-overrides", `,${ov}`]);
  }
}

async function ensureSession() {
  const has = await tmux(["has-session", "-t", TMUX_SESSION]);
  if (has === null) {
    // ウィンドウ0 はプレースホルダ。案件ウィンドウはこの後ろに積む
    await tmux(["new-session", "-d", "-s", TMUX_SESSION, "-n", "_idle", "-c", os.homedir()]);
  }
  await applyTmuxConfig();
}

// 全ソケットの全ウィンドウ。id は "socket\tsession:window" で一意にする。
async function listWindows() {
  const out = [];
  for (const socket of listSockets()) {
    const raw = await tmuxOn(socket, [
      "list-windows", "-a",
      "-F", "#{session_name}\t#{window_index}\t#{window_name}\t#{pane_current_path}\t#{window_activity}\t#{pane_current_command}",
    ]);
    if (!raw) continue;
    for (const line of raw.trim().split("\n").filter(Boolean)) {
      const [session, index, name, cwd, activity, cmd] = line.split("\t");
      if (name === "_idle") continue;
      out.push({
        id: `${socket}\t${session}:${index}`,
        socket, session, index: Number(index), name, cwd: nfc(cwd),
        cmd, own: socket === SOCKET,
        activity: Number(activity) * 1000,
      });
    }
  }
  return out;
}

// macOS の tmux は cwd を NFD(濁点が分解された形)で返すことがあり、
// Claude Code が記録する NFC 形と文字列一致しない。比較前に必ず揃える。
const nfc = (s) => (s || "").normalize("NFC");

// id("socket\tsession:window") を分解して tmux コマンドに渡せる形にする
function parseId(id) {
  const [socket, target] = String(id).split("\t");
  if (!socket || !target) return null;
  return { socket, target };
}

// ---------------------------------------------------- session-status (hook)
function readStatuses() {
  let files = [];
  try { files = fs.readdirSync(STATUS_DIR).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(STATUS_DIR, f), "utf8"));
      r.cwd = nfc(r.cwd);
      out.push(r);
    } catch {}
  }
  return out;
}

// tmux ウィンドウに hook 状態を重ねる。
// MulmoTerminal のセッション名は "mt-<session-id>" なので、まず session_id で正確に照合し、
// 当たらなければ同じ cwd の最新セッションで代用する。
function mergeStatus(windows) {
  const statuses = readStatuses();
  const byId = new Map(statuses.map((s) => [s.session_id, s]));
  return windows.map((w) => {
    // ① cockpit が起動したものは記録済みの session-id で確実に引く
    // ② MulmoTerminal はセッション名が "mt-<session-id>"
    // ③ どちらでもなければ同じ cwd の最新セッションで代用する
    const known = w.own ? windowSession.get(w.name) : null;
    const m = /^mt-([0-9a-f-]{16,})$/i.exec(w.session);
    const sid = known || (m ? m[1] : null);
    let s = sid ? byId.get(sid) : null;
    if (!s) {
      s = statuses
        .filter((x) => x.cwd === w.cwd)
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0];
    }
    const sessionId = sid || s?.session_id || null;
    return {
      ...w,
      label: path.basename(w.cwd),
      title: summaryFor(sessionId, w.cwd) || titleForSession(sessionId, w.cwd),
      state: effectiveState(s?.state || "—", sessionId, w.cwd, s?.updated_at),
      summary: s?.summary || "",
      updatedAt: s ? s.updated_at * 1000 : w.activity,
      sessionId,
    };
  });
}

// ------------------------------------------------- resume 候補(過去セッション)
// Claude Code は ~/.claude/projects/<cwdをエンコードした名前>/<session-id>.jsonl に記録する。
// エンコードは「パス中の / _ . を - に置換」。古い版の規則も残っているので両方見る。
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const encodeCwd = (cwd) => [
  cwd.replace(/[/_.]/g, "-"),
  cwd.replace(/\//g, "-"),          // 旧規則(_ をそのまま残す)
];

// naru-memory が量産した記憶抽出セッションは候補から外す(2026-07 時点で全体の64%を占めていた)
const JUNK_TITLE = "記憶すべき情報を抽出してJSON配列";

// セッションのタイトル。「最初に何を頼んだか」ではなく「いま何をやっているか」を出したいので、
// ファイル末尾から遡って直近の naru の発話を拾う。分岐や脱線でタイトルが陳腐化するのを防ぐ。
// tool_result も type:"user" で流れてくるので、テキスト発話だけを対象にする。
function titleOf(file, { latest = true } = {}) {
  let text = "";
  try {
    const size = fs.statSync(file).size;
    const span = Math.min(size, 256 * 1024);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(span);
    // latest=true なら末尾から、false なら先頭から読む
    fs.readSync(fd, buf, 0, span, latest ? size - span : 0);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch { return ""; }

  const lines = text.split("\n").filter((l) => l.trim());
  if (latest) lines.reverse();               // 末尾側から探す
  for (const line of lines) {
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type === "summary" && rec.summary) return String(rec.summary);
    if (rec.type !== "user") continue;
    const c = rec.message?.content;
    if (typeof c === "string" && c.trim()) return c.trim();
    if (Array.isArray(c)) {
      // tool_result や画像を除いた、素のテキストだけ
      const t = c.find((p) => p?.type === "text" && p.text?.trim());
      if (t) return t.text.trim();
    }
  }
  return "";
}

// session-id からタイトルを引く。会話が始まるまでは空なので、都度キャッシュを更新する。
function findTranscript(sessionId, cwd) {
  // cwd のエンコード規則は Claude Code の版によって3通り(/ のみ・_ も・非ASCIIも)あるので、
  // まず素直に試し、見つからなければ全プロジェクトディレクトリを走査する。
  for (const dir of new Set([...encodeCwd(cwd), ...encodeCwd(cwd).map((d) => d.replace(/[^\x20-\x7e]/g, "-"))])) {
    const f = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  let dirs = []; try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// 「要入力」「許可待ち」は、naru が答えても状態が戻らない。
// 許可を出した／答えた、という hook イベントが存在しないため、Stop が来るまで貼りついたままになる。
// その結果、次に許可を求められても「変化なし」と見なされて通知が出ない。
//
// 会話ログ(transcript)の更新時刻で解決する。待機中は誰も書き込まないので、
// 状態を記録した時刻より会話が先に進んでいれば、その待機はもう終わっている。
// 実測: 本当に待機中のものは差が -30〜-63秒、決着済みのものは +1400〜1800秒。
const WAIT_SETTLED_SEC = 5;
const WAITING = new Set(["要入力", "許可待ち"]);

function effectiveState(state, sessionId, cwd, updatedAt) {
  if (!WAITING.has(state) || !sessionId || !updatedAt) return state;
  const f = findTranscript(sessionId, cwd);
  if (!f) return state;
  let mtime; try { mtime = fs.statSync(f).mtimeMs / 1000; } catch { return state; }
  return mtime - updatedAt > WAIT_SETTLED_SEC ? "実行中" : state;
}

function titleForSession(sessionId, cwd) {
  if (!sessionId) return "";
  const hit = titleCache.get(sessionId);
  if (hit && hit.title && Date.now() - hit.at < 30_000) return hit.title;
  const f = findTranscript(sessionId, cwd);
  if (!f) return hit?.title || "";
  const t = titleOf(f, { latest: true }).slice(0, 70);
  titleCache.set(sessionId, { title: t, at: Date.now() });
  return t;
}

function listResumable(cwd, limit = 25) {
  const files = [];
  for (const dir of new Set(encodeCwd(cwd))) {
    const full = path.join(PROJECTS_DIR, dir);
    let names = []; try { names = fs.readdirSync(full); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith(".jsonl")) continue;
      const f = path.join(full, n);
      try { files.push({ id: n.replace(/\.jsonl$/, ""), file: f, mtime: fs.statSync(f).mtimeMs }); } catch {}
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const f of files) {
    if (out.length >= limit) break;
    const title = titleOf(f.file, { latest: false });
    if (title.includes(JUNK_TITLE)) continue;      // 記憶抽出セッションを除外
    out.push({ id: f.id, title: title.slice(0, 90) || "(無題)", mtime: f.mtime });
  }
  return out;
}

// 起動していない案件も含めた候補一覧(最近さわった順)
function listProjects() {
  let names = [];
  try { names = fs.readdirSync(PROJECTS); } catch { return []; }
  return names
    .filter((n) => !n.startsWith(".") && !n.startsWith("_") && n !== "data")
    .map((n) => {
      const p = path.join(PROJECTS, n);
      let mtime = 0;
      try { const st = fs.statSync(p); if (!st.isDirectory()) return null; mtime = st.mtimeMs; } catch { return null; }
      return { name: n.trim(), path: p, mtime };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

// tmux のウィンドウ名は記号を含むと扱いづらいので落とす
const winName = (s) => s.replace(/[\s.:]/g, "").slice(0, 20) || "proj";

// ---------------------------------------------------------------- HTTP
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
               ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

function serveStatic(req, res) {
  const rel = req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

function json(res, obj, code = 200) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function body(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/state") {
    await ensureSession();
    const windows = mergeStatus(await listWindows());
    // tmux にすら乗っていないセッション(Ghostty で直接起動したもの)。
    // hook 経由で状態は見えるが、端末に書き込む手段が無いので指示は送れない。
    const seen = new Set(windows.map((w) => w.sessionId).filter(Boolean));
    const seenCwd = new Set(windows.map((w) => w.cwd));
    const external = readStatuses()
      .filter((s) => s.cwd && !seen.has(s.session_id) && !seenCwd.has(s.cwd)
                  && !adopted.has(s.session_id))
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .map((s) => ({
        sessionId: s.session_id, cwd: s.cwd, label: s.label || path.basename(s.cwd),
        state: effectiveState(s.state || "—", s.session_id, s.cwd, s.updated_at),
        summary: s.summary || "", updatedAt: (s.updated_at || 0) * 1000,
      }));
    return json(res, {
      windows, external,
      projects: listProjects().map(({ name, path }) => ({ name, path })),
    });
  }

  // 通知の ON/OFF。実際に鳴らすのは hook(session-status.py)なので、
  // ここは「ミュートの旗を立てる/降ろす」だけ。サーバーが落ちていても設定は残る。
  if (url.pathname === "/api/notify") {
    if (req.method === "POST") {
      const { on } = await body(req);
      try {
        if (on) fs.rmSync(MUTE_FLAG, { force: true });
        else fs.writeFileSync(MUTE_FLAG, "");
      } catch (e) { return json(res, { error: String(e) }, 500); }
    }
    return json(res, { on: !fs.existsSync(MUTE_FLAG), notifier: fs.existsSync(NOTIFIER) });
  }

  // 通知の動作確認。ボタンから叩いて「実際に通知が出るか」をその場で見る
  if (url.pathname === "/api/notify/test" && req.method === "POST") {
    if (!fs.existsSync(NOTIFIER)) return json(res, { ok: false, error: "terminal-notifier がありません" });
    execFile(NOTIFIER, ["-title", "cockpit — 通知テスト", "-message",
      "これが見えていれば通知は届きます", "-sound", "Ping", "-group", "cockpit-test"]);
    return json(res, { ok: true });
  }

  // 案件ディレクトリの過去セッション(resume 候補)
  if (url.pathname === "/api/resumable") {
    const cwd = url.searchParams.get("cwd");
    if (!cwd) return json(res, { error: "cwd が要ります" }, 400);
    return json(res, { sessions: listResumable(cwd) });
  }

  // 案件を tmux ウィンドウとして起動。
  // resumeId があれば過去セッションを再開し、無ければ新規で立てる。
  // 同じ案件でも呼ぶたびに別ウィンドウを足す(1案件を複数セッションで並列に回せるように)。
  if (url.pathname === "/api/launch" && req.method === "POST") {
    const { path: dir, resumeId } = await body(req);
    if (!dir || !fs.existsSync(dir)) return json(res, { error: "ディレクトリがありません" }, 400);
    await ensureSession();
    const base = winName(path.basename(dir));
    const taken = new Set((await listWindows()).map((w) => w.name));
    let name = base, n = 2;
    while (taken.has(name)) name = `${base}-${n++}`;   // 1LC / 1LC-2 / 1LC-3 …
    await tmux(["new-window", "-t", TMUX_SESSION, "-n", name, "-c", dir]);
    // 新規は session-id を自分で決めて渡す。こうしないと「どのウィンドウがどの会話か」を
    // 後から特定できず、タイトル表示も状態の紐づけもできない。
    // resumeId は英数とハイフンのみ通す(そのままシェルに渡るため)
    const ok = resumeId && /^[A-Za-z0-9-]+$/.test(resumeId);
    const sid = ok ? resumeId : crypto.randomUUID();
    const cmd = ok ? `claude --resume ${sid}` : `claude --session-id ${sid}`;
    await tmux(["send-keys", "-t", `${TMUX_SESSION}:${name}`, cmd, "Enter"]);
    windowSession.set(name, sid);
    // 引き取ったセッションは外部一覧から消す(resume 後は新しい session_id になるため、
    // cwd 一致だけでは同じものを何度も引き取れてしまう)
    if (ok) adopted.add(resumeId);
    // 直後は window_index が未確定なのでウィンドウ名で引ける形の id を返す
    return json(res, { ok: true, id: `${SOCKET}\t${TMUX_SESSION}:${name}`, resumed: !!resumeId });
  }

  // 宛先セッションへ指示を送る(これが MulmoTerminal に無い部分)。
  // id が指すソケットへ送るので、MulmoTerminal や素の tmux のセッションにも届く。
  if (url.pathname === "/api/send" && req.method === "POST") {
    const { target, text } = await body(req);
    const t = parseId(target);
    if (!t || !text) return json(res, { error: "target と text が要ります" }, 400);
    // 文字列と Enter を分けて送る(改行を含む指示でも1回の送信で確定させる)
    await tmuxOn(t.socket, ["send-keys", "-t", t.target, "-l", text]);
    await tmuxOn(t.socket, ["send-keys", "-t", t.target, "Enter"]);
    return json(res, { ok: true });
  }

  if (url.pathname === "/api/close" && req.method === "POST") {
    const { target } = await body(req);
    const t = parseId(target);
    // 他ツールが管理しているセッションは閉じない(cockpit が作ったものだけ)
    if (t && t.socket === SOCKET) {
      const w = (await listWindows()).find((x) => x.id === target);
      if (w) windowSession.delete(w.name);
      await tmuxOn(t.socket, ["kill-window", "-t", t.target]);
    }
    return json(res, { ok: true });
  }

  return serveStatic(req, res);
});

// アプリが端末に投げる「問い合わせ」制御シーケンス(Device Attributes / DSR / kitty flags /
// XTVERSION / OSC 色問い合わせ)。ライブでは xterm が自動応答してよいが、再接続時に
// バッファを replay すると xterm が「もう一度」応答し、その返事が入力として送られて
// プロンプトに "0;276;0c" のようなゴミが出る。replay からだけ取り除く。
// 出典: MulmoTerminal (MIT, Copyright (c) 2026 Receptron) server/session/terminal-replay.ts
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const QUERY_PATTERNS = [
  new RegExp(ESC + "\\[[>=]?\\d*c", "g"),                                  // DA1/DA2/DA3
  new RegExp(ESC + "\\[\\??\\d*n", "g"),                                    // DSR / CPR
  new RegExp(ESC + "\\[\\?u", "g"),                                         // kitty keyboard flags
  new RegExp(ESC + "\\[>\\d*q", "g"),                                       // XTVERSION
  new RegExp(ESC + "\\]1[012];\\?(?:" + BEL + "|" + ESC + "\\\\)", "g"),      // OSC 10/11/12
];
const stripTerminalQueries = (data) =>
  QUERY_PATTERNS.reduce((out, re) => out.replace(re, ""), data);


// ---------------------------------------------------------- セッション要約
// 生の発話をそのまま出すと「1.お願いします。2.本当にNeonでいいの？…」のようになり読めない。
// claude -p に1行へ畳ませる。ただし naru-memory が claude -p を5分ごとに回して
// 1,290本の使い捨てセッションを溜めた前例があるので、暴走しない作りにする:
//   ・会話が進んだとき(mtime が変わったとき)だけ走らせる
//   ・同時実行は2本まで、1セッションにつき1本
//   ・cwd を案件の外(/tmp)にして、生成される jsonl が案件の resume 候補を汚さないようにする
//   ・生成中は前回の要約を返し、UI を待たせない
const CLAUDE_BIN = ["/Users/naru/.nvm/versions/node/v22.19.0/bin/claude",
                    "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]
  .find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || "claude";
const SUM_CWD = "/tmp/cockpit-sum";
const summaryCache = new Map();   // sessionId -> { title, mtime }
const summarizing = new Set();
const MAX_PARALLEL_SUMMARY = 2;

const SUM_PROMPT = `次の会話の断片から、今やっている作業を全角15字以内で1行にして。
形式は「絵文字 作業内容」。絵文字は 🔄=進行中 ⏸=判断待ち ✅=完了 ⚠=停滞 から選ぶ。
顧客名・個人名・URLは入れない。説明や前置きは書かない。1行だけ返す。

--- 会話 ---
`;

// 末尾から数往復ぶんの発話を取り出す(要約に投げる材料)
function tailConversation(file, maxChars = 4000) {
  let text = "";
  try {
    const size = fs.statSync(file).size;
    const span = Math.min(size, 256 * 1024);
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(span);
    fs.readSync(fd, buf, 0, span, size - span);
    fs.closeSync(fd);
    text = buf.toString("utf8");
  } catch { return ""; }

  const turns = [];
  for (const line of text.split("\n").reverse()) {
    if (!line.trim()) continue;
    let rec; try { rec = JSON.parse(line); } catch { continue; }
    if (rec.type !== "user" && rec.type !== "assistant") continue;
    const c = rec.message?.content;
    let t = "";
    if (typeof c === "string") t = c;
    else if (Array.isArray(c)) t = (c.find((p) => p?.type === "text")?.text) || "";
    t = t.trim();
    if (!t) continue;
    turns.push(`${rec.type === "user" ? "naru" : "AI"}: ${t.slice(0, 500)}`);
    if (turns.join("\n").length > maxChars) break;
  }
  return turns.reverse().join("\n");
}

function runSummary(convo) {
  return new Promise((resolve) => {
    try { fs.mkdirSync(SUM_CWD, { recursive: true }); } catch {}
    const child = execFile(CLAUDE_BIN, ["-p", "--output-format", "json"],
      { cwd: SUM_CWD, timeout: 60_000, maxBuffer: 4 << 20 },
      (err, stdout) => {
        if (err) return resolve("");
        try {
          const out = JSON.parse(stdout);
          const line = String(out.result || "").trim().split("\n")[0].slice(0, 40);
          resolve(line);
        } catch { resolve(""); }
      });
    try { child.stdin.end(SUM_PROMPT + convo); } catch { resolve(""); }
  });
}

// 要約を返す。無ければバックグラウンドで作り始め、今は空(または前回値)を返す。
function summaryFor(sessionId, cwd) {
  if (!sessionId) return "";
  const file = findTranscript(sessionId, cwd);
  if (!file) return "";
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return ""; }

  const hit = summaryCache.get(sessionId);
  if (hit && hit.mtime === mtime) return hit.title;
  if (summarizing.has(sessionId) || summarizing.size >= MAX_PARALLEL_SUMMARY) return hit?.title || "";

  summarizing.add(sessionId);
  (async () => {
    try {
      const convo = tailConversation(file);
      if (convo) {
        const title = await runSummary(convo);
        if (title) summaryCache.set(sessionId, { title, mtime });
      }
    } finally { summarizing.delete(sessionId); }
  })();
  return hit?.title || "";
}

// ------------------------------------------------------------- WebSocket
// tmux に PTY で attach して入出力をそのまま中継する。
//
// 当初は capture-pane を 400ms ごとに取って画面全体を送り直していたが、これは破綻した:
// xterm の画面クリアは表示領域しか消さず消えた行はスクロールバックに積まれるため、
// 同じ画面が何十回も積み上がって遡れなくなり、全画面再描画のぶん操作も遅れた。
// attach なら tmux が差分だけを吐くので、スクロールバックも履歴検索もそのまま効く。
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const q = new URL(req.url, "http://x").searchParams;
  const t = parseId(q.get("target"));
  if (!t) { ws.close(); return; }
  const cols = Math.max(20, Math.min(500, Number(q.get("cols")) || 120));
  const rows = Math.max(5, Math.min(200, Number(q.get("rows")) || 30));

  let term;
  try {
    // -d は付けない: 同じセッションを他ツールで開いたままにできるようにする
    term = pty.spawn(TMUX_BIN, ["-L", t.socket, "attach-session", "-t", t.target], {
      name: "xterm-256color",
      cols, rows,
      cwd: os.homedir(),
      env: { ...process.env, TERM: "xterm-256color" },
    });
  } catch (e) {
    try { ws.send(JSON.stringify({ type: "error", data: String(e) })); } catch {}
    ws.close();
    return;
  }

  // attach 直後に tmux が画面を丸ごと送り直す。ここには端末への問い合わせが混ざっており、
  // そのまま xterm に流すと再応答が入力として返ってプロンプトにゴミが出る(MulmoTerminal と同じ対策)。
  // 落ち着いた後のライブ出力には手を触れない(アプリが本当に問い合わせている場合は答えるべきなので)。
  const attachedAt = Date.now();
  term.onData((d) => {
    if (ws.readyState !== 1) return;
    const data = Date.now() - attachedAt < 800 ? stripTerminalQueries(d) : d;
    ws.send(JSON.stringify({ type: "out", data }));
  });
  term.onExit(() => { if (ws.readyState === 1) ws.close(); });

  ws.on("message", (raw) => {
    let msg = {};
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "in" && typeof msg.data === "string") {
      term.write(msg.data);
    } else if (msg.type === "resize" && msg.cols && msg.rows) {
      try { term.resize(Math.max(20, msg.cols | 0), Math.max(5, msg.rows | 0)); } catch {}
    }
  });

  ws.on("close", () => { try { term.kill(); } catch {} });
});

await ensureSession();
server.listen(PORT, () => {
  console.log(`walkers-cockpit → http://localhost:${PORT}`);
  console.log(`tmux socket: -L ${SOCKET} / session: ${TMUX_SESSION}`);
});
