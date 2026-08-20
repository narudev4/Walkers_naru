// 議事録自動生成 tldv-poll — Vercel Cron ルート。
// vercel.json で "50 * * * *"（毎時 50 分）に自動実行される。
// tl;dv Webhook（/api/tldv-webhook）が主経路、この cron は取りこぼしの保険。
//
// 認証: CRON_SECRET の Bearer 認証で保護する（cron/ops-watch と同型）。

import type { NextRequest } from "next/server";
import { runTldvPoll } from "@/lib/minutes-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  // CRON_SECRET 未設定時も 401 にする（api/cron は認証除外のため無認証公開を防ぐ）。
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const run = await runTldvPoll("cron");
  return Response.json(run);
}
