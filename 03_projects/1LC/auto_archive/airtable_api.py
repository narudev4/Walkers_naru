import os, sys, time, json, urllib.request, urllib.parse, urllib.error
from config import (
    API_BASE, BASE_ID, SLEEP, DELETE_BATCH, PAGE_SIZE, MAX_RETRIES,
)


def get_token():
    t = os.environ.get("AIRTABLE_PAT", "").strip()
    if t:
        return t
    path = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "credentials", "airtable-1lc-pat.txt"
    )
    path = os.path.normpath(path)
    if os.path.exists(path):
        return open(path).read().strip()
    sys.exit("PAT がありません。AIRTABLE_PAT 環境変数か credentials/airtable-1lc-pat.txt を設定してください。")


HEADERS = None


def _headers():
    global HEADERS
    if HEADERS is None:
        HEADERS = {"Authorization": "Bearer " + get_token()}
    return HEADERS


def call(method, url, body=None):
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, method=method, headers=_headers())
            if body is not None:
                req.add_header("Content-Type", "application/json")
                data = json.dumps(body).encode()
            else:
                data = None
            with urllib.request.urlopen(req, data, timeout=60) as r:
                return json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            msg = "HTTP %d: %s" % (e.code, e.read().decode()[:200])
            if e.code == 429 or 500 <= e.code < 600:
                wait = min(2 ** attempt, 30)
                print("  ↻ %d リトライ %ds後 (%d/%d)" % (e.code, wait, attempt + 1, MAX_RETRIES), flush=True)
                time.sleep(wait)
                continue
            sys.exit("API エラー（リトライ不可）: %s" % msg)
        except Exception as e:
            msg = "通信エラー: %s" % e
            wait = min(2 ** attempt, 30)
            print("  ↻ 通信エラー リトライ %ds後 (%d/%d)" % (wait, attempt + 1, MAX_RETRIES), flush=True)
            time.sleep(wait)
            continue
    sys.exit("リトライ上限に到達。最後のエラー: %s" % msg)


def collect_records(table_id, formula, fields=None):
    records, offset = [], None
    while True:
        params = [("pageSize", str(PAGE_SIZE)), ("filterByFormula", formula)]
        if fields:
            for f in fields:
                params.append(("fields[]", f))
        if offset:
            params.append(("offset", offset))
        qs = urllib.parse.urlencode(params)

        data = call("GET", "%s/%s/%s?%s" % (API_BASE, BASE_ID, table_id, qs))
        records.extend(data.get("records", []))
        offset = data.get("offset")
        if len(records) % 5000 == 0 or not offset:
            print("  取得中… %d 件" % len(records), flush=True)
        time.sleep(SLEEP)
        if not offset:
            break
    return records


def delete_ids(table_id, ids):
    done = 0
    for i in range(0, len(ids), DELETE_BATCH):
        batch = ids[i : i + DELETE_BATCH]
        q = urllib.parse.urlencode([("records[]", x) for x in batch])
        call("DELETE", "%s/%s/%s?%s" % (API_BASE, BASE_ID, table_id, q))
        done += len(batch)
        if done % 2000 == 0 or done == len(ids):
            print("  削除済み %d / %d 件 (%s)" % (done, len(ids), time.strftime("%H:%M:%S")), flush=True)
        time.sleep(SLEEP)
    return done


def count_records(table_id):
    records = []
    offset = None
    while True:
        q = [("pageSize", "100")]
        if offset:
            q.append(("offset", offset))
        data = call("GET", "%s/%s/%s?%s" % (API_BASE, BASE_ID, table_id, urllib.parse.urlencode(q)))
        records.extend(data.get("records", []))
        offset = data.get("offset")
        time.sleep(SLEEP)
        if not offset:
            break
    return len(records)
