# yt-thumbnail Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild `yt-thumbnail` so Codex can generate Walkers-style YouTube thumbnails from project titles using local Houta photos, downloaded past thumbnails, learned title-to-thumbnail rules, and `imagegen`.

**Architecture:** Keep `.claude/skills/yt-thumbnail/SKILL.md` as the user-facing skill. Add small deterministic helper scripts under `_shared/yt-thumbnail/` for metadata loading, project title extraction, style classification, copy candidate generation, and run artifact writing. The skill uses those helpers to prepare references and prompts, then calls `imagegen` for the final image.

**Tech Stack:** Markdown skills, Python 3 standard library, local filesystem assets, existing Codex `imagegen` skill/tool.

---

### Task 1: Add Thumbnail Helper Module Skeleton

**Files:**
- Create: `/Users/naru/Walkers_naru/05_development/youtube/_shared/yt-thumbnail/thumbnail_brief.py`
- Create: `/Users/naru/Walkers_naru/05_development/youtube/_shared/yt-thumbnail/__init__.py`
- Test: `/Users/naru/Walkers_naru/05_development/youtube/_shared/yt-thumbnail/test_thumbnail_brief.py`

**Step 1: Write failing tests**

Create tests for:

```python
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
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/naru/Walkers_naru/05_development/youtube
python3 _shared/yt-thumbnail/test_thumbnail_brief.py
```

Expected: import or function-not-defined failure.

**Step 3: Implement minimal helpers**

Implement:

```python
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
```

**Step 4: Run tests**

Run:

```bash
cd /Users/naru/Walkers_naru/05_development/youtube
python3 _shared/yt-thumbnail/test_thumbnail_brief.py
```

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Users/naru/Walkers_naru add 05_development/youtube/_shared/yt-thumbnail
git -C /Users/naru/Walkers_naru commit -m "feat: add thumbnail brief helpers"
```

### Task 2: Add Metadata Loading and Style Classification

**Files:**
- Modify: `/Users/naru/Walkers_naru/05_development/youtube/_shared/yt-thumbnail/thumbnail_brief.py`
- Test: `/Users/naru/Walkers_naru/05_development/youtube/_shared/yt-thumbnail/test_thumbnail_brief.py`

**Step 1: Write failing tests**

Add tests for:

```python
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
```

**Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/naru/Walkers_naru/05_development/youtube
python3 _shared/yt-thumbnail/test_thumbnail_brief.py
```

Expected: missing functions fail.

**Step 3: Implement classification and metadata parsing**

Implement keyword-based `classify_style(title)`:

- `VS`, `どちらを選ぶ` -> `comparison`
- `費用`, `相場`, `期間`, `スケジュール` -> `cost-schedule`
- `失敗`, `危険`, `セキュリティ`, `事故`, `限界`, `できないこと` -> `risk-failure-security`
- `流れ`, `手順`, `方法`, `STEP` -> `method-howto`
- `Claude` and `選`/`まとめ`/`起業`/`収益化` -> `claude-code-list`
- `とは`, `完全解説`, `特徴`, `料金`, `使い方` -> `tool-explainer`
- otherwise `opinion-market`

Implement `load_reference_metadata(path)` with `csv.DictReader(delimiter="\t")`.

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Users/naru/Walkers_naru add 05_development/youtube/_shared/yt-thumbnail
git -C /Users/naru/Walkers_naru commit -m "feat: classify thumbnail styles"
```

### Task 3: Generate Title-Preserving Copy Candidates

**Files:**
- Modify: `/Users/naru/Walkers_naru/05_development/youtube/_shared/yt-thumbnail/thumbnail_brief.py`
- Test: `/Users/naru/Walkers_naru/05_development/youtube/_shared/yt-thumbnail/test_thumbnail_brief.py`

**Step 1: Write failing tests**

Add tests:

```python
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
```

**Step 2: Run tests**

Expected: missing function failure.

**Step 3: Implement copy generation**

Implement conservative string cleanup:

- Strip bracket prefixes like `【...】`.
- Remove SEO tails after `｜`.
- Remove phrases `特徴や料金`, `料金や特徴`, `使い方まで`, `完全解説！` only when generating blocks.
- Extract quoted tool names from `「...」`, or known names from a list.
- Preserve `N選`, `Nつ`, `NSTEP`, `とは？`, `完全解説`.

Return exactly three candidates as `list[list[str]]`.

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Users/naru/Walkers_naru add 05_development/youtube/_shared/yt-thumbnail
git -C /Users/naru/Walkers_naru commit -m "feat: generate thumbnail copy candidates"
```

### Task 4: Add Brief Artifact Writer

**Files:**
- Modify: `/Users/naru/Walkers_naru/05_development/youtube/_shared/yt-thumbnail/thumbnail_brief.py`
- Test: `/Users/naru/Walkers_naru/05_development/youtube/_shared/yt-thumbnail/test_thumbnail_brief.py`

**Step 1: Write failing test**

```python
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
```

**Step 2: Run tests**

Expected: missing function failure.

**Step 3: Implement writer**

Write markdown files:

- `copy_candidates.md`
- `selected_references.md`
- `prompt.md`

Do not write generated image files here.

**Step 4: Run tests**

Expected: PASS.

**Step 5: Commit**

```bash
git -C /Users/naru/Walkers_naru add 05_development/youtube/_shared/yt-thumbnail
git -C /Users/naru/Walkers_naru commit -m "feat: write thumbnail brief artifacts"
```

### Task 5: Rewrite yt-thumbnail Skill

**Files:**
- Modify: `/Users/naru/Walkers_naru/05_development/youtube/.claude/skills/yt-thumbnail/SKILL.md`

**Step 1: Replace old PPTX workflow**

Rewrite the skill with these sections:

- Purpose
- Inputs
- Required local references
- Workflow
- Copy rules
- Reference selection
- Imagegen prompt construction
- Output files
- Quality review

**Step 2: Required behavior**

The skill must instruct Codex to:

1. Read `assets/houta/learning/thumbnail_style_rules_v0.md`.
2. Extract title from `projects/{slug}/script.md`.
3. Compare `article.md` when available.
4. Use `_shared/yt-thumbnail/thumbnail_brief.py` helpers where practical.
5. Choose relevant past thumbnails and Houta photos.
6. Create `projects/{slug}/thumbnail/` artifacts before image generation.
7. Use `imagegen` for the actual thumbnail.
8. Save final output to `projects/{slug}/thumbnail/thumbnail.png` and `projects/{slug}/thumbnail.png`.

**Step 3: Run a static check**

Run:

```bash
sed -n '1,260p' /Users/naru/Walkers_naru/05_development/youtube/.claude/skills/yt-thumbnail/SKILL.md
```

Expected: no remaining old `python-pptx`/LibreOffice-first workflow as the primary path.

**Step 4: Commit**

```bash
git -C /Users/naru/Walkers_naru add 05_development/youtube/.claude/skills/yt-thumbnail/SKILL.md
git -C /Users/naru/Walkers_naru commit -m "feat: rewrite yt thumbnail skill for imagegen"
```

### Task 6: Add a Refresh References Script

**Files:**
- Create: `/Users/naru/Walkers_naru/05_development/youtube/_shared/yt-thumbnail/refresh_references.py`

**Step 1: Implement script**

Implement a script that:

1. Fetches `https://www.youtube.com/@walkers-development/videos`.
2. Saves HTML as `assets/houta/reference_thumbnails/youtube_channel_YYYY-MM-DD.html`.
3. Extracts visible video IDs and titles from `richItemRenderer`.
4. Writes `metadata.tsv`.
5. Downloads thumbnails to `reference_thumbnails/originals/{index}_{video_id}.jpg`, preferring `maxresdefault.jpg` and falling back to `hqdefault.jpg`.
6. Rebuilds `contact_sheet.jpg` using Pillow.

**Step 2: Run script**

Run:

```bash
cd /Users/naru/Walkers_naru/05_development/youtube
python3 _shared/yt-thumbnail/refresh_references.py --dry-run
```

Expected: prints planned fetch/download paths without writing.

**Step 3: Commit**

```bash
git -C /Users/naru/Walkers_naru add 05_development/youtube/_shared/yt-thumbnail/refresh_references.py
git -C /Users/naru/Walkers_naru commit -m "feat: add thumbnail reference refresh script"
```

### Task 7: Manual End-to-End Dry Run

**Files:**
- No permanent source changes expected.
- Possible generated files under `projects/{slug}/thumbnail/`.

**Step 1: Choose a project**

Use an existing project with `script.md`, such as:

`/Users/naru/Walkers_naru/05_development/youtube/projects/what-is-claudecode`

**Step 2: Run helper manually**

Use the helper module to extract title, classify style, and generate candidates.

Expected:

- Title is extracted from `**タイトル案**`.
- Style is plausible.
- Copy candidates preserve title meaning.

**Step 3: Run the skill manually**

Invoke `/yt-thumbnail what-is-claudecode` in the YouTube workspace.

Expected:

- Creates `projects/what-is-claudecode/thumbnail/copy_candidates.md`
- Creates `selected_references.md`
- Creates `prompt.md`
- Calls `imagegen`
- Saves final image paths

**Step 4: Review**

Check:

- Houta identity remains plausible.
- Text is readable.
- Copy remains close to the title.
- Visual style resembles `contact_sheet.jpg`.

**Step 5: Do not commit generated test thumbnails unless explicitly wanted**

Generated thumbnails are run artifacts. Leave them uncommitted unless the user asks to preserve them in git.
