# AWS 上 Claude Code CLI 常駐（Docker）検証（NA-20260818-003）2026-08-18

> サブエージェント調査結果の保存。AWS リソースの作成・変更は一切行っていない（describe/get/list のみ）。成果物: `claude-runner/`（Dockerfile / README.md / run.sh / smoke.sh / .env.example）。

## 結論
- ローカル Docker で Claude Code CLI v2.1.234 は **Node 不要・非 root で動作**。`CLAUDE_CODE_OAUTH_TOKEN` を渡せば `claude -p` が動く状態（無効トークンで 401 が返る＝配線済み。正しいトークン投入は naru の手動作業待ち）。
- 1LC アカウント（ap-northeast-1）は EC2/ECR/ECS が無い「更地」。デフォルト VPC のみ（NAT 無し）。
- 方式は「概要書取得にブラウザ GUI が要るか」で分岐。岩下様の手順書が来るまで取得側は保留。**暫定推奨: (b) ECS Fargate スケジュール起動（Walkers agent-runtime の型を流用）**。GUI 必須と判明したら (c) EC2+DCV。

## ローカル Docker 実測
| 項目 | arm64 | amd64 |
|---|---|---|
| ビルド | 3分50秒 | 3分25秒 |
| イメージ | 圧縮155MB / 展開682MB | 159 / 670MB |
| 起動直後メモリ | 136MiB | — |
| `-p` 認証なし | `Not logged in` exit 1 | 同 |
| `-p` 無効トークン | `401 Invalid bearer token` exit 1 | — |
CLI 単体は 1GB 未満で足りる見込み（岩下様の「24〜32GB」は Windows デスクトップ＋ブラウザ込みの体感値）。

## 費用（Pricing API 実値・東京・730h/月）
| 方式 | スペック | 月額目安 |
|---|---|---|
| (a) EC2 常時 t3.large 8GB | $0.1088/h | 約 $86 |
| (a) EC2 常時 t3.xlarge 16GB | $0.2176/h | 約 $165 |
| (a') t4g.large arm64 | $0.0864/h | 約 $70 |
| (b) Fargate x86 2vCPU/8GB | $0.1454/h | 1h/日 $4.4、24h $106 |
| (b) Fargate ARM | $0.1163/h | 1h/日 $3.5 |
| (c) EC2+DCV | t3.xlarge〜 | $165〜（DCV は EC2 上ではライセンス不要） |

## サブスク・認証（出典付き）
- `claude setup-token`: 1年有効 OAuth トークン、`CLAUDE_CODE_OAUTH_TOKEN` に設定。Pro/Max 必須。`--bare` は読まない。https://code.claude.com/docs/en/authentication#generate-a-long-lived-token
- `--bare` は将来 `-p` の既定になる予定 → **バージョン固定・更新時再検証が必要**。https://code.claude.com/docs/en/headless#start-faster-with-bare-mode
- Max の 5 時間/週次上限は Claude と Claude Code で共有 → `-p` も同じ枠を消費。https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- `--max-budget-usd` は API ドル建てキャップでサブスク枠は制御不可。実効上限は `--max-turns` と 1 回あたり件数。
- **利用規約リスク**: 「Advertised usage limits ... assume ordinary, individual usage」「Anthropic reserves the right to take measures ... without prior notice」。無人・大量バッチは外れると判断される可能性。保険は Bedrock（`CLAUDE_CODE_USE_BEDROCK=1`、同イメージ・同コマンドで切替可）。https://code.claude.com/docs/en/legal-and-compliance
- 帯差し替えは Sonnet で妥当（岩下様の 8 割成功も Sonnet）。

## 検証ステップ
| # | ステップ | 合格条件 | naru 手動作業 |
|---|---|---|---|
| 0 | （済）ローカル Docker ビルド | `--version` OK | — |
| 1 | トークン認証の `-p` 疎通 | `./smoke.sh` → `SMOKE: PASS` | `claude setup-token` → `.env` |
| 2 | 加工 1 件をローカル `-p` | 帯差し替え目視 OK、失敗パターン記録 | Chatwork zip 2 本を `work/` へ |
| 3 | 1LC に最小リソース（暫定 Fargate） | RunTask 1 回で smoke PASS | AWS 作成承認、岩下様トークン受領経路 |
| 4 | AWS 上で加工 1 件 → S3 | 出力 PDF を物件 ID で参照可 | S3 プレフィックス承認 |
| 5 | 常駐（EventBridge Scheduler） | 7 日運用 | 実行時刻・件数上限 |
| 6 | 取得工程の統合 | 手順書で API/HTTP or ブラウザを判定 | 手順書催促 |

## naru 手動作業
1. `claude setup-token` → `claude-runner/.env`（chmod 600）→ `./smoke.sh`。
2. Chatwork の zip 2 本を DL → `claude-runner/work/`。
3. 本番トークンの発行者決定（推奨: 岩下様本人が発行、Secrets Manager へ登録）。
4. AWS リソース作成の承認。
5. 規約リスクを岩下様に伝えるか／Bedrock を保険提示するかの判断。

## 未確認・リスク
- 概要書取得がブラウザ操作か API/HTTP か。
- `-p` 実タスク時のメモリ・時間・枠消費（トークン待ち）。
- `--bare` 既定化。利用規約。帯精度（固定スクリプトを Claude が呼ぶ構成に寄せる案）。
- NAT 無しのためパブリック IP 付与（SG は全閉）。
