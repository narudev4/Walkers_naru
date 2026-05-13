from pathlib import Path
import inspect

from thumbnail_brief import (
    classify_style,
    extract_project_title,
    generate_copy_candidates,
    load_reference_metadata,
    write_run_artifacts,
)


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


def test_copy_candidates_keep_main_topic_and_number():
    title = "【事例付き】ClaudeCodeで作ったアプリを収益化する方法11選"
    candidates = generate_copy_candidates(title, "claude-code-list")
    joined = "\n".join(" / ".join(c) for c in candidates)
    assert "ClaudeCode" in joined
    assert "収益化" in joined
    assert "11選" in joined


def test_copy_candidates_remove_seo_tail():
    title = "【2026年最新】Web開発AIツール「Bolt」とは？使い方や商用利用まで完全解説！"
    candidates = generate_copy_candidates(title, "tool-explainer")
    joined = "\n".join(" / ".join(c) for c in candidates)
    assert "2026年最新" not in joined
    assert "使い方や商用利用まで" not in joined
    assert "Bolt" in joined


def test_write_run_artifacts(tmp_path):
    out = tmp_path / "thumbnail"
    write_run_artifacts(
        out,
        title="Sample Title",
        style="tool-explainer",
        candidates=[["Sample", "とは?", "完全解説"]],
        selected_refs=["assets/houta/reference_thumbnails/originals/01_x.jpg"],
        selected_photos=["assets/houta/source_photos/IMG_2900.JPG"],
        prompt="Prompt text",
    )
    assert (out / "copy_candidates.md").exists()
    assert (out / "selected_references.md").exists()
    assert (out / "prompt.md").exists()


if __name__ == "__main__":
    import tempfile

    tests = [
        test_extract_title_prefers_script_title案,
        test_extract_title_falls_back_to_script_h2,
        test_classifies_tool_explainer,
        test_classifies_risk_failure_security,
        test_load_reference_metadata,
        test_copy_candidates_keep_main_topic_and_number,
        test_copy_candidates_remove_seo_tail,
        test_write_run_artifacts,
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
