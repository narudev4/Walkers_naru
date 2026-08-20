// 受託案件「最終Gmailやり取り日時」収集ランナーの最新実行結果を KV に永続化するストア。
//
// 定期実行カード（BatchJobs）に「最後にいつ走って何件更新したか」を表示するために使う。
// KV 未設定時はグレースフル劣化（null を返す / 書き込みはサイレント失敗）。throw しない。
//
// KV キー:
//   noah:gmail-lastseen:last → GmailLastSeenRun（最新 1 件のみ保持）

import { isKvConfigured, kvGet, kvSet } from "@/lib/kv-store";

/** 1 回の収集実行結果サマリー。 */
export interface GmailLastSeenRun {
  /** 実行開始時刻 (ISO8601)。 */
  ranAt: string;
  /** Gmail を調べた案件数。 */
  checked: number;
  /** last_gmail_at を更新できた案件数。 */
  updated: number;
  /** 個別処理で失敗した案件数。 */
  failed: number;
  /** 実行に要した時間（ms）。 */
  durationMs: number;
  /** 実行ステータス。skipped=Gmail未連携 / partial=時間予算切れ / success=全件処理。 */
  status: "success" | "partial" | "skipped";
  /** 呼び出し元の種別。 */
  trigger: "cron" | "manual";
}

const KEY_LAST = "noah:gmail-lastseen:last";

/** 最新の実行結果を KV に保存する（全置換）。KV 未設定時はサイレント。 */
export async function writeLastSeenRun(run: GmailLastSeenRun): Promise<void> {
  await kvSet<GmailLastSeenRun>(KEY_LAST, run);
}

/** 最新の実行結果を KV から読み込む。KV 未設定/未実行は null。 */
export async function readLastSeenRun(): Promise<GmailLastSeenRun | null> {
  if (!isKvConfigured()) return null;
  return (await kvGet<GmailLastSeenRun>(KEY_LAST)) ?? null;
}
