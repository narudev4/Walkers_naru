from pathlib import Path

from thumbnail_brief import extract_project_title


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


if __name__ == "__main__":
    import tempfile

    tests = [
        test_extract_title_prefers_script_title案,
        test_extract_title_falls_back_to_script_h2,
    ]
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        for test in tests:
            test_dir = base / test.__name__
            test_dir.mkdir()
            test(test_dir)
    print("PASS")
