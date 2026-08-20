#!/usr/bin/env python3
"""
minutes.md → スプシ「雑タスク」A列に入るブロック を抽出する dry-run スクリプト。

使い方:
  python extract.py <path/to/minutes.md>     # 1ファイル
  python extract.py --all                    # 03_projects 配下の全 minutes.md

ブロック仕様 (naru の手書きパターンに合わせる):
  【案件名】
  [YYYY-MM-DD 会議名]
  ・[ ] @担当: 内容（期限）
  ・[ ] @担当: 内容（期限）
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path("/Users/naru/Walkers_naru")


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """YAML frontmatter を簡易 parse (top-level の key: value のみ拾う)."""
    m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not m:
        return {}, text
    fm: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if line and not line.startswith((" ", "\t", "-")) and ":" in line:
            k, _, v = line.partition(":")
            fm[k.strip()] = v.strip()
    return fm, text[m.end():]


def extract_section(body: str, heading: str) -> str:
    """`## 見出し` ブロックを抜き出す (次の `## ` または文末まで)."""
    pattern = rf"^##\s+{re.escape(heading)}\s*\n(.*?)(?=^##\s+|\Z)"
    m = re.search(pattern, body, re.MULTILINE | re.DOTALL)
    return m.group(1).strip() if m else ""


def clean_action(line: str) -> str:
    """`- [ ] **@担当（補足）**: 内容（期限）` → `@担当: 内容（期限）`."""
    s = re.sub(r"^-\s*\[[ xX]\]\s*", "", line).strip()
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"^(@[^\s（:]+)（[^）]*?）", r"\1", s)
    return s


def extract_actions(section_text: str) -> list[str]:
    return [
        clean_action(line)
        for line in section_text.splitlines()
        if re.match(r"^-\s*\[[ xX]\]", line)
    ]


def project_name(fm: dict[str, str], path: Path) -> str:
    """案件名: frontmatter `案件:` 優先、なければ 03_projects/<dir> から."""
    if fm.get("案件"):
        return fm["案件"]
    try:
        return path.relative_to(ROOT / "03_projects").parts[0].strip()
    except ValueError:
        return path.parent.parent.parent.name.strip()


def meeting_label(fm: dict[str, str], path: Path) -> str:
    """日付 + 会議名 (`YYYY-MM-DD 会議名` 形式)."""
    date = fm.get("日時", "").split(" ")[0]
    meeting = fm.get("会議", "")
    if not (date and meeting):
        dn = path.parent.name
        m = re.match(r"(\d{4}-\d{2}-\d{2})_(.+)", dn)
        if m:
            date = date or m.group(1)
            meeting = meeting or m.group(2).replace("_", " ")
    return f"{date} {meeting}".strip()


def build_block(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(text)
    proj = project_name(fm, path)
    label = meeting_label(fm, path)
    actions = extract_actions(extract_section(body, "ネクストアクション"))

    lines = [f"【{proj}】", f"[{label}]"]
    if actions:
        lines.extend(f"・[ ] {a}" for a in actions)
    else:
        lines.append("（ネクストアクション抽出なし — 議事録の体裁を確認）")
    return "\n".join(lines)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("path", nargs="?", help="minutes.md のパス")
    p.add_argument("--all", action="store_true", help="03_projects 配下の全件")
    args = p.parse_args()

    if args.all:
        files = sorted((ROOT / "03_projects").rglob("minutes.md"))
    elif args.path:
        files = [Path(args.path)]
    else:
        p.error("path か --all を指定してください")
        return 2

    sep = "\n" + "=" * 64 + "\n"
    blocks = []
    for f in files:
        try:
            blk = build_block(f)
            try:
                rel = f.relative_to(ROOT)
            except ValueError:
                rel = f
            blocks.append(f"{blk}\n\n[source] {rel}")
        except Exception as e:
            blocks.append(f"[ERROR] {f}: {type(e).__name__}: {e}")
    print(sep.join(blocks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
