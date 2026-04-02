# Cron実行通知 & Resume UX アーキテクチャ

> 2026-03-20 設計・実装状況ドキュメント

---

## 1. 理想のUXフロー（合意済み）

```
[cron発火 22:00]
    ↓
[claude -p --output-format json 実行]
    ↓
[session ID取得] + [成果物保存: sub-agents/{id}/artifacts/*.md]
    ↓
[Google Chat通知] ←── メインのタッチポイント
  ✅ [cron] Google Chat分析 — SUCCESS (156s)

  実行結果: 19件の会話を分析し8件の問題を検出...
  （要約 300〜800字）

  💬 このスレッドに返信すると、続きの会話ができます
  📊 ダッシュボードで詳細を確認
    ↓
[ユーザーがスレッドに返信]
  「P1の重複処理、server.pyに直して」
    ↓
[_poll_cloud_commands: cron threadを検出]
  → _cron_thread_sessions[thread] → session_id取得
  → _chat_sessions にseed
    ↓
[handle_gateway_chat: --resume {session_id} で実行]
    ↓
[結果をGoogle Chatスレッドに返信]
    ↓
[さらに返信で会話継続可能（マルチターン）]


[ダッシュボード] ←── PC作業時の詳細確認用
  エージェントカード:
    📄 → 成果物ビューア（フル出力閲覧 + ⏩ resume）
    💬 → チャットモーダル
  実行ログ:
    ⏩ resume → チャットモーダル（session ID引き継ぎ）
    📄 → 成果物ビューア
```

---

## 2. 実装状況

### ✅ 完了

| # | 機能 | ファイル | 詳細 |
|---|------|---------|------|
| 1 | **デバウンス処理 (P1)** | server.py | 同一プロンプトを15秒以内に受信→スキップ (`_gateway_dedup`) |
| 2 | **権限デッドロック対策 (P2)** | server.py | Google Chat/cloud経由→`--dangerously-skip-permissions`自動付与 |
| 3 | **Session IDキャプチャ** | server.py | `_execute_sub_agent`を`--output-format json`に変更、session_idを抽出 |
| 4 | **成果物保存** | server.py | `sub-agents/{id}/artifacts/*.md`にフル出力を保存（最大30件ローテーション） |
| 5 | **Google Chat通知（リッチ）** | server.py `_notify_cron_result()` | 要約+ダッシュボードリンク+「返信でresume」案内 |
| 6 | **通知スレッド→session IDマッピング** | server.py `_cron_thread_sessions` | 通知時にthread_name→session_idを保存 |
| 7 | **Google Chat返信→resume検出** | server.py `_poll_cloud_commands()` | cron通知スレッドからの返信を検出→`_chat_sessions`にseed→`--resume`で実行 |
| 8 | **cronNotifySpace自動学習** | server.py | Google Chatメッセージ受信時にspaceをconfig.jsonに永続化 |
| 9 | **Artifacts API** | server.py | `GET /api/sub-agents/{id}/artifacts` — 成果物一覧（content含む） |
| 10 | **Resume API** | server.py | `POST /api/sub-agents/{id}/resume` — session IDでセッション再開 |
| 11 | **Seed Session API** | server.py | `POST /api/gateway/chat/seed-session` — チャットUIにsession IDを注入 |
| 12 | **成果物ビューア (UI)** | index.html `ArtifactViewer` | 左ペイン: 実行選択 / 右ペイン: フル出力+⏩ resume |
| 13 | **Resumeモーダル→チャットUI遷移** | index.html | ⏩ resume → ChatModal.open（session ID引き継ぎ） |
| 14 | **実行ログにresume/📄ボタン** | index.html | recent-runsにsession IDがある行に⏩ resumeと📄を表示 |
| 15 | **エージェントカードに📄ボタン** | index.html | 各カードのボタン列に成果物ボタン追加 |

### ⚠️ 未テスト（今夜22:00が初回テスト）

| # | 機能 | 状況 |
|---|------|------|
| A | **Google Chat通知の実送信** | コード実装済み。cronNotifySpaceがまだ未設定（初回Google Chat受信時に自動設定される） |
| B | **cron通知スレッドへの返信→resume** | コード実装済み。Google Chat→Webhook→server.pyのフルパスは未テスト |
| C | **通知メッセージの見た目** | リッチテキスト（*太字*, リンク）がGoogle Chatで正しく表示されるか未確認 |

### ❌ 未実装（設計はあるが手を付けていない）

| # | 機能 | 設計内容 | 優先度 |
|---|------|---------|--------|
| D | **90秒タイムアウト警告** | 処理中90秒経過でGoogle Chatに「処理中です」を送信 | 高 |
| E | **180秒タイムアウト→handoff.md** | 180秒で自動中断、handoff.mdにタスク記録+「PCから実行して」通知 | 高 |
| F | **_cron_thread_sessionsの永続化** | 現在メモリのみ。サーバー再起動で消える。config.jsonかファイルに保存すべき | 中 |
| G | **ResumeModalの削除** | ChatModal遷移に変更したのでResumeModal HTMLとJSは不要。削除してよい | 低 |
| H | **Google Chat通知の設定UI** | ダッシュボード設定画面でcronNotifySpaceを編集できるようにする | 低 |

---

## 3. ファイル構成

```
server.py
├── _notify_cron_result()         # cron完了→Google Chat通知（リッチ）
├── _cron_thread_sessions         # thread→session_idマッピング（メモリ）
├── _gateway_dedup                # デバウンス用ハッシュ（メモリ）
├── _execute_sub_agent()          # --output-format json + session_id取得 + artifacts保存
├── handle_gateway_chat()         # --dangerously-skip-permissions (cloud/google-chat)
├── handle_sub_agent_artifacts()  # GET /api/sub-agents/{id}/artifacts
├── handle_sub_agent_resume()     # POST /api/sub-agents/{id}/resume
├── seed-session endpoint         # POST /api/gateway/chat/seed-session
└── _poll_cloud_commands()        # cron thread返信→resume検出

index.html
├── ArtifactViewer                # 成果物モーダル（左右ペイン）
├── ResumeModal                   # ※廃止予定（ChatModal遷移に置換済み）
├── ChatModal.open()              # resumeSessionId対応（seed-session呼び出し）
├── .sa-artifacts-btn             # エージェントカード📄ボタン
├── .sa-resume-run-btn            # 実行ログ⏩ resumeボタン
└── .sa-run-artifact-btn          # 実行ログ📄ボタン

sub-agents/{id}/
├── artifacts/                    # 実行ごとのフル出力 (*.md, 最大30件)
├── logs/                         # 実行ログ (*.log, 最大60件)
│   └── SessionId: {uuid}         # ログにsession ID記録
└── memories/                     # facts.md, decisions.md, preferences.md
```

---

## 4. データフロー詳細

### Google Chat Resume フロー

```
[Google Chat スレッド返信]
         ↓
[Vercel Webhook] → [Neon DB]
         ↓
[server.py _poll_cloud_commands()] ← 15秒ごとにポーリング
         ↓
    threadName を取得
         ↓
    _cron_thread_sessions[threadName] を参照
         ↓ session_id が見つかった
    _chat_sessions[sessionKey] = { session_id: ... } をseed
    is_resume = True に設定
         ↓
    /api/gateway/chat に転送
         ↓
[handle_gateway_chat]
    _chat_sessions[sessionKey].session_id を取得
    claude -p --resume {session_id} --output-format json で実行
         ↓
    結果を _gateway_results に保存
         ↓
[_relay_results_to_cloud]
    結果を Vercel に返送
         ↓
[_reply_to_google_chat]
    Google Chat スレッドに結果を返信
```

### ダッシュボード Resume フロー

```
[⏩ resumeボタンクリック]
         ↓
[ChatModal.open({ resumeSessionId: ... })]
         ↓
[fetch /api/gateway/chat/seed-session]
    _chat_sessions[sessionKey] = { session_id: ... }
         ↓
[ユーザーがメッセージ入力]
         ↓
[fetch /api/gateway/chat { sessionKey }]
         ↓
[handle_gateway_chat]
    session_id を _chat_sessions から取得
    claude -p --resume {session_id} で実行
         ↓
[結果をチャットUIにポーリング表示]
```

---

## 5. 設定値

| キー | 場所 | 説明 | デフォルト |
|------|------|------|-----------|
| `cronNotifySpace` | config.json | Google Chat通知先space | 自動学習（初回Chat受信時に保存） |
| `_DEDUP_WINDOW_SEC` | server.py | デバウンス窓（秒） | 15 |
| artifacts最大数 | server.py | `sub-agents/{id}/artifacts/`の保持数 | 30 |
| logs最大数 | server.py | `sub-agents/{id}/logs/`の保持数 | 60 |
| `_cron_thread_sessions`有効期間 | server.py | cronスレッド→sessionマッピングの有効期間 | 7日 |

---

## 6. 次のアクション（優先順）

1. **今夜22:00のcron実行を待って全フロー動作確認**
   - Google Chat通知が届くか
   - 通知に要約+リンクが含まれるか
   - 通知スレッドに返信してresume会話ができるか

2. **D: 90秒タイムアウト警告の実装**
   - Google Chat経由の長時間処理で「処理中です」を送信

3. **E: 180秒タイムアウト→handoff.md**
   - 自動中断 + handoff.md記録 + 「PCから実行して」通知

4. **F: _cron_thread_sessionsの永続化**
   - サーバー再起動後もresume可能にする

5. **G: ResumeModal HTMLの削除**（クリーンアップ）

---

## 7. セキュリティ: Google Chat Bot 経由のアクセス制御

### 現状のリスク（CRITICAL）

```
[悪意のあるユーザーがBotを追加]
    → [メッセージ送信]
    → [Vercel Webhook（認証なし）]
    → [Neon DB保存]
    → [server.pyがポーリング]
    → [claude -p --dangerously-skip-permissions で実行]
    → PCのファイル・システムに自由アクセス
```

**Botを追加できる人 = PCに指示を出せる人** という状態。送信者の認証チェックが一切ない。

### 必要な対策

| # | 対策 | 実装場所 | 優先度 | 状態 |
|---|------|---------|--------|------|
| S1 | **送信者メールのホワイトリスト** | server.py `_poll_cloud_commands()` | **最高** | ✅ 完了 |
| S2 | **Webhook署名検証** | Vercel API route | 高 | ❌ 未実装 |
| S3 | **Bot公開範囲の確認・制限** | Google Cloud Console | 高 | ❌ 未確認 |
| S4 | **ダッシュボードで許可ユーザー管理UI** | index.html + config.json | 中 | ✅ 完了 |

#### S1: 送信者ホワイトリスト ✅ 完了
```python
# config.json
"allowedSenders": ["daiki.furutani@walker-s.co.jp", "<YOUR_EMAIL>"]

# server.py _poll_cloud_commands() — メール不一致でスキップ
sender_email = cmd_meta.get('senderEmail', '')
allowed_senders = CONFIG.get('allowedSenders', [])
if allowed_senders and sender_email.lower() not in allowed_senders:
    print(f'[security] Rejected command from {sender_email} (not in allowedSenders)')
    continue

# API: GET/PUT /api/settings/allowed-senders
# Dashboard: 設定画面に「送信者ホワイトリスト」セクション追加
```

#### S2: Webhook署名検証
- Google Chatは `Authorization: Bearer {token}` ヘッダーを送信
- Vercel側で Google の JWT を検証し、偽のリクエストを拒否

#### S3: Bot公開範囲
- Google Cloud Console → Chat API → Bot設定
- 「誰がこのBotを追加できるか」を「同じドメインのユーザーのみ」に制限

---

## 8. 通知先のエージェント別設定

### 現状
- `cronNotifySpace` がグローバルに1つだけ（config.json）
- 全エージェントが同じスペースに通知

### 理想
- エージェントごとに通知先スペースを設定可能
- ダッシュボードの編集UIで設定
- 設定なしの場合はグローバル `cronNotifySpace` にフォールバック

### 実装方針
```json
// sub-agents.json の各エージェントに追加
{
  "id": "gchat-analyzer",
  "notifySpace": "spaces/xxxxxxxxx",  // 個別設定（空ならグローバル）
  ...
}
```
```python
# _notify_cron_result() を変更
space = sa.get('notifySpace', '') or CONFIG.get('cronNotifySpace', '') or _last_chat_space
```

ダッシュボードの編集モーダルに「通知先スペース」入力欄を追加。

---

## 9. 次のアクション（優先順・更新版）

1. **[S1] 送信者ホワイトリスト実装** — セキュリティ最優先
2. **[S3] Bot公開範囲の確認** — Google Cloud Consoleで確認
3. **今夜22:00のcron通知テスト** — E2E動作確認
4. **エージェント別通知先設定** — sub-agents.json + ダッシュボードUI
5. **90秒タイムアウト警告**
6. **180秒→handoff.md**
7. **_cron_thread_sessions永続化**
8. **ResumeModal削除（クリーンアップ）**
