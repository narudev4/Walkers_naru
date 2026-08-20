// Supabase PostgREST 汎用 CRUD ヘルパ（正規テーブル用）。
//
// kv-store.ts と同じ流儀: @supabase/supabase-js 非依存・fetch 直叩き・service_role キー。
// env(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) 未設定・通信失敗・パース失敗はすべて
// 握りつぶす（select→[]、書き込み→false）。throw しない（グレースフル劣化）。
//
// サーバー専用（"use client" 不可）。SERVICE_ROLE_KEY をクライアントに出さないこと。

import { isKvConfigured } from "@/lib/kv-store";

/** Supabase が利用可能か（kv-store と同じ env 判定を共有）。 */
export const isSupabaseConfigured = isKvConfigured;

function base(): string | undefined {
  return process.env.SUPABASE_URL;
}
function serviceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function headers(opts?: { write?: boolean; prefer?: string }): HeadersInit {
  const apiKey = serviceKey()!;
  const h: Record<string, string> = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  if (opts?.write) h["Content-Type"] = "application/json";
  if (opts?.prefer) h["Prefer"] = opts.prefer;
  return h;
}

/**
 * SELECT。`query` は `/rest/v1/` 以降（例: "deals?deleted_at=is.null&order=updated_at.desc"）。
 * 失敗時は空配列。
 */
export async function sbSelect<T>(query: string): Promise<T[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const res = await fetch(`${base()!}/rest/v1/${query}`, {
      headers: headers(),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    return [];
  }
}

/**
 * INSERT（return=representation）。生成された行（id 等含む）を返す。失敗時 null。
 */
export async function sbInsertReturning<T>(
  table: string,
  row: Record<string, unknown>
): Promise<T | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const res = await fetch(`${base()!}/rest/v1/${table}`, {
      method: "POST",
      headers: headers({ write: true, prefer: "return=representation" }),
      body: JSON.stringify([row]),
      cache: "no-store",
    });
    if (!res.ok) {
      // 呼び出し側はグレースフルに null を受けるが、原因調査のためサーバーログには残す。
      const detail = await res.text().catch(() => "");
      console.error(
        `[supabase-rest] insert ${table} failed: ${res.status} ${detail.slice(0, 300)}`,
      );
      return null;
    }
    const rows = (await res.json()) as T[];
    return rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}

/** UPDATE。`filter` は PostgREST フィルタ（例: "id=eq.xxx"）。patch は変更フィールドのみ。 */
export async function sbUpdate(
  table: string,
  filter: string,
  patch: Record<string, unknown>
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const res = await fetch(`${base()!}/rest/v1/${table}?${filter}`, {
      method: "PATCH",
      headers: headers({ write: true, prefer: "return=minimal" }),
      body: JSON.stringify(patch),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 論理削除（deleted_at をセット）。 */
export async function sbSoftDelete(
  table: string,
  filter: string
): Promise<boolean> {
  return sbUpdate(table, filter, { deleted_at: new Date().toISOString() });
}

/** 物理削除（sample 系で完全削除したい場合のみ）。 */
export async function sbDelete(
  table: string,
  filter: string
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const res = await fetch(`${base()!}/rest/v1/${table}?${filter}`, {
      method: "DELETE",
      headers: headers({ write: true, prefer: "return=minimal" }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** UPSERT（on_conflict 指定）。冪等な seed / 単一キー更新に使う。 */
export async function sbUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const res = await fetch(
      `${base()!}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: "POST",
        headers: headers({
          write: true,
          prefer: "resolution=merge-duplicates,return=minimal",
        }),
        body: JSON.stringify(rows),
        cache: "no-store",
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
