#!/usr/bin/env python3
"""
1LC 物件フル同期 / 遡及登録スクリプト

背景・設計は plans/precious-pondering-hinton.md 参照。要点:
  - チタンAPIの取りこぼし（掲載中なのにAirtable未登録）の遡及登録を行う。
  - 原因は ① inai:2（登録2日以内の新着のみ）② エリア設定の住所コードが
    都道府県全域を網羅していない、の2点。本スクリプトは inai を外し、
    都道府県エリアは2桁コード（全域）でfetchすることで岩下様の母集団
    （12都道府県 × 1億円以上 × bukkmoku=50 一棟系）を正確に再現する。
  - 冪等: Airtableの「問合わせ番号」で既存判定し、未登録のみ新規作成。
  - 土地権利フィルタ: 新規作成は「空欄 or 所有権」のみ（旧法賃借等はスキップ）。

使い方:
  python3 full_sync.py                 # dry-run（書き込みなし・既定）
  python3 full_sync.py --limit 30 --commit   # 先頭30件だけ本番作成（小規模テスト）
  python3 full_sync.py --commit        # 全件本番作成

前提: 岩下様の欠損リストExcel（--excel で指定、既定は ~/Downloads の 20260716版）。
"""
import argparse
import os
import re
import sys
import time
import urllib.parse
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config import BASE_ID, API_BASE, CHITAN_TABLE  # noqa: E402
import airtable_api as api  # noqa: E402

TITAN_API = "https://www.1lcinc.com/syuuekibukken/php/json_output.php"
TITAN_SITE = "https://1lcinc-syuuekibukken.com"
AREA_TABLE = urllib.parse.quote("物件エリア")  # 日本語テーブル名はURLエンコードが必要
PRICE_MIN = 10000       # 万円（1億円以上 = 岩下様の母集団条件）
PRICE_MAX = 600000      # 万円（60億円。上限帯の広め設定）
HKENSU = 8000
OWNERSHIP = "所有権"

# 物件エリアテーブルにある都道府県エリア名 → 総務省2桁コード
PREF_CODE = {
    "北海道": "01", "宮城県": "04", "埼玉県": "11", "千葉県": "12",
    "東京都": "13", "神奈川県": "14", "新潟県": "15", "静岡県": "22",
    "愛知県": "23", "滋賀県": "25", "京都府": "26", "大阪府": "27",
    "兵庫県": "28", "岡山県": "33", "広島県": "34", "福岡県": "40",
    "佐賀県": "41", "長崎県": "42", "熊本県": "43", "大分県": "44",
    "宮崎県": "45", "鹿児島県": "46",
}
# 岩下様の母集団＝12都道府県のみを対象にする
TARGET_PREF_CODES = {"11", "12", "13", "14", "23", "25",
                     "26", "27", "28", "40", "43", "46"}

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


# ---------- ユーティリティ ----------
def safe_float(v, strip=""):
    if v is None:
        return None
    s = str(v)
    for ch in strip:
        s = s.replace(ch, "")
    s = s.replace(",", "").strip()
    if s in ("", "-", "―", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def to_multiselect(s):
    """REST API 形式の multi-select（文字列配列）"""
    if not s:
        return []
    return [x.strip() for x in re.split(r"[、,／/]", s) if x.strip()]


def exid(url):
    m = re.search(r"bukken_([A-Za-z0-9]+)_des", url or "")
    return m.group(1) if m else None


def read_excel_qnos(path):
    with zipfile.ZipFile(path) as z:
        with z.open("xl/worksheets/sheet1.xml") as f:
            tree = ET.parse(f)
    rows = tree.getroot().find("m:sheetData", NS).findall("m:row", NS)

    def cell(c):
        v = c.find("m:v", NS)
        is_ = c.find("m:is", NS)
        if is_ is not None:
            t = is_.find("m:t", NS)
            return t.text if t is not None else ""
        return v.text if v is not None else None

    qnos = []
    for r in rows[1:]:
        vals = [cell(c) for c in r.findall("m:c", NS)]
        if vals and vals[0]:
            qnos.append(vals[0].strip())
    return qnos


# ---------- チタンAPI ----------
def titan_fetch(jusyoc, lo, hi, hkensu=HKENSU, retries=5):
    import json
    import urllib.request
    body = json.dumps({
        "fm": "baibai", "url": TITAN_SITE, "jusyoc": jusyoc,
        "yachik": lo, "yachij": hi, "hkensu": hkensu, "bukkmoku": 50,
    }).encode()
    label = jusyoc if isinstance(jusyoc, str) else "codes"
    for attempt in range(retries):
        req = urllib.request.Request(TITAN_API, data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                d = json.loads(resp.read().decode())
            return d if isinstance(d, list) else None
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(min(2 ** attempt, 20))  # 500/503/通信エラーは一時的：バックオフ再試行
                continue
            print(f"    fetch失敗({label} {lo}-{hi}): {e}", flush=True)
            return None
    return None


def fetch_area_adaptive(area, truncated):
    """まず全価格帯を1回。失敗(500等) or hkensu到達なら価格帯分割にフォールバック"""
    code = area["fetch_code"]
    d = titan_fetch(code, PRICE_MIN, PRICE_MAX)
    if d is not None and len(d) < HKENSU:
        return d
    if d is None:
        print(f"  ⚠ {area['name']}: 全域fetch失敗 → 価格帯分割で再試行", flush=True)
    else:
        truncated.append(f"{area['name']}(全域{len(d)}件)")
        print(f"  🚨 {area['name']}: {len(d)}件でhkensu到達 → 価格帯分割", flush=True)
    merged = {}
    lo = PRICE_MIN
    bands = []
    while lo < 200000:
        bands.append((lo, lo + 10000))
        lo += 10000
    bands.append((200000, PRICE_MAX))
    for blo, bhi in bands:
        dd = titan_fetch(code, blo, bhi)
        if dd:
            if len(dd) >= HKENSU:
                truncated.append(f"{area['name']}({blo}-{bhi}:{len(dd)}件)")
            for it in dd:
                merged[it.get("URL")] = it
        time.sleep(0.2)
    return list(merged.values())


# ---------- フィールド構築（REST API 形式） ----------
def build_fields(item, area_ids):
    price_man = None
    m = re.sub(r"[万円,]", "", item.get("価格") or "")
    if m.isdigit():
        price_man = int(m)
    f = {
        "公開用URL": item.get("URL"),
        "画像": item.get("画像"),
        "所在地": item.get("所在地"),
        "沿線・駅": item.get("沿線・駅"),
        "バス・徒歩": item.get("バス・徒歩"),
        "価格": price_man * 10000 if price_man else None,
        "土地面積": safe_float(item.get("土地面積"), "㎡"),
        "建物面積": safe_float(item.get("建物面積"), "㎡"),
        "建物構造": to_multiselect(item.get("建物構造")),
        "利回り": safe_float(item.get("利回り"), "%"),
        "種別": to_multiselect(item.get("種別")),
        "築年": item.get("築年"),
        "エリア": area_ids,
    }
    lr = item.get("土地権利")
    if lr:
        f["土地権利"] = lr
    for key in ("積算価格の妥当性", "土地比率", "建物比率"):
        v = safe_float(item.get(key))
        if v is not None:
            f[key] = v
    # None / 空文字 / 空配列は送らない（Airtableのエラー・上書き回避）
    return {k: v for k, v in f.items() if v not in (None, "", [])}


# ---------- メイン ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="本番書き込み（既定はdry-run）")
    ap.add_argument("--limit", type=int, default=0, help="作成する最大件数（小規模テスト用・0で無制限）")
    ap.add_argument("--excel", default=os.path.expanduser(
        "~/Downloads/Airtable未登録物件一覧_20260716.xlsx"))
    args = ap.parse_args()

    mode = "COMMIT（本番書き込み）" if args.commit else "DRY-RUN（書き込みなし）"
    print(f"=== 1LC フル同期 / 遡及登録  [{mode}] ===", flush=True)

    # 1) 岩下様リスト（対象母集団）
    excel_qnos = set(read_excel_qnos(args.excel))
    print(f"Excel欠損リスト: {len(excel_qnos)}件", flush=True)

    # 2) 最新Airtable（冪等性チェック用）
    print("Airtable既存レコード取得中...", flush=True)
    recs = api.collect_records(CHITAN_TABLE, "TRUE()", fields=["問合わせ番号"])
    existing = {r["fields"].get("問合わせ番号") for r in recs if r["fields"].get("問合わせ番号")}
    print(f"Airtable既存: {len(recs)}件 / 問合わせ番号ユニーク: {len(existing)}件", flush=True)

    target = excel_qnos - existing
    print(f"真に未登録（対象）: {len(target)}件", flush=True)

    # 3) エリア構築（都道府県エリアは2桁コード、細分エリアは既存住所コード）
    area_recs = api.collect_records(
        AREA_TABLE, "TRUE()", fields=["エリア名", "住所コード（ref）"])
    areas = []
    for r in area_recs:
        name = r["fields"].get("エリア名")
        if name in PREF_CODE:
            code2 = PREF_CODE[name]
            if code2 in TARGET_PREF_CODES:
                areas.append({"id": r["id"], "name": name, "fetch_code": code2})
        else:
            codes = r["fields"].get("住所コード（ref）")
            if codes:
                areas.append({"id": r["id"], "name": name, "fetch_code": codes})
    print(f"fetch対象エリア: {len(areas)}個", flush=True)

    # 4) 取得（target かつ 未登録 のみ収集、エリアIDを付与）
    found = {}
    truncated = []
    pop = set()
    for i, area in enumerate(areas, 1):
        items = fetch_area_adaptive(area, truncated)
        hit = 0
        for it in items:
            qno = exid(it.get("URL"))
            if not qno:
                continue
            pop.add(qno)
            if qno in target and qno not in existing:
                if qno not in found:
                    found[qno] = {"item": it, "area_ids": set()}
                found[qno]["area_ids"].add(area["id"])
                hit += 1
        print(f"[{i}/{len(areas)}] {area['name']}: {len(items)}件取得 / target新規 {len(found)}", flush=True)
        time.sleep(0.2)

    # 5) 土地権利フィルタ → creates
    creates = []
    skipped_lr = 0
    for qno, d in found.items():
        lr = d["item"].get("土地権利")
        if lr and lr != OWNERSHIP:
            skipped_lr += 1
            continue
        creates.append(build_fields(d["item"], sorted(d["area_ids"])))

    # 6) サマリ（再発防止ログ）
    print("\n=== サマリ ===", flush=True)
    print(f"母集団(掲載中1億以上・一棟系ユニーク): {len(pop)}件", flush=True)
    print(f"対象(真に未登録): {len(target)}件", flush=True)
    print(f"うち回収(掲載中で再取得できた): {len(found)}件", flush=True)
    print(f"土地権利フィルタで除外(所有権以外): {skipped_lr}件", flush=True)
    print(f"新規作成候補: {len(creates)}件", flush=True)
    print(f"未回収(掲載終了等): {len(target) - len(found)}件", flush=True)
    if truncated:
        print(f"⚠ hkensu到達エリア: {truncated}", flush=True)

    if args.limit:
        creates = creates[:args.limit]
        print(f"\n--limit {args.limit} 指定: 先頭{len(creates)}件のみ作成対象", flush=True)

    # 7) 書き込み
    if not args.commit:
        print("\n[DRY-RUN] 書き込みは行いません。--commit で本番実行。", flush=True)
        if creates:
            print("--- 作成予定サンプル(先頭3件) ---", flush=True)
            import json
            for c in creates[:3]:
                print(json.dumps(c, ensure_ascii=False)[:300], flush=True)
        return

    print(f"\n本番書き込み開始: {len(creates)}件", flush=True)
    created = 0
    for i in range(0, len(creates), 10):
        batch = creates[i:i + 10]
        body = {"records": [{"fields": f} for f in batch], "typecast": True}
        api.call("POST", f"{API_BASE}/{BASE_ID}/{CHITAN_TABLE}", body)
        created += len(batch)
        if created % 200 == 0 or created == len(creates):
            print(f"  作成済み {created}/{len(creates)}", flush=True)
        time.sleep(0.25)
    print(f"完了: {created}件を新規作成しました。", flush=True)


if __name__ == "__main__":
    main()
