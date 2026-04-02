// ChatHub - チャットツール設定
const CHAT_TOOLS = [
  {
    id: 'line',
    name: 'LINE',
    label: 'FEMMAオーナーLINE',
    url: 'https://chat.line.biz/',
    icon: 'LY',
    color: '#06C755',
    category: 'chat',
    webAvailable: false,
    note: 'LINE公式アカウント管理画面（Web版）'
  },
  {
    id: 'lineworks',
    name: 'LINE WORKS',
    label: 'LINE WORKS',
    url: 'https://talk.workmobile.com/',
    icon: 'LW',
    color: '#00C73C',
    category: 'chat',
    webAvailable: true
  },
  {
    id: 'lark',
    name: 'Lark',
    label: 'Lark (Walkers)',
    url: 'https://www.larksuite.com/messenger/',
    icon: 'LK',
    color: '#3370FF',
    category: 'chat',
    webAvailable: true
  },
  {
    id: 'chatwork',
    name: 'Chatwork',
    label: 'Chatwork',
    url: 'https://www.chatwork.com/',
    icon: 'CW',
    color: '#E3382B',
    category: 'chat',
    webAvailable: true
  },
  {
    id: 'slack',
    name: 'Slack',
    label: 'Slack (旧Walkers)',
    url: 'https://app.slack.com/client',
    icon: 'SL',
    color: '#4A154B',
    category: 'chat',
    webAvailable: true
  },
  {
    id: 'gmail-personal',
    name: 'Gmail',
    label: 'Gmail (個人)',
    url: 'https://mail.google.com/mail/u/0/',
    icon: 'GM',
    color: '#EA4335',
    category: 'email',
    webAvailable: true
  },
  {
    id: 'gmail-work',
    name: 'Gmail',
    label: 'Gmail (業務)',
    url: 'https://mail.google.com/mail/u/1/',
    icon: 'GM',
    color: '#4285F4',
    category: 'email',
    webAvailable: true
  },
  {
    id: 'messenger',
    name: 'Messenger',
    label: 'Messenger',
    url: 'https://www.messenger.com/',
    icon: 'MS',
    color: '#0084FF',
    category: 'chat',
    webAvailable: true
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    label: 'Microsoft Teams',
    url: 'https://teams.microsoft.com/',
    icon: 'TM',
    color: '#6264A7',
    category: 'chat',
    webAvailable: true
  }
];

// AI設定
const AI_CONFIG = {
  provider: 'anthropic', // 'anthropic' or 'openai'
  model: 'claude-sonnet-4-20250514',
  apiKeyStorageKey: 'chathub_ai_api_key',
  systemPrompt: `あなたはビジネスチャットの返信アシスタントです。
与えられたメッセージに対して、適切な返信案を日本語で3パターン生成してください。

ルール:
- ビジネスにふさわしいトーン（丁寧すぎず、カジュアルすぎず）
- 簡潔で要点を押さえた返信
- 相手の意図を汲み取った回答
- パターン1: 丁寧な返信、パターン2: カジュアルな返信、パターン3: 最短の返信`
};

if (typeof module !== 'undefined') {
  module.exports = { CHAT_TOOLS, AI_CONFIG };
}
