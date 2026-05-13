#!/usr/bin/env python3
import argparse
from datetime import date
import json
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


CHANNEL_URL = "https://www.youtube.com/@walkers-development/videos"
MAX_ITEMS = 30


def main() -> None:
    args = parse_args()
    root = Path(__file__).resolve().parents[2]
    ref_dir = root / "assets" / "houta" / "reference_thumbnails"
    originals_dir = ref_dir / "originals"
    html_path = ref_dir / f"youtube_channel_{date.today().isoformat()}.html"
    metadata_path = ref_dir / "metadata.tsv"
    contact_sheet_path = ref_dir / "contact_sheet.jpg"

    if args.dry_run:
        print(f"DRY RUN: fetch {CHANNEL_URL}")
        print(f"DRY RUN: save HTML -> {html_path.relative_to(root)}")
        print(f"DRY RUN: write metadata -> {metadata_path.relative_to(root)}")
        print(f"DRY RUN: download thumbnails -> {originals_dir.relative_to(root)}/NN_videoid.jpg")
        print(f"DRY RUN: rebuild contact sheet -> {contact_sheet_path.relative_to(root)}")
        return

    ref_dir.mkdir(parents=True, exist_ok=True)
    originals_dir.mkdir(parents=True, exist_ok=True)

    html = fetch_text(CHANNEL_URL)
    html_path.write_text(html, encoding="utf-8")

    videos = extract_videos(html)[: args.limit]
    if not videos:
        raise RuntimeError("No videos found in YouTube channel HTML")

    rows = []
    for index, video in enumerate(videos, start=1):
        index_text = f"{index:02d}"
        filename = f"{index_text}_{video['video_id']}.jpg"
        thumbnail_path = originals_dir / filename
        download_thumbnail(video["video_id"], thumbnail_path)
        rows.append(
            {
                "index": index_text,
                "video_id": video["video_id"],
                "title": video["title"],
                "thumbnail_path": f"originals/{filename}",
            }
        )

    write_metadata(metadata_path, rows)
    rebuild_contact_sheet(contact_sheet_path, originals_dir, rows)
    print(f"Updated {len(rows)} reference thumbnails")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh local Walkers thumbnail references")
    parser.add_argument("--dry-run", action="store_true", help="Print planned paths without writing")
    parser.add_argument("--limit", type=int, default=MAX_ITEMS, help="Maximum number of videos to save")
    return parser.parse_args()


def fetch_text(url: str) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
            )
        },
    )
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_videos(html: str) -> list[dict[str, str]]:
    data = extract_yt_initial_data(html)
    videos = []
    seen = set()
    for renderer in iter_video_renderers(data):
        video_id = renderer.get("videoId")
        title = extract_title(renderer.get("title", {}))
        if not video_id or not title or video_id in seen:
            continue
        seen.add(video_id)
        videos.append({"video_id": video_id, "title": title})
    return videos


def extract_yt_initial_data(html: str) -> dict:
    marker = "ytInitialData"
    marker_index = html.find(marker)
    if marker_index == -1:
        raise RuntimeError("ytInitialData not found in HTML")
    equals_index = html.find("=", marker_index)
    if equals_index == -1:
        raise RuntimeError("ytInitialData assignment not found in HTML")
    json_start = html.find("{", equals_index)
    if json_start == -1:
        raise RuntimeError("ytInitialData JSON object not found in HTML")
    decoder = json.JSONDecoder()
    data, _ = decoder.raw_decode(html[json_start:])
    return data


def iter_video_renderers(node):
    if isinstance(node, dict):
        rich_item = node.get("richItemRenderer")
        if isinstance(rich_item, dict):
            content = rich_item.get("content", {})
            renderer = content.get("videoRenderer")
            if isinstance(renderer, dict):
                yield renderer
        for value in node.values():
            yield from iter_video_renderers(value)
    elif isinstance(node, list):
        for item in node:
            yield from iter_video_renderers(item)


def extract_title(title_node: dict) -> str:
    if "simpleText" in title_node:
        return title_node["simpleText"].strip()
    runs = title_node.get("runs", [])
    if runs:
        return "".join(run.get("text", "") for run in runs).strip()
    return ""


def download_thumbnail(video_id: str, output_path: Path) -> None:
    urls = [
        f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
        f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
    ]
    last_error = None
    for url in urls:
        try:
            data = fetch_binary(url)
            output_path.write_bytes(data)
            return
        except (HTTPError, URLError, TimeoutError) as exc:
            last_error = exc
    raise RuntimeError(f"Failed to download thumbnail for {video_id}: {last_error}")


def fetch_binary(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=30) as response:
        return response.read()


def write_metadata(path: Path, rows: list[dict[str, str]]) -> None:
    lines = ["index\tvideo_id\ttitle\tthumbnail_path"]
    for row in rows:
        title = re.sub(r"[\t\r\n]+", " ", row["title"]).strip()
        lines.append(f"{row['index']}\t{row['video_id']}\t{title}\t{row['thumbnail_path']}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def rebuild_contact_sheet(path: Path, originals_dir: Path, rows: list[dict[str, str]]) -> None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as exc:
        raise RuntimeError("Pillow is required to rebuild contact_sheet.jpg") from exc

    thumb_w, thumb_h = 320, 180
    label_h = 34
    cols = 5
    rows_count = (len(rows) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb_w, rows_count * (thumb_h + label_h)), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for offset, row in enumerate(rows):
        src = originals_dir / Path(row["thumbnail_path"]).name
        image = Image.open(src).convert("RGB").resize((thumb_w, thumb_h))
        x = (offset % cols) * thumb_w
        y = (offset // cols) * (thumb_h + label_h)
        sheet.paste(image, (x, y))
        label = f"{row['index']} {row['video_id']}"
        draw.text((x + 6, y + thumb_h + 8), label, fill=(0, 0, 0), font=font)

    sheet.save(path, quality=92)


if __name__ == "__main__":
    main()
