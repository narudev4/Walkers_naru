#!/usr/bin/env python3
"""1LC Airtable 定期削除スクリプト

Usage:
  python3 auto_delete.py              # dry-run（件数表示のみ、削除しない）
  python3 auto_delete.py --backup-only   # バックアップのみ（削除しない）
  python3 auto_delete.py --delete     # 対話確認付き削除
  python3 auto_delete.py --delete --yes  # 確認スキップ（GitHub Actions 用）
  python3 auto_delete.py --phase 1    # Phase 1 のみ
  python3 auto_delete.py --phase 2    # Phase 2 のみ
"""
import sys, os, time, json

sys.path.insert(0, os.path.dirname(__file__))

from config import (
    CHITAN_TABLE, RIREKI_TABLE,
    PROPERTY_FORMULA, PROPERTY_FIELDS,
    HISTORY_FORMULA, HISTORY_BACKUP_FIELDS,
    MAX_DELETE_PER_PHASE, ANOMALY_RATIO, RECORD_ALERT_THRESHOLD,
)
from airtable_api import collect_records, delete_ids, get_token
from backup import send_backup


def safety_check(count, phase_label):
    if count > MAX_DELETE_PER_PHASE:
        sys.exit("安全停止: %s の削除対象 %d 件が上限 %d を超過" % (phase_label, count, MAX_DELETE_PER_PHASE))


def phase1(do_delete, auto_yes, backup_only=False, skip_backup=False):
    print("\n=== Phase 1: 物件削除（90日超 OR 5,000万未満） ===", flush=True)
    print("条件: %s" % PROPERTY_FORMULA, flush=True)

    props = collect_records(CHITAN_TABLE, PROPERTY_FORMULA, PROPERTY_FIELDS)
    print("削除対象物件: %d 件" % len(props), flush=True)

    if not props:
        print("対象 0 件。Phase 1 スキップ。", flush=True)
        return

    safety_check(len(props), "Phase 1 物件")

    if backup_only:
        if not send_backup(props, "phase1_property"):
            sys.exit("✗ Phase 1 バックアップ送信に失敗。中断します。")
        print("※ BACKUP ONLY — バックアップのみ完了。削除していません。", flush=True)
        return

    if not do_delete:
        print("※ DRY RUN — 削除していません。--delete で実行。", flush=True)
        return

    if not auto_yes:
        ans = input("物件 %d 件を削除します。'yes' で実行: " % len(props)).strip()
        if ans != "yes":
            print("中止しました。", flush=True)
            sys.exit(0)

    if skip_backup:
        print("  ⏭ バックアップ送信スキップ（--skip-backup）", flush=True)
    else:
        if not send_backup(props, "phase1_property"):
            sys.exit("✗ Phase 1 バックアップ失敗 — 削除を中止します。")

    prop_ids = [rec["id"] for rec in props]
    delete_ids(CHITAN_TABLE, prop_ids)
    print("✅ Phase 1 完了: 物件 %d 件を削除" % len(prop_ids), flush=True)


def phase2(do_delete, auto_yes, backup_only=False, skip_backup=False):
    print("\n=== Phase 2: 古い紹介履歴の削除（90日超） ===", flush=True)
    print("条件: %s" % HISTORY_FORMULA, flush=True)

    history = collect_records(RIREKI_TABLE, HISTORY_FORMULA, HISTORY_BACKUP_FIELDS)
    print("削除対象履歴: %d 件" % len(history), flush=True)

    if not history:
        print("対象 0 件。Phase 2 スキップ。", flush=True)
        return

    safety_check(len(history), "Phase 2 履歴")

    if backup_only:
        if not send_backup(history, "phase2_old_history"):
            sys.exit("✗ Phase 2 バックアップ送信に失敗。中断します。")
        print("※ BACKUP ONLY — バックアップのみ完了。削除していません。", flush=True)
        return

    if not do_delete:
        print("※ DRY RUN — 削除していません。--delete で実行。", flush=True)
        return

    if not auto_yes:
        ans = input("紹介履歴 %d 件を削除します。'yes' で実行: " % len(history)).strip()
        if ans != "yes":
            print("中止しました。", flush=True)
            sys.exit(0)

    if skip_backup:
        print("  ⏭ バックアップ送信スキップ（--skip-backup）", flush=True)
    else:
        if not send_backup(history, "phase2_old_history"):
            sys.exit("✗ Phase 2 バックアップ失敗 — 削除を中止します。")

    history_ids = [rec["id"] for rec in history]
    delete_ids(RIREKI_TABLE, history_ids)
    print("✅ Phase 2 完了: 紹介履歴 %d 件を削除" % len(history_ids), flush=True)


def write_log(log_data):
    log_dir = os.path.join(os.path.dirname(__file__), "logs")
    os.makedirs(log_dir, exist_ok=True)
    filename = "run_%s.json" % time.strftime("%Y%m%d_%H%M%S")
    path = os.path.join(log_dir, filename)
    with open(path, "w") as f:
        json.dump(log_data, f, ensure_ascii=False, indent=2)
    print("ログ: %s" % path, flush=True)


def main():
    print("1LC Airtable 定期削除  %s" % time.strftime("%Y-%m-%d %H:%M:%S"), flush=True)

    get_token()

    do_delete = "--delete" in sys.argv
    backup_only = "--backup-only" in sys.argv
    auto_yes = "--yes" in sys.argv
    skip_backup = "--skip-backup" in sys.argv
    phase_only = None
    if "--phase" in sys.argv:
        idx = sys.argv.index("--phase")
        if idx + 1 < len(sys.argv):
            phase_only = sys.argv[idx + 1]

    mode = "delete" if do_delete else ("backup-only" if backup_only else "dry-run")
    log = {"start": time.strftime("%Y-%m-%dT%H:%M:%S"), "mode": mode}

    if phase_only in (None, "1"):
        phase1(do_delete, auto_yes, backup_only, skip_backup)

    if phase_only in (None, "2"):
        phase2(do_delete, auto_yes, backup_only, skip_backup)

    log["end"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    write_log(log)
    print("\n完了。 %s" % time.strftime("%H:%M:%S"), flush=True)


if __name__ == "__main__":
    main()
