# -*- coding: utf-8 -*-
"""02a が実際に読む「築年(整形)」を全物件分取得（築年(西暦)とは値が異なるため必須）"""
import json, urllib.request, urllib.parse, time, os
PAT = open("/Users/naru/Walkers_naru/credentials/airtable-1lc-pat.txt").read().strip()
H = {"Authorization": "Bearer " + PAT}
DIR = os.path.dirname(os.path.abspath(__file__))
out, offset = {}, None
while True:
    q = [("pageSize", "100"), ("fields[]", "築年(整形)"), ("fields[]", "画像")]
    if offset:
        q.append(("offset", offset))
    url = "https://api.airtable.com/v0/appksEWIuKl7N2ftS/tbllNssTBXGexHysb?" + urllib.parse.urlencode(q)
    with urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60) as r:
        d = json.loads(r.read())
    for rec in d["records"]:
        out[rec["id"]] = rec["fields"].get("築年(整形)")
    offset = d.get("offset")
    if not offset:
        break
    time.sleep(0.22)
json.dump(out, open(f"{DIR}/year_seikei.json", "w"), ensure_ascii=False)
n_empty = sum(1 for v in out.values() if not v)
print(f"取得 {len(out)}件 / 築年(整形) が空 {n_empty}件")
