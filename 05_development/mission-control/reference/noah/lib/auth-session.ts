// NOAH 認証 — セッション（署名付き Cookie）の符号化／復号。
//
// 独自セッション認証の中核。jose で JWT(HS256) を署名／検証する。
// このファイルは next/headers に依存しない純粋ロジックのみ（proxy.ts からも decrypt を呼ぶため）。
// Cookie の読み書きは dal.ts（読取）・auth-actions.ts（発行／破棄）が担う。
//
// 必要な env（サーバー専用）:
//   SESSION_SECRET … セッション署名鍵（`openssl rand -base64 32` 等で生成）
//
// SESSION_SECRET 未設定は「無施錠」を招くため握りつぶさず明示的に失敗させる（fail closed）。

import { SignJWT, jwtVerify } from "jose";

/** セッション Cookie 名。 */
export const SESSION_COOKIE = "noah_session";

/** セッション有効期限（秒）。7 日。Cookie の maxAge と JWT の exp に共用する。 */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

export type SessionPayload = {
  userId: string;
  email: string;
};

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

/** セッション payload を署名付き JWT 文字列にする。 */
export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

/**
 * JWT 文字列を検証して payload を返す。
 * 未指定・無効・期限切れ・署名不一致・SESSION_SECRET 未設定はすべて null（fail closed）。
 */
export async function decrypt(
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    if (
      typeof payload.userId === "string" &&
      typeof payload.email === "string"
    ) {
      return { userId: payload.userId, email: payload.email };
    }
    return null;
  } catch {
    return null;
  }
}
