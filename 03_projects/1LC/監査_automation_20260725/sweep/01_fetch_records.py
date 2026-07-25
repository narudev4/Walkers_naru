# -*- coding: utf-8 -*-
"""マッチング候補になり得る全物件をAirtableから取得（読み取りのみ）"""
import json, urllib.request, urllib.parse
PAT=open("/Users/naru/Walkers_naru/credentials/airtable-1lc-pat.txt").read().strip()
BASE="appksEWIuKl7N2ftS"; TBL="tbllNssTBXGexHysb"
H={"Authorization":"Bearer "+PAT}
FIELDS=["公開用URL","所在地","価格","利回り","建物構造","種別","更新日","新規登録日","築年(西暦)","バス・徒歩(整形)","土地権利","過去紹介済｜成約済","メール埋め込み"]
recs=[]; offset=None; page=0
while True:
    p={"pageSize":100}
    for f in FIELDS: p.setdefault("fields[]",[])
    q=[("pageSize","100")]+[("fields[]",f) for f in FIELDS]
    if offset: q.append(("offset",offset))
    url=f"https://api.airtable.com/v0/{BASE}/{TBL}?"+urllib.parse.urlencode(q)
    with urllib.request.urlopen(urllib.request.Request(url,headers=H),timeout=60) as r:
        d=json.loads(r.read())
    recs+=d["records"]; offset=d.get("offset"); page+=1
    if page%50==0: print(f"  {len(recs)}件取得...", flush=True)
    if not offset: break
out=[]
for r in recs:
    f=r["fields"]
    out.append({"id":r["id"],"url":f.get("公開用URL"),"addr":f.get("所在地"),
                "price":f.get("価格"),"profit":f.get("利回り"),
                "structure":f.get("建物構造"),"kind":f.get("種別"),
                "updated":f.get("更新日"),"created":f.get("新規登録日"),
                "year":f.get("築年(西暦)"),"station":f.get("バス・徒歩(整形)"),
                "landright":f.get("土地権利"),"soldflag":f.get("過去紹介済｜成約済"),
                "embed":f.get("メール埋め込み")})
json.dump(out,open("/Users/naru/Walkers_naru/03_projects/1LC/監査_automation_20260725/sweep/records.json","w"),ensure_ascii=False)
withurl=sum(1 for x in out if x["url"])
print(f"完了: 総{len(out)}件 / URL有り {withurl}件")
