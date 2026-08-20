# レビュー報告テンプレート

## 結論

- 判定: `releaseable / conditional / blocked`
- Critical: N / High: N / Medium: N / Low: N
- 対象: base、head、PR、ディレクトリ
- 残存リスク: 未確認・環境制約・対象外

所見がある場合は所見から始める。所見がない場合は「確認した範囲では所見なし」とし、検証範囲と限界を同じ段落に書く。

## Findings

### [High] 短いタイトル

- 場所: `path/to/file.ts:123`
- 成立経路: 外部入力 → 変換 → 問題箇所 → 副作用
- 影響: 誰が、どの条件で、何を起こせるか
- 証拠: 読んだコード、実行結果、再現条件
- 最小修正: 具体的な修正方向
- 必要テスト: 修正を証明するテスト

同じ原因の複数箇所は、修正単位が同じなら1所見にまとめ、場所を列挙する。原因や修正が異なる場合は分ける。

## Scope and verification

- モード・プロファイル
- 読んだ指示・仕様
- 対象・除外
- 実行コマンドと結果
- 実行できなかった検証

## Coverage

状態管理スクリプトの出力を要約する。

| 状態 | 件数 |
|---|---:|
| finding | |
| pass | |
| na | |
| blocked | |

`blocked` はID、理由、残存リスクを列挙する。

## Release gate

- `blocked`: 検証済みCritical/Highが残る、または高リスク領域が未確認。
- `conditional`: Medium以下のみで、回避策・期限・責任者を明示できる。
- `releaseable`: 対象範囲の必須観点が完了し、検証済みCritical/Highがない。

`releaseable` は製品全体の安全保証ではなく、記載したスコープと時点に限定する。
