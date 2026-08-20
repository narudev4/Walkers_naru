// Gmail 共通ライブラリ。
// last-contact/route.ts から移設した getGmailAccessToken / fetchLastContact を公開する。
// 呼び出し元は例外を catch する必要はない（失敗時は connected:false を返す）。
//
// 認証: Google OAuth リフレッシュトークン（gmail.readonly スコープ）。
//   GSHEETS_CLIENT_ID / GSHEETS_CLIENT_SECRET（事業計画と同じ OAuth クライアント）
//   GMAIL_REFRESH_TOKEN（Gmail スコープで発行した別トークン）

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// ----------------------------------------------------------------
// 公開型定義
// ----------------------------------------------------------------

export interface LastContact {
  connected: boolean;
  found: boolean;
  /** ISO8601。最後のメッセージの日時。 */
  date?: string;
  subject?: string;
  from?: string;
  /** 本文（プレーンテキスト）抜粋。 */
  excerpt?: string;
  /** スレッド内のメッセージ数（「最後まで確認した」ことの提示用）。 */
  threadLength?: number;
  /** 検索に使ったクエリ。 */
  query?: string;
  /** 実質の最終メッセージが先方発（＝こちら未返信）か。自社ドメイン送信/SENTラベル/自動メール除外で判定。 */
  inbound?: boolean;
}

export interface LastContactInput {
  email?: string | null;
  name?: string | null;
  company: string;
}

// ----------------------------------------------------------------
// 内部型定義
// ----------------------------------------------------------------

interface GmailHeader {
  name?: string;
  value?: string;
}
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id?: string;
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart & { headers?: GmailHeader[] };
}

// ----------------------------------------------------------------
// 内部ユーティリティ
// ----------------------------------------------------------------

/** base64url → UTF-8 文字列。 */
function decodeBody(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf-8"
  );
}

/** MIME ツリーから text/plain（無ければ text/html のタグ除去）本文を取り出す。 */
function extractText(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBody(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const text = extractText(child);
    if (text) return text;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return decodeBody(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
  }
  return "";
}

function header(msg: GmailMessage, name: string): string {
  return (
    msg.payload?.headers?.find(
      (h) => h.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? ""
  );
}

/** 「様」「さん」等の敬称を除いた検索用の名前を返す。 */
function cleanName(name: string): string {
  return name.replace(/(様|さん|氏|君|ちゃん)\s*$/u, "").trim();
}

/**
 * 連絡先の Gmail 検索クエリを構築する。
 *   1) email があれば from/to アドレス検索（最精度）。
 *   2) 無ければ会社名（＋担当者名があれば OR 補助）で検索（自動通知系を除外）。
 * email 未登録の案件では、会社名が本文に出ないカジュアルなメール（例: 担当者個人の
 * iCloud から「松村です」）を拾うために担当者名 OR が必要。ただし「伊藤」等のありふれた
 * 姓は無関係な同姓スレッドに誤マッチしうる——その曖昧さは runGmailCheck 側の
 * 「同一スレッドに複数案件がマッチしたら両方除外」で取り除く。該当無しは空文字。
 */
function buildContactQuery(
  email?: string | null,
  company?: string | null,
  name?: string | null
): string {
  if (email) return `(from:${email} OR to:${email})`;
  if (company) {
    const person = cleanName(name ?? "");
    const terms = person ? `("${company}" OR "${person}")` : `"${company}"`;
    // HP問い合わせ通知の大スレッド（件名固定・本文に社名を含む・毎日新着）が
    // 検索候補を占有して実会話スレッドを押し出すため、件名で除外する。
    return `${terms} -from:noreply -from:no-reply -from:notification -subject:"お問い合わせが届きました"`;
  }
  return "";
}

/**
 * 自社ドメイン。ここから送られたメールは「自社が送った（＝返信済み）」とみなす。
 * 認証アカウント(atsushi)の SENT ラベルだけでは、他メンバー(永井・古谷等)の返信を
 * 拾えず誤って未返信判定になるため、ドメインで自社発を判定する。
 */
const OUR_DOMAIN = (process.env.GMAIL_OWN_DOMAIN ?? "walker-s.co.jp").toLowerCase();

/** From ヘッダから素のメールアドレス(小文字)を取り出す。 */
function extractEmail(fromHeader: string): string {
  const m = fromHeader.match(/<([^>]+)>/);
  return (m ? m[1] : fromHeader).trim().toLowerCase();
}

/**
 * カレンダー招待・会議メモ等の「自動メール」か。
 * これらはスレッド末尾に入り込むため、会話の最終メッセージ判定から除外する。
 */
function isAutomatedMessage(msg: GmailMessage): boolean {
  // List-Unsubscribe ヘッダーは配信メール（メルマガ・通知）共通の目印。
  // 送信元の個別リスト方式（下記）はいたちごっこになるため、これを第一判定にする
  // （TSS News=startup-station.jp のメルマガを会話と誤認した実例への構造対策）。
  if (header(msg, "List-Unsubscribe")) return true;
  const from = extractEmail(header(msg, "From"));
  if (
    from.includes("gemini-notes@google.com") ||
    from.includes("calendar-notification@google.com") ||
    from.includes("noreply") ||
    from.includes("no-reply") ||
    from.includes("notification") ||
    from.endsWith("@resource.calendar.google.com") ||
    // SNS・各種通知メール（会話ではない）
    from.includes("facebookmail.com") ||
    from.includes("facebook.com") ||
    from.includes("linkedin.com") ||
    from.includes("@mail.instagram.com") ||
    from.includes("notify@") ||
    from.includes("@notifications.") ||
    // ニュースレター・配信系（会話ではない。旧い未返信の誤検出源）
    from.includes("prtimes.jp") ||
    from.includes("newspicks.com") ||
    from.includes("@imitsu.jp") ||
    from.includes("newsletter") ||
    from.includes("mailmag") ||
    from.includes("sys_admin") ||
    // 電子契約の締結完了通知（会話ではない。2026-07-14 サンプル食品で会話と誤認した実例）
    from.endsWith("@cloudsign.jp") ||
    // 会議ノート通知（no-reply@なので現状も引っかかるが、ドメインで明示しておく）
    from.endsWith("@tldv.io")
  ) {
    return true;
  }
  // Google カレンダーの招待/応答の定型件名（招待: / 承諾: / Invitation: 等）。
  const subject = header(msg, "Subject");
  return /^(招待|承諾|辞退|仮承諾|更新された招待|キャンセル|Invitation|Updated invitation|Accepted|Declined|Canceled|Cancelled)\s*[:：]/i.test(
    subject
  );
}

/** 自社が送ったメッセージか（atsushi の SENT ラベル、または自社ドメイン送信）。 */
function isOutboundMessage(msg: GmailMessage): boolean {
  if ((msg.labelIds ?? []).includes("SENT")) return true;
  return extractEmail(header(msg, "From")).endsWith("@" + OUR_DOMAIN);
}

/**
 * 候補スレッドを新しい順に取得し、「社外の実メッセージを含む会話スレッド」を1件選んで返す。
 * fetchLastContact / fetchRecentThread で共用する選定ロジック（両者とも同じ欠陥を抱えていたため統合）。
 *
 * threads.list は「クエリに一致した最新メッセージの日時」順に並ぶため、日本語引用句
 * （例: `"サンプル食品"`）が新しいメッセージ（署名・引用部含む）にヒットしないと、実会話
 * スレッドが下位に沈む（2026-07-14 サンプル食品実例で実会話スレッドが6番目に沈み、
 * 旧 maxResults=5/1 では圏外になった）。metadata パスは軽量なので窓を 20 件に広げてループ内
 * で選別する。選定ループは最初の該当スレッドで break するため、window拡大のコストは自動メール
 * スレッドの metadata 取得数件分のみ。
 *
 * threads.list 自体が失敗した場合は例外を投げる（呼び出し元の try/catch に委ねる）。
 * 該当スレッドが無ければ null を返す（chosen ?? fallback）。
 */
async function findConversationThreadId(
  auth: HeadersInit,
  query: string
): Promise<string | null> {
  // 候補スレッドを新しい順に最大 20 件取得する。
  const listRes = await fetch(
    `${GMAIL_API}/threads?q=${encodeURIComponent(query)}&maxResults=20`,
    { headers: auth, cache: "no-store" }
  );
  if (!listRes.ok) {
    throw new Error("gmail threads.list failed");
  }
  const list = (await listRes.json()) as { threads?: { id: string }[] };
  const candidateIds = (list.threads ?? []).map((t) => t.id);
  if (candidateIds.length === 0) {
    return null;
  }

  // 候補を新しい順に評価し、「社外の実メッセージを含む会話スレッド」を採用する。
  // 選定パスはヘッダーだけで判定できるため format=metadata で軽量に読む。
  // どれも該当しなければ最新スレッド（従来挙動）にフォールバックする。
  let chosenId: string | null = null;
  let fallbackId: string | null = null;
  for (const candidateId of candidateIds) {
    const metaRes = await fetch(
      `${GMAIL_API}/threads/${candidateId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`,
      { headers: auth, cache: "no-store" }
    );
    if (!metaRes.ok) continue;
    const meta = (await metaRes.json()) as { messages?: GmailMessage[] };
    const metaMessages = meta.messages ?? [];
    if (metaMessages.length === 0) continue;
    if (!fallbackId) fallbackId = candidateId;
    const real = metaMessages.filter((m) => !isAutomatedMessage(m));
    if (real.some((m) => !isOutboundMessage(m))) {
      chosenId = candidateId;
      break;
    }
  }
  return chosenId ?? fallbackId;
}

// ----------------------------------------------------------------
// 公開 API
// ----------------------------------------------------------------

/** Gmail 用アクセストークンを取得する。環境変数未設定時は null を返す。 */
export async function getGmailAccessToken(): Promise<string | null> {
  const clientId = process.env.GSHEETS_CLIENT_ID;
  const clientSecret = process.env.GSHEETS_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ?? null;
}

/**
 * Gmail から最終やり取りを取得する。
 * 検索優先順位:
 *  1) email がある場合: from/to アドレス検索（最も精度が高い）
 *  2) company（必須）＋ name（あれば OR で補助）。自動通知系は除外。
 *
 * 例外は投げない。失敗時は { connected: false, found: false } を返す。
 * 末尾メッセージの labelIds に "SENT" を含まない場合 inbound: true を返す。
 */
export async function fetchLastContact(input: LastContactInput): Promise<LastContact> {
  try {
    const { email, name, company } = input;

    const token = await getGmailAccessToken();
    if (!token) {
      return { connected: false, found: false };
    }

    // クエリ構築（email→from/to、無ければ会社名＋担当者名で特定）。
    const query = buildContactQuery(email, company, name);
    if (!query) {
      return { connected: true, found: false };
    }

    const auth = { Authorization: `Bearer ${token}` };

    // 候補スレッドを新しい順に評価し、「社外の実メッセージを含む会話スレッド」を1件選ぶ。
    // 選定ロジックは findConversationThreadId 参照（fetchRecentThread と共用）。
    // 最新1件だけを見ると、件名固定で毎日新着が積まれる HP 問い合わせ通知の大スレッド
    // （本文に社名を含む・末尾は常に自社 support@ 発）や、カレンダー招待だけの単発スレッドを
    // 掴んで「返信済み」と誤判定する（2026-07-02 ワイヤ・アンド・ワイヤレス未返信の見逃し実例）。
    const threadId = await findConversationThreadId(auth, query);
    if (!threadId) {
      return { connected: true, found: false, query };
    }

    // 採用スレッドの全文を取得し、**最後のメッセージ**（最新）を読む。
    const threadRes = await fetch(`${GMAIL_API}/threads/${threadId}?format=full`, {
      headers: auth,
      cache: "no-store",
    });
    if (!threadRes.ok) {
      return { connected: false, found: false };
    }
    const thread = (await threadRes.json()) as { messages?: GmailMessage[] };
    const messages = thread.messages ?? [];
    if (messages.length === 0) {
      return { connected: true, found: false, query };
    }

    // internalDate でソート（古→新）。
    const sorted = [...messages].sort(
      (a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0)
    );

    // カレンダー招待・会議メモ等の自動メールを除いた「実質の会話メッセージ」の末尾を採用する。
    // （自動メールがスレッド末尾に入り込んで誤判定するのを防ぐ）
    const realMessages = sorted.filter((m) => !isAutomatedMessage(m));
    const effective = realMessages.length > 0 ? realMessages : sorted;
    const last = effective[effective.length - 1];

    // 未返信 = 実質の最終メッセージが自社発でない（先方発で止まっている）。
    // 自社判定は SENT ラベル or 自社ドメイン送信（他メンバーの返信も自社扱い）。
    // 実質メッセージが無い（全て自動メール）場合は会話として成立しないため未返信としない。
    const inbound = realMessages.length > 0 ? !isOutboundMessage(last) : false;

    const bodyText = (extractText(last.payload) || last.snippet || "")
      .replace(/\r\n/g, "\n")
      .trim()
      .slice(0, 400);

    return {
      connected: true,
      found: true,
      date: new Date(Number(last.internalDate ?? 0)).toISOString(),
      subject: header(last, "Subject"),
      from: header(last, "From"),
      excerpt: bodyText,
      threadLength: messages.length,
      query,
      inbound,
    };
  } catch {
    return { connected: false, found: false };
  }
}

// ----------------------------------------------------------------
// 直近スレッド（AI 判定用）
// ----------------------------------------------------------------

/** fetchRecentThread が返すメッセージ 1 件（AI 判定の入力）。 */
export interface RecentThreadMessage {
  /** From ヘッダ（表示名 + アドレス）。 */
  from: string;
  /** 件名。 */
  subject: string;
  /** Gmail のスニペット（本文冒頭の抜粋）。 */
  snippet: string;
  /** 受信/送信日時 (ISO8601)。 */
  date: string;
  /** 自社発（@OUR_DOMAIN 送信 or SENT ラベル）なら true。 */
  outbound: boolean;
}

/**
 * 営業案件の「最も関連の深いクライアントスレッド」の直近メッセージを取得する。
 *
 * 検索優先順位は fetchLastContact と同一:
 *   1) email があれば from/to アドレス検索（最も精度が高い）
 *   2) 無ければ会社名（＋担当者名 OR 補助）で検索（自動通知系を除外）
 *
 * threads.list（新しい順）で最新スレッドを 1 件特定し、そのスレッドの
 * メッセージを format=metadata（Subject/From/Date ヘッダ＋snippet）で軽量取得する。
 * カレンダー招待・各種通知などの自動メールは除外する。
 *
 * 返り値は **新しい順（newest-first）**、最大 8 件。各 outbound は送信者が
 * @OUR_DOMAIN（または SENT ラベル）かで判定する。
 *
 * 例外は投げない（best-effort）。トークン無し・検索不可・失敗時は [] を返す。
 */
export async function fetchRecentThread(
  token: string,
  input: { email?: string | null; name?: string | null; company?: string | null }
): Promise<RecentThreadMessage[]> {
  try {
    const { email, name, company } = input;

    // クエリ構築（fetchLastContact と同じ規則）。
    const query = buildContactQuery(email, company, name);
    if (!query) return [];

    const auth = { Authorization: `Bearer ${token}` };

    // 1) 候補スレッドから「実会話スレッド」を1件特定する（fetchLastContact と共通のロジック）。
    //    旧実装は maxResults=1 で最新スレッドを盲目的に採用しており、fetchLastContact と同じ
    //    「日本語引用句が新しいメッセージに一致せず実会話スレッドが下位に沈む」欠陥を持っていた。
    const threadId = await findConversationThreadId(auth, query);
    if (!threadId) return [];

    // 2) スレッドのメッセージ一覧（ID）を取得する。
    const threadRes = await fetch(
      `${GMAIL_API}/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`,
      { headers: auth, cache: "no-store" }
    );
    if (!threadRes.ok) return [];
    const thread = (await threadRes.json()) as { messages?: GmailMessage[] };
    const messages = thread.messages ?? [];
    if (messages.length === 0) return [];

    // 自動メール（カレンダー招待・通知）を除外し、新しい順に並べて先頭 8 件。
    const real = messages.filter((m) => !isAutomatedMessage(m));
    const effective = real.length > 0 ? real : messages;
    const sortedDesc = [...effective].sort(
      (a, b) => Number(b.internalDate ?? 0) - Number(a.internalDate ?? 0)
    );

    return sortedDesc.slice(0, 8).map((m) => ({
      from: header(m, "From"),
      subject: header(m, "Subject"),
      snippet: (m.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
      date: new Date(Number(m.internalDate ?? 0)).toISOString(),
      outbound: isOutboundMessage(m),
    }));
  } catch {
    return [];
  }
}
