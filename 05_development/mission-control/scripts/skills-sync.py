#!/usr/bin/env python3
"""skills-sync.py — Walkers 司令塔 Phase2 W7-2 (Skills可視化ダッシュボード)

Mac側の `.claude/skills/*/SKILL.md` (57件前後) を走査してメタデータをJSON化し、
mission-control の `/api/skills/sync` (W7-1, cron-auth 必須) へPOSTする。

参考(読み取り専用。importしない): 05_development/walkers-dashboard/refresh.py の
メタデータ抽出ロジックを踏襲するが、参照パスは `.claude/skills/{name}/SKILL.md`
に修正している(refresh.pyが参照する `.claude/commands/` は2026-04-10に
`.claude/skills/` へ移行済みの旧配置)。

Python標準ライブラリのみ使用(新規依存追加なし)。

使い方:
  python3 skills-sync.py <api-url> [--token TOKEN] [--dry-run] [--root PATH]

  <api-url>   mission-control の /api/skills/sync フルURL
              (例: http://localhost:3000/api/skills/sync。本番はTailscale経由URLを想定)
  --token     CRON_SECRET。省略時は環境変数 CRON_SECRET を使う
              (このスクリプト自体には秘密情報を書き込まない)
  --dry-run   POSTせず、抽出結果のJSONを標準出力にpretty printするだけ
  --root      Walkersルートパス(既定: このファイルから4階層上 = /Users/naru/Walkers_naru)

冪等性: サーバー側(/api/skills/sync)が id をキーに upsert するため、本スクリプトは
何度実行してもエラーにならない(ローカルに状態ファイルを持たない設計)。
"""
import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Optional

# このファイル: 05_development/mission-control/scripts/skills-sync.py
# → 4階層上が Walkers_naru ルート
DEFAULT_ROOT = pathlib.Path(__file__).resolve().parents[3]

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
DESCRIPTION_RE = re.compile(r"^description:\s*(.+)$", re.MULTILINE)

# トリガー文字列抽出の3パターン
# (1) 行頭の「トリガー: ...」インライン形式 (最多数派)
TRIGGER_INLINE_RE = re.compile(r"^トリガー[:：]\s*(.+)$", re.MULTILINE)
# (2) 「## トリガー」「## 起動トリガー」見出し + 本文(次の見出しまで)
TRIGGER_HEADING_RE = re.compile(r"^##\s*(?:起動)?トリガー\s*\n(.*?)(?=\n##\s|\Z)", re.MULTILINE | re.DOTALL)
# (3) 上記2つに当てはまらない箇所での緩い一致(例: 箇条書き内の「- トリガー: ...」)
TRIGGER_LOOSE_RE = re.compile(r"トリガー[:：]\s*(.+)")

TOOL_TABLE_RE = re.compile(r"^##\s*利用ツール\s*$", re.MULTILINE)

# status ヒューリスティック: SKILL.md自身の frontmatter description 内の表現のみを見る
# (本文中の「凍結」「実験中」は他スキルへの言及であることが多く、本文全体を見ると
#  誤検知が多発することを事前調査で確認済み。例: mtg-pipeline/meeting-transcribe は
#  本文で「mtg-workerは凍結」「S3同期は凍結済み」に言及するが、自身は凍結していない)
FROZEN_DESC_RE = re.compile(r"凍結")
EXPERIMENTAL_DESC_RE = re.compile(r"実験中|プロトタイプ|試験的|MVP")

# CLAUDE.mdの凍結宣言(個別「`name` は凍結」形式。例: mtg-worker)
CLAUDE_MD_FROZEN_NAME_RE = re.compile(r"`/?([a-zA-Z0-9_-]+)`\s*は凍結")

# category ヒューリスティック(優先順。name+descriptionに含まれるキーワードで判定)
CATEGORY_RULES = [
    ("mtg", ["mtg", "議事録", "tl;dv", "tldv"]),
    ("finance", ["経理", "請求", "見積", "misoca", "補助金"]),
    ("sales", ["営業", "パイプライン", "提案書", "問い合わせ", "日程調整", "デモ"]),
    ("content", ["記事", "スライド", "モックアップ", "図解", "note", "zenn", "メルマガ", "ライティング", "文章", "マニュアル", "タイトル"]),
    ("research", ["リサーチ", "調査", "トレンド", "戦略分析", "research", "trend"]),
    ("routine", ["日次", "週次", "モーニング", "デイリー", "スケジュール生成"]),
    ("video", ["動画", "video", "youtube", "heygen"]),
    ("ops", ["デプロイ", "sync", "同期", "クリーンアップ", "カーブアウト", "コミット", "ダッシュボード", "gui", "プロジェクト管理", "タスク登録", "チーム管理", "セッション", "retrospect", "aws", "postgres", "browser", "共有"]),
]


def safe_read(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def extract_description(content: str) -> Optional[str]:
    m = FRONTMATTER_RE.match(content)
    if not m:
        return None
    dm = DESCRIPTION_RE.search(m.group(1))
    return dm.group(1).strip() if dm else None


def extract_trigger(content: str) -> Optional[str]:
    m = TRIGGER_INLINE_RE.search(content)
    if m:
        return m.group(1).strip()[:2000]

    m = TRIGGER_HEADING_RE.search(content)
    if m:
        # 見出し直下の本文はトリガー箇条書きのことも手順書のこともあるため、
        # 冒頭数行・数百文字に絞って要約的に保持する(全文コピーはUI上ノイズになるため)
        lines = [ln.strip(" -*\t") for ln in m.group(1).strip().splitlines() if ln.strip()]
        joined = " / ".join(lines[:3])
        if joined:
            return joined[:200] + ("…" if len(joined) > 200 else "")

    m = TRIGGER_LOOSE_RE.search(content)
    if m:
        return m.group(1).strip()[:2000]

    return None


def git_last_updated(root: pathlib.Path, rel_path: str):
    try:
        r = subprocess.run(
            ["git", "log", "-1", "--format=%ad", "--date=iso-strict", "--", rel_path],
            capture_output=True, text=True, cwd=str(root), timeout=5,
            encoding="utf-8", errors="replace",
        )
        out = r.stdout.strip()
        if out:
            return out, "git"
    except Exception:
        pass
    return None, None


def mtime_fallback(path: pathlib.Path):
    dt = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).astimezone()
    return dt.isoformat(timespec="seconds"), "mtime"


def guess_category(name: str, description: Optional[str]) -> str:
    haystack = f"{name} {description or ''}".lower()
    for category, keywords in CATEGORY_RULES:
        for kw in keywords:
            if kw.lower() in haystack:
                return category
    return "other"


def parse_claude_md_frozen(claude_md: str, skill_names: set) -> dict:
    """CLAUDE.md の凍結宣言からスキル名→理由 の dict を作る。
    status算出はSKILL.md単体の記載よりこちらを必ず優先する(仕様どおり)。"""
    frozen: dict = {}

    # パターンA: 「## 凍結済み」セクション本文中の `/name` トークン列挙
    section_m = re.search(r"^## 凍結済み.*?$\n(.*?)(?=\n## |\Z)", claude_md, re.MULTILINE | re.DOTALL)
    if section_m:
        section_body = section_m.group(1)
        reason_m = re.search(r"^(.*?。)", section_body.strip(), re.DOTALL)
        reason = reason_m.group(1).strip() if reason_m else section_body.strip()[:120]
        reason = re.sub(r"\s+", " ", reason)
        for tok in re.findall(r"`/?([a-zA-Z0-9_-]+)`", section_body):
            if tok in skill_names:
                frozen.setdefault(tok, f"CLAUDE.md「凍結済み」節より: {reason}")

    # パターンB: 文書全体の「`name` は凍結」個別宣言 (例: `mtg-worker` は凍結)
    for m in CLAUDE_MD_FROZEN_NAME_RE.finditer(claude_md):
        name = m.group(1)
        if name in skill_names and name not in frozen:
            start = max(0, m.start() - 40)
            end = min(len(claude_md), m.end() + 10)
            excerpt = re.sub(r"\s+", " ", claude_md[start:end]).strip()
            frozen[name] = f"CLAUDE.mdより: {excerpt}"

    return frozen


def build_depends_on(name: str, content: str, all_names):
    """他スキル名への言及を単純な部分一致で拾う(誤検知を含みうる簡易ヒューリスティック。
    UI側で「誤検知を含みうる」旨を明記した上で表示する設計)。"""
    found = []
    for other in all_names:
        if other == name:
            continue
        if re.search(r"\b" + re.escape(other) + r"\b", content):
            found.append(other)
    return sorted(set(found))


def scan_skills(root: pathlib.Path):
    skills_dir = root / ".claude" / "skills"
    claude_md = safe_read(root / "CLAUDE.md")

    dirs = sorted(d for d in skills_dir.iterdir() if d.is_dir() and (d / "SKILL.md").is_file())
    names = [d.name for d in dirs]
    name_set = set(names)
    claude_frozen = parse_claude_md_frozen(claude_md, name_set)

    results = []
    missing_trigger = []

    for d in dirs:
        skill_path = d / "SKILL.md"
        content = safe_read(skill_path)
        rel_path = str(skill_path.relative_to(root))

        description = extract_description(content)
        trigger_text = extract_trigger(content)
        if not trigger_text:
            missing_trigger.append(d.name)

        last_updated_at, source = git_last_updated(root, rel_path)
        if last_updated_at is None:
            last_updated_at, source = mtime_fallback(skill_path)

        line_count = content.count("\n") + 1 if content else 0
        ref_file_count = len([f for f in d.rglob("*") if f.is_file() and f != skill_path])
        has_tool_table = bool(TOOL_TABLE_RE.search(content))

        if d.name in claude_frozen:
            status = "frozen"
            frozen_reason = claude_frozen[d.name]
        elif description and FROZEN_DESC_RE.search(description):
            status = "frozen"
            frozen_reason = description
        elif description and EXPERIMENTAL_DESC_RE.search(description):
            status = "experimental"
            frozen_reason = None
        else:
            status = "active"
            frozen_reason = None

        category = guess_category(d.name, description)
        depends_on = build_depends_on(d.name, content, names)

        results.append({
            "id": d.name,
            "category": category,
            "status": status,
            "frozen_reason": frozen_reason,
            "description": description,
            "trigger_text": trigger_text,
            "line_count": line_count,
            "ref_file_count": ref_file_count,
            "has_tool_table": has_tool_table,
            "depends_on": depends_on,
            "last_updated_at": last_updated_at,
            "last_updated_source": source,
            # SKILL.md本文(フロントマター込み)。/skills/[id] 詳細画面の
            # Markdownレンダリングに使う(W7-3)。Windows常駐Postgresは
            # .claude/skills/ を直接読めないため、メタデータと同様にここで同期する。
            "content": content,
        })

    return results, missing_trigger


def post_skills(api_url: str, token: str, payload: list):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        api_url, data=body, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="Walkers .claude/skills を走査し mission-control の /api/skills/sync へ同期する")
    parser.add_argument("api_url", help="/api/skills/sync のフルURL")
    parser.add_argument("--token", default=None, help="CRON_SECRET(省略時は環境変数 CRON_SECRET を使う)")
    parser.add_argument("--dry-run", action="store_true", help="POSTせず抽出結果のJSONを表示するだけ")
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="Walkersルートパス")
    args = parser.parse_args()

    root = pathlib.Path(args.root)
    skills, missing_trigger = scan_skills(root)

    print(f"scanned {len(skills)} skills from {root / '.claude' / 'skills'}")
    if missing_trigger:
        print(f"  trigger_text 未検出: {len(missing_trigger)}件 ({', '.join(missing_trigger)})")

    if args.dry_run:
        print(json.dumps(skills, ensure_ascii=False, indent=2))
        return

    token = args.token or os.environ.get("CRON_SECRET")
    if not token:
        print("ERROR: --token か環境変数 CRON_SECRET のいずれかが必要です", file=sys.stderr)
        sys.exit(1)

    try:
        status, data = post_skills(args.api_url, token, skills)
    except urllib.error.HTTPError as e:
        print(f"ERROR: HTTP {e.code} {e.reason}: {e.read().decode('utf-8', 'replace')}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"ERROR: 接続失敗: {e.reason}", file=sys.stderr)
        sys.exit(1)

    print(f"POST {args.api_url} -> {status}")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    if data.get("errors"):
        sys.exit(1)


if __name__ == "__main__":
    main()
