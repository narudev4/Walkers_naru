# -*- coding: utf-8 -*-
"""Step2/Step3: 現行ロジック(実配信) vs 改善版ロジック(シミュレーション) の比較表を生成。
Airtable は GET のみ。チタンの公開ページは HTTP GET のみ（02_sweep.py と同じ判定）。
書き込みはローカルファイル（sweep_extra.json と 20_新旧比較.md）だけ。"""
import json, re, os, math, time, urllib.request, urllib.error
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor

DIR = os.path.dirname(os.path.abspath(__file__))
OUT_MD = os.path.abspath(f"{DIR}/../20_新旧比較.md")
EXTRA = f"{DIR}/sweep_extra.json"
NAN = float("nan")
CURRENT_YEAR = 2026
AREA_F = "市区町村（ref） (from 物件エリア（ref）)"
MARKER = "この物件は掲載を終了致しました"

MAP = {"budgetLower": "物件価格(下限)", "budgetUpper": "物件価格(上限)",
       "structures": "new構造", "kinds": "new種目",
       "profitLower": "利回り(下限)", "profitUpper": "利回り(上限)", "years": "築年月"}


def load(n):
    return json.load(open(f"{DIR}/{n}"))


def jnum(v):
    if v is None:
        return NAN
    if isinstance(v, (int, float)):
        return float(v)
    m = re.match(r"\s*[-+]?(\d+(\.\d*)?|\.\d+)", str(v))
    return float(m.group(0)) if m else NAN


def cell_str(v):
    if v is None:
        return ""
    if isinstance(v, list):
        return ", ".join(str(x) for x in v)
    return str(v)


props = load("records.json")
YS = load("year_seikei.json")
investors = load("investors.json")
hist_today = load("history_today.json")

P = []
for i, r in enumerate(props):
    y = YS.get(r["id"])
    yb = NAN
    if y:
        m = re.match(r"\d+", str(y))
        yb = float(m.group(0)) if m else NAN
    P.append({"idx": i, "id": r["id"], "kind": cell_str(r.get("kind")),
              "structure": cell_str(r.get("structure")), "profit": jnum(r.get("profit")),
              "price": jnum(r.get("price")),
              "age": (CURRENT_YEAR - yb) if not math.isnan(yb) else NAN,
              "addr": cell_str(r.get("addr")), "url": r.get("url") or "",
              "embed": cell_str(r.get("embed")), "updated": r.get("updated"),
              "created": r.get("created"), "soldflag": r.get("soldflag")})
BY_ID = {p["id"]: p for p in P}
P_NEW = sorted(P, key=lambda p: (p["created"] or "0000-00-00", p["idx"]), reverse=True)

HIST = defaultdict(set)
for h in load("history_all.json"):
    if (h.get("createdTime") or "").startswith("2026-07-25"):
        continue   # 今朝の配信そのものは「過去の紹介履歴」に含めない（同条件で比較するため）
    f = h["fields"]
    inv = (f.get("★個人投資家") or [None])[0]
    pr = (f.get("物件紹介_投資家") or [None])[0]
    if inv and pr and pr in BY_ID:
        HIST[inv].add(BY_ID[pr]["embed"])

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
PERMITTED = [r["id"] for r in investors if r["fields"].get("紹介許可")]


# ---------------- 掲載状態 ----------------
def load_status():
    st = {}
    try:
        st.update(load("sweep_result.json"))
    except Exception:
        pass
    if os.path.exists(EXTRA):
        st.update(json.load(open(EXTRA)))
    return st


STATUS = load_status()


def state(pid):
    s = STATUS.get(pid)
    if s in ("ended", "ended404"):
        return "ended"
    if s == "alive":
        return "alive"
    return "unknown"


def check_url(p):
    for attempt in range(2):
        try:
            req = urllib.request.Request(p["url"], headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
            with urllib.request.urlopen(req, timeout=25) as r:
                html = r.read().decode("euc_jp", errors="ignore")
            return p["id"], ("ended" if MARKER in html else "alive")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return p["id"], "ended404"
            if attempt == 0:
                time.sleep(1); continue
            return p["id"], f"http{e.code}"
        except Exception:
            if attempt == 0:
                time.sleep(1); continue
            return p["id"], "error"


def sweep(pids):
    """未判定のものだけチタンに GET して sweep_extra.json に保存（sweep_result.json は触らない）"""
    todo = [BY_ID[i] for i in pids if i in BY_ID and state(i) == "unknown" and BY_ID[i]["url"]]
    if not todo:
        return 0
    extra = json.load(open(EXTRA)) if os.path.exists(EXTRA) else {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for rid, s in ex.map(check_url, todo):
            extra[rid] = s
            STATUS[rid] = s
    json.dump(extra, open(EXTRA, "w"))
    return len(todo)


# ---------------- 条件判定 ----------------
def base_cond(p, f, relax, years_cmp):
    area = f.get(AREA_F) or []
    # area が空の場合、JS 側は new RegExp('^()') となり全物件マッチ（実配信で確認済み）
    if area and not re.match("^(" + "|".join(area) + ")", p["addr"]):
        return False
    kinds = f.get(MAP["kinds"]) or []
    structures = f.get(MAP["structures"]) or []
    if not relax or kinds:
        if not (p["kind"] in kinds or "こだわらない" in kinds):
            return False
    if not relax or structures:
        if not (p["structure"] in structures or "こだわらない" in structures):
            return False
    lim = {k: jnum(f.get(MAP[k])) for k in ("budgetLower", "budgetUpper", "profitLower", "profitUpper")}
    yrs = jnum(f.get(MAP["years"]))
    checks = [(p["price"], ">=", lim["budgetLower"]), (p["price"], "<=", lim["budgetUpper"]),
              (p["profit"], ">=", lim["profitLower"]), (p["profit"], "<=", lim["profitUpper"])]
    for a, op, b in checks:
        if math.isnan(b):
            if relax:
                continue        # 改善版: 条件なしとして扱う
            return False        # 現行: NaN比較で必ず不一致
        if math.isnan(a):
            return False
        if op == ">=" and not a >= b:
            return False
        if op == "<=" and not a <= b:
            return False
    if math.isnan(yrs):
        if not relax:
            return False
    else:
        if math.isnan(p["age"]):
            return False
        if years_cmp == ">" and not p["age"] > yrs:
            return False
        if years_cmp == "<" and not p["age"] < yrs:
            return False
    if not p["url"]:
        return False
    return True


def select_current(iid, n=5):
    f = INV[iid]
    out = []
    for p in P:
        if len(out) >= n:
            break
        if p["embed"] in HIST[iid]:
            continue
        if base_cond(p, f, False, ">"):
            out.append(p)
    return out


def select_improved(iid, n=5, years_cmp=">"):
    f = INV[iid]
    out = []
    for p in P_NEW:
        if len(out) >= n:
            break
        if p["embed"] in HIST[iid]:
            continue
        if state(p["id"]) == "ended":
            continue
        if p["soldflag"]:
            continue
        if base_cond(p, f, True, years_cmp):
            out.append(p)
    return out


# ---------------- 実行 ----------------
DELIVERED = [i for i in actual if i in INV]
print(f"今日配信された投資家 {len(DELIVERED)}人 / 紹介許可 {len(PERMITTED)}人")

print("現行の実配信物件の掲載状態を確認中...")
sweep([p for i in DELIVERED for p in actual[i]])

imp, imp_rev = {}, {}


def converge(cmp_op, label):
    sel = {}
    for rnd in range(30):
        sel = {i: select_improved(i, 5, cmp_op) for i in DELIVERED}
        ids = [p["id"] for v in sel.values() for p in v]
        n = sweep(ids)
        bad = sum(1 for x in ids if state(x) == "ended")
        if rnd % 5 == 0 or (n == 0 and bad == 0):
            print(f"  {label} round{rnd+1}: 新規判定 {n}件 / 選定内の掲載終了 {bad}件")
        if n == 0 and bad == 0:
            break
    return sel


imp = converge(">", "改善版")
imp_rev = converge("<", "改善版(築年逆)")

# 紹介許可 全員での 0件 集計
cur_all = {i: len(select_current(i, 5)) for i in PERMITTED}
imp_all = {i: len(select_improved(i, 5, ">")) for i in PERMITTED}
imprev_all = {i: len(select_improved(i, 5, "<")) for i in PERMITTED}
json.dump({"cur": cur_all, "imp": imp_all, "imprev": imprev_all},
          open(f"{DIR}/counts_all.json", "w"))

STATUS.update(load_status())   # 並走中の sweep の最新結果を取り込む


def stats(items):
    c = Counter(state(p if isinstance(p, str) else p["id"]) for p in items)
    tot = sum(c.values())
    judged = c["alive"] + c["ended"]
    return c, tot, judged


cur_items = [p for i in DELIVERED for p in actual[i]]
imp_items = [p["id"] for i in DELIVERED for p in imp[i]]
rev_items = [p["id"] for i in DELIVERED for p in imp_rev[i]]
json.dump({"delivered": {i: actual[i] for i in DELIVERED},
           "improved": {i: [p["id"] for p in imp[i]] for i in DELIVERED},
           "improved_rev": {i: [p["id"] for p in imp_rev[i]] for i in DELIVERED}},
          open(f"{DIR}/compare_sets.json", "w"))

MARK = {"alive": "✅掲載中", "ended": "❌掲載終了", "unknown": "⚠️未判定"}


def mask(nm):
    nm = (nm or "不明").replace("　", " ").strip()
    return nm[0] + "◯◯" if nm else "不明"


def yen(v):
    return "-" if math.isnan(v) else f"{v/10000:,.0f}万円"


def cond_line(f):
    area = f.get("エリア名 （ref）") or f.get(AREA_F) or []
    a = "/".join(area[:2]) + ("…" if len(area) > 2 else "")
    def num(k, unit="", div=1):
        v = jnum(f.get(MAP[k]))
        return "指定なし" if math.isnan(v) else f"{v/div:,.0f}{unit}"
    yrs = jnum(f.get(MAP["years"]))
    ystr = ("指定なし" if math.isnan(yrs) else
            ("こだわらない扱い(-1)" if yrs < 0 else
             ("9999（実質全除外）" if yrs >= 9999 else f"築{yrs:.0f}年より古い")))
    return (f"エリア: {a} / 種目: {', '.join(f.get('new種目') or ['—'])} / "
            f"構造: {', '.join(f.get('new構造') or ['—'])} / "
            f"価格: {num('budgetLower','万円',10000)}〜{num('budgetUpper','万円',10000)} / "
            f"利回り: {num('profitLower','%')}〜{num('profitUpper','%')} / 築年: {ystr}")


def rows(ids_or_ps):
    out = []
    for x in ids_or_ps:
        pid = x if isinstance(x, str) else x["id"]
        p = BY_ID.get(pid)
        if p is None:
            out.append("| (物件データ取得不可) | - | - | - | ⚠️未判定 |")
            continue
        pr = "-" if math.isnan(p["profit"]) else f"{p['profit']:.2f}%"
        out.append(f"| {p['addr']} | {yen(p['price'])} | {pr} | "
                   f"{p['created'] or '-'} | {MARK[state(pid)]} |")
    return out


c_cur, t_cur, j_cur = stats(cur_items)
c_imp, t_imp, j_imp = stats(imp_items)
c_rev, t_rev, j_rev = stats(rev_items)

zero_cur = [i for i, v in cur_all.items() if v == 0]
zero_imp = [i for i, v in imp_all.items() if v == 0]
zero_rev = [i for i, v in imprev_all.items() if v == 0]
imp_zero_delivered = [i for i in DELIVERED if len(imp[i]) == 0]

L = []
w = L.append

# ---- 補助的な数字 ----
def med_date(items, key="updated"):
    ds = sorted([BY_ID[x]["created" if key == "created" else "updated"]
                 for x in items if x in BY_ID and BY_ID[x].get(key)])
    return ds[len(ds)//2] if ds else "-"


all_st = Counter(load_status().values())
judged_all = all_st["alive"] + all_st["ended"] + all_st["ended404"]
ended_all = all_st["ended"] + all_st["ended404"]
y9999 = [i for i in PERMITTED if jnum(INV[i].get(MAP["years"])) >= 9999]
y9999_zero = [i for i in y9999 if cur_all.get(i, 0) == 0]
nonum = [i for i in PERMITTED
         if any(math.isnan(jnum(INV[i].get(MAP[k])))
                for k in ("budgetLower", "budgetUpper", "profitLower", "profitUpper"))]
nonum_zero = [i for i in nonum if cur_all.get(i, 0) == 0]
rev_zero_delivered = [i for i in DELIVERED if len(imp_rev[i]) == 0]

w("# 物件マッチング 現行 vs 改善版 比較（2026-07-25）\n")
w("## 0. これは何か / どう読むか\n")
w("毎朝9時、Airtable が個人投資家ごとに物件を5件選んでメール配信している。その「選び方」を")
w("変えると配信内容がどう変わるかを、**今朝の実データ**で並べたもの。\n")
w("- **掲載状態は推測ではなく実測**。チタン（1lcinc.com）の物件ページを1件ずつ開いて確認した。")
w("  「❌掲載終了」= ページに「この物件は掲載を終了致しました」と表示される、または404。")
w("- 「現行」列は**今朝ほんとうに送られた物件そのもの**（紹介履歴テーブルから取得）。")
w("- 「改善版」列は、同じ投資家・同じ物件データで新ロジックを走らせたシミュレーション。")
w("- 現行ロジックを Python で再実装したところ、今朝の配信 **85人・401件を100%（401/401）再現**できた。")
w("  つまりシミュレータの挙動は本番と一致していることが確認済み。\n")

w("## 1. サマリ（ここだけ読めば判断できる）\n")
w("| | 配信件数 | ✅掲載中 | ❌掲載終了 | ⚠️未判定 | 掲載終了率(判定済のみ) |")
w("|---|---|---|---|---|---|")
for label, c, t, j in (("**現行（今朝の実配信）**", c_cur, t_cur, j_cur),
                       ("**改善版**", c_imp, t_imp, j_imp),
                       ("改善版（築年の不等号を逆にした場合）", c_rev, t_rev, j_rev)):
    rate = f"**{c['ended']/j*100:.1f}%**" if j else "—"
    w(f"| {label} | {t}件 | {c['alive']}件 | {c['ended']}件 | {c['unknown']}件 | {rate} |")
w("")
w(f"- 対象は今朝実際に配信された **{len(DELIVERED)}人**（紹介許可ONは{len(PERMITTED)}人）。")
w(f"- **現行は送った{t_cur}件のうち{c_cur['ended']}件（{c_cur['ended']/j_cur*100:.0f}%）が既に掲載終了**。")
w(f"  改善版は{t_imp}件のうち{c_imp['ended']}件（{c_imp['ended']/j_imp*100:.1f}%）。")
w(f"- 改善版で配信0件になる投資家: **{len(imp_zero_delivered)}人**"
  f"（今朝配信された{len(DELIVERED)}人のうち）。"
  + ("該当者は「条件に合う掲載中の物件が本当に1件も無い」ケース"
     "（今回の1人は、希望条件に合う物件が全25,739件中1件だけで、それが掲載終了だった）。"
     if imp_zero_delivered else ""))
w(f"- 選ばれた物件の新しさ（サイト登録日の中央値）: 現行 **{med_date(cur_items, 'created')}** → "
  f"改善版 **{med_date(imp_items, 'created')}**")
w(f"- 紹介許可ON {len(PERMITTED)}人で見た「1件も選べない人」: "
  f"現行 {len(zero_cur)}人 → 改善版 {len(zero_imp)}人（築年の不等号を逆にすると {len(zero_rev)}人）")
w("")

w("### 改善版で変えたのはこの4点だけ\n")
w("マッチング条件（エリア・種目・構造・価格・利回り・築年・URL有無・過去紹介済みの除外）は")
w("**現行とまったく同じ**。変えたのは選び方の周辺だけ。\n")
w("1. 物件を探す順番を「レコードID順（＝実質ランダムな固定順）」から**新規登録日の新しい順**に変更")
w("2. **掲載終了と判定された物件を除外**（チタンのページを実際に見て判定）")
w("3. 「過去紹介済｜成約済」フラグが立っている物件を除外")
w("4. 希望条件の数値が空欄・「こだわらない」の場合は**その条件を無視**（現行は空欄だと全物件が不一致になる）\n")

w("## 2. なぜ現行はこうなるのか（原因と規模）\n")
w(f"1. **掲載終了を見ていない**。物件テーブル自体が古く、判定済み{judged_all:,}件のうち")
w(f"   **{ended_all:,}件（{ended_all/judged_all*100:.0f}%）が既に掲載終了**。")
w("   何も対策しなければ配信の半分近くが死んだ物件になるのは当然の結果。")
w("2. **走査順が「レコードID昇順」で固定**。これは物件の新しさとも古さとも無関係な並び順で、")
w("   毎朝この順で先頭から探して5件で打ち切るため、**毎日ほぼ同じ顔ぶれ（＝長く残っている＝")
w("   売れた可能性が高い物件）が上位に来る**。改善版は新規登録日の新しい順に変えた。")
w(f"3. **希望条件の空欄が「全部不一致」になる**。価格・利回りの上下限のどれかが空欄の投資家は")
w(f"   {len(nonum)}人いて、うち{len(nonum_zero)}人は現行ロジックで永久に0件になる"
  "（空欄→数値比較が成立せず全条件不成立）。")
w(f"4. **築年の希望値が 9999 の投資家が {len(y9999)}人**（新しい入力フォームが「こだわらない」を")
w(f"   9999 で書き込むのに、現行の条件式は「築年数 > 9999」を要求する）。")
w(f"   このうち{len(y9999_zero)}人は**何をしても1件も選ばれない**。旧フォームは同じ意味で -1 を入れており、")
w("   そちらは正しく「全物件OK」になる。数字ひとつで結果が真逆になっている。\n")

w("### 補足: Airtable の「更新日」は鮮度の判断に使えない\n")
w("今朝配信された物件289件（実配信401件のユニーク数）は、**全件が「更新日 = 2026-07-25」**になっている。")
w("Airtable 上で今日更新された物件も同じ289件で完全一致した。つまり")
w("**メール配信して紹介履歴を作った副作用で、その物件の更新日が今日に書き換わっている**。")
w("「更新日が新しいから生きている物件」という判断はできない（今朝送った掲載終了物件も更新日は今日）。")
w("そのため本比較表の日付列には、サイトに物件が載った日である「新規登録日」を使っている。\n")

w("## 3. 投資家ごとの比較（掲載終了が多かった順に10人）\n")
w("氏名は姓の一文字＋◯◯で伏せてある。\n")
show = sorted(DELIVERED, key=lambda i: -sum(1 for p in actual[i] if state(p) == "ended"))[:10]
for n, i in enumerate(show, 1):
    f = INV[i]
    w(f"### {n}. {mask(f.get('氏名'))} さん\n")
    w(f"希望条件: {cond_line(f)}\n")
    ne = sum(1 for p in actual[i] if state(p) == "ended")
    w(f"**現行（今朝ほんとうに送られた5件）** — うち掲載終了 {ne}件\n")
    w("| 所在地 | 価格 | 利回り | 登録日 | 掲載状態 |")
    w("|---|---|---|---|---|")
    L.extend(rows(actual[i]))
    w("")
    ne2 = sum(1 for p in imp[i] if state(p["id"]) == "ended")
    w(f"**改善版（新しい物件から探す＋掲載終了を除外）** — うち掲載終了 {ne2}件\n")
    w("| 所在地 | 価格 | 利回り | 登録日 | 掲載状態 |")
    w("|---|---|---|---|---|")
    if imp[i]:
        L.extend(rows(imp[i]))
    else:
        w("| （条件に合う掲載中の物件が0件だった） | - | - | - | - |")
    w("")

w("## 4. 築年の不等号を逆にした場合（仕様が未確定なので両方出す）\n")
w("現行の条件式は「物件の築年数 **>** 投資家の希望値」。素直に読むと")
w("「希望より古い物件だけ送る」という意味になり、日本語の希望（築○年以内）とは逆。")
w("そこで不等号を逆（築年数 **<** 希望値）にした場合も出した。\n")
diff_people = [i for i in DELIVERED if set(p["id"] for p in imp[i]) != set(p["id"] for p in imp_rev[i])]
swap = sum(1 for a, b in zip(imp_items, rev_items) if a != b)
w(f"- 改善版の配信内容が変わる投資家: **{len(diff_people)}人 / {len(DELIVERED)}人**"
  f"（物件単位では{swap}件が入れ替わる。改善版{t_imp}件 → 逆{t_rev}件）")
w(f"- 今朝配信された{len(DELIVERED)}人のうち、逆にすると配信0件になる人: **{len(rev_zero_delivered)}人**")
w(f"  （現行の書き方のままなら {len(imp_zero_delivered)}人）。")
w("  理由: 旧フォームの「こだわらない = -1」が、逆にすると「築年数 < -1」＝全物件アウトになるため。")
w(f"- 紹介許可ON {len(PERMITTED)}人で見た0件の人: 改善版 {len(zero_imp)}人 → 逆にすると {len(zero_rev)}人")
w(f"  （9999 の{len(y9999)}人が救われる一方で、-1 の人が全滅する）")
w("- **結論として、不等号を逆にするだけでは解決しない。「こだわらない」を数値の魔法（-1 / 9999）で")
w("  表さず、明示的に『指定なし』として扱うのが正しい直し方**。\n")
for i in diff_people[:2]:
    f = INV[i]
    w(f"**例: {mask(f.get('氏名'))} さん**（{cond_line(f)}）\n")
    w("| ロジック | 所在地 | 価格 | 利回り | 登録日 | 掲載状態 |")
    w("|---|---|---|---|---|---|")
    for p in imp[i]:
        w("| 改善版（築年>） " + rows([p])[0])
    if not imp[i]:
        w("| 改善版（築年>） | （0件） | - | - | - | - |")
    for p in imp_rev[i]:
        w("| 逆（築年<） " + rows([p])[0])
    if not imp_rev[i]:
        w("| 逆（築年<） | （0件） | - | - | - | - |")
    w("")

w("## 5. 注意点（この表の限界）\n")
w(f"- **未判定（⚠️）の扱い**: 物件ページの読み取りが500エラー等で確定できなかったものは")
w(f"  「未判定」とし、掲載終了率の分母から外している（現行側{c_cur['unknown']}件 / 改善版{c_imp['unknown']}件）。")
w("- **改善版は「選んだ5件をその場で実チェックして掲載中のものだけ残した」結果**。")
w("  本番で同じ品質を出すには、毎朝の配信前に掲載終了チェック（今回作ったのと同じ仕組み）を回す必要がある。")
w("- **物件データは今日19時台に取得したもの**。今朝9時時点と価格・利回りが変わっている物件が")
w("  数件あり、その分だけ現行側の再現に誤差が出る可能性がある（今朝の配信は401/401一致したので実害なし）。")
w(f"- **「成約済」フラグはほぼ機能していない**。物件{len(P):,}件のうちフラグが立っているのは"
  f"{sum(1 for p in P if p['soldflag'])}件だけで、除外条件としては効果がない。")
w("- **今朝の配信は9:04〜14:12（JST）にわたって発生**しており、9時に一斉配信されていない。")
w(f"  また紹介許可ONの{len(PERMITTED)}人に対し履歴が残ったのは{len(DELIVERED)}人分だけで、")
w("  残りが「条件に合う物件が無かった」のか「処理が途中で止まった/履歴作成が失敗した」のかは")
w("  この表では判別できない（別途調査が必要）。")
w("- 氏名は伏せているが、社内テスト用アカウント（ワンエルシーテスト等）も配信対象に混ざっている。\n")

open(OUT_MD, "w").write("\n".join(L))
print("\n出力:", OUT_MD)
print("現行:", dict(c_cur), "改善版:", dict(c_imp), "逆:", dict(c_rev))
print("改善版で0件:", len(imp_zero_delivered), "逆で0件:", len(rev_zero_delivered))
print("紹介許可全体 0件:", len(zero_cur), "->", len(zero_imp), "逆", len(zero_rev))
print("9999問題:", len(y9999), "人 / うち0件", len(y9999_zero))
