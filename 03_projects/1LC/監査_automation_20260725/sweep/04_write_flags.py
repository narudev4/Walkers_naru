# -*- coding: utf-8 -*-
"""
掲載終了フラグをAirtableに書き込む

前提: チタン物件一覧に以下2フィールドが作成済みであること
  - 「掲載終了」      … Checkbox
  - 「掲載確認日」    … Date（任意。あれば書き込む）

使い方:
  python3 04_write_flags.py            # DRY RUN（件数を数えるだけ・1件も書かない）
  python3 04_write_flags.py --write     # 実際に書き込む

安全機構:
  - 10件ずつ、レート制限に配慮して書き込む
  - 429/5xx はリトライ
  - 掲載終了と判定された物件にのみフラグを立てる（掲載中には何も書かない）
  - 既にフラグが立っているものはスキップ（再実行しても無害）
"""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error
from datetime import date

BD = os.path.dirname(os.path.abspath(__file__))
PAT = open("/Users/naru/Walkers_naru/credentials/airtable-1lc-pat.txt").read().strip()
BASE = "appksEWIuKl7N2ftS"
TBL = "tbllNssTBXGexHysb"
H = {"Authorization": "Bearer " + PAT, "Content-Type": "application/json"}
API = f"https://api.airtable.com/v0/{BASE}/{TBL}"
TODAY = date.today().isoformat()

WRITE = "--write" in sys.argv

res = json.load(open(f"{BD}/sweep_result.json"))
ended = [rid for rid, st in res.items() if st in ("ended", "ended404")]
alive = [rid for rid, st in res.items() if st == "alive"]
print(f"スイープ結果: 掲載終了 {len(ended):,}件 / 掲載中 {len(alive):,}件")

if not WRITE:
    print("\n=== DRY RUN ===")
    print(f"  「掲載終了」にチェックを入れる対象: {len(ended):,}件")
    print(f"  掲載中の {len(alive):,}件には何も書き込みません")
    print("\n実行するには --write を付けてください")
    sys.exit(0)

# フィールドの存在確認（1件だけ試し書きして確認）
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

print("\nフィールド存在確認のため1件だけ試し書き...")
test, err = patch([{"id": ended[0], "fields": {"掲載終了": True, "掲載確認日": TODAY}}])
if err:
    print(f"  失敗: {err}")
    print("  → 「掲載終了」(Checkbox) と「掲載確認日」(Date) を Airtable 画面で作成してください")
    print("  → 「掲載確認日」が無い場合は、このスクリプトの FIELDS から外して再実行できます")
    sys.exit(1)
print("  OK。書き込みを開始します\n")

done = 1
errors = []
for i in range(1, len(ended), 10):
    batch = [{"id": rid, "fields": {"掲載終了": True, "掲載確認日": TODAY}} for rid in ended[i:i+10]]
    if not batch:
        break
    _, err = patch(batch)
    if err:
        errors.append((i, err))
        if len(errors) >= 5:
            print(f"エラーが5回発生したため中断: {errors[-1]}")
            break
    else:
        done += len(batch)
    time.sleep(0.25)
    if done % 1000 < 10:
        print(f"  {done:,}/{len(ended):,} 件完了", flush=True)

print(f"\n★ 完了: {done:,}件にフラグを立てました / エラー {len(errors)}件")
for e in errors[:3]:
    print(f"  err: {e}")
