from pathlib import Path
import inspect

from thumbnail_brief import classify_style, extract_project_title, load_reference_metadata


def test_extract_title_prefers_script_title案(tmp_path):
    project = tmp_path / "sample"
    project.mkdir()
    (project / "script.md").write_text(
        "# YouTube動画 台本\n"
        "## Fallback Heading\n\n"
        "**タイトル案**: ClaudeCodeで作ったアプリを収益化する方法11選\n",
        encoding="utf-8",
    )
    assert extract_project_title(project) == "ClaudeCodeで作ったアプリを収益化する方法11選"


def test_extract_title_falls_back_to_script_h2(tmp_path):
    project = tmp_path / "sample"
    project.mkdir()
    (project / "script.md").write_text("# YouTube動画 台本\n## Bubbleとは？完全解説\n", encoding="utf-8")
    assert extract_project_title(project) == "Bubbleとは？完全解説"


def test_classifies_tool_explainer():
    title = "【2026年最新】AI搭載のWeb制作ノーコードツール「Framer」とは？特徴や料金、使い方まで完全解説！"
    assert classify_style(title) == "tool-explainer"


def test_classifies_risk_failure_security():
    title = "【危険】Claude Codeのセキュリティ事故事例5選｜対策まで完全解説"
    assert classify_style(title) == "risk-failure-security"


def test_load_reference_metadata(tmp_path):
    meta = tmp_path / "metadata.tsv"
    meta.write_text(
        "index\tvideo_id\ttitle\tthumbnail_path\n"
        "01\tabc\tSample Title\toriginals/01_abc.jpg\n",
        encoding="utf-8",
    )
    rows = load_reference_metadata(meta)
    assert rows[0]["video_id"] == "abc"


if __name__ == "__main__":
    import tempfile

    tests = [
        test_extract_title_prefers_script_title案,
        test_extract_title_falls_back_to_script_h2,
        test_classifies_tool_explainer,
        test_classifies_risk_failure_security,
        test_load_reference_metadata,
    ]
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        for test in tests:
            if inspect.signature(test).parameters:
                test_dir = base / test.__name__
                test_dir.mkdir()
                test(test_dir)
            else:
                test()
    print("PASS")
