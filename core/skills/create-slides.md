# 提案書→スライド変換

トリガー: 「スライド作って」「提案書をスライドに」「プレゼン資料」

## 入力
$ARGUMENTS

## 全体フロー

```
① ソース特定 → ② 構成確認（承認必須） → ③ スクリプト生成・実行 → ④ 確認・修正
```

> **絶対ルール**: ② の構成がユーザーに承認されるまで ③ に進んではならない。

---

## Step 1: ソース特定

### 提案書の探索（優先順位）
1. ユーザーが指定した場合 → そのソースを使用
2. Google Docs から検索: `google_drive_search` で「提案書」「ご提案」を検索
3. ローカルから検索: `03_projects/` 配下の proposal/ ディレクトリを探索
4. memories/facts.md から案件情報を参照
5. 見つからない場合 → ユーザーにヒアリング

### ソースの読み取り
- Google Docs → `google_docs_get` で全文取得
- ローカルMD → Read tool で読み取り
- 内容からセクション構造と主要データ（テキスト・数値・テーブル）を抽出

### ユーザーに確認
```
この提案書をスライド化します:
■ クライアント: {企業名} {担当者名} 様
■ 案件名: {サービス名}
■ ソース: {Google Docs URL or ローカルパス}
```

---

## Step 2: 構成確認【承認必須】

### デフォルトのスライド構成

| # | スライド | 対応提案書セクション | ビルダー関数 |
|---|---------|--------------------|----|
| 1 | 表紙 | — | `make_cover` |
| 2 | エグゼクティブサマリー | §1 | `make_exec_summary` |
| 3 | 現状分析・課題定義 | §2 | `make_issues` |
| 4 | 提案ソリューション | §3 | `make_solution` |
| 5 | プラン比較 / 収益モデル | §4（案件依存） | `make_plans` |
| 6 | 業務フロー | §5（該当時） | `make_flow` |
| 7 | システム構成 | §6 | `make_system` |
| 8 | 開発スケジュール | §7 | `make_schedule` |
| 9 | 補助金活用戦略 | §8（該当時） | `make_subsidy` |
| 10 | 概算見積もり | §9 | `make_estimate` |
| 11 | プロジェクト体制 | §10 | `make_team` |
| 12 | 会社概要 | §11 | `make_company` |

### 確認事項をユーザーに提示
- スライドの追加・削除・順番変更の有無
- トンマナ: **デフォルトはWalkersブランド**（チャコール `#2B323B` + オレンジ `#E98212`）。クライアント指定があれば変更可
- 特に強調したいセクション
- 「次のステップ」スライドを追加するか（`make_next_steps`）

→ **承認を得てから Step 3 に進む**

---

## Step 3: スクリプト生成・実行

### ベーステンプレートの読み込み
```python
# 必ず slide_base.py を Read で確認してからスクリプトを生成する
# パス: output/slides/slide_base.py
```

### スクリプト生成ルール

1. **`slide_base.py` を `import` して使う**（ヘルパー関数をコピペしない）
2. 高レベルビルダー（`make_cover`, `make_exec_summary`, etc.）を最大限活用
3. ビルダーでカバーできないカスタムスライドのみ低レベルヘルパーで作成
4. 提案書の **実際のテキスト・データ** をスクリプトに埋め込む
5. `sys.path` に `output/slides/` を追加して import する

### スクリプトの基本構造
```python
#!/usr/bin/env python3
"""【{クライアント名}様】{案件名} 提案スライド生成"""

import sys
sys.path.insert(0, "<PROJECT_ROOT>/output/slides")

from slide_base import *

FOOTER = "【{クライアント名}様】{案件名} 開発のご提案"

prs = create_presentation()

# === 表紙 ===
make_cover(prs, "{サービス名}", "開発のご提案", "{キャッチコピー}",
           "{クライアント名} {担当者名} 様", "{日付}")

# === セクションスライド ===
make_exec_summary(prs, 1, "{目的テキスト}",
    [("ターゲット", "..."), ("特徴", "..."), ("ローンチ目標", "..."), ("期待効果", "...")],
    footer_text=FOOTER)

# ... 以降のスライド ...

make_company(prs, {最終セクション番号}, footer_text=FOOTER)

# === 保存 ===
output_path = "<PROJECT_ROOT>/output/slides/{ファイル名}.pptx"
prs.save(output_path)
print(f"保存完了: {output_path}")
```

### ファイル命名
- スクリプト: `output/slides/generate_{案件名}_slides.py`
- 出力PPTX: `output/slides/{クライアント名}_{案件名}_提案スライド.pptx`

### 実行
```bash
pip install python-pptx  # 未インストールの場合のみ
python output/slides/generate_{案件名}_slides.py
start "" "output/slides/{クライアント名}_{案件名}_提案スライド.pptx"
```

---

## Step 4: 確認・修正

1. ユーザーにPPTXを確認してもらう
2. 修正要望があればスクリプトを更新して再実行
3. 必要に応じて複数回サイクル

---

## デザイン仕様（Walkersブランド デフォルト）

| 要素 | 値 |
|------|-----|
| メインカラー | ダークチャコール `#2B323B` (`CHARCOAL`) |
| アクセントカラー | オレンジ `#E98212` (`ORANGE`) |
| 薄いアクセント背景 | `#FDF0DB` (`LIGHT_ACCENT`) |
| 薄いグレー背景 | `#F5F7FA` (`LIGHT_BG`) |
| 本文テキスト | `#333333` (`DARK_TEXT`) |
| 注釈テキスト | `#666666` (`GRAY_TEXT`) |
| フォント | Yu Gothic |
| スライドサイズ | 16:9（13.333" × 7.5"） |
| 表紙 | チャコール全面背景、オレンジのサブタイトル・区切り線 |
| セクションヘッダー | チャコール帯、オレンジ番号、白タイトル |
| フッター | チャコール帯、白テキスト |
| テーブルヘッダー | チャコール背景、白テキスト |
| カード見出し | オレンジ背景、白テキスト |

### トンマナ変更時
クライアント指定のカラーがある場合は、`slide_base.py` の定数を上書きする:
```python
import slide_base
slide_base.CHARCOAL = RGBColor(0xXX, 0xXX, 0xXX)
slide_base.ORANGE = RGBColor(0xXX, 0xXX, 0xXX)
```

---

## ビルダー関数リファレンス

| 関数 | 用途 | 主な引数 |
|------|------|---------|
| `make_cover` | 表紙 | service_name, subtitle, tagline, client_name, date_str |
| `make_exec_summary` | エグゼクティブサマリー | purpose_text, cards[(label, desc)] |
| `make_issues` | 課題定義（2列） | intro, left_title, left_items, right_title, right_items |
| `make_solution` | ソリューション（カード） | service_name, description, categories[(name, [items])] |
| `make_plans` | プラン比較（カード） | title, plans[(name, price, scope, feature, color)] |
| `make_flow` | 業務フロー（ステップ） | title, flows[(step_name, desc)] |
| `make_system` | システム構成 | dev_items, stack_items, security_items |
| `make_schedule` | 開発スケジュール | title_text, phases[(phase, name, period, desc)] |
| `make_subsidy` | 補助金戦略 | main_info[(label, value)], strategies[(label, desc)] |
| `make_estimate` | 概算見積もり | table_data, totals[(name, cost, color)] |
| `make_team` | プロジェクト体制 | roles[(abbr, name, desc)] |
| `make_company` | 会社概要（固定） | — |
| `make_next_steps` | 次のステップ | steps[(label, desc)] |

全関数共通: `section_num`（セクション番号）、`footer_text`（フッター右側テキスト）

---

## ルール（厳守）

1. **構成確認で必ずユーザーの承認を得る**（推測でスクリプトを書き始めない）
2. **`slide_base.py` を import して使う**（ヘルパー関数の重複コピペ禁止）
3. 金額・機密情報は提案書の記載通りにする（AIが変えない）
4. python-pptx がインストールされていない場合は先にインストール
5. 生成スクリプトは `output/slides/` に保存する
6. PPTXが完成したら `open` コマンドで自動的に開く
