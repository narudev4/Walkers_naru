# -*- coding: utf-8 -*-
"""チタンの各物件ページを読み、掲載終了かを判定（読み取りのみ・書き込みなし）"""
import json, urllib.request, os, time
from concurrent.futures import ThreadPoolExecutor

MARKER = "この物件は掲載を終了致しました"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
recs = json.load(open(f"{BASE_DIR}/records.json"))
targets = [r for r in recs if r.get("url")]

RESULT_PATH = f"{BASE_DIR}/sweep_result.json"
done = {}
if os.path.exists(RESULT_PATH):
    done = json.load(open(RESULT_PATH))
    print(f"再開: 既に{len(done)}件判定済み", flush=True)

todo = [r for r in targets if r["id"] not in done]
print(f"判定対象: {len(todo)}件 / 全{len(targets)}件", flush=True)

def check(rec):
    url = rec["url"]
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
            with urllib.request.urlopen(req, timeout=25) as r:
                html = r.read().decode("euc_jp", errors="ignore")
            return rec["id"], ("ended" if MARKER in html else "alive")
        except urllib.error.HTTPError as e:
            if e.code == 404: return rec["id"], "ended404"
            if attempt == 0: time.sleep(1); continue
            return rec["id"], f"http{e.code}"
        except Exception:
            if attempt == 0: time.sleep(1); continue
            return rec["id"], "error"

count = 0
with ThreadPoolExecutor(max_workers=8) as ex:
    for rid, status in ex.map(check, todo):
        done[rid] = status
        count += 1
        if count % 500 == 0:
            json.dump(done, open(RESULT_PATH,"w"))
            from collections import Counter
            c = Counter(done.values())
            print(f"  {count}/{len(todo)}  内訳={dict(c)}", flush=True)
json.dump(done, open(RESULT_PATH,"w"))

from collections import Counter
c = Counter(done.values())
alive = c.get("alive",0); ended = c.get("ended",0)+c.get("ended404",0)
err = len(done)-alive-ended
print(f"\n★ 完了: 掲載中 {alive}件 / 掲載終了 {ended}件 / 判定不能 {err}件")
if alive+ended: print(f"★ 掲載終了率: {ended/(alive+ended)*100:.1f}%")
