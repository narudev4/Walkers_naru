// Gmail 未返信チェックのコアロジック。
// cron ルートと手動実行ルートの両方から呼び出す共通ランナー。
//
// 処理概要:
//   1. Notion から営業案件を取得（fetchDeals）
//   2. 進行中案件に絞り込み（activeDeals）
//   3. 各案件に対して Gmail の最終やり取りを調べる（fetchLastContact）
//   4. 末尾メッセージが inbound（先方からの最後の送信）の案件を「未返信」と判定
//   5. 結果を KV に保存して GmailCheckRun を返す
//
// グレースフル劣化:
//   - Gmail 未連携（GSHEETS_CLIENT_ID 等が無い）→ status:"skipped" で即返却
//   - KV 未設定 → writeUnrepliedMap / appendRun がサイレントに失敗するが処理は続く
//   - 個別案件の fetchLastContact 失敗 → failed++ してスキップ

import { fetchDeals } from "@/lib/notion-deals";
import { activeDeals } from "@/lib/sales-data";
import {
  fetchLastContact,
  getGmailAccessToken,
} from "@/lib/gmail";
import {
  writeUnrepliedMap,
  appendRun,
  readHpInquiries,
  writeHpInquiries,
  unrepliedSig,
  readDismissedUnreplied,
  writeDismissedUnreplied,
  type GmailCheckRun,
  type UnrepliedMap,
  type HpInquiry,
  type DismissedMap,
} from "@/lib/gmail-check-store";
import {
  fetchRecentHpInquiries,
  fetchRecentSupportInquiries,
  hpReplyCheck,
} from "@/lib/gmail-hp";
import { classifyHpInquiries } from "@/lib/hp-classify";
import { registerLeadsFromInquiries } from "@/lib/lead-intake";

/** 並列処理の同時実行数。Gmail API レート制限への配慮。 */
const CONCURRENCY = 4;

/** 1 回のチェックで使える最大時間（ms）。超えたら処理を打ち切る。 */
const BUDGET_MS = 40_000;

/** HP 問い合わせを遡る日数。 */
const HP_WINDOW_DAYS = 14;

/** 営業案件の未返信として扱う「最終メッセージの鮮度」上限（日数）。 */
const DEAL_WINDOW_DAYS = 30;

/** HP チェック全体のタイムアウト（ms）。この時間を超えたら個別処理を打ち切る。 */
const HP_CEILING_MS = 56_000;

/**
 * Gmail 未返信チェックを実行し、結果を KV に保存して GmailCheckRun を返す。
 * @param trigger  呼び出し元の種別（"cron" | "manual"）
 */
export async function runGmailCheck(
  trigger: "cron" | "manual"
): Promise<GmailCheckRun> {
  const startedAt = Date.now();

  // Gmail アクセストークンを事前確認。未連携なら即 skipped。
  const token = await getGmailAccessToken();
  if (!token) {
    const run: GmailCheckRun = {
      ranAt: new Date(startedAt).toISOString(),
      checked: 0,
      unreplied: 0,
      failed: 0,
      durationMs: Date.now() - startedAt,
      status: "skipped",
      trigger,
      note: "Gmail未連携",
    };
    await appendRun(run);
    return run;
  }

  // 案件一覧取得（Notion or dummy フォールバック）。
  const deals = await fetchDeals();
  const targets = activeDeals(deals).filter(
    (d) => d.contact_email || d.company
  );

  const nextMap: UnrepliedMap = {};
  let checked = 0;
  let failed = 0;
  let status: GmailCheckRun["status"] = "success";

  // 並列度 CONCURRENCY の簡易ワーカープール。
  // targets を CONCURRENCY 件ずつバッチに区切って順番に処理する。
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    // 時間予算チェック（バッチ開始前）。
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

          // inbound（先方からの送信が末尾）のみ「未返信」と判定する。
          // ただし最終メッセージが DEAL_WINDOW_DAYS より古いものは対象外
          // （何年も前のスレッドは「未返信」ではなく「終わった会話」。
          //  スレッド選定改善で旧スレッドを拾えるようになった副作用の抑制）。
          const lastMs = info.date ? Date.parse(info.date) : 0;
          const fresh =
            lastMs > 0 && Date.now() - lastMs <= DEAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
          if (info.inbound === true && fresh) {
            nextMap[d.id] = {
              dealId: d.id,
              company: d.company,
              title: d.title,
              lastDate: info.date ?? null,
              subject: info.subject ?? null,
              from: info.from ?? null,
              ownerId: d.owner_id,
            };
          }
        } catch {
          // 個別案件の失敗はスキップ。
          checked++;
          failed++;
        }
      })
    );
  }

  // 同一スレッドに複数案件がマッチした場合は誤マッチの可能性が高い
  // （例: contact_email 未登録の案件が「伊藤」等ありふれた担当者名の OR 検索で、
  //  無関係な同姓の同一スレッドを共有して拾ってしまう）。どの案件のものか曖昧なため、
  //  共有された案件はすべて未返信から除外する（最終メッセージ from+件名+日時で同一判定）。
  {
    const sigCount = new Map<string, number>();
    for (const e of Object.values(nextMap)) {
      sigCount.set(unrepliedSig(e), (sigCount.get(unrepliedSig(e)) ?? 0) + 1);
    }
    for (const [id, e] of Object.entries(nextMap)) {
      if ((sigCount.get(unrepliedSig(e)) ?? 0) > 1) delete nextMap[id];
    }
  }

  // 手動削除（dismiss）の適用: 削除時と同じ最終メッセージ(sig)なら表示しない。
  // 返信済み・新しいメッセージで sig が変わった案件の削除記録は破棄（=自然に再表示される）。
  {
    const dismissed = await readDismissedUnreplied();
    const nextDismissed: DismissedMap = {};
    for (const [id, sig] of Object.entries(dismissed)) {
      const e = nextMap[id];
      if (e && unrepliedSig(e) === sig) {
        delete nextMap[id]; // 同じ未返信が残っている → 抑制継続（表示から外す）。
        nextDismissed[id] = sig;
      }
    }
    if (Object.keys(nextDismissed).length !== Object.keys(dismissed).length) {
      await writeDismissedUnreplied(nextDismissed);
    }
  }

  // 未返信マップを KV に保存。
  await writeUnrepliedMap(nextMap);

  // ── HP・support@ 問い合わせの未返信チェック ──
  // フォーム受信＋support@宛の直メールを AI 分類し、
  // 本物のリード(lead)＋要返信の非営業問い合わせ(other_inquiry)を返信検知する。
  let hpNote: string | null = null;
  try {
    const existing = await readHpInquiries();
    const existingIds = new Set(existing.map((e) => e.id));
    const [formRaws, directRaws] = await Promise.all([
      fetchRecentHpInquiries(token, HP_WINDOW_DAYS),
      fetchRecentSupportInquiries(token, HP_WINDOW_DAYS),
    ]);
    const raws = [...formRaws, ...directRaws].filter((r) => !r.isInternalTest);
    const fresh = raws.filter((r) => !existingIds.has(r.id));

    // 新規 ＋ 既存の未分類(unknown) を AI 分類する。
    // ANTHROPIC_API_KEY が後から設定された場合や一時的な分類失敗を救済するため、
    // 一度 unknown になったエントリも再分類対象に含める（キャッシュ済みの確定 verdict は流用）。
    const existingUnknown = existing.filter((e) => e.verdict === "unknown");
    const toClassify = [
      ...fresh.map((r) => ({ id: r.id, company: r.company, summary: r.summary })),
      ...existingUnknown.map((e) => ({
        id: e.id,
        company: e.company,
        summary: e.summary,
      })),
    ];
    const verdicts =
      toClassify.length > 0 ? await classifyHpInquiries(toClassify) : {};

    // lead（営業リード）と other_inquiry（要返信の非営業問い合わせ）を返信検知対象にする。
    const needsReplyCheck = (v: string) =>
      v === "lead" || v === "other_inquiry";
    const newEntries: HpInquiry[] = [];
    for (const r of fresh) {
      if (Date.now() - startedAt > HP_CEILING_MS) break;
      const verdict = verdicts[r.id] ?? "unknown";
      let replied = false;
      let repliedDate: string | null = null;
      if (needsReplyCheck(verdict) && r.email) {
        const rc = await hpReplyCheck(token, r.email, {
          allowSupportSender: r.source === "direct",
        });
        replied = rc.replied;
        repliedDate = rc.date;
      }
      newEntries.push({
        id: r.id, date: r.date, name: r.name, company: r.company,
        email: r.email, summary: r.summary, body: r.body, verdict, replied, repliedDate,
        source: r.source,
      });
    }

    // 既存エントリ: 未分類の再分類結果を反映し、要返信(lead/other_inquiry)かつ未返信は返信状況を再確認する。
    for (const e of existing) {
      const reclassified = verdicts[e.id];
      if (e.verdict === "unknown" && reclassified) {
        e.verdict = reclassified;
      }
      if (needsReplyCheck(e.verdict) && !e.replied && e.email) {
        if (Date.now() - startedAt > HP_CEILING_MS) break;
        try {
          const rc = await hpReplyCheck(token, e.email, {
            allowSupportSender: e.source === "direct",
          });
          e.replied = rc.replied;
          e.repliedDate = rc.date;
        } catch {
          // 個別失敗は無視。
        }
      }
    }

    // マージして直近30日分だけ保持（古いものは破棄、新規優先）。
    const cutoff = startedAt - 30 * 24 * 60 * 60 * 1000;
    let merged = [...newEntries, ...existing].filter((x) => {
      const t = Date.parse(x.date);
      return Number.isNaN(t) || t >= cutoff;
    });

    // 本物のリード(lead)を営業DB(deals)へ自動登録し、dealId を書き戻す。
    // 失敗しても本処理は止めない（Supabase 未設定・突合失敗はサイレントに no-op）。
    let leadRegistered = 0;
    try {
      const before = new Set(
        merged.filter((x) => x.dealId).map((x) => x.id)
      );
      merged = await registerLeadsFromInquiries(merged);
      leadRegistered = merged.filter(
        (x) => x.dealId && !before.has(x.id)
      ).length;
    } catch {
      // 自動登録失敗は握りつぶす（次回実行で再試行）。
    }

    await writeHpInquiries(merged);

    const actionable = merged.filter((x) => needsReplyCheck(x.verdict));
    const leadCount = actionable.filter((x) => x.verdict === "lead").length;
    const otherCount = actionable.filter(
      (x) => x.verdict === "other_inquiry"
    ).length;
    const unrepliedCount = actionable.filter((x) => !x.replied).length;
    hpNote = `HP/support問い合わせ: 新規${fresh.length} / 要返信${actionable.length}(リード${leadCount}・問い合わせ${otherCount}・未返信${unrepliedCount})`;
    if (leadRegistered > 0) hpNote += `・営業DB登録${leadRegistered}件`;
  } catch {
    hpNote = "HP/support問い合わせ: 取得失敗";
  }

  const run: GmailCheckRun = {
    ranAt: new Date(startedAt).toISOString(),
    checked,
    unreplied: Object.keys(nextMap).length,
    failed,
    durationMs: Date.now() - startedAt,
    status,
    trigger,
    note: hpNote,
  };

  await appendRun(run);
  return run;
}
