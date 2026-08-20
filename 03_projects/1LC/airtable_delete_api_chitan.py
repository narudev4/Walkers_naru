#!/usr/bin/env python3
# 1LC Airtable 承認セット 一括削除（REST API版）② チタン物件一覧
# - DRY RUN（既定）: 件数を数えるだけ・1件も消さない
# - 対話削除: python3 airtable_delete_api_chitan.py --delete         → "yes" 入力で実行
# - 無人削除: python3 airtable_delete_api_chitan.py --delete --yes   → 確認スキップ（寝てる間OK）
# - ★物件紹介履歴(①)を先に削除してから実行（順: ①履歴 → ②物件）
import os, sys, time, json, urllib.request, urllib.parse, urllib.error

# ===== 設定（② チタン物件一覧・承認ビュー）=====
BASE_ID  = "appksEWIuKl7N2ftS"
TABLE_ID = "tbllNssTBXGexHysb"   # チタン物件一覧
VIEW_ID  = "viwv0Q1hKb52UEWFb"   # 承認ビュー（更新日<2025/12 かつ 紹介なし・約31,010件）
# ================================================

API = "https://api.airtable.com/v0"
SLEEP = 0.25  # 5 req/sec 制限対策

def get_token():
    t = os.environ.get("AIRTABLE_PAT", "").strip()
    if t:
        return t
    path = "/Users/naru/Walkers_naru/credentials/airtable-1lc-pat.txt"
    if os.path.exists(path):
        return open(path).read().strip()
    sys.exit("PATがありません。credentials/airtable-1lc-pat.txt か 環境変数 AIRTABLE_PAT を設定してください。")

HEADERS = {"Authorization": "Bearer " + get_token()}

def call(method, url):
    last = ""
    for attempt in range(8):
        try:
            req = urllib.request.Request(url, method=method, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            last = "HTTP %d: %s" % (e.code, e.read().decode()[:200])
            if e.code == 429 or 500 <= e.code < 600:     # レート制限/サーバ一時エラー(503等)はリトライ
                wait = min(2 ** attempt, 30)             # 1,2,4,8,16,30,30,30 秒
                print("  ↻ %d リトライ %ds後 (%d/8)" % (e.code, wait, attempt + 1), flush=True)
                time.sleep(wait); continue
            sys.exit("APIエラー（リトライ不可・停止）: %s" % last)   # 401/403/404等は即停止
        except Exception as e:
            last = "通信エラー: %s" % e
            wait = min(2 ** attempt, 30)
            print("  ↻ 通信エラー リトライ %ds後 (%d/8)" % (wait, attempt + 1), flush=True)
            time.sleep(wait); continue
    sys.exit("リトライ上限に到達。最後のエラー: %s" % last)

def collect_ids():
    ids, offset = [], None
    while True:
        q = {"view": VIEW_ID, "pageSize": "100"}
        if offset:
            q["offset"] = offset
        data = call("GET", "%s/%s/%s?%s" % (API, BASE_ID, TABLE_ID, urllib.parse.urlencode(q)))
        ids += [rec["id"] for rec in data.get("records", [])]
        offset = data.get("offset")
        if len(ids) % 5000 == 0 or not offset:
            print("  取得中… %d 件" % len(ids), flush=True)
        time.sleep(SLEEP)
        if not offset:
            break
    return ids

def delete_ids(ids):
    done = 0
    for i in range(0, len(ids), 10):       # DELETE は最大10件/リクエスト
        batch = ids[i:i + 10]
        q = urllib.parse.urlencode([("records[]", x) for x in batch])
        call("DELETE", "%s/%s/%s?%s" % (API, BASE_ID, TABLE_ID, q))
        done += len(batch)
        if done % 2000 == 0 or done == len(ids):
            print("  削除済み %d / %d 件 (%s)" % (done, len(ids), time.strftime("%H:%M:%S")), flush=True)
        time.sleep(SLEEP)

def main():
    print("対象: TABLE=%s VIEW=%s (チタン物件一覧)  %s" % (TABLE_ID, VIEW_ID, time.strftime("%Y-%m-%d %H:%M:%S")))
    ids = collect_ids()
    print("削除対象: %d 件" % len(ids))
    if len(ids) == 0:
        print("対象0件。終了します。"); return
    if "--delete" not in sys.argv:
        print("※ DRY RUN（1件も削除していません）。")
        print("   対話削除: python3 %s --delete" % os.path.basename(__file__))
        print("   無人削除: python3 %s --delete --yes" % os.path.basename(__file__))
        return
    if "--yes" not in sys.argv:
        ans = input("本当に %d 件を削除します。よければ 'yes' と入力: " % len(ids)).strip()
        if ans != "yes":
            print("中止しました。1件も削除していません。"); return
    else:
        print("--yes 指定: 確認スキップで削除します。")
    delete_ids(ids)
    print("✅ 完了：%d 件を削除しました。 %s" % (len(ids), time.strftime("%Y-%m-%d %H:%M:%S")))

if __name__ == "__main__":
    main()
