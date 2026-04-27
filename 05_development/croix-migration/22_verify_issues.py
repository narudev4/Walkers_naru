#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
issue_index.csv の各指摘を verify_snapshots/{No}.json と
verify_snapshots_orig/{No}.json を突き合わせて判定する。

出力: output/verify_report.csv
  No, slug, source, category, subcategory, status, evidence, text
  status: PASS / FAIL / MANUAL / NO_DATA

判定ロジック:
  - C_メディア 画像非表示: STG images[*].broken が全て false なら PASS
  - A_CSS youtube-iframe-size: STG iframe.clientWidth >= 400 なら PASS
  - A_CSS align/position (class別): alignleft→float:left 等が全件正なら PASS
  - A_CSS font-color/weight: ORIG と STG の text_blocks をマッチして
       ペアの font-weight/color 差分が閾値内なら PASS, 外れたら FAIL
  - A_CSS font-size差異: 同上で font-size のペア差分が ±1px 以内なら PASS
  - A_CSS align/position (ORIG比較): text-align / float / margin-left/right のペア差分
  - A_CSS margin過大: text_blocks の margin-top/bottom のペア差分が +8px 以上なら FAIL
  - A_CSS 画像サイズ: match_images でペア抽出、width 差 ±20px 以内なら PASS
  - B_本文: MANUAL (WP admin 手動編集要)
  - D_原本由来: MANUAL
  - X_要目視: MANUAL
"""
import csv
import difflib
import json
import re
from pathlib import Path

BASE = Path(__file__).parent
ISSUES = BASE / "output" / "issue_index.csv"
SNAPSHOTS = BASE / "output" / "verify_snapshots"
SNAPSHOTS_ORIG = BASE / "output" / "verify_snapshots_orig"
OUT = BASE / "output" / "verify_report.csv"


# ---------------- snapshot loaders ----------------

def load_snapshot(no: str, orig: bool = False):
    p = (SNAPSHOTS_ORIG if orig else SNAPSHOTS) / f"{no}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


# ---------------- css parsers ----------------

_RGB_RE = re.compile(r"rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)", re.I)


def parse_rgb(s: str):
    """'rgb(51, 51, 51)' / 'rgba(0,0,0,0.87)' → (r,g,b,a) floats"""
    if not s:
        return None
    m = _RGB_RE.search(s)
    if not m:
        return None
    r = float(m.group(1))
    g = float(m.group(2))
    b = float(m.group(3))
    a = float(m.group(4)) if m.group(4) else 1.0
    return (r, g, b, a)


def color_close(a: str, b: str, rgb_tol=10, alpha_tol=0.1):
    ca, cb = parse_rgb(a), parse_rgb(b)
    if ca is None or cb is None:
        return None  # 不明扱い
    if any(abs(ca[i] - cb[i]) > rgb_tol for i in range(3)):
        return False
    if abs(ca[3] - cb[3]) > alpha_tol:
        return False
    return True


def font_weight_norm(w: str) -> int:
    """'bold'→700, 'normal'→400, '600'→600"""
    if not w:
        return 400
    w = str(w).strip().lower()
    if w == "bold":
        return 700
    if w in ("normal", ""):
        return 400
    if w == "lighter":
        return 200
    if w == "bolder":
        return 800
    try:
        return int(float(w))
    except ValueError:
        return 400


def px_of(s: str):
    """'16px' → 16.0, '' → None"""
    if not s:
        return None
    m = re.match(r"([\d.]+)", str(s))
    return float(m.group(1)) if m else None


# ---------------- matching ----------------

def _norm_text(t: str) -> str:
    if not t:
        return ""
    return re.sub(r"\s+", "", t)


def match_text_blocks(orig_blocks, stg_blocks):
    """orig と stg の text_blocks を text_head の先頭で照合し、ペアを返す。

    1) 先頭40文字の正規化文字列で完全一致
    2) 残余を difflib.ratio >= 0.75 のファジーマッチ

    Returns: list of (orig_block, stg_block) pairs, plus coverage ratio.
    """
    orig_idx = [(i, _norm_text(b.get("text_head", ""))[:40]) for i, b in enumerate(orig_blocks)]
    stg_idx = [(i, _norm_text(b.get("text_head", ""))[:40]) for i, b in enumerate(stg_blocks)]

    pairs = []
    used_stg = set()
    unmatched_orig = []

    # pass1: 先頭40文字完全一致
    for i, oh in orig_idx:
        if not oh:
            continue
        found = None
        for j, sh in stg_idx:
            if j in used_stg:
                continue
            if sh and sh == oh:
                found = j
                break
        if found is not None:
            pairs.append((orig_blocks[i], stg_blocks[found]))
            used_stg.add(found)
        else:
            unmatched_orig.append(i)

    # pass2: fuzzy
    for i in unmatched_orig:
        oh = orig_idx[i][1]
        if not oh:
            continue
        best_j, best_ratio = None, 0.0
        for j, sh in stg_idx:
            if j in used_stg or not sh:
                continue
            r = difflib.SequenceMatcher(None, oh, sh).ratio()
            if r > best_ratio:
                best_ratio = r
                best_j = j
        if best_j is not None and best_ratio >= 0.75:
            pairs.append((orig_blocks[i], stg_blocks[best_j]))
            used_stg.add(best_j)

    coverage = len(pairs) / max(1, len([o for o in orig_idx if o[1]]))
    return pairs, coverage


def match_images(orig_imgs, stg_imgs):
    """画像を src のファイル名（末尾セグメント）で照合。無ければ順序で対応。"""
    def fname(s):
        if not s:
            return ""
        s = s.split("?", 1)[0]
        return s.rsplit("/", 1)[-1].lower()

    stg_by_fn = {}
    for j, im in enumerate(stg_imgs):
        stg_by_fn.setdefault(fname(im.get("src", "")), []).append(j)

    pairs = []
    used_stg = set()
    unmatched_orig = []
    for i, oi in enumerate(orig_imgs):
        fn = fname(oi.get("src", ""))
        if fn and fn in stg_by_fn:
            for j in stg_by_fn[fn]:
                if j not in used_stg:
                    pairs.append((oi, stg_imgs[j]))
                    used_stg.add(j)
                    break
            else:
                unmatched_orig.append(i)
        else:
            unmatched_orig.append(i)

    # 残余は出現順で対応
    stg_remain = [j for j in range(len(stg_imgs)) if j not in used_stg]
    for i, j in zip(unmatched_orig, stg_remain):
        pairs.append((orig_imgs[i], stg_imgs[j]))

    coverage = len(pairs) / max(1, len(orig_imgs))
    return pairs, coverage


# ---------------- check functions ----------------

def _block_color(b):
    """text_block の色：優先 span_color → color"""
    return b.get("span_color") or b.get("color") or ""


def _block_weight(b):
    w = b.get("span_font_weight") or b.get("font-weight") or ""
    return font_weight_norm(w)


def _block_size(b):
    return px_of(b.get("span_font_size") or b.get("font-size"))


def check_font_color_weight(orig_snap, stg_snap):
    """文字色/太さ差。ORIGペア毎に 色≠ or 太さ差>=100 なら NG として集計。"""
    pairs, cov = match_text_blocks(orig_snap.get("text_blocks", []), stg_snap.get("text_blocks", []))
    if cov < 0.5:
        return ("MANUAL", f"pair_coverage={cov:.0%} (判定不足)")
    bad = []
    for o, s in pairs:
        oc, sc = _block_color(o), _block_color(s)
        close = color_close(oc, sc)
        if close is False:
            bad.append(f"color: orig={oc} stg={sc} @ {o.get('text_head','')[:20]}")
        ow, sw = _block_weight(o), _block_weight(s)
        if abs(ow - sw) >= 100:
            bad.append(f"weight: orig={ow} stg={sw} @ {o.get('text_head','')[:20]}")
    if not bad:
        return ("PASS", f"{len(pairs)}ペア中 色/太さ差なし")
    return ("FAIL", f"{len(bad)}件 NG: {'; '.join(bad[:2])}")


def check_font_size(orig_snap, stg_snap):
    pairs, cov = match_text_blocks(orig_snap.get("text_blocks", []), stg_snap.get("text_blocks", []))
    if cov < 0.5:
        return ("MANUAL", f"pair_coverage={cov:.0%}")
    bad = []
    for o, s in pairs:
        os_, ss = _block_size(o), _block_size(s)
        if os_ is None or ss is None:
            continue
        if abs(os_ - ss) > 1.0:
            bad.append(f"orig={os_}px stg={ss}px @ {o.get('text_head','')[:20]}")
    if not bad:
        return ("PASS", f"{len(pairs)}ペア中 font-size差±1px以内")
    return ("FAIL", f"{len(bad)}件 NG: {'; '.join(bad[:2])}")


def check_align_position_orig(orig_snap, stg_snap):
    """text_blocks の text-align とイメージの float / margin のペア差分を見る。"""
    pairs, cov = match_text_blocks(orig_snap.get("text_blocks", []), stg_snap.get("text_blocks", []))
    bad = []
    for o, s in pairs:
        oa, sa = (o.get("text-align") or "").strip(), (s.get("text-align") or "").strip()
        if oa and sa and oa != sa:
            # start は left とほぼ同義とみなす
            if {oa, sa} <= {"start", "left"} or {oa, sa} <= {"end", "right"}:
                continue
            bad.append(f"text-align: orig={oa} stg={sa} @ {o.get('text_head','')[:20]}")

    # 画像のalignクラス差
    ipairs, icov = match_images(orig_snap.get("images", []), stg_snap.get("images", []))
    for oi, si in ipairs:
        ocls = oi.get("className", "")
        scls = si.get("className", "")
        for k in ("alignleft", "alignright", "aligncenter"):
            if (k in ocls) != (k in scls):
                bad.append(f"img class: orig={ocls} stg={scls}")
                break

    if cov < 0.5 and icov < 0.5:
        return ("MANUAL", f"pair_coverage text={cov:.0%} img={icov:.0%}")
    if not bad:
        return ("PASS", f"text={len(pairs)}pair img={len(ipairs)}pair 位置差なし")
    return ("FAIL", f"{len(bad)}件 NG: {'; '.join(bad[:2])}")


def check_margin(orig_snap, stg_snap):
    """text_blocks の margin-top/bottom のペア差分が +8px 以上あれば FAIL。"""
    pairs, cov = match_text_blocks(orig_snap.get("text_blocks", []), stg_snap.get("text_blocks", []))
    if cov < 0.5:
        return ("MANUAL", f"pair_coverage={cov:.0%}")
    bad = []
    for o, s in pairs:
        for key in ("margin-top", "margin-bottom"):
            op, sp = px_of(o.get(key)), px_of(s.get(key))
            if op is None or sp is None:
                continue
            if sp - op >= 8.0:
                bad.append(f"{key}: orig={op}px stg={sp}px @ {o.get('text_head','')[:20]}")
    if not bad:
        return ("PASS", f"{len(pairs)}ペア中 margin差+8px未満")
    return ("FAIL", f"{len(bad)}件 NG: {'; '.join(bad[:2])}")


def check_image_size(orig_snap, stg_snap):
    pairs, cov = match_images(orig_snap.get("images", []), stg_snap.get("images", []))
    if cov < 0.5:
        return ("MANUAL", f"img coverage={cov:.0%}")
    bad = []
    for o, s in pairs:
        ow, sw = o.get("clientWidth"), s.get("clientWidth")
        if ow is None or sw is None:
            continue
        if abs(sw - ow) > 20:
            bad.append(f"orig={ow}px stg={sw}px src={(s.get('src') or '')[-40:]}")
    if not bad:
        return ("PASS", f"{len(pairs)}画像 width差±20px以内")
    return ("FAIL", f"{len(bad)}件 NG: {'; '.join(bad[:2])}")


# ---------------- existing simple checks ----------------

def check_broken_images(snap):
    imgs = snap.get("images", [])
    broken = [im for im in imgs if im.get("broken")]
    return (len(broken), len(imgs), broken)


def check_iframe_size(snap):
    iframes = snap.get("iframes", [])
    small = [f for f in iframes if f.get("clientWidth", 0) < 400]
    return (len(small), len(iframes), small)


def check_aligns_class(snap):
    """alignleft/right/center の float/display を検証。"""
    aligns = snap.get("aligns", [])
    bad = []
    for a in aligns:
        cls = a.get("className", "")
        flt = a.get("float", "")
        disp = a.get("display", "")
        if "alignleft" in cls and flt != "left":
            bad.append(f"alignleft float={flt}")
        elif "alignright" in cls and flt != "right":
            bad.append(f"alignright float={flt}")
        elif "aligncenter" in cls and "block" not in disp and disp != "table":
            bad.append(f"aligncenter display={disp}")
    return (len(bad), len(aligns), bad)


# ---------------- dispatch ----------------

def verify(row, snap, orig_snap):
    cat = row["category"]
    sub = row["subcategory"]

    if snap is None:
        return ("NO_DATA", "STGスナップショットなし")

    # --- C: 画像非表示 ---
    if cat == "C_メディア" and sub == "画像非表示":
        broken_cnt, total, broken = check_broken_images(snap)
        if broken_cnt == 0:
            return ("PASS", f"全{total}枚の画像がロード成功")
        srcs = ", ".join(b.get("src", "")[-50:] for b in broken[:3])
        return ("FAIL", f"{broken_cnt}/{total}枚 broken: {srcs}")

    # --- A_CSS: youtube iframe サイズ ---
    if cat == "A_CSS" and sub == "youtube-iframe-size":
        small_cnt, total, small = check_iframe_size(snap)
        if total == 0:
            return ("NO_DATA", "iframe が見つからない")
        if small_cnt == 0:
            sizes = ", ".join(f"{f.get('clientWidth')}x{f.get('clientHeight')}" for f in snap["iframes"])
            return ("PASS", f"iframe size: {sizes}")
        return ("FAIL", f"{small_cnt}/{total} iframe < 400px")

    # --- A_CSS: align/position ---
    if cat == "A_CSS" and sub == "align/position":
        # まずクラス単独判定
        bad_cnt, total, bad = check_aligns_class(snap)
        if total > 0 and bad_cnt == 0:
            # クラス判定で全OKでも、ORIG比較で text-align 差があれば FAIL に転ばせる
            if orig_snap is not None:
                return check_align_position_orig(orig_snap, snap)
            return ("PASS", f"{total}件のalign全て正常")
        if total > 0 and bad_cnt > 0:
            return ("FAIL", f"{bad_cnt}/{total} align不正: {'; '.join(bad)}")
        # align クラス無し → ORIG比較
        if orig_snap is not None:
            return check_align_position_orig(orig_snap, snap)
        return ("MANUAL", ".alignleft/right/center要素なし, ORIGデータなし")

    # --- A_CSS: font-color/weight ---
    if cat == "A_CSS" and sub == "font-color/weight":
        if orig_snap is None:
            return ("MANUAL", "ORIGスナップショットなし")
        return check_font_color_weight(orig_snap, snap)

    # --- A_CSS: font-size差異 ---
    if cat == "A_CSS" and sub == "font-size差異":
        if orig_snap is None:
            return ("MANUAL", "ORIGスナップショットなし")
        return check_font_size(orig_snap, snap)

    # --- A_CSS: margin過大 ---
    if cat == "A_CSS" and sub == "margin過大":
        if orig_snap is None:
            return ("MANUAL", "ORIGスナップショットなし")
        return check_margin(orig_snap, snap)

    # --- A_CSS: 画像サイズ ---
    if cat == "A_CSS" and sub == "画像サイズ":
        if orig_snap is None:
            return ("MANUAL", "ORIGスナップショットなし")
        return check_image_size(orig_snap, snap)

    # --- B_本文 ---
    if cat == "B_本文":
        return ("MANUAL", "本文編集要 - WP admin で修正")

    # --- A_CSS 残り ---
    if cat == "A_CSS":
        return ("MANUAL", f"CSS {sub} - 目視またはORIG比較要")

    # --- D / X ---
    if cat == "D_原本由来":
        return ("MANUAL", "ユーザー巻き取り: 原本も同じバグ")
    if cat == "X_要目視":
        return ("MANUAL", "指摘なし/分類不可")

    return ("MANUAL", f"未対応カテゴリ {cat}/{sub}")


def main():
    rows = list(csv.DictReader(ISSUES.open(encoding="utf-8")))
    print(f"Loaded {len(rows)} issues")

    snap_cache = {}
    orig_cache = {}

    def get_snap(no):
        if no not in snap_cache:
            snap_cache[no] = load_snapshot(no, orig=False)
        return snap_cache[no]

    def get_orig(no):
        if no not in orig_cache:
            orig_cache[no] = load_snapshot(no, orig=True)
        return orig_cache[no]

    out_rows = []
    counts = {"PASS": 0, "FAIL": 0, "MANUAL": 0, "NO_DATA": 0}
    for r in rows:
        snap = get_snap(r["No"])
        orig = get_orig(r["No"])
        status, evidence = verify(r, snap, orig)
        counts[status] += 1
        out_rows.append({
            "No": r["No"],
            "slug": r["slug"],
            "source": r["source"],
            "category": r["category"],
            "subcategory": r["subcategory"],
            "status": status,
            "evidence": evidence,
            "text": r["text"],
        })

    with OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["No", "slug", "source", "category", "subcategory", "status", "evidence", "text"])
        w.writeheader()
        w.writerows(out_rows)

    print(f"\nReport saved to {OUT}")
    print("Summary:")
    for k, v in counts.items():
        print(f"  {k}: {v}")

    print("\n--- PASS items ---")
    for r in out_rows:
        if r["status"] == "PASS":
            print(f"  #{r['No']:>3} [{r['source']}] {r['subcategory']:<20} :: {r['evidence']}")
    print("\n--- FAIL items ---")
    for r in out_rows:
        if r["status"] == "FAIL":
            print(f"  #{r['No']:>3} [{r['source']}] {r['subcategory']:<20} :: {r['evidence']}")
            print(f"      text: {r['text'][:100]}")


if __name__ == "__main__":
    main()
