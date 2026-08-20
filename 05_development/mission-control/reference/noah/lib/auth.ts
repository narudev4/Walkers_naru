// NOAH 認証 — ユーザー／招待の永続層＋パスワードハッシュ＋登録ドメイン制限。
//
// ユーザー(noah_users)・招待(noah_invites)は Supabase（supabase-rest.ts 経由・service_role）。
// パスワードは Node 標準 crypto の scrypt でハッシュ化（外部依存なし）。サーバー専用。
//
// 登録は「管理者が発行した招待トークンの受諾」のみ（自己登録は廃止）。

import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import {
  sbSelect,
  sbInsertReturning,
  sbUpdate,
  sbDelete,
} from "@/lib/supabase-rest";
import type { UserRole } from "@/lib/types";

/** 登録を許可するメールドメイン（社内限定）。 */
export const ALLOWED_DOMAIN = "walker-s.co.jp";

export type NoahUser = {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  is_admin: boolean;
  created_at: string;
};

export type NoahInvite = {
  token: string;
  email: string;
  is_admin: boolean;
  /** 受諾時に profiles へ付与する RBAC ロール（既定 member）。 */
  role: UserRole | null;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
};

/** email を正規化（前後空白除去＋小文字化）。 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** email が許可ドメインか。 */
export function isAllowedEmail(email: string): boolean {
  return normalizeEmail(email).endsWith(`@${ALLOWED_DOMAIN}`);
}

// ── パスワード ───────────────────────────────────────────────

/** scrypt でパスワードをハッシュ化。戻り値は "salt:hash"（ともに hex）。 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/** 平文と "salt:hash" を定数時間比較で検証する。 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const stored64 = Buffer.from(hash, "hex");
  const test64 = scryptSync(password, salt, 64);
  if (stored64.length !== test64.length) return false;
  return timingSafeEqual(stored64, test64);
}

// ── ユーザー ───────────────────────────────────────────────

/** email でユーザーを 1 件取得（正規化）。無ければ null。 */
export async function findUserByEmail(email: string): Promise<NoahUser | null> {
  const rows = await sbSelect<NoahUser>(
    `noah_users?email=eq.${encodeURIComponent(normalizeEmail(email))}&select=*&limit=1`
  );
  return rows.length > 0 ? rows[0] : null;
}

/** id でユーザーを 1 件取得（セッション → ユーザー解決・admin 判定用）。 */
export async function getUserById(id: string): Promise<NoahUser | null> {
  const rows = await sbSelect<NoahUser>(
    `noah_users?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
  );
  return rows.length > 0 ? rows[0] : null;
}

/** 新規ユーザーを作成する。email 重複等の失敗は null。 */
export async function createUser(params: {
  email: string;
  name: string;
  passwordHash: string;
  isAdmin?: boolean;
}): Promise<NoahUser | null> {
  return sbInsertReturning<NoahUser>("noah_users", {
    email: normalizeEmail(params.email),
    name: params.name.trim(),
    password_hash: params.passwordHash,
    is_admin: !!params.isAdmin,
  });
}

// ── 招待 ───────────────────────────────────────────────────

/** URL セーフな招待トークン（256bit）。 */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 招待を作成する。 */
export async function createInviteRow(params: {
  token: string;
  email: string;
  isAdmin: boolean;
  role: UserRole;
  invitedBy: string | null;
  expiresAt: string;
}): Promise<NoahInvite | null> {
  return sbInsertReturning<NoahInvite>("noah_invites", {
    token: params.token,
    email: normalizeEmail(params.email),
    is_admin: !!params.isAdmin,
    role: params.role,
    invited_by: params.invitedBy,
    expires_at: params.expiresAt,
  });
}

/** トークンで招待を取得。無ければ null。 */
export async function findInviteByToken(
  token: string
): Promise<NoahInvite | null> {
  const rows = await sbSelect<NoahInvite>(
    `noah_invites?token=eq.${encodeURIComponent(token)}&select=*&limit=1`
  );
  return rows.length > 0 ? rows[0] : null;
}

/** 未受諾の招待一覧（期限切れ含む・新しい順）。管理画面で表示。 */
export async function listPendingInvites(): Promise<NoahInvite[]> {
  return sbSelect<NoahInvite>(
    `noah_invites?accepted_at=is.null&select=*&order=created_at.desc`
  );
}

/** 招待を受諾済みにする。 */
export async function markInviteAccepted(token: string): Promise<boolean> {
  return sbUpdate("noah_invites", `token=eq.${encodeURIComponent(token)}`, {
    accepted_at: new Date().toISOString(),
  });
}

/** 招待を削除（取消）する。 */
export async function deleteInvite(token: string): Promise<boolean> {
  return sbDelete("noah_invites", `token=eq.${encodeURIComponent(token)}`);
}

/** 招待が受諾可能か（未受諾かつ未期限切れ）。 */
export function isInviteUsable(invite: NoahInvite): boolean {
  return (
    !invite.accepted_at && new Date(invite.expires_at).getTime() > Date.now()
  );
}
