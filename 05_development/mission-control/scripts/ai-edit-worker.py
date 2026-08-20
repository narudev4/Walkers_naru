#!/usr/bin/env python3
"""ai-edit-worker.py — Walkers 司令塔 Phase2 W9-4 (AI編集キュー Mac側常駐ワーカー)

`ai_edit_queue`(mission-control の Postgres, W9-1で追加)を定期ポーリングし、
`status='pending'`の行を見つけたら:
  1. `processing`に更新(`for update skip locked`で同時実行時の二重取得を防止)
  2. 対象の `proposal_versions.html_content` を取得
  3. 指示(prompt)とHTMLを組み立て、`claude -p` をheadless実行
  4. 出力から修正後HTML全体を抽出し `proposal_versions.html_content` をUPDATE、
     `status='done'` に更新(has_placeholderも再計算する)
  5. 失敗時(claudeコマンドの異常終了・JSON解析失敗・不正なtarget_id等)は
     `status='error'` + `result_note` に理由を記録

設計上の注意点(SPEC.md §8.2・IMPLEMENTATION_PLAN.md W9-4を参照):
  - **API従量課金ではなくClaude Codeサブスクセッションを使う設計**。そのため `claude -p`
    実行時に `--bare` は使わない(--bareは`ANTHROPIC_API_KEY`/`apiKeyHelper`経由のAPI課金
    認証のみをサポートしOAuth/keychain認証を意図的に読まない仕様のため、本来の設計意図
    =通常の`claude`コマンドのログインセッションを使う、と矛盾する)
  - `--tools ""` でツール使用を全て無効化する(このワーカーは「HTML全文を渡して修正後の
    HTML全文を受け取るだけ」のテキスト変換であり、ファイル読み書き等のツール呼び出しは
    不要かつ余分なコスト・遅延・誤動作の原因になるため)
  - `claude -p` の実行ディレクトリ(cwd)は**mission-controlリポジトリ内ではなく毎回
    生成する独立の一時ディレクトリ**にする。理由: リポジトリ内で実行すると
    (親リポジトリの).claude/CLAUDE.md 等のプロジェクト文脈が自動読み込まれ、
    本タスクに無関係な文脈やhookが紛れ込みうる。必要な文脈(HTML本文・指示)は
    プロンプトに全て埋め込んでいるため、cwdは中立な場所でよい
  - `--output-format json` (非ストリーミングの単一JSON) を使う。walkers-dashboard の
    `claude_session_hub.py quick_run()` は `stream-json --verbose` を使うが、あちらは
    ライブ表示のための逐次出力が目的。本ワーカーは最終結果のみ要るため単純なjsonで足りる

依存: Python標準ライブラリ + **psycopg2**(このリポジトリのNext.js本体の依存管理外。
IMPLEMENTATION_PLAN.md 絶対ルール6の例外として、このスクリプト専用の追加依存として
明示的に許容されている。導入: `pip install psycopg2-binary`。実行環境のPythonが
`~/.browser-use-env` 等の別venvに切り替わっている場合、そのpython3にも
`python3 -m pip install psycopg2-binary`(pip自体が無ければ `python3 -m ensurepip` を先に)
が必要な場合がある——詳細はPLAN_PROGRESS.mdのW9-4エントリ参照)。

使い方:
  python3 ai-edit-worker.py [DATABASE_URL] [--interval 10] [--claude-timeout 180] [--once]

  DATABASE_URL   Postgres接続文字列。省略時は環境変数 DATABASE_URL を使う
                 (このスクリプト自体には秘密情報を書き込まない)
  --interval     ポーリング間隔(秒、既定10。SPEC.md §8.2の「例10秒間隔」に準拠)
  --claude-timeout  claude -p 1回あたりのタイムアウト秒(既定180)
  --once         pending行を最大1件処理したら終了する(常駐せず1回だけ回す動作確認用。
                 launchdでの常駐化はW9-4のスコープ外=手動起動での動作確認まで)

冪等性・安全性:
  - `for update skip locked` により、同じ行を複数ワーカーが同時に処理することはない
  - target_kind が 'proposal_version' 以外、または target_id が存在しない場合は
    即座に status='error' にして次の行へ進む(クラッシュしない)
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from typing import Optional

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print(
        "psycopg2 が見つかりません。`pip install psycopg2-binary` を実行してください"
        "(このスクリプト専用の依存です。詳細はファイル冒頭のdocstring参照)。",
        file=sys.stderr,
    )
    sys.exit(1)


# 修正後HTML全文が ```html ... ``` / ``` ... ``` で囲まれて返ってきた場合にフェンスを剥がす。
FENCE_RE = re.compile(r"^```(?:html)?\s*\n(.*?)\n```$", re.DOTALL)

# has_placeholder再計算用(src/lib/proposals.ts の detectPlaceholder() と同じパターン。
# TypeScript側とPython側で二重実装になるが、Python側からTSモジュールを直接importできない
# ため、簡易ヒューリスティックとして同一の正規表現をここに複製している)。
PLACEHOLDER_PATTERNS = [
    re.compile(r"◯◯|○○|××|✕✕"),
    re.compile(r"\{\{[^}]*\}\}"),
    re.compile(r"\[\[[^\]]*\]\]"),
    re.compile(r"【(?:要確認|未定|仮|TBD)[^】]*】"),
    re.compile(r"\bTBD\b|\bTODO\b", re.IGNORECASE),
]


def detect_placeholder(html: str) -> bool:
    return any(p.search(html) for p in PLACEHOLDER_PATTERNS)


def extract_html(text: str) -> str:
    text = text.strip()
    m = FENCE_RE.match(text)
    if m:
        return m.group(1).strip()
    return text


def build_prompt(instruction: str, html: str) -> str:
    return (
        "あなたはHTML編集アシスタントです。以下の「対象HTML」に対して、「指示」の内容だけを"
        "反映するように修正してください。\n\n"
        "制約:\n"
        "- 指示に関係のない箇所は変更しないでください\n"
        "- 出力は修正後のHTML全文のみとしてください。前置き・説明文・コードフェンス(```)は"
        "一切付けないでください\n"
        "- HTML以外の文字列(Markdown記法や補足コメント)を混ぜないでください\n\n"
        f"# 指示\n{instruction}\n\n"
        f"# 対象HTML\n{html}"
    )


def run_claude_edit(prompt: str, cwd: str, timeout_sec: int) -> dict:
    """claude -p をheadless実行し、{"ok": True, "html": ..., ...} または
    {"ok": False, "error": "..."} を返す。"""
    cmd = [
        "claude",
        "-p",
        prompt,
        "--output-format",
        "json",
        "--permission-mode",
        "auto",
        "--tools",
        "",
    ]
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"claude実行がタイムアウトしました({timeout_sec}秒)"}
    except FileNotFoundError:
        return {"ok": False, "error": "claudeコマンドが見つかりません(PATHを確認してください)"}

    stdout = (proc.stdout or "").strip()
    if not stdout:
        stderr = (proc.stderr or "").strip()
        return {
            "ok": False,
            "error": f"claudeが標準出力を返しませんでした(exit={proc.returncode}, stderr={stderr[:300]!r})",
        }

    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return {"ok": False, "error": f"claude出力のJSON解析に失敗しました: {stdout[:300]!r}"}

    if payload.get("is_error"):
        return {"ok": False, "error": f"claude実行エラー: {str(payload.get('result', ''))[:300]}"}

    result_text = payload.get("result")
    if not isinstance(result_text, str) or not result_text.strip():
        return {"ok": False, "error": "claudeの応答が空でした"}

    html = extract_html(result_text)
    if "<" not in html or ">" not in html:
        return {"ok": False, "error": f"claudeの応答がHTMLに見えません: {html[:200]!r}"}

    return {
        "ok": True,
        "html": html,
        "cost_usd": payload.get("total_cost_usd"),
        "duration_ms": payload.get("duration_ms"),
    }


def claim_pending(conn) -> Optional[dict]:
    """status='pending'の最古の1件を'processing'に更新して取得する。
    `for update skip locked` により複数ワーカー並行実行時の二重取得を防ぐ。"""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            update ai_edit_queue
            set status = 'processing'
            where id = (
                select id from ai_edit_queue
                where status = 'pending'
                order by created_at
                limit 1
                for update skip locked
            )
            returning id, target_kind, target_id, prompt
            """
        )
        row = cur.fetchone()
    conn.commit()
    return dict(row) if row else None


def mark_error(conn, queue_id: int, message: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "update ai_edit_queue set status = 'error', processed_at = now(), result_note = %s where id = %s",
            (message[:2000], queue_id),
        )
    conn.commit()
    print(f"[ai-edit-worker] queue id={queue_id} -> error: {message}", file=sys.stderr)


def process_one(conn, row: dict, cwd: str, timeout_sec: int) -> None:
    queue_id = row["id"]
    target_kind = row["target_kind"]
    target_id = row["target_id"]

    if target_kind != "proposal_version":
        mark_error(conn, queue_id, f"未対応のtarget_kindです: {target_kind}")
        return

    with conn.cursor() as cur:
        cur.execute("select html_content from proposal_versions where id = %s", (target_id,))
        found = cur.fetchone()
    if not found:
        mark_error(conn, queue_id, f"対象のバージョンが見つかりません: proposal_versions.id={target_id}")
        return

    html_content = found[0]
    prompt_text = build_prompt(row["prompt"], html_content)

    print(f"[ai-edit-worker] queue id={queue_id} target=proposal_version:{target_id} 実行中…")
    result = run_claude_edit(prompt_text, cwd, timeout_sec)

    if not result["ok"]:
        mark_error(conn, queue_id, result["error"])
        return

    new_html = result["html"]
    has_placeholder = detect_placeholder(new_html)

    with conn.cursor() as cur:
        cur.execute(
            "update proposal_versions set html_content = %s, has_placeholder = %s where id = %s",
            (new_html, has_placeholder, target_id),
        )
        note = f"AI編集完了(cost=${result.get('cost_usd')}, {result.get('duration_ms')}ms)"
        cur.execute(
            "update ai_edit_queue set status = 'done', processed_at = now(), result_note = %s where id = %s",
            (note, queue_id),
        )
    conn.commit()
    print(f"[ai-edit-worker] queue id={queue_id} -> done ({note})")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ai_edit_queueをポーリングしclaude -pでHTML編集を行うワーカー")
    parser.add_argument("database_url", nargs="?", help="Postgres接続文字列(省略時は環境変数DATABASE_URL)")
    parser.add_argument("--interval", type=int, default=10, help="ポーリング間隔(秒、既定10)")
    parser.add_argument("--claude-timeout", type=int, default=180, help="claude -p 1回あたりのタイムアウト秒(既定180)")
    parser.add_argument(
        "--once",
        action="store_true",
        help="pending行を最大1件処理したら終了する(常駐せず1回だけ回す動作確認用)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    database_url = args.database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        print(
            "DATABASE_URLが指定されていません(第1引数または環境変数DATABASE_URLで指定してください)",
            file=sys.stderr,
        )
        sys.exit(1)

    cwd = tempfile.mkdtemp(prefix="ai-edit-worker-")
    conn = psycopg2.connect(database_url)
    conn.autocommit = False

    print(f"[ai-edit-worker] 起動。interval={args.interval}s once={args.once} cwd={cwd}")
    try:
        while True:
            row = claim_pending(conn)
            if row:
                process_one(conn, row, cwd, args.claude_timeout)
            elif args.once:
                print("[ai-edit-worker] pending行なし(--onceのため終了)")

            if args.once:
                break
            time.sleep(args.interval)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
