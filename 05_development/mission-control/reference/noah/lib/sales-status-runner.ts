// AI 営業ステータス更新のコアロジック（DRY-RUN 既定）。
//
// 各「進行中」案件の直近 Gmail スレッドを読み、Claude Haiku の判定で
// 「高確度の前進シグナル」がある案件だけ、許可された 1 ホップ先へ PJ ステータスを前進させる。
// gmail-check-runner.ts と同じ構造（fetchDeals → 並列 → KV 保存）をミラーしている。
//
// 安全設計（最重要）:
//   - 既定は DRY-RUN（提案のみ・書き込みなし）。opts.apply===true のときだけ書き込む。
//   - 採用するのは action==="advance" && confidence==="high" の前進のみ。
//   - 失注/不採用/撤退への遷移は構造上発生しない（FORWARD_MAP に無い）。
//   - 1 回の実行で高確度前進が MAX_ADVANCE を超えたら、apply でも一切書き込まず安全停止する。
//   - 日調中→初回mtg前 は既存の決定的同期(sync_nichou)が担当するため、日調中は対象から除外する。
//
// グレースフル劣化:
//   - Gmail 未連携 → mode に応じた skipped 相当の run を返す。
//   - 個別案件の失敗 → try/catch で failed++ してスキップ（全体は止めない）。
//   - 例外を投げない（常に SalesStatusRun を返す）。

import { fetchDeals } from "@/lib/notion-deals";
import { activeDeals } from "@/lib/sales-data";
import { getGmailAccessToken, fetchRecentThread } from "@/lib/gmail";
import {
  judgeSalesStatus,
  FORWARD_MAP,
} from "@/lib/sales-status-judge";
import { applyAdvance, stageFor } from "@/lib/sales-advance-apply";
import {
  writeSalesStatusLatest,
  appendSalesStatusRun,
  type SalesStatusChange,
  type SalesStatusRun,
} from "@/lib/sales-status-store";

/** 並列処理の同時実行数（Gmail API レート制限への配慮）。 */
const CONCURRENCY = 4;

/** 1 回の実行で使える最大時間（ms）。超えたらバッチ境界で打ち切る。 */
const BUDGET_MS = 50_000;

/**
 * 1 回の実行で許容する高確度前進の上限。
 * これを超える前進が一度に検知された場合は「異常」とみなし、
 * apply でも一切書き込まずに安全停止する（要手動確認）。
 */
const MAX_ADVANCE = 8;

/**
 * AI 営業ステータス更新を実行し、結果を KV に保存して SalesStatusRun を返す。
 *
 * @param trigger  呼び出し元の種別（"cron" | "manual"）
 * @param opts.apply  true のときだけ実書き込み（既定は DRY-RUN）。
 */
export async function runSalesStatusCheck(
  trigger: "cron" | "manual",
  opts: { apply: boolean }
): Promise<SalesStatusRun> {
  const startedAt = Date.now();
  const apply = opts.apply === true;

  // Gmail アクセストークンを事前確認。未連携なら即 skipped 相当。
  const token = await getGmailAccessToken();
  if (!token) {
    const run: SalesStatusRun = {
      ranAt: new Date(startedAt).toISOString(),
      mode: apply ? "apply" : "dry-run",
      checked: 0,
      advanced: 0,
      skipped: 0,
      failed: 0,
      durationMs: Date.now() - startedAt,
      trigger,
      note: "Gmail未連携",
    };
    await appendSalesStatusRun(run);
    return run;
  }

  // 案件一覧取得（Supabase → Notion → dummy のフォールバック）。
  const deals = await fetchDeals();

  // 対象: 進行中（lead〜negotiation）かつ
  //   - stage が won/lost でない（activeDeals が保証）
  //   - pj_status があり、FORWARD_MAP のキーに含まれる
  //   - 日調中 は除外（sync_nichou の領分）
  //   - contact_email か company のいずれかがある（Gmail 検索の手掛かり）
  const targets = activeDeals(deals).filter((d) => {
    const status = d.pj_status;
    if (!status) return false;
    if (status === "日調中") return false;
    if (!(status in FORWARD_MAP)) return false;
    if (!d.contact_email && !d.company) return false;
    return true;
  });

  let checked = 0;
  let failed = 0;
  let partial = false;
  const advances: SalesStatusChange[] = [];

  // 並列度 CONCURRENCY の簡易ワーカープール。バッチ境界で時間予算を確認する。
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > BUDGET_MS) {
      partial = true;
      break;
    }

    const batch = targets.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async (d) => {
        try {
          const messages = await fetchRecentThread(token, {
            email: d.contact_email ?? undefined,
            name: d.contact_name ?? undefined,
            company: d.company,
          });

          const verdict = await judgeSalesStatus({
            id: d.id,
            company: d.company,
            title: d.title,
            currentStatus: d.pj_status as string,
            messages,
          });

          checked++;

          if (
            verdict.action === "advance" &&
            verdict.confidence === "high" &&
            verdict.toStatus
          ) {
            advances.push({
              dealId: d.id,
              company: d.company,
              title: d.title,
              from: d.pj_status as string,
              to: verdict.toStatus,
              confidence: "high",
              reason: verdict.reason,
              appliedAt: new Date().toISOString(),
              applied: false, // 適用フェーズで true に更新する。
            });
          }
        } catch {
          checked++;
          failed++;
        }
      })
    );
  }

  // ── 安全弁: 一度に大量前進＝異常。apply でも書き込まず安全停止する。 ──
  const capExceeded = advances.length > MAX_ADVANCE;
  let appliedCount = 0;
  let note: string | null = null;

  if (capExceeded) {
    note = `高確度前進が${advances.length}件（上限${MAX_ADVANCE}）。上限超過のため安全停止（要手動確認）。`;
    // 提案は記録するが applied は全て false のまま。
  } else if (apply) {
    // 高確度前進を 1 件ずつ適用する（個別失敗は failed++ してスキップ）。
    for (const ch of advances) {
      try {
        const stage = stageFor(ch.to);
        if (!stage) {
          // 想定外（FORWARD_MAP の遷移先は STATUS_TO_STAGE に必ずあるはずだが保険）。
          failed++;
          continue;
        }
        const ok = await applyAdvance(ch.dealId, ch.to, stage);
        if (ok) {
          ch.applied = true;
          appliedCount++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
  }

  // 直近の変更一覧と実行ログを KV に保存する。
  await writeSalesStatusLatest(advances);

  if (note === null) {
    note = apply
      ? `適用 ${appliedCount}/${advances.length} 件（前進シグナル検知）`
      : `DRY-RUN: 前進候補 ${advances.length} 件（書き込みなし）`;
  }

  const run: SalesStatusRun = {
    ranAt: new Date(startedAt).toISOString(),
    mode: apply ? "apply" : "dry-run",
    checked,
    advanced: advances.length,
    skipped: Math.max(0, checked - advances.length),
    failed,
    durationMs: Date.now() - startedAt,
    trigger,
    note: partial ? `${note}（時間予算超過で一部のみ判定）` : note,
  };

  await appendSalesStatusRun(run);
  return run;
}
