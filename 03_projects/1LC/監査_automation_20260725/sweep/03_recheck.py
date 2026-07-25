# -*- coding: utf-8 -*-
"""判定不能(http500/error)を低速で再判定（読み取りのみ）"""
import json, urllib.request, os, time
MARKER="この物件は掲載を終了致しました"
BD=os.path.dirname(os.path.abspath(__file__))
recs={r["id"]:r for r in json.load(open(f"{BD}/records.json")) if r.get("url")}
res=json.load(open(f"{BD}/sweep_result.json"))
todo=[rid for rid,st in res.items() if st not in ("alive","ended","ended404")]
print(f"再判定対象: {len(todo)}件（同時接続2・待機0.5秒）",flush=True)
from concurrent.futures import ThreadPoolExecutor
def check(rid):
    url=recs[rid]["url"]
    for a in range(3):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
            with urllib.request.urlopen(req,timeout=30) as r:
                html=r.read().decode("euc_jp",errors="ignore")
            return rid,("ended" if MARKER in html else "alive")
        except urllib.error.HTTPError as e:
            if e.code==404: return rid,"ended404"
            time.sleep(2+a*2)
        except Exception:
            time.sleep(2+a*2)
    return rid,"unresolved"
n=0
with ThreadPoolExecutor(max_workers=2) as ex:
    for rid,st in ex.map(check,todo):
        res[rid]=st; n+=1
        time.sleep(0.5)
        if n%100==0: print(f"  {n}/{len(todo)}",flush=True)
json.dump(res,open(f"{BD}/sweep_result.json","w"))
from collections import Counter
c=Counter(res.values())
print(f"\n★再判定後の全体: {dict(c)}")
al=c.get("alive",0); en=c.get("ended",0)+c.get("ended404",0)
print(f"★掲載終了率: {en/(al+en)*100:.1f}%  (掲載中{al} / 終了{en} / 未解決{len(res)-al-en})")
