# launchd 自動実行セットアップ

## 概要
毎朝03:00にClaude CLIを起動し、`/morning-routine` コマンドを自動実行する。

## セットアップ手順

### 1. Claude CLIのパスを確認
```bash
which claude
```
出力が `/usr/local/bin/claude` でない場合、plistの `ProgramArguments` を修正する。

### 2. plistをLaunchAgentsにコピー
```bash
cp com.walkers.aimaguru.plist ~/Library/LaunchAgents/
```

### 3. plistを読み込む
```bash
launchctl load ~/Library/LaunchAgents/com.walkers.aimaguru.plist
```

### 4. 動作確認（手動実行）
```bash
launchctl start com.walkers.aimaguru
```

### 5. ログ確認
```bash
tail -f <YOUR_PATH>
```

## 停止・無効化

### 一時停止
```bash
launchctl stop com.walkers.aimaguru
```

### 完全に無効化
```bash
launchctl unload ~/Library/LaunchAgents/com.walkers.aimaguru.plist
```

## トラブルシューティング

### Claude CLIが見つからない
- Homebrew経由でインストールした場合: `/opt/homebrew/bin/claude`
- npm経由でインストールした場合: `npx claude` に変更

### 実行されない
- Mac miniがスリープしていないか確認
- `launchctl list | grep walkers` で状態確認
- エラーログ: `output/digest/launchd-stderr.log`

### API認証エラー
- Claude CLIの認証が有効か確認: `claude --version`
- 環境変数 `ANTHROPIC_API_KEY` が設定されているか確認

## 注意事項
- Mac miniが24時間稼働している前提
- スリープ設定を「しない」にするか、`caffeinate` を併用する
- ネットワーク接続が切れている場合はローカルデータのみで動作する
