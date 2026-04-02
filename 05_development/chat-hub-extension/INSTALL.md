# ChatHub - Chrome拡張インストール手順

## 1. Chromeに読み込む

1. Chrome を開く
2. `chrome://extensions/` にアクセス
3. 右上の「デベロッパーモード」をON
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. このフォルダを選択: `05_development/chat-hub-extension/`
6. ChatHub アイコンがツールバーに表示される

## 2. 初期設定

1. ツールバーの **CH** アイコンをクリック → サイドパネルが開く
2. **設定タブ** → AIプロバイダーとAPIキーを入力
   - Anthropic: `sk-ant-...` 形式のキー
   - OpenAI: `sk-...` 形式のキー

## 3. 使い方

### チャット管理
- **「全て開く」** → 9つのチャットツールが一括でピンタブとして開く
- サイドパネルから **ワンクリックでタブ切り替え**
- 未読バッジがリアルタイムで表示される

### AI機能
- **方法1**: サイドパネルの「AI」タブにテキストを貼り付け → 返信案/要約/英訳
- **方法2**: チャット画面でテキスト選択 → 右クリック → ChatHubメニュー

## 4. 対応チャットツール

| ツール | Web版 | 未読検知 |
|--------|-------|---------|
| LINE (公式アカウント) | chat.line.biz | △ |
| LINE WORKS | workmobile.com | ○ |
| Lark | larksuite.com | ○ |
| Chatwork | chatwork.com | ○ |
| Slack | slack.com | ○ |
| Gmail (個人) | mail.google.com | ○ |
| Gmail (業務) | mail.google.com | ○ |
| Messenger | messenger.com | ○ |
| Teams | teams.microsoft.com | ○ |
