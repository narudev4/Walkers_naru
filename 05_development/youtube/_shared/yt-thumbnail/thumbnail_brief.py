import csv
from pathlib import Path
import re


def load_reference_metadata(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def classify_style(title: str) -> str:
    if "VS" in title or "どちらを選ぶ" in title:
        return "comparison"
    if any(keyword in title for keyword in ("費用", "相場", "期間", "スケジュール")):
        return "cost-schedule"
    if any(
        keyword in title
        for keyword in ("失敗", "危険", "セキュリティ", "事故", "限界", "できないこと")
    ):
        return "risk-failure-security"
    if any(keyword in title for keyword in ("流れ", "手順", "方法", "STEP")):
        return "method-howto"
    if "Claude" in title and any(keyword in title for keyword in ("選", "まとめ", "起業", "収益化")):
        return "claude-code-list"
    if any(keyword in title for keyword in ("とは", "完全解説", "特徴", "料金", "使い方")):
        return "tool-explainer"
    return "opinion-market"


def extract_project_title(project_dir: Path) -> str:
    script = project_dir / "script.md"
    article = project_dir / "article.md"
    if script.exists():
        text = script.read_text(encoding="utf-8")
        m = re.search(r"^\*\*タイトル案\*\*:\s*(.+)$", text, re.MULTILINE)
        if m:
            return m.group(1).strip()
        m = re.search(r"^##\s+(.+)$", text, re.MULTILINE)
        if m:
            return m.group(1).strip()
    if article.exists():
        text = article.read_text(encoding="utf-8")
        m = re.search(r"^title:\s*(.+)$", text, re.MULTILINE)
        if m:
            return m.group(1).strip()
        m = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
        if m:
            return m.group(1).strip()
    raise FileNotFoundError(f"No title source found in {project_dir}")
