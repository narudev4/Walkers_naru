# Chathub 運用メモ（naru 専用環境）

古谷さん配布の `full999/chathub-distribution` を、naru 専用に構築したものの運用記録。
構築日: 2026-08-03。

配布リポジトリの clone 自体は `05_development/chathub-distribution/`（Git 管理外）にある。
このディレクトリは運用手順だけを Git 管理する。**認証情報・トークン・鍵はここに書かない**。

## 構成

| 項目 | 値 |
|---|---|
| サーバー実体 | win-naru の WSL2 Ubuntu 24.04.4（Tailscale ノード名 `winnaru`） |
| Tailscale IP | 100.89.168.85 |
| 公開URL | `https://winnaru.tailac157e.ts.net`（Tailscale Serve、tailnet 内のみ） |
| Matrix server_name | `chathub.naru.internal`（変更不可） |
| 管理ユーザー | `@naru:chathub.naru.internal` |
| インストール先 | `/opt/chathub`（WSL 内） |
| ソース | `~/chathub-src/chathub-distribution`（WSL 内） |
| 認証情報 | `/opt/chathub/credentials.txt`（600、WSL 内のみ） |

Mac からは `ssh winnaru` で入る。デスクトップアプリは
`05_development/chathub-distribution/ui/release/mac-arm64/Chathub.app`。

## 配布版からの変更点

配布版は「Windows の PowerShell から `wsl` を叩く」前提だが、この環境では WSL に直接 SSH
できるので、PowerShell を経由しない Linux ネイティブ構成にした。

- `~/chathub-src/install-linux.sh` — `install-windows.ps1` の WSL 内処理を移植したもの。
- `~/chathub-src/update-linux.sh` — `update-windows.ps1` の移植。UI ビルドも WSL 内で行う。
- `/opt/chathub/nginx-default.conf` — **稼働中サービスのみ**に絞った最小構成。理由は下記。
- Matrix を UI と同一オリジン（`/_matrix/`）で出している。CORS もポート開放も不要になる。
- Electron の接続先は既定値をビルド時に焼き込んでいる。`main.cjs` は
  `process.env.CHATHUB_PRIMARY_URL` を実行時に読むが、パッケージした `.app` には環境変数が
  渡らないため。ビルドは `scripts/build-mac-app.sh` 相当の手順で行う。

## 更新手順

```bash
ssh winnaru
cd ~/chathub-src/chathub-distribution && git pull
bash ~/chathub-src/update-linux.sh
```

`update-linux.sh` は UI をビルドして `/opt/chathub/webui` へ配り、自作バックエンド
（gmail-proxy / bridge-links / chatwork-bridge / infra）のソースを同期する。
ブリッジの認証情報・DB・`nginx-default.conf` は触らない。

Mac アプリを更新するときは、`ui/electron/main.cjs` の既定URLを差し替えてから
`npm run app:dir` し、`codesign --force --deep --sign -` する。作業ツリーは元に戻すこと。

## バックアップ対象

すべて WSL 内。**Git には絶対に入れない**。

| パス | 中身 | 失うと |
|---|---|---|
| `/opt/chathub/synapse/` | homeserver.yaml、署名鍵、SQLite DB | 全ルーム・全メッセージ・サーバー同一性 |
| `/opt/chathub/credentials.txt` | 管理ユーザーのパスワード | ログイン手段 |
| `~/chathub-src/chathub-distribution/.env` | server_name、URL設定 | 再構築時の設定 |
| `/opt/chathub/nginx-default.conf` | provisioning の shared_secret（ブリッジ追加後） | ブリッジのプロビジョニング |
| `/opt/chathub/bridges/` | 各ブリッジの config・DB・ログインセッション | 全ブリッジの再ログイン |
| `/opt/chathub/bridge-links-data/` | 未着信メッセージの記録 | 取りこぼしの記録 |
| `/opt/chathub/gmail-proxy/creds.json` | Google OAuth 認証情報 | Gmail 連携 |

取得例。

```bash
ssh winnaru "sudo tar czf /tmp/chathub-backup.tgz \
  -C / opt/chathub/synapse opt/chathub/credentials.txt \
  opt/chathub/nginx-default.conf opt/chathub/bridges opt/chathub/bridge-links-data"
scp winnaru:/tmp/chathub-backup.tgz ~/backups/
```

**署名鍵（`synapse/*.signing.key`）を失うと server_name の同一性が壊れ、既存ルームに
復帰できない。** ここだけは必ず退避する。

## 復旧手順

1. WSL2 Ubuntu を用意し、Docker Engine と Tailscale を入れる。
2. `git clone https://github.com/full999/chathub-distribution.git ~/chathub-src/chathub-distribution`
3. `.env` を復元する（`CHATHUB_SERVER_NAME=chathub.naru.internal` は必ず一致させる）。
4. バックアップを `/opt/chathub` へ展開する。
5. `bash ~/chathub-src/install-linux.sh` を実行する。既存の `synapse/homeserver.yaml` と
   `credentials.txt` があれば、生成とユーザー登録はスキップされる。
6. `bash ~/chathub-src/update-linux.sh` で UI を配る。
7. `sudo tailscale serve --bg 8009` で HTTPS を復旧する。

## 自動復旧

実機で検証済み（2026-08-03）。`wsl --shutdown` から **約36秒で全復旧**した。

- WSL 内: `docker.service` が enabled、コンテナは `restart: unless-stopped`、
  `tailscaled` が enabled、`/etc/wsl.conf` に `systemd=true`。
- Windows 側: タスクスケジューラ `WalkersChat-WSL-KeepAlive` が
  `wsl.exe -d Ubuntu --exec sleep infinity` を実行し、WSL2 VM を開いたまま保つ。
  ログオン時トリガー＋毎日トリガーで、どちらも5分間隔で再実行する。
- Tailscale Serve の設定は tailscaled に永続化されるので、再起動をまたいで維持される。

### 制約

**Windows を再起動した場合、naru が Windows にログオンするまで WSL は起動しない。**
keepalive タスクの principal が `InteractiveToken` のため。完全無人にするなら Windows の
自動ログオン設定が要る。停電・強制再起動のあと Chathub が沈黙していたら、まずこれを疑う。

## 未設定の連携

現在動いているのは **Synapse・Web UI・bridge-links の3つだけ**。以下は未設定。

| 連携 | 状態 | 必要な作業 |
|---|---|---|
| Chatwork | **稼働中（2026-08-03〜）** | 双方向の送受信を確認済み。ダブルパペットで `@naru` 本人名義 |
| Google Chat | **稼働中（2026-08-05〜）** | `naru.hosoya@walker-s.co.jp` で接続。メッセージ同期を確認済み |
| Gmail | **稼働中（2026-08-05〜）** | `gmail-proxy/creds.json` に workspace-mcp と同じ OAuth 認証情報を流用 |
| LINE | **稼働中（2026-08-05〜）** | ログイン済み。ログインは**メール＋パスワード**方式 |
| Slack | **ログイン待ち（2026-08-05〜）** | 構築完了。ログインフローは `token`（xoxc/xoxd）と `app` |
| Messenger | **ログイン待ち（2026-08-05〜）** | 構築完了。`dock.mau.dev/mautrix/meta:latest`、フローは `messenger` 等4種 |
| Teams | 構築中（2026-08-05〜） | 上流を clone してパッチ適用・自前ビルド。非公式クライアント方式で凍結リスクあり |
| Discord / WhatsApp / Signal / Twitter / LinkedIn / Instagram / gmessages | 未設定 | appservice registration と各サービスのログイン（OAuth・QR・Cookie） |
| Sygnal（プッシュ通知） | 未設定 | VAPID 秘密鍵の生成 |

### Gmail の認証情報について

`credentials/workspace-mcp/naru.hosoya@walker-s.co.jp.json` の `client_id` /
`client_secret` / `refresh_token` をそのまま `gmail-proxy/creds.json` に流用している
（同じ Google アカウント・同じ OAuth クライアントで、Gmail の全スコープが既に付与済みだった）。

**このため google-workspace MCP 側で token を revoke すると Gmail 連携も同時に止まる。**
分離したくなったら、同じ OAuth クライアントで Chathub 専用の refresh_token を発行して
`creds.json` だけ差し替えればよい。

### LINE ブリッジの構築（配布物に手順が無いので記録）

上流は **`https://github.com/highesttt/matrix-line-messenger`**（bridgev2 / mautrix-go）。
配布物には `infra/bridges/line/patches/membership.go` しか入っておらず、リポジトリ名も
Dockerfile も無いので、以下を自前で行った。

```bash
cd /opt/chathub/src && git clone https://github.com/highesttt/matrix-line-messenger.git
cp /opt/chathub/infra/bridges/line/patches/membership.go \
   /opt/chathub/src/matrix-line-messenger/pkg/connector/membership.go
cd /opt/chathub/src/matrix-line-messenger && docker build -t matrix-line-messenger:latest .
```

踏んだ点が3つある。

1. **配布パッチが上流の古い API を参照していて、そのままではビルドが落ちる。**
   `lc.shouldAttemptTokenRecovery` / `lc.recoverToken` の2段構えは、上流で
   `lc.callLine(ctx, func(*line.Client) error)` に統合済み。この1本に書き換えた
   （`pkg/line` の import 追加が必要）。**再クローン時は同じ書き換えが要る。**
2. **上流の `docker-run.sh` にバグがある。** 初回起動でサンプル config を `/data/config` に
   書きながら「config.yaml にコピーした」と表示する。`config` → `config.yaml` に
   手でリネームしないと、永久に「config が無い」と言われ続ける。
3. **database の既定が postgres。** 単独利用で postgres を建てる意味がないので
   `sqlite3-fk-wal` + `file:/data/bridge.db?_txlock=immediate` に変更した。

**制約:** このブリッジは自身を LINE の Chrome 拡張クライアントとして名乗る。LINE は
同時に1つの拡張セッションしか許さないため、**LINE Chrome 拡張とブリッジは併用できない**。
非公式クライアント方式なので、利用規約違反によるアカウント凍結のリスクがある。

なお有料リアクションを含むトークで `PaidReactionType ... version of type int` のパース
エラーが出る（LINE 側が数値を文字列で返すようになった上流のバグ）。実測では1641件中7件。
新着の取得は続くので実害は限定的。

### Teams ブリッジの構築（`scripts/apply-teams-patches.sh`）

上流は **`https://github.com/gekiclaws/matrix-teams`**（commit `0c4e041`、配布元のパッチが
想定しているベースと一致）。`infra/bridges/teams/patches/` に `.patch` 4本と `.go` ミラー
21本が入っており、**両方が必要**（patch にしか無い変更と、ミラーにしか無いファイルがある）。

配布元 README の記載どおりに置くと**ビルドが落ちる**。以下は実測で判明した差異。

1. **ミラーの行き先はファイル名ではなく `package` 宣言で決まる。**
   README は「接頭辞なしは `pkg/connector/`、例外は `auth_state.go` だけ」と書いているが、
   実際は `msal.go`(auth) / `thread_roster.go`(model) / `threads.go`(client) も接頭辞なしで
   別パッケージ。名前で振り分けると
   `found packages connector (capabilities.go) and auth (msal.go) in pkg/connector` で落ちる。
2. **`teams-roster.patch` は上流に素直に当たらない**（`handleteams.go:207` でコンフリクト）。
   ただし `handleteams.go` / `client.go` はミラーが完成形を持つので、**ミラーを敷いた後に
   `patch -p1 --forward` で当てる**と、既に入っている hunk は「適用済み」として飛ばされ、
   ミラーに無い `conversations.go`（メンバー一覧の取得）だけが残って入る。

**制約:** Teams も非公式クライアント方式で、配布元 README が「Microsoft 利用規約違反で、
アカウント凍結の可能性がある」と明記している。単独メンテナの実験的プロジェクト。
ログインは**デスクトップアプリの埋め込み窓**からのみ可能（ブラウザ版 UI では不可）。

### ブリッジを追加するときの注意

配布版の `infra/nginx-default.conf` は全ブリッジ稼働前提で書かれている。nginx は起動時に
すべての upstream を名前解決するため、**未起動コンテナを参照する `location` が1つでもあると
nginx 自体が起動できない**（`host not found in upstream`）。実際これで Web UI が起動ループした。

そのため `/opt/chathub/nginx-default.conf` は稼働中サービスのみに絞ってある。ブリッジを
足したら、`infra/nginx-default.conf` から該当 `location` をコピーして戻す。その際、配布版では
`Authorization "Bearer <REDACTED>"` と伏せられているので、各ブリッジの `config.yaml` の
`provisioning.shared_secret` を入れ直す必要がある。

### Chatwork 追加で踏んだ落とし穴（他のブリッジでも起きる）

1. **未設定ブリッジの経路は 404 JSON を返さないと UI が落ちる。**
   UI は起動時に**全ブリッジ**の `whoami` と `/gmail/threads` を叩く。該当 `location` が無いと
   `try_files $uri /index.html` に落ちて **HTML を 200 で返す**ため、UI が JSON として読もうとして
   `cannot read properties` で停止する。`location /provision/` と `location /gmail/` に 404 JSON を
   置いてある。nginx は最長プレフィックス一致なので、設定済みブリッジはこの 404 に落ちない。
2. **owner を appservice の namespace に入れないと本人名義で送れない。**
   入れないと `Application service cannot masquerade as this user` でルーム同期が全滅する。
   `@naru` は実在ユーザーなので **`exclusive: false`** で入れること（`true` では登録できない）。
3. **`config.json` の置き場所は `data/` 配下。**
   `chatwork-bridge/config.json` ではなく `chatwork-bridge/data/config.json`
   （`CHATWORK_BRIDGE_DATA` 配下）。間違えると再起動ループになる。
4. **API トークンは UI から入れられる。**
   `config.json` の `chatworkToken` は空のままで良く、アプリの「接続する」から貼ると
   ブリッジが自分で書き込む。トークンを手で配置する必要はない。

## 動作確認済みの内容（2026-08-03）

- Mac から `https://winnaru.tailac157e.ts.net` へ HTTPS 接続（Let's Encrypt、検証OK）。
- Web UI・Service Worker（`sw.js`）・`/_matrix/` すべて 200。
- Matrix ログイン、ルーム作成、メッセージ送信、読み出し、ログアウト。
- `wsl --shutdown` からの自動復旧（36秒）。
- 配布物の検証（UIテスト283件、chatwork-bridge 18件、bridge-links 5件、gitleaks クリーン）。
- **Chatwork ブリッジの双方向送受信。** Chatwork の既存ルームが Matrix に同期され、
  Matrix→Chatwork（`sent to chatwork room …`）、Chatwork→Matrix の両方向が通った。
  送信者は `@naru` 本人（ゴーストではない）。
