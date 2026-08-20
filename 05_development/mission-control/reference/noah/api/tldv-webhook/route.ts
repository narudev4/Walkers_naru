// tl;dv Webhook 受信ルート（MeetingReady / TranscriptReady）。
//
// tl;dv ダッシュボード（Settings > Webhooks）でこの URL を登録し、カスタムヘッダー
// `x-webhook-token: <TLDV_WEBHOOK_SECRET>` を設定する運用。ペイロードの形は
// アルファ版で揺れうるため中身は信用せず、受信をトリガーに tldv-poll を 1 回
// 実行するだけ（処理本体は冪等な runTldvPoll に集約・毎時 cron と重複しても安全）。
//
// 認証: TLDV_WEBHOOK_SECRET の一致（未設定時は 503 で受け付けない = 無認証公開を防ぐ）。
// proxy.ts の matcher で本ルートはセッション認証から除外している。

import type { NextRequest } from "next/server";
import { runTldvPoll } from "@/lib/minutes-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.TLDV_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "webhook not configured" }, { status: 503 });
  }
  const token =
    request.headers.get("x-webhook-token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (token !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const run = await runTldvPoll("webhook");
  return Response.json(run);
}
