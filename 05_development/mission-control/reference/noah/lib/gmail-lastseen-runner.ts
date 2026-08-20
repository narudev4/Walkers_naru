// 受託案件の「最終Gmailやり取り日時」収集ランナー。
// cron ルートと手動実行ルートの両方から呼び出す共通ランナー。
//
// 処理概要:
//   1. 案件一覧を取得（fetchDeals）
//   2. 受託「進行中」案件に絞り込む（won かつ 完了(着金確認済) を除く、受託区分のみ、検索キーあり）
//   3. 各案件の Gmail 最終やり取り日時を取得（fetchLastContact）
//   4. パース可能な date を deals.last_gmail_at に保存（NOAHローカル列・Notion非同期）
//
// 受託開発ページ「進行中の受託プロジェクト」表は、この last_gmail_at の降順
// （＝最も最近やり取りした案件が上）で並べる。毎日 cron で更新する。
//
// グレースフル劣化:
//   - Gmail 未連携（GSHEETS_CLIENT_ID 等が無い）→ status:"skipped" で即返却
//   - 個別案件の fetchLastContact 失敗 → failed++ してスキップ
//   - Supabase 未設定 → sbUpdate がサイレントに false を返すが処理は続く（throw しない）

import { fetchDeals } from "@/lib/notion-deals";
import { fetchLastContact, getGmailAccessToken } from "@/lib/gmail";
import { sbUpdate } from "@/lib/supabase-rest";
import {
  writeLastSeenRun,
  type GmailLastSeenRun,
} from "@/lib/gmail-lastseen-store";

export type { GmailLastSeenRun };

/** 並列処理の同時実行数。Gmail API レート制限への配慮。 */
const CONCURRENCY = 6;

/** 1 回の収集で使える最大時間（ms）。超えたらバッチ境界で打ち切る。 */
const BUDGET_MS = 55_000;

/**
 * 受託「進行中」案件の最終Gmailやり取り日時を収集し、deals.last_gmail_at を更新する。
 * @param trigger  呼び出し元の種別（"cron" | "manual"）
 */
export async function runGmailLastSeen(
  trigger: "cron" | "manual"
): Promise<GmailLastSeenRun> {
  const startedAt = Date.now();

  // Gmail アクセストークンを事前確認。未連携なら即 skipped。
  const token = await getGmailAccessToken();
  if (!token) {
    const run: GmailLastSeenRun = {
      ranAt: new Date(startedAt).toISOString(),
      checked: 0,
      updated: 0,
      failed: 0,
      durationMs: Date.now() - startedAt,
      status: "skipped",
      trigger,
    };
    await writeLastSeenRun(run);
    return run;
  }

  // 案件一覧を取得し、受託開発ページ「進行中」表と同じ集合に絞る。
  // （stage="won" かつ 完了(着金確認済) を除く・受託区分のみ・Gmail 検索キーあり）
  const deals = await fetchDeals();
  const targets = deals.filter(
    (d) =>
      d.stage === "won" &&
      d.pj_status !== "完了(着金確認済)" &&
      (d.division === "contract_aix" ||
        d.division === "contract_new" ||
        d.division === "enterprise_public") &&
      (d.contact_email || d.company)
  );

  let checked = 0;
  let updated = 0;
  let failed = 0;
  let status: GmailLastSeenRun["status"] = "success";

  // 並列度 CONCURRENCY の簡易ワーカープール。
  // targets を CONCURRENCY 件ずつバッチに区切って順番に処理する。
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    // 時間予算チェック（バッチ開始前）。超過したら partial で打ち切る。
    if (Date.now() - startedAt > BUDGET_MS) {
      status = "partial";
      break;
    }

    const batch = targets.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async (d) => {
        try {
          const info = await fetchLastContact({
            email: d.contact_email ?? undefined,
            name: d.contact_name ?? undefined,
            company: d.company,
          });

          checked++;

          // パース可能な date のみ保存（不正な日付の案件はスキップ）。
          const raw = info.date;
          if (raw && !Number.isNaN(Date.parse(raw))) {
            const iso = new Date(raw).toISOString();
            const ok = await sbUpdate(
              "deals",
              `id=eq.${encodeURIComponent(d.id)}`,
              { last_gmail_at: iso }
            );
            if (ok) updated++;
          }
        } catch {
          // 個別案件の失敗はスキップ（never throw）。
          checked++;
          failed++;
        }
      })
    );
  }

  const run: GmailLastSeenRun = {
    ranAt: new Date(startedAt).toISOString(),
    checked,
    updated,
    failed,
    durationMs: Date.now() - startedAt,
    status,
    trigger,
  };
  await writeLastSeenRun(run);
  return run;
}
