import json, re
from pathlib import Path

WORK = Path('/Users/naru/Walkers_naru/03_projects/福岡県環境部/minutes/2026-05-28_第2回MTG_提案')
PARTS = WORK / 'parts'
SEG = 600  # 分割秒

SHORT_OK = {'はい','うん','ええ','そう','ああ','おう','うーん','なるほど',
            'ありがとう','ありがとうございます','了解','お願いします','すみません'}

def is_repetition(text, min_len=20, cover=0.7, min_rep=5):
    """単一セグメント内の病的反復を検出（例: 昔×100, お客さん、×50, 福岡県、×40）"""
    t = text.strip()
    if len(t) < min_len:
        return False
    # 単位長 1〜8 で、その単位の連続反復が文字列の cover 割合以上を占めるか
    for u in range(1, 9):
        unit = t[:u]
        if not unit:
            continue
        rep = 0
        i = 0
        while t[i:i+u] == unit:
            rep += 1
            i += u
        if rep >= min_rep and (rep * u) / len(t) >= cover:
            return True
    # 文字多様性が極端に低い（例: 「昔」だけ）
    compact = re.sub(r'[、。\s]', '', t)
    if compact and len(set(compact)) / len(compact) < 0.12:
        return True
    return False

# --- マージ（オフセット付与。優先順: _v3(large-v3-mlx) > _fix > base） ---
all_segs = []
for idx in range(7):
    v3 = PARTS / f'part_{idx:03d}_v3.json'
    fix = PARTS / f'part_{idx:03d}_fix.json'
    base = PARTS / f'part_{idx:03d}.json'
    jf = v3 if v3.exists() else (fix if fix.exists() else base)
    if not jf.exists():
        continue
    off = idx * SEG
    data = json.loads(jf.read_text())
    for s in data['segments']:
        all_segs.append({'start': s['start'] + off, 'end': s['end'] + off,
                         'text': s['text'].strip(), 'part': idx})
all_segs.sort(key=lambda s: s['start'])
raw_n = len(all_segs)

# --- 1) 空除去 + 2) 反復ハルシネーション除去 ---
rep_removed = []
segs = []
for s in all_segs:
    if not s['text']:
        continue
    if is_repetition(s['text']):
        rep_removed.append((s['start'], s['text'][:20]))
        continue
    segs.append(s)

# --- 3) 連続同一セグメント除去（相槌は保護） ---
def clean_consecutive(segs, threshold=5):
    result, removed, i = [], [], 0
    while i < len(segs):
        t = segs[i]['text']
        j = i
        while j < len(segs) and segs[j]['text'] == t:
            j += 1
        if j - i >= threshold and t not in SHORT_OK:
            removed.append((segs[i]['start'], j - i, t[:20]))
        else:
            result.extend(segs[i:j])
        i = j
    return result, removed

clean_segs, consec_removed = clean_consecutive(segs)

# --- ギャップ検出（30秒超の無音=コンテンツ欠損の疑い） ---
gaps = []
for a, b in zip(clean_segs, clean_segs[1:]):
    g = b['start'] - a['end']
    if g > 30:
        gaps.append((a['end'], b['start'], g))

# --- 出力 ---
with (WORK / 'transcript.txt').open('w') as f:
    for s in clean_segs:
        m, sec = divmod(int(s['start']), 60)
        f.write(f"[{m:02d}:{sec:02d}] {s['text']}\n")
with (WORK / 'transcript_plain.txt').open('w') as f:
    f.write(''.join(s['text'] for s in clean_segs))

# --- レポート ---
def hms(x):
    m, s = divmod(int(x), 60)
    return f"{m}:{s:02d}"

print(f"raw={raw_n} 反復除去={len(rep_removed)} 連続除去スパン={len(consec_removed)} 有効={len(clean_segs)}")
print(f"有効レンジ: {hms(clean_segs[0]['start'])} 〜 {hms(clean_segs[-1]['end'])}")
print(f"文字数(plain): {sum(len(s['text']) for s in clean_segs)}")
print("--- パート別 有効セグメント数 ---")
from collections import Counter
c = Counter(s['part'] for s in clean_segs)
for p in range(7):
    print(f"  part_{p:03d}: {c.get(p,0)}")
print(f"--- 30秒超ギャップ {len(gaps)}件 ---")
for st, en, g in gaps:
    print(f"  {hms(st)} 〜 {hms(en)} ({g:.0f}s 欠損疑い)")
print(f"--- 反復除去サンプル（先頭8） ---")
for st, t in rep_removed[:8]:
    print(f"  {hms(st)}: {t}")
