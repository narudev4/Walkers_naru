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


def generate_copy_candidates(title: str, style: str) -> list[list[str]]:
    cleaned = _clean_title(title)
    number = _extract_number_phrase(cleaned)
    tool = _extract_tool_name(cleaned)
    topic = _extract_topic(cleaned, tool)

    if style == "claude-code-list":
        topic_block = _claude_topic_block(cleaned)
        candidates = [
            ["ClaudeCode開発", topic_block, number or "まとめ"],
            ["ClaudeCode", topic_block, number or "完全解説"],
            ["ClaudeCodeで", topic_block, number or "方法まとめ"],
        ]
    elif style == "tool-explainer":
        about = f"{tool}とは?" if tool else "ツールとは?"
        category = topic or "AIツール"
        candidates = [
            [category, about, "完全解説"],
            [tool or category, "特徴まとめ", "完全解説"],
            [category, tool or "使えるツール", "とは?"],
        ]
    elif style == "risk-failure-security":
        risk = _risk_topic_block(cleaned)
        candidates = [
            [tool or "ClaudeCode", risk, number or "完全解説"],
            [tool or "ClaudeCodeで", "実際に起きた", risk],
            [tool or "AI開発", risk, "対策まとめ"],
        ]
    elif style == "comparison":
        parts = re.split(r"\s*VS\s*|どちらを選ぶ.*", cleaned, maxsplit=1)
        left = parts[0].strip(" ?？") or "選択肢A"
        right = parts[1].strip(" ?？") if len(parts) > 1 and parts[1].strip() else "選択肢B"
        candidates = [[left, "VS", right], [left, "どちらを選ぶ?", right], ["徹底比較", left, right]]
    elif style == "cost-schedule":
        candidates = [
            [topic or cleaned, "費用・相場", "っていくら?"],
            [topic or cleaned, "開発期間", "まとめ"],
            [topic or cleaned, "費用と期間", "完全解説"],
        ]
    elif style == "method-howto":
        candidates = [
            [topic or cleaned, "開発の流れ", number or "手順まとめ"],
            [topic or cleaned, "方法", number or "完全解説"],
            [topic or cleaned, "はじめ方", number or "STEP解説"],
        ]
    else:
        candidates = [
            [topic or cleaned, "生き残る条件", "完全解説"],
            [topic or cleaned, "今後どうなる?", "まとめ"],
            [topic or cleaned, "重要ポイント", "解説"],
        ]

    return [_compact_blocks(candidate) for candidate in candidates[:3]]


def write_run_artifacts(
    out_dir: Path,
    *,
    title: str,
    style: str,
    candidates: list[list[str]],
    selected_refs: list[str],
    selected_photos: list[str],
    prompt: str,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "copy_candidates.md").write_text(
        _format_copy_candidates(title, style, candidates),
        encoding="utf-8",
    )
    (out_dir / "selected_references.md").write_text(
        _format_selected_references(selected_refs, selected_photos),
        encoding="utf-8",
    )
    (out_dir / "prompt.md").write_text(prompt.rstrip() + "\n", encoding="utf-8")


def _format_copy_candidates(title: str, style: str, candidates: list[list[str]]) -> str:
    lines = [
        "# Thumbnail Copy Candidates",
        "",
        f"- Title: {title}",
        f"- Style: {style}",
        "",
    ]
    for index, candidate in enumerate(candidates, start=1):
        lines.append(f"{index}. {' / '.join(candidate)}")
    return "\n".join(lines) + "\n"


def _format_selected_references(selected_refs: list[str], selected_photos: list[str]) -> str:
    lines = ["# Selected References", "", "## Past Thumbnails"]
    lines.extend(f"- {path}" for path in selected_refs)
    lines.extend(["", "## Houta Photos"])
    lines.extend(f"- {path}" for path in selected_photos)
    return "\n".join(lines) + "\n"


def _clean_title(title: str) -> str:
    text = re.sub(r"^【[^】]+】", "", title).strip()
    text = re.split(r"[｜|]", text, maxsplit=1)[0].strip()
    replacements = (
        "特徴や料金、",
        "料金や特徴、",
        "特徴から料金まで",
        "使い方や商用利用まで",
        "使い方まで",
        "対策まで",
        "注意点からよくある質問まで",
    )
    for phrase in replacements:
        text = text.replace(phrase, "")
    text = text.replace("！", "").replace("!", "")
    return text.strip()


def _extract_number_phrase(text: str) -> str:
    m = re.search(r"\d+\s*(?:選|つ|STEP)", text, re.IGNORECASE)
    return m.group(0).replace(" ", "") if m else ""


def _extract_tool_name(text: str) -> str:
    m = re.search(r"「([^」]+)」", text)
    if m:
        return m.group(1).strip()
    known_names = (
        "ClaudeCode",
        "Claude Code",
        "Framer",
        "Zapier",
        "Make",
        "Glide",
        "Airtable",
        "Bolt",
        "Studio",
        "Lovart",
        "Replit Agent",
        "Codex",
    )
    for name in known_names:
        if name in text:
            return "ClaudeCode" if name == "Claude Code" else name
    return ""


def _extract_topic(text: str, tool: str) -> str:
    if tool and "「" in text:
        before_tool = text.split("「", 1)[0].strip()
        return _trim_topic(before_tool)
    if tool:
        return _trim_topic(text.replace(tool, ""))
    return _trim_topic(re.sub(r"(とは|完全解説).*", "", text))


def _trim_topic(text: str) -> str:
    text = re.sub(r"とは[？?]?.*", "", text)
    text = re.sub(r"完全解説.*", "", text)
    text = text.strip(" ？?")
    return text[:28] if len(text) > 28 else text


def _claude_topic_block(text: str) -> str:
    if "収益化" in text:
        return "収益化方法"
    if "起業" in text:
        return "起業方法"
    if "開発" in text:
        return "開発方法"
    return "活用方法"


def _risk_topic_block(text: str) -> str:
    if "セキュリティ" in text and "事故" in text:
        return "セキュリティ事故"
    if "セキュリティ" in text:
        return "セキュリティ対策"
    if "失敗" in text:
        return "失敗事例"
    if "限界" in text:
        return "限界とは?"
    return "危険ポイント"


def _compact_blocks(blocks: list[str]) -> list[str]:
    compacted = []
    for block in blocks:
        clean = re.sub(r"\s+", " ", block).strip()
        if clean and clean not in compacted:
            compacted.append(clean)
    return compacted


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
