import json, re
from pathlib import Path

WORK = Path('/Users/naru/Walkers_naru/03_projects/1LC/minutes/2026-06-04_作戦MTG')
PARTS = WORK / 'parts'
SEG = 600
N_PARTS = 8

SHORT_OK = {'はい','うん','ええ','そう','ああ','おう','うーん','なるほど',
            'ありがとう','ありがとうございます','了解','お願いします','すみません'}

def is_repetition(text, min_len=20, cover=0.7, min_rep=5):
    t = text.strip()
    if len(t) < min_len:
        return False
    for u in range(1, 9):
        unit = t[:u]; rep = 0; i = 0
        while t[i:i+u] == unit:
            rep += 1; i += u
        if rep >= min_rep and (rep*u)/len(t) >= cover:
            return True
    c = re.sub(r'[、。\s]', '', t)
    return bool(c) and len(set(c))/len(c) < 0.12

def clean_consecutive(segs, threshold=5):
    result, removed, i = [], [], 0
    while i < len(segs):
        t = segs[i]['text']; j = i
        while j < len(segs) and segs[j]['text'] == t:
            j += 1
        if j - i >= threshold and t not in SHORT_OK:
            removed.append((segs[i]['start'], j-i, t[:20]))
        else:
            result.extend(segs[i:j])
        i = j
    return result, removed

all_segs = []
for idx in range(N_PARTS):
    v3   = PARTS / f'part_{idx:03d}_v3.json'
    base = PARTS / f'part_{idx:03d}.json'
    jf = v3 if v3.exists() else base
    if not jf.exists():
        continue
    off = idx * SEG
    for s in json.loads(jf.read_text())['segments']:
        all_segs.append({'start': s['start']+off, 'end': s['end']+off, 'text': s['text'].strip()})
all_segs.sort(key=lambda s: s['start'])

segs = [s for s in all_segs if s['text'] and not is_repetition(s['text'])]
clean_segs, _ = clean_consecutive(segs)
gaps = [(a['end'], b['start'], b['start']-a['end'])
        for a, b in zip(clean_segs, clean_segs[1:]) if b['start']-a['end'] > 30]

with (WORK/'transcript.txt').open('w') as f:
    for s in clean_segs:
        m, sec = divmod(int(s['start']), 60)
        f.write(f"[{m:02d}:{sec:02d}] {s['text']}\n")
with (WORK/'transcript_plain.txt').open('w') as f:
    f.write(''.join(s['text'] for s in clean_segs))

hms = lambda x: f"{int(x)//60}:{int(x)%60:02d}"
print(f"有効={len(clean_segs)}seg / 文字数={sum(len(s['text']) for s in clean_segs)} / レンジ {hms(clean_segs[0]['start'])}〜{hms(clean_segs[-1]['end'])}")
print(f"30秒超ギャップ {len(gaps)}件:")
for st, en, g in gaps:
    print(f"  {hms(st)}〜{hms(en)} ({g:.0f}s)")
