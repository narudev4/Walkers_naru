# コミット・プッシュ・PR作成

トリガー: 「コミット」

## 利用ツール

| ステップ | ツール | 用途 |
|---------|--------|------|
| Step 1 | Bash: `git status` | 変更ファイル一覧（`-uall` フラグ禁止） |
| Step 1 | Bash: `git diff` + `git diff --staged` | 差分確認 |
| Step 2 | Bash: `git log --oneline -5` | 直近コミットスタイル確認 |
| Step 3 | Bash: `git add <files>` | ステージング（`git add -A` は避ける） |
| Step 3 | Bash: `git commit -m "..."` | コミット |
| Step 4 | Bash: `git push -u origin <branch>` | プッシュ |
| Step 5 | Bash: `gh pr create --title "..." --body "..."` | PR作成（GitHub CLI） |

## 実行手順

1. **状態確認**（並列実行）:
   - Bash: `git status`（`-uall` フラグは使わない）で変更内容を確認する
   - Bash: `git diff` + `git diff --staged` で差分を確認する
   - Bash: `git log --oneline -5` で直近のコミットスタイルを確認する
2. 変更内容に基づいてコミットメッセージを作成し、ユーザーに確認する
3. ステージング → コミット → プッシュを実行する
   - Bash: `git add <対象ファイル>`（`.mcp.json`、`credentials/`、`.env` を含めないよう個別指定）
   - Bash: `git commit -m "..."` （HEREDOC形式でメッセージを渡す）
   - Bash: `git push -u origin <branch>`（プッシュ先をユーザーに確認）
4. ユーザーにPR作成が必要か確認し、必要な場合:
   - Bash: `gh pr create --title "..." --body "..."` で作成する

## コミットメッセージ規約

```
<type>: <簡潔な説明>

<詳細な説明（任意）>
```

type:
- feat: 新機能
- fix: バグ修正
- docs: ドキュメント
- style: フォーマット
- refactor: リファクタリング
- chore: 雑務

## ルール
- `.mcp.json`、`credentials/`、`.env` がステージングに含まれていないことを確認する
- コミット前に変更内容をユーザーに確認する
- プッシュ先ブランチをユーザーに確認する
- PR作成が必要かユーザーに確認する
