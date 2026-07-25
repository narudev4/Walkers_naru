# -*- coding: utf-8 -*-
# バックログ回収 実行: /tmp/recover_candidates.json の392件をREST APIで登録
import json, urllib.request, urllib.parse, time, unicodedata
PAT=open("/Users/naru/Walkers_naru/credentials/airtable-1lc-pat.txt").read().strip()
BASE="appksEWIuKl7N2ftS"; TBL="tbllNssTBXGexHysb"
H={"Authorization":"Bearer "+PAT,"Content-Type":"application/json"}

def num(v):
    if v is None: return None
    s=unicodedata.normalize("NFKC",str(v)).replace(",","").replace("%","").replace(" ","")
    if s=="": return None
    try:
        x=float(s)
        return x
    except: return None

def toMS(s):
    import re
    return [t.strip() for t in re.split(r'[、,／/]', s or '') if t.strip()]

cands=json.load(open("/tmp/recover_candidates.json"))
records=[]
skipped_kenri=0
for url,obj in cands.items():
    d=obj["d"]; areaIds=obj["areaIds"]
    kenri=d.get("土地権利") or None
    if kenri and kenri!="所有権":
        skipped_kenri+=1
        continue
    _p=num((d.get("価格") or "").replace("万円","").replace("万",""))
    f={
        "公開用URL": url,
        "画像": d.get("画像"), "所在地": d.get("所在地"),
        "沿線・駅": d.get("沿線・駅"), "バス・徒歩": d.get("バス・徒歩"),
        "価格": int(_p*10000) if _p is not None else None,
        "土地面積": num((d.get("土地面積") or "").replace("㎡","")),
        "建物面積": num((d.get("建物面積") or "").replace("㎡","")),
        "建物構造": toMS(d.get("建物構造")),
        "利回り": num((d.get("利回り") or "").replace("%","")),
        "種別": toMS(d.get("種別")),
        "築年": d.get("築年"),
        "土地権利": kenri,
        "エリア": areaIds,
    }
    for k in ["積算価格の妥当性","土地比率","建物比率"]:
        v=num(d.get(k))
        if v is not None: f[k]=v
    # None値のキーは送らない（RESTでは省略が安全）
    f={k:v for k,v in f.items() if v is not None and v!=[]}
    records.append({"fields":f})

print(f"登録対象: {len(records)}件（土地権利除外 {skipped_kenri}件）")

url_api=f"https://api.airtable.com/v0/{BASE}/{TBL}"
created=0; errors=[]
for i in range(0,len(records),10):
    batch=records[i:i+10]
    body=json.dumps({"records":batch,"typecast":True},ensure_ascii=False).encode()
    for attempt in range(5):
        try:
            req=urllib.request.Request(url_api,data=body,headers=H,method="POST")
            with urllib.request.urlopen(req,timeout=60) as r:
                res=json.loads(r.read())
                created+=len(res.get("records",[]))
            break
        except urllib.error.HTTPError as e:
            msg=e.read().decode()[:300]
            if e.code==429 or 500<=e.code<600:
                time.sleep(min(2**attempt,15)); continue
            errors.append((i,e.code,msg))
            print(f"  バッチ{i//10+1} HTTP {e.code}: {msg}")
            break
        except Exception as e:
            if attempt<4: time.sleep(min(2**attempt,15)); continue
            errors.append((i,"exc",str(e)[:200]))
            break
    time.sleep(0.25)
    if (i//10+1)%10==0: print(f"  進捗: {created}件作成済み")

print(f"\n★★ 完了: 作成 {created}件 / エラーバッチ {len(errors)}件 ★★")
for e in errors[:5]: print("  err:",e)
