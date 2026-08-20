// Gmail 未返信チェックの結果を KV に永続化するストア。
//
// KV が未設定の場合はグレースフル劣化（空の状態を返す）。
// throw しない。"use client" 不要（サーバー専用）。
//
// KV キー:
//   noah:gmail:unreplied  → UnrepliedMap
//   noah:gmail:history    → GmailCheckRun[]

import { isKvConfigured, kvGet, kvSet } from "@/lib/kv-store";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** 未返信案件の 1 エントリ。 */
export interface UnrepliedEntry {
  dealId: string;
  company: string;
  title: string;
  lastDate: string | null;
  subject: string | null;
  from: string | null;
  ownerId: string;
}

/** dealId → UnrepliedEntry のマップ。 */
export type UnrepliedMap = Record<string, UnrepliedEntry>;

/** HP 問い合わせフォーム受信の 1 件（分類・返信検知済み）。 */
export interface HpInquiry {
  id: string;
  date: string;
  name: string;
  company: string;
  email: string;
  summary: string;
  /** メール本文の全文（クリック展開で表示・旧データは未設定→summary にフォールバック）。 */
  body?: string;
  verdict: "lead" | "other_inquiry" | "cold_sales" | "spam" | "unknown";
  replied: boolean;
  repliedDate: string | null;
  /** 受信経路: "form"=HP問い合わせフォーム / "direct"=support@宛の直メール（旧データは未設定）。 */
  source?: "form" | "direct";
  /** 手動削除（dismiss）済みか。要返信一覧から非表示にする（メッセージIDで永続・runnerが保持）。 */
  dismissed?: boolean;
  /**
   * 営業DB（deals）に自動登録済みリードの deals.id。
   * 二重登録の防止と UI からの案件リンクに使う（未登録は未設定/null）。
   */
  dealId?: string | null;
  /** lead-watch が作成した Gmail 返信下書きの draft ID（未作成は未設定）。 */
  replyDraftId?: string;
  /** 返信下書きを作成した時刻 (ISO8601)。 */
  replyDraftAt?: string;
  /** 下書き本文の由来: "ai"=AI生成 / "template"=固定テンプレ。 */
  replyDraftSource?: "ai" | "template";
  /** 下書き内容を営業チャンネルへ通知した時刻 (ISO8601・未通知は未設定)。 */
  chatNotifiedAt?: string;
}

/** 1 回のチェック実行ログ。 */
export interface GmailCheckRun {
  ranAt: string;
  checked: number;
  unreplied: number;
  failed: number;
  durationMs: number;
  status: "success" | "partial" | "error" | "skipped";
  trigger: "cron" | "manual";
  note?: string | null;
}

/** KV に保存される Gmail チェック全体の状態。 */
export interface GmailCheckState {
  connected: boolean;
  unreplied: UnrepliedMap;
  history: GmailCheckRun[];
  hpInquiries: HpInquiry[];
}

/** 履歴の最大保持件数。 */
export const GMAIL_CHECK_HISTORY_LIMIT = 20;

// ---------------------------------------------------------------------------
// KV キー定数
// ---------------------------------------------------------------------------

const KEY_UNREPLIED = "noah:gmail:unreplied";
const KEY_HISTORY = "noah:gmail:history";
const KEY_HP = "noah:gmail:hp";
const KEY_DISMISSED = "noah:gmail:unreplied-dismissed";

// ---------------------------------------------------------------------------
// 公開関数
// ---------------------------------------------------------------------------

/**
 * KV から Gmail チェック状態を読み込む。
 * KV 未接続の場合は connected:false の空状態を返す。
 */
export async function readGmailCheckState(): Promise<GmailCheckState> {
  if (!isKvConfigured()) {
    return { connected: false, unreplied: {}, history: [], hpInquiries: [] };
  }

  const [unreplied, history, hp] = await Promise.all([
    kvGet<UnrepliedMap>(KEY_UNREPLIED),
    kvGet<GmailCheckRun[]>(KEY_HISTORY),
    kvGet<HpInquiry[]>(KEY_HP),
  ]);

  return {
    connected: true,
    unreplied: unreplied ?? {},
    history: history ?? [],
    hpInquiries: hp ?? [],
  };
}

/**
 * 未返信マップを KV に全置換で書き込む。
 */
export async function writeUnrepliedMap(map: UnrepliedMap): Promise<void> {
  await kvSet<UnrepliedMap>(KEY_UNREPLIED, map);
}

/**
 * HP 問い合わせ一覧を KV から読み込む。KV 未設定時は空配列を返す。
 */
export async function readHpInquiries(): Promise<HpInquiry[]> {
  if (!isKvConfigured()) return [];
  return (await kvGet<HpInquiry[]>(KEY_HP)) ?? [];
}

/**
 * HP 問い合わせ一覧を KV に全置換で書き込む。
 */
export async function writeHpInquiries(list: HpInquiry[]): Promise<void> {
  await kvSet<HpInquiry[]>(KEY_HP, list);
}

/**
 * HpInquiry レコードを patch でマージ upsert する。
 * read → record.id 一致があれば merge、無ければ record＋patch を先頭に挿入 → write。
 * lead-watch（毎時）が gmail-check（毎朝）より先に新着を処理するケースでは
 * noah:gmail:hp に該当レコードがまだ無いため、挿入で処理結果を残す
 * （翌朝の gmail-check は existingIds で突合するので二重登録されない）。
 * KV 未設定は何もしない（throw しない）。
 */
export async function upsertHpInquiry(
  record: HpInquiry,
  patch: Partial<HpInquiry>,
): Promise<boolean> {
  if (!isKvConfigured()) return false;
  const list = await readHpInquiries();
  const idx = list.findIndex((x) => x.id === record.id);
  if (idx === -1) {
    await writeHpInquiries([{ ...record, ...patch }, ...list]);
  } else {
    list[idx] = { ...list[idx], ...patch };
    await writeHpInquiries(list);
  }
  return true;
}

/**
 * 実行ログを履歴の先頭に追加し、上限件数を超えた分は切り捨てて KV に保存する。
 */
export async function appendRun(run: GmailCheckRun): Promise<void> {
  const prev = (await kvGet<GmailCheckRun[]>(KEY_HISTORY)) ?? [];
  const next = [run, ...prev].slice(0, GMAIL_CHECK_HISTORY_LIMIT);
  await kvSet<GmailCheckRun[]>(KEY_HISTORY, next);
}

// ---------------------------------------------------------------------------
// 未返信の手動削除（dismiss）
// ---------------------------------------------------------------------------

/**
 * 未返信エントリの同一性シグネチャ（差出人＋件名＋最終受信日時）。
 * 「同一スレッドの重複除外」と「手動削除の照合」に使う。最終メッセージが変われば
 * sig も変わる＝新しいやり取りが来たら削除状態はリセットされ再表示される。
 */
export function unrepliedSig(e: {
  from: string | null;
  subject: string | null;
  lastDate: string | null;
}): string {
  return `${e.from ?? ""}|${e.subject ?? ""}|${e.lastDate ?? ""}`;
}

/** 手動削除された未返信: dealId → 削除時点の sig（その最終メッセージのみ抑制）。 */
export type DismissedMap = Record<string, string>;

/** 手動削除マップを KV から読み込む。KV 未設定時は空。 */
export async function readDismissedUnreplied(): Promise<DismissedMap> {
  if (!isKvConfigured()) return {};
  return (await kvGet<DismissedMap>(KEY_DISMISSED)) ?? {};
}

/** 手動削除マップを KV に全置換で書き込む。 */
export async function writeDismissedUnreplied(map: DismissedMap): Promise<void> {
  await kvSet<DismissedMap>(KEY_DISMISSED, map);
}
