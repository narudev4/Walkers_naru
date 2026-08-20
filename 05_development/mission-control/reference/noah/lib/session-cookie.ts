// NOAH 認証 — セッション Cookie の発行／破棄（Server Component / Server Action 専用）。
//
// 署名は auth-session.ts（純粋・proxy からも使う）に委譲し、ここは cookies() を使う書き込み係。
// proxy.ts からは import しない（next/headers 依存のため）。

import { cookies } from "next/headers";
import {
  encrypt,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  type SessionPayload,
} from "@/lib/auth-session";

/** セッション Cookie を発行する。 */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await encrypt(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // ローカル(http)でも Cookie が保存されるよう本番のみ secure。
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** セッション Cookie を破棄する。 */
export async function deleteSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
