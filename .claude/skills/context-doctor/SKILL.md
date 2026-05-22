---
description: S3 とローカルのコンテキストが整合しているか診断し、競合ファイル (.conflict-*) や孤立ファイル、サイズ統計を一覧する。同期トラブル時に最初に呼ぶ。
---

# context-doctor

クロスデバイス同期の健康診断。`/sync-down` `/sync-up` で問題が出た時に状況を可視化する。

## トリガー

- 「同期おかしい」「conflict があるみたい」「context doctor」
- `/sync-down --dry-run` で大量の差分が出た時
- bisync が `Resync` を要求してきた時

## 実行手順

以下を順に Bash で実行し、レポートを Markdown で出力する:

### 1. 競合ファイル一覧

```bash
PROJ_ROOT="$(git rev-parse --show-toplevel)"
find "$PROJ_ROOT" -type f -name '*.conflict-*' 2>/dev/null
```

### 2. 同期対象ディレクトリのサイズ

```bash
du -sh "$PROJ_ROOT"/{00_context,01_strategy,02_finance,03_projects,04_sales,06_learning} 2>/dev/null
du -sh "$PROJ_ROOT/DAILY.md" 2>/dev/null
```

### 3. S3 側のサイズ (rclone size)

```bash
rclone --config "$PROJ_ROOT/credentials/rclone.conf" size walkers-s3:walkers-context-prod
```

### 4. ロック状態

```bash
ls -la "$PROJ_ROOT/.sync.lock" 2>/dev/null
ls -la "$PROJ_ROOT/.sync-logs/" 2>/dev/null | tail -5
```

### 5. 直近のログ要約

```bash
tail -50 "$(ls -t "$PROJ_ROOT/.sync-logs/"sync-*.log 2>/dev/null | head -1)" 2>/dev/null
```

### 6. 100MB 超の混入チェック

```bash
find "$PROJ_ROOT"/{00_context,01_strategy,02_finance,03_projects,04_sales,06_learning} \
  -type f -size +100M 2>/dev/null
```

## 出力フォーマット

```markdown
# Context Doctor Report — {YYYY-MM-DD HH:MM}

## 競合ファイル ({N} 件)
- ...

## サイズ
| パス | ローカル | S3 |
|---|---|---|
| ...

## ロック
- .sync.lock: {存在/不在}, PID {N}

## 直近ログ
...

## 推奨アクション
- {自動判定した次の手}
```

## 推奨アクションの判定ルール

- 競合 > 0 → 「.conflict-* ファイルを手動マージして元ファイルに統合し、削除してから sync-up」
- ロック孤児 (PID 不在) → 「`.sync.lock` を削除」
- サイズ大きく乖離 → 「`/sync-down --resync` で復旧」
- 100MB 超ファイル検出 → 「圧縮 or `output/` へ移動」

## 関連

- `/sync-down`, `/sync-up`
