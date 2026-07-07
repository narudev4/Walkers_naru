import os, json, time, urllib.request, hashlib


def get_webhook_url():
    url = os.environ.get("BACKUP_SHEET_WEBHOOK", "").strip()
    if url:
        return url
    cred_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "credentials", "1lc-backup-webhook.txt")
    if os.path.isfile(cred_path):
        with open(cred_path) as f:
            url = f.read().strip()
        if url:
            return url
    return None


def send_backup(records, phase_label):
    url = get_webhook_url()
    if not url:
        print("  ⚠ BACKUP_SHEET_WEBHOOK 未設定 — バックアップをスキップ", flush=True)
        return False

    rows = []
    for rec in records:
        fields = rec.get("fields", {})
        rows.append({
            "id": rec["id"],
            "phase": phase_label,
            **{k: _serialize(v) for k, v in fields.items()},
        })

    CHUNK = 200
    MAX_RETRIES = 3
    sent = 0
    total_chunks = (len(rows) + CHUNK - 1) // CHUNK
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i : i + CHUNK]
        chunk_idx = i // CHUNK
        chunk_id = hashlib.sha256(
            "|".join(sorted(r["id"] for r in chunk)).encode("utf-8")
        ).hexdigest()
        payload = json.dumps({"rows": chunk, "chunkId": chunk_id}, ensure_ascii=False).encode("utf-8")

        ok = False
        for attempt in range(MAX_RETRIES):
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    resp.read()
                ok = True
                break
            except Exception as e:
                wait = 2 ** attempt
                print("  ⚠ chunk %d/%d 送信エラー (試行 %d/%d): %s — %d秒後にリトライ"
                      % (chunk_idx, total_chunks, attempt + 1, MAX_RETRIES, e, wait), flush=True)
                time.sleep(wait)

        if not ok:
            print("  ✗ chunk %d/%d: %d回リトライ後も失敗 — 中断" % (chunk_idx, total_chunks, MAX_RETRIES), flush=True)
            return False

        sent += len(chunk)
        if (chunk_idx + 1) % 10 == 0 or chunk_idx == total_chunks - 1:
            print("  … %d/%d chunks 送信済み (%d 行)" % (chunk_idx + 1, total_chunks, sent), flush=True)
        time.sleep(0.3)

    print("  📋 バックアップ完了: %d 行 (%s)" % (sent, phase_label), flush=True)
    return True


def _serialize(value):
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    return value
