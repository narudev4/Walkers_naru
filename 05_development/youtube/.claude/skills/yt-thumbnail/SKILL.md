---
description: Walkers YouTube thumbnail generation with local Houta references and imagegen
---

# yt-thumbnail

## Purpose

Generate a Walkers-style YouTube thumbnail for a project or title. The output is a 1280x720 thumbnail that preserves the video's core title meaning, uses local Houta identity photos, borrows composition cues from recent channel thumbnails, and is generated with `imagegen`.

## Inputs

`$ARGUMENTS` may be:

- A project slug: read `projects/{slug}/`.
- A title string: use it directly and create artifacts in a sensible project thumbnail directory only when a project is known.
- Empty: infer the latest project under `projects/`.

For a project, read title sources in this order:

1. `projects/{slug}/script.md`
   - Prefer `**タイトル案**: ...`.
   - Fall back to the first `## ...` heading.
2. `projects/{slug}/article.md`
   - Use frontmatter `title:` as supporting context when present.
   - Use major headings only to resolve ambiguity.
3. `projects/{slug}/audio/whisper_segments.json`
   - Optional supporting context only when title and script are ambiguous.

## Required Local References

Read these files before choosing copy or references:

- `assets/houta/learning/thumbnail_style_rules_v0.md`
- `assets/houta/reference_thumbnails/metadata.tsv`
- `assets/houta/reference_thumbnails/contact_sheet.jpg`
- Relevant files under `assets/houta/reference_thumbnails/originals/`
- Relevant files under `assets/houta/source_photos/`

Use `_shared/yt-thumbnail/thumbnail_brief.py` helpers where practical for title extraction, style classification, copy candidates, metadata loading, and artifact writing.

## Workflow

1. Resolve the project slug or title.
2. Extract the project title from `script.md`; compare `article.md` when available.
3. Read the learning file and metadata TSV.
4. Classify the style group with the helper:
   - `tool-explainer`
   - `claude-code-list`
   - `risk-failure-security`
   - `method-howto`
   - `cost-schedule`
   - `comparison`
   - `opinion-market`
5. Generate exactly 3 thumbnail copy candidates.
6. Select the strongest candidate, favoring title fidelity and mobile readability.
7. Select 3-6 past thumbnails and 2-4 Houta photos.
8. Create `projects/{slug}/thumbnail/` artifacts before image generation:
   - `copy_candidates.md`
   - `selected_references.md`
   - `prompt.md`
9. Call `imagegen` with the selected references and prompt.
10. Save the final image to:
    - `projects/{slug}/thumbnail/thumbnail.png`
    - `projects/{slug}/thumbnail.png`
11. Write `projects/{slug}/thumbnail/review.md` after quality review.

## Copy Rules

The thumbnail copy is a compression of the video title, not a new hook.

- Keep the main product, tool, or topic name.
- Keep strong title nouns such as `完全解説`, `とは?`, `N選`, `失敗事例`, `収益化方法`, `費用・相場`, `VS`, and `セキュリティ`.
- Keep numbers and make them visually important.
- Remove SEO wrappers and long tails such as `【2026年最新】`, `特徴や料金`, `使い方まで`, and `対策まで完全解説`.
- Split the copy into 2-5 large visual blocks.
- Do not replace the title with an unrelated viewer-language hook.
- Specialist terms are allowed when they are the video's central subject.

## Reference Selection

Choose references according to the classified style:

- `tool-explainer`: bright, clear thumbnails; smiling or neutral presenter pose.
- `claude-code-list`: recent Claude Code thumbnails with large `ClaudeCode` and oversized number treatment.
- `risk-failure-security`: dark, red, purple, warning, serious pose, crossed arms, thinking pose, or warning gesture.
- `method-howto`: clear step or flow compositions.
- `cost-schedule`: money, schedule, question-style compositions.
- `comparison`: sparse two-side layout with strong `VS`.
- `opinion-market`: serious or analytical pose and argument-driven composition.

Record selected paths in `selected_references.md`. Give each selected image a role in the prompt instead of attaching references without explanation.

## Imagegen Prompt Construction

The prompt must include:

- Output: YouTube thumbnail, 1280x720.
- Exact thumbnail copy and block order.
- Style group.
- Past thumbnail references and what to borrow from each.
- Houta photo references and what identity details to preserve.
- Layout direction: text placement, Houta placement, background, color, emphasis, and empty space.
- Avoidances: distorted face, unreadable text, extra Japanese or English text, unrelated objects, off-brand palette, and important text under the YouTube time badge area.

If text fidelity is poor, simplify the copy blocks while preserving the title meaning. If Houta's face drifts, increase identity emphasis and use fewer style transformations on the person.

## Output Files

For every project run, produce:

- `projects/{slug}/thumbnail/copy_candidates.md`
- `projects/{slug}/thumbnail/selected_references.md`
- `projects/{slug}/thumbnail/prompt.md`
- `projects/{slug}/thumbnail/review.md`
- `projects/{slug}/thumbnail/thumbnail.png`
- `projects/{slug}/thumbnail.png`

Do not commit generated run artifacts unless the user explicitly asks.

## Quality Review

Before finishing, review the generated thumbnail and write `review.md` covering:

- Title fidelity: copy preserves the video's core meaning.
- Channel fit: visual style matches the learned Walkers reference set.
- Houta fidelity: face, hair, suit, and overall identity remain plausible.
- Readability: main words are legible at mobile thumbnail size.
- Composition: no important text sits under the time badge area.
- Text discipline: no hallucinated phrases, extra labels, or broken Japanese.
- Visual priority: the most important word or number is the largest element.

If the output fails materially, produce a concise regeneration instruction and retry when appropriate.
