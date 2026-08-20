# -*- coding: utf-8 -*-
"""
掲載状況の日次スイープ（A-2 のプロトタイプ）

やること:
  1. Airtable から「公開用URL があり、まだ掲載終了フラグが立っていない」物件を取得
  2. チタンの物件ページを1件ずつ開いて掲載終了かを判定（読み取りのみ）
  3. 掲載終了と判定できたものだけ「掲載終了」=true / 「掲載確認日」=今日 を書き込む

意図的にやらないこと:
  - 掲載中の物件には何も書き込まない
    （書き込むと Airtable の「更新日」が今日になり、auto_archive の
      「更新日90日超で削除」が永久に発火しなくなる＝不死化する）

安全機構:
  - 判定不能（通信エラー等）の比率が20%を超えたら1件も書き込まずに中断
    （チタン側の障害中に全件を掲載終了扱いにする事故を防ぐ）
  - 10件ずつ書き込み、429/5xx はリトライ
  - 既にフラグが立っているものは対象外なので、再実行しても無害

使い方:
  python3 05_daily_sweep.py            # DRY RUN（判定だけ・1件も書かない）
  python3 05_daily_sweep.py --write    # 判定して書き込む
"""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date

BD = os.path.dirname(os.path.abspath(__file__))
PAT = open("/Users/naru/Walkers_naru/credentials/airtable-1lc-pat.txt").read().strip()
BASE, TBL = "appksEWIuKl7N2ftS", "tbllNssTBXGexHysb"
H = {"Authorization": "Bearer " + PAT, "Content-Type": "application/json"}
API = f"https://api.airtable.com/v0/{BASE}/{TBL}"
MARKER = "この物件は掲載を終了致しました"
TODAY = date.today().isoformat()
WRITE = "--write" in sys.argv
ERROR_ABORT_RATIO = 0.20

# ---------- 1. 対象の取得 ----------
print("Airtable から物件を取得中...", flush=True)
recs, offset, page = [], None, 0
while True:
    q = [("pageSize", "100")] + [("fields[]", f) for f in ("公開用URL", "掲載終了")]
    if offset:
        q.append(("offset", offset))
    url = f"{API}?" + urllib.parse.urlencode(q)
    with urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60) as r:
        d = json.loads(r.read())
    recs += d["records"]
    offset = d.get("offset")
    page += 1
    if page % 50 == 0:
        print(f"  {len(recs):,}件...", flush=True)
    if not offset:
        break

already = [r for r in recs if r["fields"].get("掲載終了")]
targets = [r for r in recs if r["fields"].get("公開用URL") and not r["fields"].get("掲載終了")]
print(f"総 {len(recs):,}件 / 既に掲載終了フラグ済み {len(already):,}件 / 今回の判定対象 {len(targets):,}件\n")

# ---------- 2. 判定 ----------
def check(rec):
    u = rec["fields"]["公開用URL"]
    for attempt in range(2):
        try:
            q = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
            with urllib.request.urlopen(q, timeout=25) as r:
                html = r.read().decode("euc_jp", errors="ignore")
            return rec["id"], ("ended" if MARKER in html else "alive")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return rec["id"], "ended404"
            if attempt == 0:
                time.sleep(1); continue
            return rec["id"], f"http{e.code}"
        except Exception:
            if attempt == 0:
                time.sleep(1); continue
            return rec["id"], "error"

result, n = {}, 0
with ThreadPoolExecutor(max_workers=8) as ex:
    for rid, st in ex.map(check, targets):
        result[rid] = st
        n += 1
        if n % 1000 == 0:
            c = Counter(result.values())
            print(f"  {n:,}/{len(targets):,}  掲載中={c['alive']:,} 終了={c['ended']+c['ended404']:,}", flush=True)

json.dump(result, open(f"{BD}/daily_sweep_{TODAY}.json", "w"))
c = Counter(result.values())
ended = [rid for rid, st in result.items() if st in ("ended", "ended404")]
alive = c["alive"]
errs = len(result) - alive - len(ended)
print(f"\n判定完了: 掲載中 {alive:,} / 掲載終了 {len(ended):,} / 判定不能 {errs:,}")
if len(result):
    print(f"  新たに掲載終了になっていた割合: {len(ended)/max(1,alive+len(ended))*100:.1f}%")

if len(result) and errs / len(result) > ERROR_ABORT_RATIO:
    print(f"\n中断: 判定不能が {errs/len(result)*100:.1f}% と多すぎます（閾値 {ERROR_ABORT_RATIO*100:.0f}%）")
    print("  チタン側が不調の可能性があるため、書き込みは行いません")
    sys.exit(1)

if not WRITE:
    print(f"\n=== DRY RUN ===\n  書き込む対象: {len(ended):,}件\n  掲載中の {alive:,}件には何も書きません")
    print("\n実行するには --write を付けてください")
    sys.exit(0)

# ---------- 3. 書き込み ----------
def patch(records):
    body = json.dumps({"records": records, "typecast": True}, ensure_ascii=False).encode()
    for attempt in range(6):
        try:
            req = urllib.request.Request(API, data=body, headers=H, method="PATCH")
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read()), None
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code == 429 or 500 <= e.code < 600:
                time.sleep(min(2 ** attempt, 20)); continue
            return None, f"HTTP {e.code}: {msg}"
        except Exception as e:
            if attempt < 5:
                time.sleep(min(2 ** attempt, 20)); continue
            return None, str(e)[:200]
    return None, "リトライ上限"

print(f"\n{len(ended):,}件にフラグを書き込みます...")
done, errors = 0, []
for i in range(0, len(ended), 10):
    batch = [{"id": rid, "fields": {"掲載終了": True, "掲載確認日": TODAY}} for rid in ended[i:i + 10]]
    _, err = patch(batch)
    if err:
        errors.append(err)
        if len(errors) >= 5:
            print(f"エラーが5回発生したため中断: {errors[-1]}")
            break
    else:
        done += len(batch)
    time.sleep(0.25)
    if done and done % 500 < 10:
        print(f"  {done:,}/{len(ended):,}", flush=True)

print(f"\n★ 完了: {done:,}件にフラグを立てました / エラー {len(errors)}件")
for e in errors[:3]:
    print("  err:", e)
