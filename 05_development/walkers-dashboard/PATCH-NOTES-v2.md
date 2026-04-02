# Walkers Dashboard Patch v2

## 適用方法

```bash
cd ~/Walkers_full
git apply 05_development/walkers-dashboard/walkers-dashboard-patch-v2.patch
```

適用後、ダッシュボードを再起動してください:
```bash
cd 05_development/walkers-dashboard
python3 server.py --port 8080
```

## 変更内容

### バグ修正
1. **スキル作成後に表示されない問題を修正** — ブラウザHTTPキャッシュが原因。`Cache-Control: no-store` ヘッダーを全APIレスポンスに追加し、フロントエンドの `fetchJSON()` に `{cache: 'no-store'}` を設定
2. **Skill Hubインストール済み状態がスキル削除後も残る問題を修正** — スキル削除時に `.skillhub-installed.json` からも除去。読み取り時にファイル存在チェックで自動クリーンアップ
3. **Skill Hub「取り下げ」ボタンが一部スキルで表示されない問題を修正** — `isMine` 判定条件を削除（個人ダッシュボードなので全スキル取り下げ可能に）

### セキュリティ修正
4. **Skill Hubインストール時のスキル名サニタイズ追加** — パストラバーサル攻撃を防止。`_sanitize_skill_name()` + `resolve_safe()` による二重チェック

### コード品質改善
5. **`_sanitize_skill_name()` 共通関数化** — 4箇所に散在していたインライン正規表現を統一
6. **`Sanitizer.sanitize()` のデッドブランチ削除** — if/elseの両方が同一コードだった問題を修正
7. **未使用変数の削除** — `isMine`, `myName`, `_syncPrompt`
8. **`bare except:` → `except Exception:`** — ベストプラクティスに準拠
9. **JSON読み書き共通ヘルパー** — `_read_json_file()` / `_write_json_file()` を追加し、重複ロジックを排除
10. **`read_json_body()` メソッド追加** — 6箇所の `read_body() + json.loads()` パターンを統一
11. **`DataLayer.refreshSkillHub()` / `DataLayer.installSkill()` 追加** — フロントエンドの重複fetchパターンを統一（4+2箇所）

### 新機能（前回パッチから含む）
- **スキル作成機能** — Skills タブからスキルを新規作成可能
- **スキル削除機能** — Skills タブからスキルを削除可能（.md.deleted バックアップ付き）
- **Skill Hub** — スキルの公開・インストール・取り下げ
- **Google Sheets同期** — Skill Hubレジストリの自動同期
- **スキルプレビュー** — Skill Hubスキルの詳細プレビュー

## 対象ファイル
- `05_development/walkers-dashboard/index.html` — フロントエンド
- `05_development/walkers-dashboard/server.py` — バックエンド
- `05_development/walkers-dashboard/refresh.sh` — データ収集スクリプト
- `05_development/walkers-dashboard/config.json` — 設定（Sheets連携追加）

## 注意
- `data.json` はパッチに含まれません（`refresh.sh` で自動生成されるため）
- パッチ適用後、初回は `bash refresh.sh` で `data.json` を再生成してください
