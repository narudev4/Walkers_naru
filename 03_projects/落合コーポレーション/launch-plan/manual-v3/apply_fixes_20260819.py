#!/usr/bin/env python3
# マニュアル v3 修正スクリプト（fix-spec-20260819.md の仕様 1b・2・3）
# - 仕様 1b: band h2 / とびら行の「A-1」等の節プレフィックスを削除
# - 仕様 2 : 各節の先頭ページに id を付与し、本文の「X 章」→「N章」、「X-n」→ P.プレースホルダに変換
# - 仕様 3 : テキストノード内の「日本語文字と半角英数字の間の半角スペース」を削除（P. 21 型の詰めを含む)
# 対象外: m2 の付録 A/B/C の 3 ページ、C-3 見本の表紙・目次ページ、HTML コメント、<style>
import re
import pathlib
from bs4 import BeautifulSoup, NavigableString, Comment, Tag

BASE = pathlib.Path(__file__).parent
LP = BASE.parent

CHAPTER_MAP = {"0": "1", "A": "2", "B": "3", "C": "4", "D": "5", "E": "6"}

# 節 id: m1 は band h2 の「X-n　」プレフィックス（削除前）で自動割当。
# 1章とm2はプレフィックスが無いためタイトル文字列で割当。
TITLE_IDS = {
    "管理画面にログインする": "sec-login",
    "画面の地図（どこに何があるか)".replace(")", "）"): "sec-map",
    "操作するときの": "sec-rules",
    "ご注文の一覧を見る": "sec-c1",
    "都度払いの入金を確認して出荷に回す": "sec-c2",
    "ご注文をキャンセルする": "sec-c4",
    "電話・FAX のご注文を管理画面から入力する": "sec-c5",
    "都度払いの請求は自動で作られます": "sec-d1",
    "請求書の下書きが自動で作られます": "sec-d2",
    "マネーフォワードで「入金済み」にする": "sec-d3",
    "未入金を見つけて連絡する": "sec-d4",
    "返品を記録して、Walkers にご連絡する": "sec-d5",
    "お知らせを追加する": "sec-e1",
    "問い合わせを受け付けて対応を決める": "sec-e2",
    "ご注文の内容を確認して荷造りする": "sec-c3",
}

JP = (
    r"　-〿"   # CJK 記号・句読点（、。「」等）
    r"぀-ヿ"   # ひらがな・カタカナ・ー
    r"ㇰ-ㇿ"
    r"㐀-䶿一-鿿豈-﫿"  # 漢字
    r"！-｠"   # 全角英数・全角括弧
)
AL = r"0-9A-Za-z"
RE_JP_AL = re.compile(rf"(?<=[{JP}]) +(?=[{AL}])")
RE_AL_JP = re.compile(rf"(?<=[{AL}]) +(?=[{JP}])")
RE_PDOT = re.compile(r"P\. +(?=\d)")
RE_SECREF = re.compile(r"([A-E])-([1-5])")
RE_CHAP = re.compile(r"([A-E0]) ?章")

space_count = 0
ref_log = []


def is_skipped_section(sec: Tag, fname: str) -> bool:
    band = sec.find("div", class_="band")
    if band is None:
        return True  # 表紙・目次（band が無いページ）は触らない
    h2 = band.find("h2")
    t = h2.get_text() if h2 else ""
    if t.startswith("付録"):
        return True  # 付録 A/B/C は修正禁止
    return False


def first_text_char_before(node):
    """同一 section 内で node の直前に描画される文字（プレースホルダ span.pref は数字扱い）。"""
    cur = node
    while cur is not None:
        prev = cur.previous_sibling
        while prev is not None:
            if isinstance(prev, Tag) and "pref" in (prev.get("class") or []):
                return "9"
            if isinstance(prev, Comment):
                prev = prev.previous_sibling
                continue
            if isinstance(prev, NavigableString):
                s = str(prev)
                if s.strip():
                    return s.rstrip()[-1]
                prev = prev.previous_sibling
                continue
            t = prev.get_text()
            if t.strip():
                return t.rstrip()[-1]
            prev = prev.previous_sibling
        cur = cur.parent
        if cur is None or (isinstance(cur, Tag) and cur.name == "section"):
            return ""
    return ""


def last_text_char_after(node):
    cur = node
    while cur is not None:
        nxt = cur.next_sibling
        while nxt is not None:
            if isinstance(nxt, Tag) and "pref" in (nxt.get("class") or []):
                return "9"
            if isinstance(nxt, Comment):
                nxt = nxt.next_sibling
                continue
            if isinstance(nxt, NavigableString):
                s = str(nxt)
                if s.strip():
                    return s.lstrip()[0]
                nxt = nxt.next_sibling
                continue
            t = nxt.get_text()
            if t.strip():
                return t.lstrip()[0]
            nxt = nxt.next_sibling
        cur = cur.parent
        if cur is None or (isinstance(cur, Tag) and cur.name == "section"):
            return ""
    return ""


def text_nodes(sec: Tag):
    return [
        n for n in sec.find_all(string=True)
        if not isinstance(n, Comment) and n.parent.name not in ("style", "script")
    ]


def strip_prefixes(sec: Tag):
    """band h2 とびら行 .tt の「X-n　」プレフィックスを削除。id 付与後に呼ぶこと。"""
    targets = []
    band = sec.find("div", class_="band")
    if band and band.find("h2"):
        targets.append(band.find("h2"))
    targets += sec.select(".trow .tt")
    for t in targets:
        for n in t.find_all(string=True):
            if isinstance(n, Comment):
                continue
            new = re.sub(r"^\s*[A-E]-\d[　\s]*", "", str(n))
            if new != str(n):
                ref_log.append(f"  [prefix] {str(n).strip()!r} -> {new.strip()!r}")
                n.replace_with(new)
            break  # 先頭テキストノードのみ


def assign_id(sec: Tag, used: set):
    band = sec.find("div", class_="band")
    h2 = band.find("h2") if band else None
    if h2 is None:
        return
    t = re.sub(r"\s+", " ", h2.get_text()).strip()
    m = re.match(r"^([A-E])-(\d)　", h2.get_text())
    sid = None
    if m:
        sid = f"sec-{m.group(1).lower()}{m.group(2)}"
    else:
        for key, val in TITLE_IDS.items():
            if t.startswith(key):
                sid = val
                break
    if sid and sid not in used:
        sec["id"] = sid
        used.add(sid)
        ref_log.append(f"  [id] {sid} <- {t}")


def convert_refs(sec: Tag, soup: BeautifulSoup):
    for n in text_nodes(sec):
        s = str(n)
        # 章参照
        def chap_sub(m):
            ref_log.append(f"  [章] {m.group(0)!r} -> {CHAPTER_MAP[m.group(1)]}章  ctx={s.strip()[:60]!r}")
            return CHAPTER_MAP[m.group(1)] + "章"
        s2 = RE_CHAP.sub(chap_sub, s)
        if s2 != s:
            n.replace_with(s2)
            n = sec  # placeholder; re-fetch below
        # 節参照はノードを分割して span を挿入する必要があるため別処理
    # 節参照（章参照置換後に再走査）
    for n in text_nodes(sec):
        s = str(n)
        m = RE_SECREF.search(s)
        if not m:
            continue
        parts = []
        pos = 0
        for m in RE_SECREF.finditer(s):
            parts.append(s[pos:m.start()] + "P.")
            span = soup.new_tag("span", attrs={"class": "pref", "data-ref": f"sec-{m.group(1).lower()}{m.group(2)}"})
            parts.append(span)
            ref_log.append(f"  [節] {m.group(0)!r} -> P.(sec-{m.group(1).lower()}{m.group(2)})  ctx={s.strip()[:70]!r}")
            pos = m.end()
        parts.append(s[pos:])
        anchor = n
        for p in parts:
            anchor.insert_before(p if isinstance(p, Tag) else NavigableString(p))
        n.extract()


def remove_spaces(sec: Tag):
    global space_count
    for n in text_nodes(sec):
        s = str(n)
        orig = s
        cnt = 0
        s, c1 = RE_JP_AL.subn("", s)
        s, c2 = RE_AL_JP.subn("", s)
        s, c3 = RE_PDOT.subn("P.", s)
        cnt += c1 + c2 + c3
        # 要素境界（前後の兄弟の描画文字を見て先頭・末尾スペースを判断）
        m = re.match(r"^( +)(?=\S)", s)
        if m and "\n" not in orig[: len(m.group(1))]:
            prev_ch = first_text_char_before(n)
            nxt_ch = s.lstrip()[0]
            if prev_ch and _boundary(prev_ch, nxt_ch):
                s = s.lstrip(" ")
                cnt += 1
        m = re.search(r"(?<=\S)( +)$", s)
        if m:
            nxt_ch = last_text_char_after(n)
            prev_ch = s.rstrip()[-1]
            if nxt_ch and _boundary(prev_ch, nxt_ch):
                s = s.rstrip(" ")
                cnt += 1
        if s != str(n):
            n.replace_with(s)
        space_count += cnt


def _boundary(a: str, b: str) -> bool:
    ja = re.match(rf"[{JP}]", a)
    jb = re.match(rf"[{JP}]", b)
    aa = re.match(rf"[{AL}]", a)
    ab = re.match(rf"[{AL}]", b)
    return bool((ja and ab) or (aa and jb))


def process(path: pathlib.Path, c3_mode: bool = False):
    global ref_log
    html = path.read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")
    used = set()
    ref_log.append(f"== {path.name} ==")
    for sec in soup.find_all("section", class_="page"):
        if is_skipped_section(sec, path.name):
            continue
        assign_id(sec, used)
        strip_prefixes(sec)
        convert_refs(sec, soup)
        remove_spaces(sec)
    path.write_text(str(soup), encoding="utf-8")


process(BASE / "m1-sections.html")
process(BASE / "m2-sections.html")
process(LP / "33-操作マニュアル_v3見本_C3_20260818.html", c3_mode=True)
print("\n".join(ref_log))
print(f"\nスペース削除の適用件数: {space_count}")
