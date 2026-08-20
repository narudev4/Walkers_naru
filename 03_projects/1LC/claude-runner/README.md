# claude-runner — Claude Code CLI を Docker で非対話実行する最小構成

1LC 案件「物件概要書 PDF の取得→下帯書き換え」を、API 従量課金ではなく **Claude サブスク（Max）内で `claude -p` を常時稼働マシンから回す**ための検証用イメージ。
ローカル Docker → AWS（EC2 / ECS Fargate）へ同じイメージを持っていく前提。

## 構成

| ファイル | 役割 |
|---|---|
| `Dockerfile` | Ubuntu 24.04 + 公式インストーラ（ネイティブバイナリ、**Node.js 不要**）。非 root ユーザー `runner`。 |
| `.env.example` | `CLAUDE_CODE_OAUTH_TOKEN` の雛形。**`.env` にコピーして使う。`.env` は git / イメージに含めない**（`.gitignore` `.dockerignore` 済み）。 |
| `run.sh` | `docker run --env-file .env ... -p "<prompt>" --output-format json` のラッパー。`./work` をコンテナの作業ディレクトリにマウント。 |
| `smoke.sh` | トークン認証の疎通テスト（`Reply with exactly OK` を Sonnet・1 ターンで実行）。 |

## 実測（2026-08-18、Apple Silicon / Docker 29.4.2）

| 項目 | arm64（ローカル native） | amd64（`--platform linux/amd64`） |
|---|---|---|
| ビルド時間 | 3 分 50 秒（うちインストーラ 200 秒＝バイナリ DL） | 3 分 25 秒 |
| Claude Code バージョン | 2.1.234 | 2.1.234 |
| イメージサイズ | 圧縮 155 MB / 展開後 682 MB（`docker image ls`） | 圧縮 159 MB / 展開後 670 MB |
| レイヤ内訳 | base 110 MB + apt 91 MB + claude 326 MB（うち claude バイナリ単体 328 MB） | 同等 |
| 起動直後メモリ（対話モードでログイン待ち、`docker stats`） | 136 MiB（プロセス RSS 235 MB） | 未計測（エミュレーション） |
| `claude -p` 認証なし | `{"is_error":true,"result":"Not logged in · Please run /login"}` exit 1、36 ms | 同じ |
| `claude -p` 無効トークン | `Failed to authenticate. API Error: 401 Invalid bearer token` exit 1 | — |

`-p` 実行中（実タスク）のメモリ・所要時間は **トークン投入後に `smoke.sh` / 実タスクで計測**する（未実施）。

## 使い方（naru の手動作業を含む）

### 1. トークン発行（naru or 岩下様本人が自分の端末で実行。**このコンテナ内では実行しない**）

```bash
claude setup-token
```

- ブラウザで承認 → 端末にトークンが表示される（**どこにも保存されない**ので即コピー）。
- 1 年有効。Pro / Max / Team / Enterprise が必要。モデル呼び出し専用（Remote Control・claude.ai コネクタは不可、ローカル MCP は可）。
- 出典: https://code.claude.com/docs/en/authentication#generate-a-long-lived-token

### 2. `.env` を作る

```bash
cp .env.example .env
# CLAUDE_CODE_OAUTH_TOKEN=<貼り付け>
chmod 600 .env
```

### 3. ビルドと疎通

```bash
docker build -t claude-runner:local .                       # ローカル（Apple Silicon なら arm64）
docker build --platform linux/amd64 -t claude-runner:amd64 . # EC2 t3 系 / Fargate x86 向け
./smoke.sh                                                    # 合格: SMOKE: PASS
```

### 4. 実タスク例（`./work` に PDF を置く）

```bash
./run.sh "work/ 配下の sample.pdf の最下部の帯を読み取り、会社名を『1LC株式会社』に差し替えた out.pdf を作成して" \
  --model sonnet --max-turns 30 \
  --allowedTools "Read,Write,Edit,Bash(python3 *),Bash(pip *),Bash(ls *)"
```

- `-p` の権限モードは既定 Manual なので、**必要なツールは `--allowedTools` か `--permission-mode acceptEdits` で先に許可**する（許可がないと止まる）。出典: https://code.claude.com/docs/en/headless#auto-approve-tools
- `--output-format json` の `total_cost_usd` は **API 定価での参考値。サブスクでは請求と無関係**。出典: https://code.claude.com/docs/en/costs

## 注意（設計上の禁止事項）

- **トークンはイメージに焼かない**（`ENV`/`COPY .env` 禁止）。実行時 `--env-file` / ECS の Secrets（Secrets Manager 参照）/ EC2 なら SSM Parameter Store から注入する。
- **`--bare` を付けない**。`--bare` は `CLAUDE_CODE_OAUTH_TOKEN` を読まず API キー必須になる。ドキュメントは「将来 `-p` の既定が `--bare` になる」と予告しているため、**バージョン更新時に再検証が必要**（イメージのバージョンを固定する運用にする）。出典: https://code.claude.com/docs/en/headless#start-faster-with-bare-mode
- トークンは**岩下様本人が発行し、岩下様のアカウント用途（1LC 自身の業務）にのみ使う**。Walkers が岩下様のアカウントを使い回さない。

## 次のステージ（未実装の案）

- PDF 加工ツールを同梱: `python3 python3-pip poppler-utils` + `pymupdf`（帯の座標特定・画像差し替え）/ `pypdf`。加工ロジックが固まったら Claude に「毎回書かせる」のではなく **固定スクリプトを Claude が呼ぶ**形にして、トークン消費と失敗率を下げる。
- 常駐: EC2 なら `systemd timer`、Fargate なら EventBridge Scheduler → `RunTask`（Walkers の agent-runtime IaC の型を流用）。
- 出力保存: 加工済み PDF を S3（1LC アカウント `onelc-artifacts-857932879110` 等）に置き、物件 ID と紐付ける。
