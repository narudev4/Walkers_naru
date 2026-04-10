"""Deep comparison: tag counts, image HEAD status, raw HTML diff.

This is the re-investigation after realizing 07_diff_analysis.py (text-stripped diff)
missed style-level bugs like <strong> removal and image 404s.
"""
import difflib
import json
import os
import re
import sys
import urllib.request
import urllib.error
import ssl
from collections import Counter

OUT_DIR = "/Users/naru/Walkers_naru/05_development/croix-migration/output"
REPORT = "/Users/naru/Walkers_naru/05_development/croix-migration/output/deep_diff_report.md"

# Ignore SSL for croix.asia (stg has cert issues)
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def tag_counts(html):
    if not html:
        return {}
    c = Counter()
    for tag in ["strong", "b", "em", "p", "br", "img", "iframe", "h1", "h2", "h3", "h4", "figure", "figcaption"]:
        c[tag] = len(re.findall(rf"<{tag}\b", html, flags=re.I))
    return dict(c)


def extract_img_srcs(html):
    return re.findall(r'<img[^>]+src="([^"]+)"', html or "")


def head_check(url, timeout=8):
    """Returns (status, note). Uses GET with Range to be gentler than HEAD for some servers."""
    try:
        req = urllib.request.Request(url, method="HEAD",
                                     headers={"User-Agent": "Mozilla/5.0 croix-migration-check"})
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return r.status, ""
    except urllib.error.HTTPError as e:
        # Some servers return 403/405 for HEAD; fall back to GET Range
        if e.code in (403, 405):
            try:
                req = urllib.request.Request(url,
                                             headers={"User-Agent": "Mozilla/5.0", "Range": "bytes=0-0"})
                with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                    return r.status, "(via GET)"
            except Exception as e2:
                return f"ERR", str(e2)[:60]
        return e.code, ""
    except Exception as e:
        return "ERR", str(e)[:60]


def normalize_for_diff(html):
    """Normalize for visual diff: pretty-ish format."""
    if not html:
        return ""
    h = re.sub(r">\s+<", ">\n<", html)
    # Collapse runs of whitespace
    h = re.sub(r"[ \t]+", " ", h)
    return h


def analyze(path, out):
    d = json.load(open(path))
    stg = d.get("stg_content") or ""
    orig = d.get("orig_html") or ""
    header = f"\n## #{d['stg_id']} {d['nickname']} — {d.get('issue', '')}\n"
    print(header)
    out.append(header)
    out.append(f"- Title: {d['title']}")
    out.append(f"- STG content length: {len(stg)}")
    out.append(f"- ORIG content length: {len(orig)}")

    # Tag counts
    tc_stg = tag_counts(stg)
    tc_orig = tag_counts(orig)
    out.append("\n### Tag counts\n")
    out.append("| tag | STG | ORIG | diff |")
    out.append("|---|---|---|---|")
    all_tags = sorted(set(tc_stg) | set(tc_orig))
    for t in all_tags:
        s = tc_stg.get(t, 0)
        o = tc_orig.get(t, 0)
        flag = "" if s == o else f"**{s - o:+d}**"
        out.append(f"| `{t}` | {s} | {o} | {flag} |")

    # Image HEAD checks
    stg_imgs = extract_img_srcs(stg)
    orig_imgs = extract_img_srcs(orig)
    out.append(f"\n### Images: STG {len(stg_imgs)} / ORIG {len(orig_imgs)}\n")
    out.append("**STG image status:**\n")
    out.append("| # | status | URL |")
    out.append("|---|---|---|")
    for i, src in enumerate(stg_imgs):
        status, note = head_check(src)
        flag = "✅" if status == 200 else "❌"
        short = src if len(src) < 90 else "..." + src[-85:]
        out.append(f"| {i} | {flag} {status} {note} | `{short}` |")

    out.append("\n**ORIG image status (for reference):**\n")
    out.append("| # | status | URL |")
    out.append("|---|---|---|")
    for i, src in enumerate(orig_imgs):
        status, note = head_check(src)
        flag = "✅" if status == 200 else "❌"
        short = src if len(src) < 90 else "..." + src[-85:]
        out.append(f"| {i} | {flag} {status} {note} | `{short}` |")

    # Raw HTML unified diff (first 120 lines)
    stg_lines = normalize_for_diff(stg).splitlines()
    orig_lines = normalize_for_diff(orig).splitlines()
    diff = list(difflib.unified_diff(orig_lines, stg_lines,
                                     fromfile="ORIG", tofile="STG", lineterm="", n=1))
    out.append(f"\n### Raw HTML diff (ORIG → STG, first 120 lines)\n")
    out.append("```diff")
    for l in diff[:120]:
        out.append(l)
    if len(diff) > 120:
        out.append(f"... ({len(diff) - 120} more lines)")
    out.append("```")


def main():
    files = sorted([f for f in os.listdir(OUT_DIR) if f.endswith(".json")])
    out = ["# Deep diff report — M列コメント再調査", ""]
    for fn in files:
        analyze(os.path.join(OUT_DIR, fn), out)
    with open(REPORT, "w") as f:
        f.write("\n".join(out))
    print(f"\n\nWrote report: {REPORT}")


if __name__ == "__main__":
    main()
