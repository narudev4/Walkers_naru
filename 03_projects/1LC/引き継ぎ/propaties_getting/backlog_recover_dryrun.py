# -*- coding: utf-8 -*-
# 停止期間バックログ回収 DRY RUN: inai=7 で全エリア照会し、Airtable未登録分を数えるだけ（書き込みゼロ）
import json, urllib.request, urllib.parse, time
from collections import Counter
PAT=open("/Users/naru/Walkers_naru/credentials/airtable-1lc-pat.txt").read().strip()
BASE="appksEWIuKl7N2ftS"; TBL="tbllNssTBXGexHysb"; AREA_TBL="tblzcwsQyKYP6AFtN"
H={"Authorization":"Bearer "+PAT}
def air(tbl,params):
    url=f"https://api.airtable.com/v0/{BASE}/{tbl}?"+urllib.parse.urlencode(params,doseq=True)
    with urllib.request.urlopen(urllib.request.Request(url,headers=H),timeout=60) as r: return json.loads(r.read())

# 1) エリア一覧
areas=[]; offset=None
while True:
    p={"pageSize":100,"fields[]":["エリア名","住所コード（ref）"]}
    if offset:p["offset"]=offset
    d=air(AREA_TBL,p)
    for rec in d["records"]:
        f=rec["fields"]
        if f.get("住所コード（ref）"): areas.append((f["エリア名"], rec["id"], f["住所コード（ref）"]))
    offset=d.get("offset")
    if not offset:break
print(f"エリア: {len(areas)}")

# 2) チタン inai=7 全エリア
API="https://www.1lcinc.com/syuuekibukken/php/json_output.php"
def titan(codes):
    body=json.dumps({"fm":"baibai","url":"https://1lcinc-syuuekibukken.com","inai":7,"jusyoc":codes,"yachik":5000,"yachij":200000,"hkensu":1000}).encode()
    req=urllib.request.Request(API,data=body,headers={"Content-Type":"application/json"},method="POST")
    with urllib.request.urlopen(req,timeout=60) as r: return json.loads(r.read().decode())
props={}  # url -> (data, [area_record_ids])
capped=[]
for name,aid,codes in areas:
    try:
        d=titan(codes)
        if len(d)>=1000: capped.append(name)
        for x in d:
            u=x.get("URL")
            if not u: continue
            # 価格5000万未満は通常ルールで除外
            try:
                pv=int(str(x.get("価格","")).replace("万円","").replace(",",""))
                if 0<pv<5000: continue
            except: pass
            if u not in props: props[u]=(x,[])
            if aid not in props[u][1]: props[u][1].append(aid)
    except Exception as e:
        print("  fetch err:",name,str(e)[:50])
print(f"inai=7 ユニーク物件: {len(props)}件  hkensu上限到達エリア: {capped or 'なし'}")

# 3) Airtable既存URL全取得（fields絞り・ソートなし）
existing=set(); offset=None; pages=0
while True:
    p={"pageSize":100,"fields[]":"公開用URL"}
    if offset:p["offset"]=offset
    d=air(TBL,p); pages+=1
    for rec in d["records"]:
        u=rec["fields"].get("公開用URL")
        if u: existing.add(u)
    offset=d.get("offset")
    if not offset:break
print(f"Airtable既存URL: {len(existing)}件 ({pages}ページ)")

# 4) 未登録の集計
missing=[u for u in props if u not in existing]
kenri=Counter(); createable=0
for u in missing:
    d=props[u][0]
    k=d.get("土地権利") or "(空欄)"
    kenri[k]+=1
    if k=="(空欄)" or k=="所有権": createable+=1
print()
print("★★ DRY RUN 結果 ★★")
print(f"  Airtableに無い物件: {len(missing)}件")
print(f"  うち登録対象(所有権or空欄): {createable}件 / 土地権利で除外: {len(missing)-createable}件")
print(f"  未登録分の土地権利内訳: {dict(kenri)}")
# 保存(実行フェーズで使う)
json.dump({u:{"d":props[u][0],"areaIds":props[u][1]} for u in missing},
          open("/tmp/recover_candidates.json","w"), ensure_ascii=False)
print("  候補を /tmp/recover_candidates.json に保存（まだ何も書き込んでいません）")
