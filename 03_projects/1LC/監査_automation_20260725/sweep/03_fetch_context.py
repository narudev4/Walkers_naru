# -*- coding: utf-8 -*-
"""Step1 用: 投資家の希望条件 + 紹介履歴(全件) を GET のみで取得"""
import json, urllib.request, urllib.parse, time, os

PAT = open("/Users/naru/Walkers_naru/credentials/airtable-1lc-pat.txt").read().strip()
BASE = "appksEWIuKl7N2ftS"
H = {"Authorization": "Bearer " + PAT}
DIR = os.path.dirname(os.path.abspath(__file__))


def fetch_all(tbl, params=None):
    recs, offset = [], None
    while True:
        q = [("pageSize", "100")] + list(params or [])
        if offset:
            q.append(("offset", offset))
        url = f"https://api.airtable.com/v0/{BASE}/{tbl}?" + urllib.parse.urlencode(q)
        for attempt in range(5):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60) as r:
                    d = json.loads(r.read())
                break
            except Exception as e:
                if attempt == 4:
                    raise
                time.sleep(2 * (attempt + 1))
        recs += d["records"]
        offset = d.get("offset")
        if not offset:
            break
        time.sleep(0.22)
    return recs


inv = fetch_all("tbleMuHEGiMZqO2xb")
json.dump(inv, open(f"{DIR}/investors.json", "w"), ensure_ascii=False)
print("投資家(希望条件):", len(inv))

hist = fetch_all("tblMieyctX1o6LI7X",
                 [("fields[]", "★個人投資家"), ("fields[]", "物件紹介_投資家"),
                  ("fields[]", "紹介日時"), ("fields[]", "Name")])
json.dump(hist, open(f"{DIR}/history_all.json", "w"), ensure_ascii=False)
print("紹介履歴 全件:", len(hist))
today = [h for h in hist if (h.get("createdTime") or "").startswith("2026-07-25")]
print("うち今日作成:", len(today))
