// 汎用 key/value ストア（Supabase / Postgres バックエンド）。
//
// gmail-check-store などが使う薄い抽象。実体は Supabase の `noah_kv` テーブルで、
// PostgREST(REST API) を fetch で直叩きする（@supabase/supabase-js 等の依存は追加しない）。
//
// 必要な env（サーバー専用・クライアントには絶対に出さない）:
//   SUPABASE_URL               : https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  : サービスロールキー（RLS をバイパスしてサーバーから読み書き）
//
// テーブル定義（migration で作成する）:
//   create table public.noah_kv (
//     key        text primary key,
//     value      jsonb not null,
//     updated_at timestamptz not null default now()
//   );
//   alter table public.noah_kv enable row level security;  -- service_role のみアクセス可
//
// env 未設定・通信失敗・パース失敗はすべて握りつぶす（get → null, set → false）。throw しない。

const TABLE = "noah_kv";

function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL;
}
function supabaseServiceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が両方揃っていれば true。 */
export function isKvConfigured(): boolean {
  return !!(supabaseUrl() && supabaseServiceKey());
}

/**
 * noah_kv から値を取得する。
 * env 未設定・通信失敗・該当なしはすべて null を返す。
 */
export async function kvGet<T>(key: string): Promise<T | null> {
  if (!isKvConfigured()) return null;

  const base = supabaseUrl()!;
  const apiKey = supabaseServiceKey()!;

  try {
    const res = await fetch(
      `${base}/rest/v1/${TABLE}?key=eq.${encodeURIComponent(key)}&select=value`,
      {
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!res.ok) return null;

    // PostgREST は JSONB をネイティブ JSON で返す（文字列ではない）。
    const rows = (await res.json()) as { value: T }[];
    return rows.length > 0 ? rows[0].value : null;
  } catch {
    return null;
  }
}

/**
 * noah_kv から `key=like.<prefix>*` に一致する全行の value を取得する。
 * （単一キーの kvGet と違い、プレフィックス一覧を一括取得する用途。
 *  例: "sns:post:" で SNS 投稿キュー全件を引く。）
 * env 未設定・通信失敗・該当なしはすべて空配列を返す。throw しない。
 */
export async function kvList<T>(prefix: string): Promise<T[]> {
  if (!isKvConfigured()) return [];

  const base = supabaseUrl()!;
  const apiKey = supabaseServiceKey()!;

  try {
    // PostgREST の like パターン。`*` がワイルドカード（SQL の %）。
    const pattern = encodeURIComponent(`${prefix}*`);
    const res = await fetch(
      `${base}/rest/v1/${TABLE}?key=like.${pattern}&select=value`,
      {
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!res.ok) return [];

    const rows = (await res.json()) as { value: T }[];
    return rows.map((r) => r.value);
  } catch {
    return [];
  }
}

/**
 * noah_kv に値を upsert する（key 競合時は更新）。
 * env 未設定・通信失敗はすべて false を返す。throw しない。
 */
export async function kvSet<T>(key: string, value: T): Promise<boolean> {
  if (!isKvConfigured()) return false;

  const base = supabaseUrl()!;
  const apiKey = supabaseServiceKey()!;

  try {
    const res = await fetch(`${base}/rest/v1/${TABLE}?on_conflict=key`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // PK(key) 競合時は更新（upsert）。レスポンス本文は不要。
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([
        { key, value, updated_at: new Date().toISOString() },
      ]),
      cache: "no-store",
    });

    return res.ok;
  } catch {
    return false;
  }
}
