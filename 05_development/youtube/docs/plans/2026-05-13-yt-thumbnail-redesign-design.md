# yt-thumbnail Redesign Design

## Goal

Rebuild `yt-thumbnail` as a Codex-driven YouTube thumbnail generation skill for the Walkers channel. The skill should use local Houta photos, locally saved past channel thumbnails, project titles, article titles, and learned title-to-thumbnail rules to generate stable 1280x720 thumbnails with `imagegen`.

## Context

The previous workflow used ChatGPT image generation directly. Image generation quality was strong, but quality varied because the ChatGPT UI could not reliably inspect many local files, past thumbnails, and Houta reference photos on every run. This redesign moves reference selection, title analysis, prompt construction, and quality review into Codex, while still using `imagegen` for the actual thumbnail image.

The existing `.claude/skills/yt-thumbnail/SKILL.md` is a simple PPTX-based thumbnail generator. It should be treated as replaceable. The new version should keep the same skill name so it stays compatible with the existing YouTube workspace.

## Assets

Primary workspace:

`/Users/naru/Walkers_naru/05_development/youtube`

Prepared Houta assets:

- `assets/houta/source_photos/`: local Houta photo and video素材 copied from `/Users/naru/Desktop/Houta/houta`
- `assets/houta/reference_thumbnails/originals/`: 30 latest channel thumbnails downloaded at 1280x720
- `assets/houta/reference_thumbnails/metadata.tsv`: video ID, title, and local thumbnail path
- `assets/houta/reference_thumbnails/contact_sheet.jpg`: visual contact sheet for the reference set
- `assets/houta/reference_thumbnails/youtube_channel_2026-05-13.html`: fetched channel videos page
- `assets/houta/learning/thumbnail_style_rules_v0.md`: first learned style and copy rules

## Inputs

The skill receives a project slug or infers the latest project.

For `projects/{slug}/`, read in this order:

1. `script.md`
   - Prefer `**タイトル案**: ...`
   - Fall back to the first `## ...` heading
2. `article.md`
   - Use frontmatter `title:` when present
   - Use major headings as supporting context
3. `audio/whisper_segments.json`
   - Optional supporting context only when title and script are ambiguous

Reference data:

1. `assets/houta/learning/thumbnail_style_rules_v0.md`
2. `assets/houta/reference_thumbnails/metadata.tsv`
3. `assets/houta/reference_thumbnails/contact_sheet.jpg`
4. Selected files from `assets/houta/reference_thumbnails/originals/`
5. Selected files from `assets/houta/source_photos/`

## Copy Strategy

The thumbnail copy should be a compression of the video title, not a newly invented hook.

Rules:

- Keep the main product, tool, or topic name.
- Keep strong title nouns such as `完全解説`, `とは?`, `N選`, `失敗事例`, `収益化方法`, `費用・相場`, `VS`, `セキュリティ`.
- Keep numbers and make them visually important.
- Remove SEO wrappers and long tail phrases such as `【2026年最新】`, `特徴や料金`, `使い方まで`, `対策まで完全解説`.
- Split the result into 2-5 large visual blocks.
- Do not turn the title into an unrelated viewer-language hook.
- Specialist terms are allowed when they are the title's main subject. Secondary jargon should be dropped if it competes with the main subject.

Examples:

`【事例付き】ClaudeCodeで作ったアプリを収益化する方法11選`

→ `ClaudeCode開発 / 収益化方法 / 11選`

`【2026年最新】AI搭載のWeb制作ノーコードツール「Framer」とは？特徴や料金、使い方まで完全解説！`

→ `AI搭載のWeb制作ノーコード / Framerとは? / 完全解説`

`【危険】Claude Codeのセキュリティ事故事例5選｜対策まで完全解説`

→ `ClaudeCodeで / 実際に起きた / セキュリティ事故5選`

## Style Classification

Classify each thumbnail into one primary style group before selecting references:

- `tool-explainer`: tool name, `とは?`, `完全解説`
- `claude-code-list`: Claude Code topic with `N選`, methods, or summary
- `risk-failure-security`: failures, risks, security, accidents, limits
- `method-howto`: flow, steps, procedures, development method
- `cost-schedule`: cost, market price, duration, schedule
- `comparison`: `VS`, two options, selection
- `opinion-market`: SaaS survival, market shift, argument-driven topics

The style group determines reference thumbnail selection, Houta photo mood, color palette, and prompt wording.

## Reference Selection

For each run, Codex should select:

- 3-6 past thumbnails from `reference_thumbnails/originals/`
- 2-4 Houta source photos from `source_photos/`

Selection heuristics:

- Tool explainer: smiling or neutral presenter pose; bright, clear visual tone.
- Risk/failure/security: serious, crossed arms, thinking pose, warning gesture; dark/red/purple tone.
- Money/growth: confident smile, open hand gesture.
- Comparison: neutral pose, less emotional composition.
- Opinion/market: serious or analytical pose.

Codex should explicitly record selected references in `projects/{slug}/thumbnail/selected_references.md`.

## Imagegen Strategy

Use `imagegen` as the main image creation engine.

Codex's role before imagegen:

1. Read title, article title, and supporting script context.
2. Produce 3 thumbnail copy candidates.
3. Select the strongest candidate using the learned rules.
4. Select reference thumbnails and Houta photos.
5. Build an imagegen prompt with explicit roles for each reference.

Prompt must include:

- Output size and usage: YouTube thumbnail, 1280x720.
- Exact thumbnail copy.
- Selected style group.
- Past thumbnail style references and what to borrow from each.
- Houta identity references and what to preserve.
- Layout direction: text blocks, Houta placement, background, color, emphasis.
- Avoidances: distorted face, unreadable text, extra English/Japanese text, unrelated objects, off-brand palette.

If `imagegen` output has poor text fidelity, the next iteration should simplify text blocks rather than invent a new title. If Houta's face drifts, increase identity reference emphasis and use fewer style transformations on the person.

## Outputs

For every run, write:

`projects/{slug}/thumbnail/copy_candidates.md`

`projects/{slug}/thumbnail/selected_references.md`

`projects/{slug}/thumbnail/prompt.md`

`projects/{slug}/thumbnail/review.md`

`projects/{slug}/thumbnail/thumbnail.png`

Also copy or symlink the final image to:

`projects/{slug}/thumbnail.png`

## Quality Review

Review generated output before finishing:

- Title fidelity: copy preserves the video title's core meaning.
- Channel fit: looks like the learned Walkers thumbnail set.
- Houta fidelity: face, hair, suit, and overall identity remain plausible.
- Readability: main words are readable at YouTube mobile size.
- Composition: no important text is under the time badge area.
- Text discipline: no hallucinated phrases, extra labels, or broken Japanese.
- Visual priority: the most important word or number is the largest element.

If the output fails, produce a concise regeneration instruction and retry when appropriate.

## Skill Structure

Rewrite:

`/Users/naru/Walkers_naru/05_development/youtube/.claude/skills/yt-thumbnail/SKILL.md`

Keep the skill body concise. It should instruct Codex to read the learning file and local references as needed rather than embedding all learned examples directly.

Recommended sections:

- Purpose
- Inputs
- Required local references
- Workflow
- Copy rules
- Reference selection
- Imagegen prompt construction
- Output files
- Quality review

## Open Decisions

- Whether to keep only the latest 30 thumbnails or add a deeper fetch path using YouTube Data API or `yt-dlp`.
- Whether to make copy candidate confirmation mandatory at first or allow automatic selection.
- Whether to add a deterministic fallback compositing path if imagegen repeatedly distorts Houta's face.

Initial recommendation:

- Start with latest 30 thumbnails.
- Generate 3 copy candidates and auto-select one, but write the candidates to disk for review.
- Keep compositing fallback out of v1 unless face drift remains a practical problem.
