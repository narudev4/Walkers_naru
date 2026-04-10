"""For each saved article JSON, extract just text + key markers and diff
to identify the actual bug.

Strategy: strip HTML tags from both STG and ORIG content, normalize whitespace,
then show the differences. Also list image src/alt and iframe src/dimensions
side-by-side.
"""
import json
import os
import re
import sys
from html.parser import HTMLParser

OUT_DIR = "/Users/naru/Walkers_naru/05_development/croix-migration/output"


class TextStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
    def handle_data(self, data):
        self.parts.append(data)
    def handle_starttag(self, tag, attrs):
        if tag in ("br", "p", "div", "h1", "h2", "h3", "h4", "li"):
            self.parts.append("\n")


def strip(html):
    s = TextStripper()
    s.feed(html or "")
    text = "".join(s.parts)
    # collapse whitespace
    text = re.sub(r"[ \t\u3000]+", " ", text)
    text = re.sub(r"\n\s*\n", "\n", text)
    return text.strip()


def imgs(html):
    """Extract image src + width + height."""
    out = []
    for m in re.finditer(r'<img[^>]+>', html or ""):
        tag = m.group(0)
        src = re.search(r'src="([^"]+)"', tag)
        w = re.search(r'width="([^"]+)"', tag)
        h = re.search(r'height="([^"]+)"', tag)
        out.append({
            "src": src.group(1) if src else None,
            "w": w.group(1) if w else None,
            "h": h.group(1) if h else None,
        })
    return out


def iframes(html):
    out = []
    for m in re.finditer(r'<iframe[^>]+>', html or ""):
        tag = m.group(0)
        src = re.search(r'src="([^"]+)"', tag)
        w = re.search(r'width="([^"]+)"', tag)
        h = re.search(r'height="([^"]+)"', tag)
        out.append({
            "src": src.group(1) if src else None,
            "w": w.group(1) if w else None,
            "h": h.group(1) if h else None,
        })
    return out


def analyze(path):
    d = json.load(open(path))
    print(f"\n{'='*80}")
    print(f"#{d['stg_id']} {d['nickname']} — {d['issue']}")
    print(f"Title: {d['title']}")
    print(f"{'='*80}")
    stg = d.get("stg_content") or ""
    orig = d.get("orig_html") or ""

    stg_text = strip(stg)
    orig_text = strip(orig)
    print(f"STG text length: {len(stg_text)} | ORIG text length: {len(orig_text)}")

    # Image comparison
    stg_imgs = imgs(stg)
    orig_imgs = imgs(orig)
    print(f"\n--- IMAGES (STG: {len(stg_imgs)} | ORIG: {len(orig_imgs)}) ---")
    print("STG imgs:")
    for i, im in enumerate(stg_imgs):
        src = (im['src'] or "")[-80:]
        print(f"  [{i}] {im['w']}x{im['h']} ...{src}")
    print("ORIG imgs:")
    for i, im in enumerate(orig_imgs):
        src = (im['src'] or "")[-80:]
        print(f"  [{i}] {im['w']}x{im['h']} ...{src}")

    # iframe comparison
    stg_ifr = iframes(stg)
    orig_ifr = iframes(orig)
    if stg_ifr or orig_ifr:
        print(f"\n--- IFRAMES (STG: {len(stg_ifr)} | ORIG: {len(orig_ifr)}) ---")
        print("STG iframes:")
        for i, fr in enumerate(stg_ifr):
            print(f"  [{i}] {fr['w']}x{fr['h']} {fr['src']}")
        print("ORIG iframes:")
        for i, fr in enumerate(orig_ifr):
            print(f"  [{i}] {fr['w']}x{fr['h']} {fr['src']}")

    # Text diff: line-by-line presence
    stg_lines = [l.strip() for l in stg_text.split("\n") if l.strip()]
    orig_lines = [l.strip() for l in orig_text.split("\n") if l.strip()]
    stg_set = set(stg_lines)
    orig_set = set(orig_lines)
    only_orig = [l for l in orig_lines if l not in stg_set and len(l) > 4]
    only_stg = [l for l in stg_lines if l not in orig_set and len(l) > 4]
    if only_orig:
        print(f"\n--- ONLY IN ORIG (missing from STG, {len(only_orig)} lines) ---")
        for l in only_orig[:30]:
            print(f"  - {l[:120]}")
    if only_stg:
        print(f"\n--- ONLY IN STG (added on STG, {len(only_stg)} lines) ---")
        for l in only_stg[:30]:
            print(f"  + {l[:120]}")


if __name__ == "__main__":
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for fn in sorted(os.listdir(OUT_DIR)):
        if not fn.endswith(".json"):
            continue
        if only and only not in fn:
            continue
        analyze(os.path.join(OUT_DIR, fn))
