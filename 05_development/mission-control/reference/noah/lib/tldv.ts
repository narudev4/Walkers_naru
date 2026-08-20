// tl;dv（AI 会議録画）API の薄クライアント（サーバー専用）。
//
// 議事録自動化パイプライン（クライアントMTG判定 → tl;dv 録画 → 議事録生成）の
// 取得層。tl;dv には「特定の会議へボットを参加させる」API が存在しないため
// （2026-07 調査済み）、録画自体は tl;dv アプリのカレンダー連携設定
// （External meetings only）に任せ、NOAH は録画済みミーティングの取得だけを担う。
//
// API 仕様（doc.tldv.io・v1alpha1 = アルファ版なのでレスポンス形の揺れに寛容に作る）:
//   ベース URL: https://pasta.tldv.io
//   認証: x-api-key ヘッダ（env TLDV_API_KEY）
//   GET /v1alpha1/meetings                  … ミーティング一覧
//   GET /v1alpha1/meetings/{id}/transcript  … トランスクリプト
//
// グレースフル劣化: env 未設定は isTldvConfigured()=false / 各関数 null。throw しない。

/** tl;dv API のベース URL。 */
const TLDV_API = "https://pasta.tldv.io/v1alpha1";

/** TLDV_API_KEY が設定されていれば true。 */
export function isTldvConfigured(): boolean {
  return !!process.env.TLDV_API_KEY;
}

/** ミーティング 1 件（必要フィールドのみ・形の揺れは unknown で受けて正規化）。 */
export interface TldvMeeting {
  id: string;
  /** 会議名（カレンダーのタイトル由来）。 */
  name: string;
  /** 開催時刻（ISO8601）。取れなければ null。 */
  happenedAt: string | null;
  /** tl;dv 上の視聴 URL。 */
  url: string | null;
  /** 参加者（メール or 名前。API が返す場合のみ）。 */
  invitees: string[];
}

/** トランスクリプトの発話 1 件。 */
export interface TldvUtterance {
  speaker: string;
  text: string;
}

/** API へ GET し JSON を返す。失敗（env 無し・非2xx・例外）は null。 */
async function tldvGet(path: string): Promise<unknown | null> {
  const key = process.env.TLDV_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${TLDV_API}${path}`, {
      headers: { "x-api-key": key, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** unknown から文字列フィールドを安全に取り出す。 */
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * unknown を ISO8601 日時文字列へ正規化する。
 * v1alpha1 は日時の形が揺れうる（ISO 文字列 / エポック秒・ミリ秒の数値 or 数値文字列）ため、
 * Postgres timestamptz に安全に入る ISO へ寄せる。解釈できなければ null。
 */
function isoDate(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    // 10 桁台はエポック秒、13 桁台はミリ秒とみなす。
    const ms = v < 1e12 ? v * 1000 : v;
    return new Date(ms).toISOString();
  }
  if (typeof v === "string" && v.length > 0) {
    if (/^\d{10,13}$/.test(v)) {
      const n = Number(v);
      return new Date(n < 1e12 ? n * 1000 : n).toISOString();
    }
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return null;
}

/** ミーティング 1 件の生オブジェクトを正規化する（id が無ければ null）。 */
function normalizeMeeting(raw: unknown): TldvMeeting | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  // 参加者はバージョンにより invitees / attendees / participants と揺れうる。
  const inviteesRaw = o.invitees ?? o.attendees ?? o.participants;
  const invitees: string[] = Array.isArray(inviteesRaw)
    ? inviteesRaw
        .map((p) => {
          if (typeof p === "string") return p;
          if (typeof p === "object" && p !== null) {
            const po = p as Record<string, unknown>;
            return str(po.email) ?? str(po.name) ?? null;
          }
          return null;
        })
        .filter((s): s is string => !!s)
    : [];
  return {
    id,
    name: str(o.name) ?? "(無題ミーティング)",
    happenedAt:
      isoDate(o.happenedAt) ?? isoDate(o.date) ?? isoDate(o.createdAt),
    url: str(o.url) ?? `https://tldv.io/app/meetings/${id}`,
    invitees,
  };
}

/**
 * ミーティング一覧を取得する（新しい順・最大 `limit` 件）。
 * レスポンスは { results: [...] } / { meetings: [...] } / 素の配列 のいずれにも対応。
 * env 未設定・失敗は null（「取得できなかった」と「0 件」を区別する）。
 */
export async function listTldvMeetings(
  limit = 20,
): Promise<TldvMeeting[] | null> {
  const json = await tldvGet(`/meetings?limit=${limit}`);
  if (json === null) return null;
  const arr = Array.isArray(json)
    ? json
    : Array.isArray((json as Record<string, unknown>).results)
      ? ((json as Record<string, unknown>).results as unknown[])
      : Array.isArray((json as Record<string, unknown>).meetings)
        ? ((json as Record<string, unknown>).meetings as unknown[])
        : [];
  return arr
    .map(normalizeMeeting)
    .filter((m): m is TldvMeeting => m !== null)
    .slice(0, limit);
}

/**
 * トランスクリプトを取得し、発話列に正規化する。
 * レスポンスは { data: [{speaker,text}...] } / 素の配列 のいずれにも対応。
 * 取得失敗・空は null。
 */
export async function fetchTldvTranscript(
  meetingId: string,
): Promise<TldvUtterance[] | null> {
  const json = await tldvGet(
    `/meetings/${encodeURIComponent(meetingId)}/transcript`,
  );
  if (json === null) return null;
  const arr = Array.isArray(json)
    ? json
    : Array.isArray((json as Record<string, unknown>).data)
      ? ((json as Record<string, unknown>).data as unknown[])
      : [];
  const utterances: TldvUtterance[] = [];
  for (const raw of arr) {
    if (typeof raw !== "object" || raw === null) continue;
    const o = raw as Record<string, unknown>;
    const text = str(o.text) ?? str(o.sentence);
    if (!text) continue;
    utterances.push({ speaker: str(o.speaker) ?? "不明", text });
  }
  return utterances.length > 0 ? utterances : null;
}
