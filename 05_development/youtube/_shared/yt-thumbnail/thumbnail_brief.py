from pathlib import Path
import re


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
