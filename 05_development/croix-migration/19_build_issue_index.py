#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
スプシ (F=小島, I=鈴さき, M=AI) の指摘を1指摘=1行に展開して
output/issue_index.csv に書き出す。

No, slug, title, source, raw_text, category, machine_verifiable, note
"""
import csv
import re
from pathlib import Path

# スプシから取得した85件の生データ（A11:M95）
# [No, title, url_orig, url_stg, E, F(小島), G, H, I(鈴さき), J, K, L, M(AI)]
ROWS = [
    ["1","ウェルビーイング企業クロア、元・東京スタイル代表ら参画の睡眠ブランド「nemcaro」アパレルチーム発足","https://croix.asia/2026/03/16/nemcaro-apparel-team-launch/","http://stg.croix.asia/news/nemcaro-apparel-team-launch/","⚪︎","","小島","⚪︎","・要改行　（開発プロセス：植物由来の～、スリープウェア開発:休息環境を～、開発プロセス:睡眠ウェアに～）\n・文字サイズ/色が違う（スリープウェア開発:休息環境を～、開発プロセス:睡眠ウェアに～、開発プロセス:植物由来の～）","鈴さき","修正済み","⚪︎","■スロープウェア開発部分、「睡眠ソリューション」の後の改行が詰まっている。\n■機能性素材部分、「植物由来の～curefilo」の後の改行が詰まっている。\n■開発プロセス部分、「座談会の様子」の後の改行が詰まっている。"],
    ["2","2026年 新年あけましておめでとうございます。","https://croix.asia/2026/01/01/2026_newyear/","http://stg.croix.asia/news/2026_newyear/","⚪︎","","小島","⚪︎","","鈴さき","","⚪︎","指摘なし"],
    ["3","高校生の音楽の使い方からヒントを得る新しい探究型マーケティング。株式会社クロアが「StudyJam」をきっかけに","https://croix.asia/2025/11/28/croix-studyjam/","http://stg.croix.asia/news/croix-studyjam/","×","画像表示エラー","小島","✖︎","・文字抜け（株式会社クロア × StudyJam:1枚目の画像下）","鈴さき","修正済み","✖︎","一枚目の画像の下「株式会社クロア×Studyjam」の表記がない。\n元ページで太ゴシックで書かれている部分はポイントが少し大きいが、移行先では本文と大きさが同じ。"],
    ["4","眠りが変われば、人生が変わる。nemcaro GREENFUNDING","https://croix.asia/2025/05/30/nemcaro/","http://stg.croix.asia/news/nemcaro/","×","中央部　眠り専用3Dサウンド　画像表示エラー","小島","✖︎","・要改行（GREEN FUNDINGクラウドファンディング プロジェクトページ（YouTube動画下）、新しい音と香りの体験を～、リターン内容（2つあるうちの1つめ））\n・太字になっていない（特許技術で～、空間そのものが～、心と身体で～、音にも香りにも～、caroはイタリア語で、目元にぴたりと～）\n・埋め込みのYouTube動画のサイズが小さい","鈴さき","修正済み","✖︎","「癒しの音を、ここまで立体的に～?」の項の「特許技術で～再構築。」が太字になっていない。\n「音を聞くから感じる～」の項の「空間そのものが～」「心と身体で～」の部分が太字になってない。\n「音と香り～」の項の「音にも香りにも～設計」が太字になっていない。\n「nemcaroの立体音響の秘密」の項の「シーイヤー株式会社」と「代表取締役　村山　好孝」が離れている。\n「その名に込めたのは～」の項の「caro」が太字になってない。\n「オプション」の項の「目元にぴたりと～」が太字になってない。"],
    ["5","眠れる森の美女コンセプトの美容鍼サロンRelaxest 恵比寿","https://croix.asia/2025/03/21/relaxest_ebisu/","http://stg.croix.asia/news/relaxest_ebisu/","×","一番下のYoutube以外すべて画像表示エラー","小島","⚪︎","","鈴さき","","⚪︎",""],
    ["6","2025年 新年あけましておめでとうございます。","https://croix.asia/2025/01/01/2025_newyear/","http://stg.croix.asia/news/2025_newyear/","⚪︎","","小島","⚪︎","・文字が薄い（新年あけましておめでとうございます。～）","鈴さき","修正済み","⚪︎",""],
    ["7","美容鍼サロンRelaxestイメージキャラクターすみれ","https://croix.asia/2024/12/13/relaxest_sumire/","http://stg.croix.asia/news/relaxest_sumire/","×","画像表示エラー","小島","⚪︎","・要改行（Relaxestのイメージキャラクター「すみれ」、SUMIRE / Relaxest）","鈴さき","修正済み","⚪︎",""],
    ["8","AI生成による瞑想音楽サービスitakeru.com","https://croix.asia/2024/11/05/itakeru/","http://stg.croix.asia/news/itakeru/","×","画像表示エラー","小島","⚪︎","・画像サイズ大きい（1枚目）\n・要改行（itakeru.com（1枚目画像下））","鈴さき","修正済み","⚪︎",""],
    ["14","新年あけましておめでとうございます。","https://croix.asia/2024/01/01/","http://stg.croix.asia/news/2024_newyear/","⚪︎","","小島","⚪︎","・文字が薄い（新年あけましておめでとうございます。～）","鈴さき","修正済み","⚪︎",""],
    ["17","RELAX WORLDスペシャルイベントの脳波計測結果","https://croix.asia/2023/10/11/","http://stg.croix.asia/news/relaxworld-brainwave/","×","画像表示エラー","小島","⚪︎","・文字が薄い（2023年8月27日に行われた～）","鈴さき","修正済み","⚪︎",""],
    ["20","TOKYO FMで放送中のラジオ番組RELAX WORLDスペシャルイベント 8/27","https://croix.asia/2023/08/28/","http://stg.croix.asia/news/tokyofm-0828/","×","画像表示エラー","小島","⚪︎","・文章の位置が違う（ウェルビーイング・テクノロジー事業～）\n・2枚目の画像が挿入されていない","鈴さき","修正済み","⚪︎","一枚目の写真の差し込み位置が違う。二枚目の写真がない。"],
    ["21","TOKYO FMで放送中のラジオ番組RELAX WORLDスペシャルイベント","https://croix.asia/2023/08/21/","http://stg.croix.asia/news/tokyofm-0821/","×","画像表示エラー","小島","⚪︎","・文字が薄い（番組リスナーを招待しての～）","鈴さき","修正済み","⚪︎",""],
    ["23","cafebgm","https://croix.asia/2023/04/28/cafebgm/","http://stg.croix.asia/news/cafebgm/","⚪︎","","小島","⚪︎","","鈴さき","","⚪︎","最後の行「おいしエスプレッソ」になっている（元ページも同様）"],
    ["24","RELAX WORLD Cafe Theater SPROUT","https://croix.asia/2023/04/21/relaxworldcafe202304/","http://stg.croix.asia/news/relaxworldcafe202304/","×","画像表示エラー","小島","⚪︎","・要改行（◆2023 年 4 月 21日～）","鈴さき","修正済み","⚪︎","画像が二枚とも表示されていない。\n画像一枚目下、「株式会社社クロア」になっている（元ページも同様）"],
    ["26","新年あけましておめでとうございます。","https://croix.asia/2023/01/01/hny2023/","http://stg.croix.asia/news/hny2023/","⚪︎","","小島","⚪︎","・文字が薄い（新年あけましておめでとうございます。～）","鈴さき","修正済み","⚪︎",""],
    ["34","おはようからおやすみまでRELAX WORLD MUSIC アプリ","https://croix.asia/2022/07/19/rwm-app/","http://stg.croix.asia/news/rwm-app/","×","画像表示エラー","小島","⚪︎","・文字が薄い（「お目覚め」「ランチ」～）\n・要改行（アプリの４つの特徴:1、2、3、4、）\n・改行幅が広い（推奨OS:iOS／13.0の上のスペース）","鈴さき","修正済み","⚪︎","＜アプリの４つの特徴＞１～４とPR動画の文の改行・間隔が異なっている。\n画像、アプリのアイコン、QRコードが表示されていない。"],
    ["37","シモキタのアイコン 下北沢南口商店街の街頭BGMをプロデュース","https://croix.asia/2022/06/14/pr_shimokitazawabgm/","http://stg.croix.asia/news/pr_shimokitazawabgm/","×","画像表示エラー","小島","⚪︎","・改行幅が広い（RELAX WORLD、Chill Cafe Beats、Sugar Candy、FaRao PROについて）","鈴さき","修正済み","⚪︎","画像がすべて表示されていない。"],
    ["46","代表取締役社長がアーツイノベーター・ジャパンの芸術顧問に就任","https://croix.asia/2021/09/16/pr20210916/","http://stg.croix.asia/news/pr20210916/","⚪︎","","小島","⚪︎","・要改行（【アーツイノベーター・ジャパンについて】）","鈴さき","","⚪︎",""],
    ["47","Huluでの配信開始 クロアヒーリング・チャンネル","https://croix.asia/2021/06/23/pr-hulu/","http://stg.croix.asia/news/pr-hulu/","⚪︎","","小島","⚪︎","","鈴さき","","⚪︎","田中理事長のメッセージの中で誤字「創り出しことが出来ます」（元ページも同様）"],
    ["50","望月明人氏が顧問就任","https://croix.asia/2021/05/14/pr-20210514/","http://stg.croix.asia/news/pr-20210514/","⚪︎","","小島","⚪︎","・文章の位置が違う（望月明人氏）","鈴さき","","",""],
    ["51","医学博士が監修する眠りの音楽アプリRELAX WORLD","https://croix.asia/2021/01/20/relaxworld_app/","http://stg.croix.asia/news/relaxworld_app/","⚪︎","","小島","⚪︎","・太字になっていない（RELAX WORLDアプリの特徴）\n・要改行（RELAX WORLDアプリの特徴　と、付随する各5項目（専門家が監修しリラックスを～など））","鈴さき","","",""],
    ["54","DMMによる4K画質動画配信サービス","https://croix.asia/2020/11/16/pr20201116_dmm/","http://stg.croix.asia/news/pr20201116_dmm/","⚪︎","","小島","⚪︎","・文章が中央に配置されている（動画画像 / 厳寒の奥日光(栃木)～）","鈴さき","","",""],
    ["56","U-NEXTにて高画質動画を配信開始","https://croix.asia/2020/06/30/pr_unext/","http://stg.croix.asia/news/pr_unext/","⚪︎","","小島","⚪︎","・文章の位置が違う（クロアヒーリングの～）","鈴さき","","",""],
    ["58","新型コロナウイルス感染拡大予防措置のためのテレワーク実施のお知らせ","https://croix.asia/2020/04/07/info01/","http://stg.croix.asia/news/info01/","⚪︎","","小島","⚪︎","旧サイトに比べて文字が濃い","鈴さき","","",""],
    ["63","薬用音楽","https://croix.asia/2019/07/23/pr20190723/","http://stg.croix.asia/news/pr20190723/","⚪︎","","小島","⚪︎","・改行幅が広い（■「従業員の健康管理」を～）\n・文章の位置が違う（薬用音楽セットハイレゾ・オーディオシステム例～）","鈴さき","","",""],
    ["66","Amazon Alexaスキル おやすみの音","https://croix.asia/2019/05/31/release_amazonalexa_oyasumino-oto/","http://stg.croix.asia/news/release_amazonalexa_oyasumino-oto/","⚪︎","","小島","⚪︎","・文章の位置が違う（Amazon Alexaスキル「おやすみの音」アイコン）","鈴さき","","",""],
    ["72","クロアがサウンドヒーリング協会に入会","https://croix.asia/2018/12/28/","http://stg.croix.asia/news/sound-healing-association/","⚪︎","","小島","⚪︎","・要改行（■サウンドヒーリング協会の活動内容　の各7項目について）","鈴さき","","",""],
    ["78","Believe Digital社との戦略的事業提携","https://croix.asia/2018/07/24/believe-digital/","http://stg.croix.asia/news/believe-digital/","⚪︎","","小島","⚪︎","・要改行（Believe Digital）","鈴さき","","",""],
    ["84","MEGURO FM ラジオクラウド","https://croix.asia/2017/10/02/01/","http://stg.croix.asia/news/01/","⚪︎","","小島","⚪︎","・要改行（【10 月以降のコンテンツ配信社】　の各8項目について）","鈴さき","","",""],
]


def classify(text: str, source: str) -> tuple[str, str, bool]:
    """指摘テキストを (category, subcategory, machine_verifiable) に分類"""
    t = text.lower()
    # D: 原本由来（元ページも同様）
    if "元ページも同様" in text:
        return ("D_原本由来", "原本誤字", False)
    # C: 画像表示エラー
    if "画像表示エラー" in text or "画像が表示" in text or "表示されていない" in text or "挿入されていない" in text or "アイコン、qrコード" in t or "qrコード" in text:
        return ("C_メディア", "画像非表示", True)
    # B: 本文編集（要改行, 太字, 文字抜け, 改行幅）
    if "要改行" in text or "改行が詰まっている" in text or "改行・間隔" in text:
        return ("B_本文", "要改行", True)
    if "太字" in text:
        return ("B_本文", "太字不足", True)
    if "文字抜け" in text or "表記がない" in text:
        return ("B_本文", "文字抜け", True)
    if "改行幅が広い" in text:
        return ("B_本文", "改行幅過大", True)
    # A: CSS/スタイル
    if "文字サイズ" in text or "ポイント" in text or "大きさが同じ" in text:
        return ("A_CSS", "font-size差異", True)
    if "文字が薄い" in text or "文字が濃い" in text:
        return ("A_CSS", "font-color/weight", True)
    if "文章の位置が違う" in text or "文章が中央" in text or "差し込み位置" in text:
        return ("A_CSS", "align/position", True)
    if "画像サイズ大きい" in text:
        return ("A_CSS", "画像サイズ", True)
    if "youtube" in t and "サイズが小さい" in text:
        return ("A_CSS", "youtube-iframe-size", True)
    if "離れている" in text:
        return ("A_CSS", "margin過大", True)
    if "文字サイズ/色" in text or "色が違う" in text:
        return ("A_CSS", "color/size", True)
    return ("X_要目視", "分類不可", False)


def split_issues(cell: str) -> list[str]:
    """F/I/M列のテキストを個別指摘に分割"""
    if not cell or not cell.strip():
        return []
    # 箇条書き記号 (・, ■) で分割
    parts = re.split(r"[\n]+", cell)
    issues = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # 先頭の記号除去
        p = re.sub(r"^[・■◆]\s*", "", p)
        if p:
            issues.append(p)
    return issues


def main():
    out_path = Path(__file__).parent / "output" / "issue_index.csv"
    out_path.parent.mkdir(exist_ok=True)

    rows_out = []
    for row in ROWS:
        no = row[0]
        title = row[1]
        url_stg = row[3] if len(row) > 3 else ""
        slug = url_stg.rstrip("/").split("/")[-1] if url_stg else ""
        F = row[5] if len(row) > 5 else ""
        I = row[8] if len(row) > 8 else ""
        M = row[12] if len(row) > 12 else ""

        for source, cell in [("F_小島", F), ("I_鈴さき", I), ("M_AI", M)]:
            for issue in split_issues(cell):
                cat, sub, verifiable = classify(issue, source)
                rows_out.append({
                    "No": no,
                    "slug": slug,
                    "title": title[:40],
                    "source": source,
                    "category": cat,
                    "subcategory": sub,
                    "verifiable": "Y" if verifiable else "N",
                    "text": issue,
                })

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["No", "slug", "title", "source", "category", "subcategory", "verifiable", "text"])
        w.writeheader()
        w.writerows(rows_out)

    # サマリ
    print(f"Total issues: {len(rows_out)}")
    from collections import Counter
    cat_counts = Counter(r["category"] for r in rows_out)
    for c, n in sorted(cat_counts.items()):
        print(f"  {c}: {n}")
    print(f"\nUnique articles: {len(set(r['No'] for r in rows_out))}")
    print(f"Machine-verifiable: {sum(1 for r in rows_out if r['verifiable']=='Y')}")
    print(f"Requires manual review: {sum(1 for r in rows_out if r['verifiable']=='N')}")
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()
