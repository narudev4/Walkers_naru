---
description: 案件をクローズして archive へ退避する。distill で学びを蒸留 → 検収シート完了確認 → リポ軽量化（参照クローン・node_modules削除）→ archive/ へ移動 → 納品リンク集生成。「案件クローズ」「project-close」「{案件}終わった」で起動。
---

# project-close（案件クローズ）

トリガー: 「案件クローズ」「project-close」「{案件}終わった」「納品済みなので片付けて」

クローズ済み案件を軽量化して `archive/` へ退避する。aikata がパイロットケース。

> **絶対ルール**: Step 4 の移動・削除は naru の承認を得てから実行する。推測で消さない。app/ の最終 push 未済を消すと取り返しがつかないため、未コミット・未push を必ず先に検出する。

## 実行手順

### Step 1: distill（学びの蒸留）

`distill` スキルを呼び、この案件の地雷・判断・再利用パターンを memories/incidents.md へ蒸留する。

### Step 2: 検収確認

真理源スプシの検収シートを `read_sheet_values` で読み、全行が PASS / テスト不可 / naru確認済みかを確認。未完があれば一覧化して naru に報告し、クローズ可否を仰ぐ。

### Step 3: リポ状態の確認（不可逆防止）

- `app/`・`repos/*` で `git status` / `git log origin/main..HEAD` を確認し、**未コミット・未push が無いこと**を検証
- 残っていれば naru に報告して止まる（消さない）

### Step 4: 軽量化【承認必須】

naru の承認後:
- 参照用クローン（例: love-search 群のような他社既存システムのクローン）と `node_modules/`・ビルド成果物を削除
- サイズの before/after を提示

### Step 5: archive へ移動

`clients/{案件}/` を `archive/{案件}/` へ移動（移行前は `03_projects/` → `archive/`）。L3 の現フェーズを「保守」または「クローズ（{日付}）」に更新してから移動。

### Step 6: 納品リンク集

顧客向け最終成果物（本番URL・リポ・検収シート・提案書）のリンク集を `archive/{案件}/DELIVERY.md` に生成。

## 完了報告

蒸留件数・削減サイズ・移動先・納品リンク集の場所を報告する。
