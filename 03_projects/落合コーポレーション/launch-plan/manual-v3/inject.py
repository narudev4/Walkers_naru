#!/usr/bin/env python3
# 表紙・目次を final.html に注入する（ページ番号は sec-id から自動解決）
import re, sys, pathlib

BASE = pathlib.Path(__file__).parent
p = BASE / 'final.html'
s = p.read_text(encoding='utf-8')

# sec-id → ページ番号（final.html 内の .page 出現順。表紙・目次の 2 ページ分を加算）
pages = re.findall(r'<section class="page[^>]*>.*?</section>', s, re.S)
secmap = {}
for i, pg in enumerate(pages, start=3):
    for sid in re.findall(r'id="(sec-[a-z0-9]+)"', pg):
        secmap.setdefault(sid, i)
total = len(pages) + 2

def P(sid):
    if sid not in secmap:
        sys.exit(f'!! 未解決: {sid}')
    return secmap[sid]

COVER = f'''<section class="page">
  <style>
    .cover .rule{{width:24mm;height:2.2mm;background:#24365c;border-radius:2px;margin-bottom:9mm}}
    .cover h1{{letter-spacing:.02em}}
    .cover .sub{{letter-spacing:.06em}}
    .cover .scope p{{line-height:2.1}}
    .cover .scope .t{{display:flex;align-items:center;gap:6px}}
    .fcard{{background:#f8fafc}}
    .fcard .fp{{font-weight:700;color:#24365c}}
  </style>
  <div class="cover">
    <div class="rule"></div>
    <h1>落合コーポレーション様<br>ECサイト 操作マニュアル</h1>
    <div class="scope">
      <div class="t">⚠ この本の対象</div>
      <p>落合コーポレーション様が<b>日常的に操作する範囲</b>だけを扱います。<br>設定の変更・不具合の調査はWalkersの作業です。<br><span class="kw"><b>Walkers対応</b></span>の目印が付いた箇所は、ご連絡いただくだけで大丈夫です。</p>
    </div>
    <div class="flow">
      <div class="fcard"><div class="fn">毎日1</div><div class="ft">注文が入ったら</div><div class="fp">P.{P('sec-c1')}</div></div>
      <div class="fcard"><div class="fn">毎日2</div><div class="ft">出荷して「発送済み」に</div><div class="fp">P.{P('sec-c3')}</div></div>
      <div class="fcard"><div class="fn">締め日</div><div class="ft">請求書を確認して送る</div><div class="fp">P.{P('sec-d2')}</div></div>
    </div>
    <div class="meta">作成: 株式会社Walkers</div>
  </div>
  <div class="foot"><span>落合コーポレーション様 操作マニュアル</span><span>1 / {total}</span></div>
</section>'''

GROUPS = [
    ('#64748b', '1章　はじめに', [
        ('管理画面へのログインと画面一覧', 'sec-login'),
        ('操作するときの3つのお願い', 'sec-rules'),
    ]),
    ('#16a34a', '2章　商品を売る準備', [
        ('新しい商品を売り始める（登録・商品区分）', 'sec-a1'),
        ('価格（上代）を変える', 'sec-a2'),
        ('商品を売るのをやめる（一時的に隠す）', 'sec-a3'),
        ('在庫を直す（補充・棚卸し）', 'sec-a4'),
    ]),
    ('#7c3aed', '3章　業者様を迎える', [
        ('業者様アカウントの作成とご案内', 'sec-b1'),
        ('業者様の情報を直す', 'sec-b2'),
        ('業者様価格のしくみと割引率の表', 'sec-b3'),
        ('取引をやめる', 'sec-b4'),
    ]),
    ('#2563eb', '4章　注文から発送まで', [
        ('ご注文が入ったら（見方と支払区分）', 'sec-c1'),
        ('都度払いの入金を確認して出荷する', 'sec-c2'),
        ('出荷して「発送済み」にする', 'sec-c3'),
        ('ご注文の変更・キャンセル', 'sec-c4'),
        ('電話・FAXのご注文を入力する', 'sec-c5'),
    ]),
    ('#dc2626', '5章　請求と入金', [
        ('都度払いの請求（自動・操作なし）', 'sec-d1'),
        ('締めの請求書を確認して送る（毎月20日・末日）', 'sec-d2'),
        ('マネーフォワードで「入金済み」にする', 'sec-d3'),
        ('未入金を見つけて連絡する', 'sec-d4'),
        ('返品を記録する', 'sec-d5'),
    ]),
    ('#0d9488', '6章　お知らせと問い合わせ', [
        ('お知らせを出す・出し分ける', 'sec-e1'),
        ('問い合わせ・不良品のご連絡を受ける', 'sec-e2'),
    ]),
]

toc_rows = []
for color, name, rows in GROUPS:
    g = f'<div class="tgroup"><div class="gh"><span class="dot" style="background:{color}"></span>{name}</div>'
    for label, sid in rows:
        g += f'<div class="trow"><span class="tt">{label}</span><span class="dots"></span><span class="tp">P.{P(sid)}</span></div>'
    g += '</div>'
    toc_rows.append(g)

TOC = ('<section class="page toc" style="padding-top:12mm">'
       '<style>.toc .trow{line-height:1.9;font-size:10.5pt}.toc .tgroup{margin-bottom:4.6mm}'
       '.toc h1{margin-bottom:6mm}.toc .gh{font-size:11.5pt;margin-bottom:1.8mm}</style>'
       '<h1>目次</h1>' + ''.join(toc_rows) +
       '<div class="note" style="margin-top:5mm"><span class="t">この本の見方。</span> '
       '本書は「業務の流れ」の順に並んでいます。<span class="tbd">確定後に記入</span> のタグはご回答待ちの事項で、確定次第、更新版をお渡しします。</div>'
       f'<div class="foot"><span>落合コーポレーション様 操作マニュアル</span><span>2 / {total}</span></div></section>')

s = s.replace('<!--COVER-->', COVER).replace('<!--TOC-->', TOC)
p.write_text(s, encoding='utf-8')
print('injected. total =', total)
print('secmap:', {k: v for k, v in sorted(secmap.items(), key=lambda x: x[1])})
