// HP（walker-s.co.jp）問い合わせフォーム受信の取得・パース・返信検知。
//
// 受信経路: フォーム送信 → 差出人 support@walker-s.co.jp、件名「【WalkersHP】お問い合わせが
// 届きました」で社内5名に一斉送信。件名・参加者が固定のため Gmail がスレッド集約する。
// 本文（スニペット）は定型: 「お名前 X 貴社名 Y メールアドレス Z 電話番号 W お問い合わせ内容 …」。
//
// 返信運用: 返信は同スレッドに乗らず、担当が問い合わせ者へ個別メールする。よって未返信判定は
// 問い合わせ者アドレスに対する to: 検索（自社からの送信形跡）で行う。
//
// 例外は投げない。失敗時は空配列 / replied:false を返す（呼び出し側を壊さない）。

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const OUR_DOMAIN = (process.env.GMAIL_OWN_DOMAIN ?? "walker-s.co.jp").toLowerCase();

/** HP 問い合わせフォーム通知メールの検索クエリ。 */
const HP_QUERY = "from:support@walker-s.co.jp subject:お問い合わせが届きました";

/** パース済みの HP 問い合わせ 1 件（分類・返信検知前）。 */
export interface HpInquiryRaw {
  /** Gmail メッセージ ID。 */
  id: string;
  /** 受信日時 (ISO8601)。 */
  date: string;
  name: string;
  company: string;
  email: string;
  /** お問い合わせ内容の抜粋（最大 240 字）。 */
  summary: string;
  /** メール本文の全文（プレーンテキスト化・最大 8000 字）。クリック展開で表示。 */
  body: string;
  /** staging / 自社ドメイン宛のテスト送信か（チェック対象外）。 */
  isInternalTest: boolean;
  /** 受信経路: "form"=HP問い合わせフォーム通知 / "direct"=support@宛の直メール。 */
  source: "form" | "direct";
}

interface GHeader {
  name?: string;
  value?: string;
}
interface GPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GPart[];
}
interface GMsg {
  id?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GPart & { headers?: GHeader[] };
}

/** base64url 文字列を UTF-8 文字列にデコードする（失敗時は空）。 */
function b64urlDecode(data: string): string {
  try {
    return Buffer.from(data, "base64url").toString("utf-8");
  } catch {
    return "";
  }
}

/** HTML を最小限テキスト化する（改行・タグ除去）。 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n");
}

/** payload を再帰的に辿り、指定 MIME タイプの最初の body.data を返す。 */
function findPartData(part: GPart, mime: string): string | null {
  if (part.mimeType === mime && part.body?.data) return part.body.data;
  for (const p of part.parts ?? []) {
    const r = findPartData(p, mime);
    if (r) return r;
  }
  return null;
}

/**
 * メール payload から本文全文（プレーンテキスト）を抽出する。
 * text/plain を優先し、無ければ text/html をテキスト化。最大 8000 字。
 */
function extractBody(payload?: GPart): string {
  if (!payload) return "";
  const plain = findPartData(payload, "text/plain");
  const raw = plain
    ? b64urlDecode(plain)
    : (() => {
        const html = findPartData(payload, "text/html");
        return html ? stripHtml(b64urlDecode(html)) : "";
      })();
  return unescapeHtml(raw)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/株式会社Walkers\s*から送信\s*$/u, "")
    .trim()
    .slice(0, 8000);
}

function header(msg: GMsg, name: string): string {
  return (
    msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

/** スニペット中の HTML エンティティを最小限デコードする。 */
function unescapeHtml(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function field(text: string, re: RegExp): string {
  const m = text.match(re);
  return m ? unescapeHtml(m[1]).trim() : "";
}

/** 定型スニペットから問い合わせ者情報を抽出する。 */
function parseHpSnippet(snippet: string): {
  name: string;
  company: string;
  email: string;
  summary: string;
} {
  const text = unescapeHtml(snippet);
  const name = field(text, /お名前\s+([\s\S]+?)\s+貴社名/);
  const company = field(text, /貴社名\s+([\s\S]+?)\s+メールアドレス/);
  const emailRaw = field(text, /メールアドレス\s+([^\s]+@[^\s]+)/);
  const email = emailRaw.replace(/[、。.,;:]+$/u, "").toLowerCase();
  let summary = field(text, /お問い合わせ内容\s+([\s\S]+)$/);
  summary = summary.replace(/株式会社Walkers\s*から送信\s*$/u, "").trim().slice(0, 240);
  return { name, company, email, summary };
}

async function gget(url: string, token: string): Promise<Response> {
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
}

/**
 * 直近 windowDays 日の HP 問い合わせを取得してパースする。
 * messages.list で ID を取り、各メッセージは format=metadata（スニペット＋件名）で軽量取得する。
 * 失敗時は空配列。
 */
export async function fetchRecentHpInquiries(
  token: string,
  windowDays: number
): Promise<HpInquiryRaw[]> {
  try {
    const q = `${HP_QUERY} newer_than:${windowDays}d`;
    const listRes = await gget(
      `${GMAIL_API}/messages?q=${encodeURIComponent(q)}&maxResults=50`,
      token
    );
    if (!listRes.ok) return [];
    const list = (await listRes.json()) as { messages?: { id: string }[] };
    const ids = (list.messages ?? []).map((m) => m.id);

    const out: HpInquiryRaw[] = [];
    for (const id of ids) {
      try {
        const res = await gget(
          `${GMAIL_API}/messages/${id}?format=full`,
          token
        );
        if (!res.ok) continue;
        const msg = (await res.json()) as GMsg;
        const subject = header(msg, "Subject");
        const { name, company, email, summary } = parseHpSnippet(msg.snippet ?? "");
        const isInternalTest =
          /staging/i.test(subject) || email.endsWith("@" + OUR_DOMAIN);
        out.push({
          id,
          date: new Date(Number(msg.internalDate ?? 0)).toISOString(),
          name,
          company,
          email,
          summary,
          body: extractBody(msg.payload),
          isInternalTest,
          source: "form",
        });
      } catch {
        // 1 件の失敗はスキップ。
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** From ヘッダから 表示名 と 素のメールアドレス(小文字) を取り出す。 */
function parseFrom(fromHeader: string): { name: string; email: string } {
  const m = fromHeader.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: fromHeader.trim().toLowerCase() };
}

/** 自動通知・no-reply 等（人手の返信が不要なメール）か。直メール用の簡易判定。 */
function isAutomatedSender(fromHeader: string): boolean {
  const f = fromHeader.toLowerCase();
  return (
    f.includes("noreply") ||
    f.includes("no-reply") ||
    f.includes("mailer-daemon") ||
    f.includes("postmaster") ||
    f.includes("notification") ||
    f.includes("notify@") ||
    f.includes("@notifications.") ||
    f.includes("bounce") ||
    f.includes("donotreply")
  );
}

/**
 * support@walker-s.co.jp 宛に直接届いた外部メール（フォーム以外）を取得する。
 * フォーム通知や自社ドメイン送信（WordPress通知・グループ管理メール等）はクエリ段階で除外し、
 * no-reply 等の自動通知も弾く。同一送信者は最新 1 件に集約する。
 * 失敗時は空配列。
 */
export async function fetchRecentSupportInquiries(
  token: string,
  windowDays: number
): Promise<HpInquiryRaw[]> {
  try {
    // to:support@ かつ 自社ドメイン送信を除外（WordPress通知・グループ管理メール等を排除）。
    const q = `to:support@walker-s.co.jp -from:${OUR_DOMAIN} newer_than:${windowDays}d`;
    const listRes = await gget(
      `${GMAIL_API}/messages?q=${encodeURIComponent(q)}&maxResults=40`,
      token
    );
    if (!listRes.ok) return [];
    const list = (await listRes.json()) as { messages?: { id: string }[] };
    const ids = (list.messages ?? []).map((m) => m.id);

    const out: HpInquiryRaw[] = [];
    const seenEmail = new Set<string>();
    for (const id of ids) {
      try {
        const res = await gget(
          `${GMAIL_API}/messages/${id}?format=full`,
          token
        );
        if (!res.ok) continue;
        const msg = (await res.json()) as GMsg;
        const fromH = header(msg, "From");
        if (isAutomatedSender(fromH)) continue;
        const { name, email } = parseFrom(fromH);
        if (!email || !email.includes("@")) continue;
        if (seenEmail.has(email)) continue; // 同一送信者は最新1件のみ
        seenEmail.add(email);
        const subject = header(msg, "Subject");
        const snippet = unescapeHtml(msg.snippet ?? "");
        const summary = `【件名】${subject} ${snippet}`.trim().slice(0, 240);
        const fullBody = extractBody(msg.payload);
        out.push({
          id,
          date: new Date(Number(msg.internalDate ?? 0)).toISOString(),
          name,
          company: name || email.split("@")[1] || "",
          email,
          summary,
          body: `【件名】${subject}\n\n${fullBody}`.trim().slice(0, 8000),
          isInternalTest: email.endsWith("@" + OUR_DOMAIN),
          source: "direct",
        });
      } catch {
        // 1 件の失敗はスキップ。
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 問い合わせ者アドレス宛に自社から送信した形跡があるか（＝返信済み）を調べる。
 * support@ の通知メール自体は問い合わせ者宛ではないため除外する。
 * 失敗時は replied:false。
 */
export async function hpReplyCheck(
  token: string,
  email: string,
  opts?: { allowSupportSender?: boolean }
): Promise<{ replied: boolean; date: string | null }> {
  try {
    if (!email) return { replied: false, date: null };
    // フォーム経由は support@ 発を除外（フォーム通知の取り違え防止）。
    // 直メールは support@ から返信することもあるため除外しない（誤検知=未返信 を防ぐ）。
    const q = opts?.allowSupportSender
      ? `to:${email}`
      : `to:${email} -from:support@walker-s.co.jp`;
    const res = await gget(
      `${GMAIL_API}/messages?q=${encodeURIComponent(q)}&maxResults=1`,
      token
    );
    if (!res.ok) return { replied: false, date: null };
    const data = (await res.json()) as { messages?: { id: string }[] };
    return { replied: (data.messages?.length ?? 0) > 0, date: null };
  } catch {
    return { replied: false, date: null };
  }
}
