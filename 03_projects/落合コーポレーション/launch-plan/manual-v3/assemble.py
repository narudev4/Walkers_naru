#!/usr/bin/env python3
# マニュアル v3 結合スクリプト v2（司令塔用）
# - m1 + C-3(見本) + m2 を結合し、フッター採番
# - <span class="pref" data-ref="sec-xx"></span> を実ページ番号で埋める
# - sec-id → ページ番号の対応表と台帳を stdout に出す（表紙・目次作成用）
import re, sys, json, pathlib

BASE = pathlib.Path(__file__).parent
LP = BASE.parent

def pages_of(html: str):
    return re.findall(r'<section class="page[^>]*>.*?</section>', html, re.S)

def title_of(page: str):
    m = re.search(r'<h2[^>]*>(.*?)</h2>', page, re.S) or re.search(r'<h1[^>]*>(.*?)</h1>', page, re.S)
    t = re.sub(r'<[^>]+>', '', m.group(1)) if m else '(無題)'
    return re.sub(r'\s+', ' ', t).strip()

m1 = (BASE / 'm1-sections.html').read_text(encoding='utf-8')
m2 = (BASE / 'm2-sections.html').read_text(encoding='utf-8')
sample = (LP / '33-操作マニュアル_v3見本_C3_20260818.html').read_text(encoding='utf-8')

style = re.search(r'<style>.*?</style>', m1, re.S).group(0)

m1_pages = pages_of(m1)
m2_pages = pages_of(m2)
# 見本から C-3 の 3 ステップページ（band を持ち cover/toc でない）を抽出し画像パス補正
sample_pages = [p for p in pages_of(sample) if ('class="band"' in p and 'cover' not in p and 'class="page toc' not in p)]
sample_pages = [p.replace('src="33-manual-assets', 'src="../33-manual-assets') for p in sample_pages]
if len(sample_pages) != 3:
    sys.exit(f'!! C-3 抽出が 3 ページでない: {len(sample_pages)}')

idx = next((i for i, p in enumerate(m2_pages) if 'キャンセル' in title_of(p)), None)
if idx is None:
    sys.exit('!! C-4（キャンセル）ページが見つからない。中断')
m2_assembled = m2_pages[:idx] + sample_pages + m2_pages[idx:]

# 付録は削除（2026-08-19 naru 指示。目次からも外す）
m2_assembled = [p for p in m2_assembled if not title_of(p).startswith('付録')]

all_pages = m1_pages + m2_assembled
total = len(all_pages) + 2  # 表紙+目次

# 1周目: sec-id → ページ番号
secmap = {}
for i, p in enumerate(all_pages, start=3):
    for sid in re.findall(r'id="(sec-[a-z0-9]+)"', p):
        secmap.setdefault(sid, i)

# 2周目: pref 埋め + 採番
out, inv, unresolved = [], [], set()
for i, p in enumerate(all_pages, start=3):
    def fill(m):
        sid = m.group(1)
        if sid in secmap:
            return str(secmap[sid])
        unresolved.add(sid)
        return '??'
    p = re.sub(r'<span class="pref" data-ref="(sec-[a-z0-9]+)"></span>', fill, p)
    p = re.sub(r'<span class="pnum"></span>', f'<span>{i} / {total}</span>', p)
    p = re.sub(r'<span>\d+ / \d+</span>', f'<span>{i} / {total}</span>', p)
    out.append(p)
    inv.append(f'P.{i}\t{title_of(p)}')

final = f'''<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<title>落合コーポレーション様 EC サイト 操作マニュアル v3</title>
{style}
</head><body>
<!--COVER-->
<!--TOC-->
{''.join(out)}
</body></html>'''

(BASE / 'final.html').write_text(final, encoding='utf-8')
print(f'総ページ数（表紙・目次込み）: {total}')
print('SECMAP', json.dumps(secmap, ensure_ascii=False))
if unresolved:
    print('!! 未解決の参照:', sorted(unresolved))
print('\n'.join(inv))
