# Gmail署名ルール

CLAUDE.md の外部参照ルールから飛んでくるファイル。`draft_gmail_message` を呼ぶ前に適用すること。

## 原因（CRITICAL）

`draft_gmail_message` の `include_signature=true`（既定値）は Gmail Settings > 署名 のHTML署名を自動挿入するが、
HTML→プレーンテキスト変換で改行が失われ、1行に潰れた状態で挿入される既知の不具合がある。
MCP側（google-workspace コネクタ）の実装起因のため、こちら側では修正不可。

## ルール

- **`draft_gmail_message` は必ず `include_signature=false` を指定する**（既定の `true` に頼らない）
- 署名が必要な文面は、下記の署名ブロックを `body` に**実際の改行込みで**直接書き込む

## 署名ブロック（フル / 初回接点・対外向け）

```
───────────────────
【あなたの事業を成功させる強力なパートナー】
株式会社Walkers
Naru Hosoya
Email: naru.hosoya@walker-s.co.jp
URL: https://walker-s.co.jp/
───────────────────
```

## 簡易署名を使う既存テンプレの扱い

`schedule-adjust` の日程調整メールのように、案件内の名乗りに合わせて
本文内に「株式会社Walkers」＋担当者名の簡易署名を独自に書いているテンプレはそのまま維持してよい。
このケースでも `include_signature=false` は必須（付けないと簡易署名の直後に壊れたフル署名が二重挿入される）。

<!-- 発火=draft_gmail_message 呼び出し時／廃止=MCP側の署名HTML→プレーンテキスト変換バグが修正され、include_signature=trueで改行が保持されるようになったら見直し -->
