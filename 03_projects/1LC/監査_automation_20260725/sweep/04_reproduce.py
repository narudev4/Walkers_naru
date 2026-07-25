# -*- coding: utf-8 -*-
"""Step1: 02a_物件データのマッチング.js を Python で忠実再現し、
今日実際に配信された内容とどれだけ一致するか検証する（GETのみ・書き込み無し）"""
import json, re, os, math, itertools
from collections import defaultdict

DIR = os.path.dirname(os.path.abspath(__file__))
NAN = float("nan")
CURRENT_YEAR = 2026


def load(name):
    return json.load(open(f"{DIR}/{name}"))


props = load("records.json")          # 全物件（REST既定順 = レコードID昇順）
investors = load("investors.json")    # 希望条件
hist_today = load("history_today.json")


# ---------- 物件側の値を 02a と同じ型に整える ----------
def jnum(v):
    """JS parseFloat 相当。数値化できなければ NaN"""
    if v is None:
        return NAN
    if isinstance(v, (int, float)):
        return float(v)
    m = re.match(r"\s*[-+]?(\d+(\.\d*)?|\.\d+)", str(v))
    return float(m.group(0)) if m else NAN


def cell_str(v):
    """getCellValueAsString 相当（multiple select は ', ' 連結）"""
    if v is None:
        return ""
    if isinstance(v, list):
        return ", ".join(str(x) for x in v)
    return str(v)


YEAR_SEIKEI = load("year_seikei.json")   # 02a が読むのは「築年(整形)」

P = []
for i, r in enumerate(props):
    year = YEAR_SEIKEI.get(r["id"])
    yb = NAN
    if year:
        m = re.match(r"\d+", str(year))
        yb = float(m.group(0)) if m else NAN
    P.append({
        "idx": i,
        "id": r["id"],
        "kind": cell_str(r.get("kind")),
        "structure": cell_str(r.get("structure")),
        "profit": jnum(r.get("profit")),
        "price": jnum(r.get("price")),
        "age": (CURRENT_YEAR - yb) if not math.isnan(yb) else NAN,
        "addr": cell_str(r.get("addr")),
        "url": r.get("url") or "",
        "embed": cell_str(r.get("embed")),
        "updated": r.get("updated"),
        "created": r.get("created"),
        "soldflag": r.get("soldflag"),
    })
BY_ID = {p["id"]: p for p in P}

# ---------- 今日の実配信 ----------
actual = defaultdict(list)
for h in hist_today:
    f = h["fields"]
    inv = (f.get("★個人投資家") or [None])[0]
    pr = (f.get("物件紹介_投資家") or [None])[0]
    if inv and pr:
        actual[inv].append((h.get("createdTime"), pr))
for k in actual:
    actual[k] = [p for _, p in sorted(actual[k])]

INV = {r["id"]: r["fields"] for r in investors}

AREA_F = "市区町村（ref） (from 物件エリア（ref）)"

# ---------- 候補マッピング ----------
CAND = {
    "budgetLower": ["物件価格(下限)", "予算（下限・正式）"],
    "budgetUpper": ["物件価格(上限)", "予算（上限・正式）"],
    "structures": ["new構造", "構造"],
    "kinds": ["new種目"],
    "yearsCmp": [">", "<"],
    "history": [False, True],
}


def cond(p, f, m, ignore_history=False):
    """02a の7条件AND。True/False を返す（例外は False 扱い）"""
    try:
        area = f.get(AREA_F) or []
        # area が空 → JS 側は new RegExp('^()') となり全物件マッチ（実配信でも確認済み）
        pat = re.compile("^(" + "|".join(area) + ")") if area else None
        kinds = f.get(m["kinds"]) or []
        structures = f.get(m["structures"]) or []
        bl = jnum(f.get(m["budgetLower"]))
        bu = jnum(f.get(m["budgetUpper"]))
        pl = jnum(f.get("利回り(下限)"))
        pu = jnum(f.get("利回り(上限)"))
        yrs = jnum(f.get("築年月"))

        if not ignore_history and m["history"]:
            if p["embed"] in HIST_EMBED.get(f["レコードID"], set()):
                return False
        if pat is not None and not pat.match(p["addr"]):
            return False
        if not (p["kind"] in kinds or "こだわらない" in kinds):
            return False
        if not (p["structure"] in structures or "こだわらない" in structures):
            return False
        for a, op, b in ((p["price"], ">=", bl), (p["price"], "<=", bu),
                         (p["profit"], ">=", pl), (p["profit"], "<=", pu)):
            if math.isnan(a) or math.isnan(b):
                return False
            if op == ">=" and not a >= b:
                return False
            if op == "<=" and not a <= b:
                return False
        if math.isnan(p["age"]) or math.isnan(yrs):
            return False
        if m["yearsCmp"] == ">" and not p["age"] > yrs:
            return False
        if m["yearsCmp"] == "<" and not p["age"] < yrs:
            return False
        if not p["url"]:
            return False
        return True
    except Exception:
        return False


# ---------- 過去（今日より前）の紹介履歴 → メール埋め込み文字列の集合 ----------
HIST_EMBED = defaultdict(set)
for h in load("history_all.json"):
    if (h.get("createdTime") or "").startswith("2026-07-25"):
        continue
    f = h["fields"]
    inv = (f.get("★個人投資家") or [None])[0]
    pr = (f.get("物件紹介_投資家") or [None])[0]
    if inv and pr and pr in BY_ID:
        HIST_EMBED[inv].add(BY_ID[pr]["embed"])

# ---------- Stage A: 実配信された物件が条件を満たすマッピングを探す ----------
targets = [i for i in actual if i in INV]
print(f"今日配信された投資家: {len(actual)}人（希望条件テーブルに存在: {len(targets)}人）")

results = []
for bl, bu, st, yc in itertools.product(CAND["budgetLower"], CAND["budgetUpper"],
                                        CAND["structures"], CAND["yearsCmp"]):
    m = {"budgetLower": bl, "budgetUpper": bu, "structures": st,
         "kinds": "new種目", "yearsCmp": yc, "history": True}
    ok_inv = 0
    ok_prop = tot_prop = 0
    for iid in targets:
        f = INV[iid]
        deliv = [BY_ID[x] for x in actual[iid] if x in BY_ID]
        if not deliv:
            continue
        r = [cond(p, f, m) for p in deliv]
        ok_prop += sum(1 for x in r if x is True)
        tot_prop += len(r)
        if all(x is True for x in r):
            ok_inv += 1
    results.append((ok_prop / tot_prop if tot_prop else 0, ok_inv, tot_prop, m))

results.sort(reverse=True, key=lambda x: x[0])
print("\n=== Stage A: 実配信物件が条件を満たす率 ===")
for rate, ok_inv, tot, m in results:
    print(f"  {rate*100:5.1f}%  全5件一致投資家={ok_inv:3d}  "
          f"下限={m['budgetLower']} 上限={m['budgetUpper']} 構造={m['structures']} 築年{m['yearsCmp']}")

BEST = results[0][3]
print("\n最有力マッピング:", BEST)

# ---------- Stage B: 走査順の検証 ----------
def match_first_n(f, m, order, n=5, exclude=None):
    out = []
    for p in order:
        if len(out) >= n:
            break
        if exclude and exclude(p):
            continue
        if cond(p, f, m) is True:
            out.append(p)
    return out


ORDERS = {
    "id昇順(RESTの既定順)": P,
    "新規登録日 昇順": sorted(P, key=lambda p: (p["created"] or "9999", p["idx"])),
    "新規登録日 降順": sorted(P, key=lambda p: (p["created"] or "0000", p["idx"]), reverse=True),
    "更新日 昇順": sorted(P, key=lambda p: (p["updated"] or "9999", p["idx"])),
}

print("\n=== Stage B: 走査順ごとの再現率（最有力マッピング）===")
best_order = None
for oname, order in ORDERS.items():
    exact = partial = 0
    inter = tot = 0
    for iid in targets:
        f = INV[iid]
        act = set(actual[iid])
        rep = set(p["id"] for p in match_first_n(f, BEST, order, len(actual[iid])))
        inter += len(act & rep)
        tot += len(act)
        if act == rep:
            exact += 1
        elif act & rep:
            partial += 1
    print(f"  {oname}: 完全一致 {exact}/{len(targets)}人, 部分一致 {partial}人, "
          f"物件単位 {inter}/{tot} ({inter/tot*100:.1f}%)")
    if best_order is None or inter > best_order[1]:
        best_order = (oname, inter)
print("\n最有力の走査順:", best_order[0])

json.dump({"mapping": BEST, "order": best_order[0]},
          open(f"{DIR}/step1_mapping.json", "w"), ensure_ascii=False, indent=1)
