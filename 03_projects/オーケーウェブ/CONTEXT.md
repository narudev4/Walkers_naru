# OKWEB（オーケーウェブ）プロジェクト コンテキスト

最終更新: 2026-05-27（naru セッション、Stripe NG 反映）
スコープ: 決済まわりの実装着手前の把握情報を一式集約

---

## ⚠️ 2026-05-27 重要更新: Stripe NG

**Stripe 利用が先方規約違反で NG となり、新規決済代行を選び直しになった**（滝川氏／伊藤氏ルートからの共有）。

> 「今更で申し訳ないのですが、stripeがNG出てしまって新規の決済代行会社選び直しとなります。
> 既存で使ってるAXES、テレコムを利用することになると思いますが、再考になります。確定したら共有いたします」

→ 以下の本文中で `Stripe` と書かれている箇所は**全て暫定保留**。確定後に代行名を置き換えた版へ更新する。

**そのまま使える資産**: §3〜§5（リポジトリ・既存スタック・ローカル開発環境）、§6 の決済仕様の大半、§7 の料金、§9 の Slack コンテキスト、§10〜§12。

**置換が必要**: §2 のタスク（Stripe → 新代行）、§6 §8 の Stripe 固有部分、§7 の対象代行記述。

**確定までは手を止める**方針（2026-05-27 naru 判断）。

---

## 1. 案件サマリ

35歳以上向けマッチングサービス「**シンシアリーユアーズ**」（コード上は `love-search`、新フロント名は `aikata`）の**全面リニューアル**案件。サーバー側は CodeIgniter 3 のまま維持し、フロントエンドを React Native + Expo + RNW で刷新する。

- **顧客（サービスオーナー）**: 株式会社オープンサイト = GitHub org **`opensite-lvs`**（旧 neo-corporation）
  - 伊藤康幸 `y_ito@okweb.co.jp`
  - 滝川 emi（Stripeアカウント招待担当）
- **設計・PM**: OKWAVE
  - 中野かおり `k_nakano@okwave.co.jp`（仕様作成）
- **開発**: 株式会社Walkers
  - 古谷大輝 `daiki.furutani@walker-s.co.jp`
  - 野呂歩希 / Ibuki Noro `ibuki.noro@walker-s.co.jp` = `ibuki.noro@omoshiro-technology.co.jp` （社内PM）
  - 三國陸真 `rikuma.mikuni@walker-s.co.jp`（外部協力、omoshiro-technology）
  - 細谷 成 / naru `naru.hosoya@walker-s.co.jp` — **Stripe実装担当**
- **保守体制**: リリース時に現保守体制終了 → Walkers へ切替

---

## 2. naru の正式タスク（5/24 21:46 野呂さん→naru、5/25 受諾済み）

> Stripeの決済まわりの実装を進めていただくことはできますか？
> 有料プランと退会の関係、サブスクリプションの周期など、事故るとクレームになるところなので、評価含めて対応いただけると助かります。

- 期限: 明示なし。**6月リリース想定**（5/25 中野氏「6月に入ってからで良いので」より逆算）
- 評価（QA）含む

---

## 3. リポジトリ

### 実装リポ（canonical monorepo）
- GitHub: **`opensite-lvs/aikata`**（Private）
- ローカル clone 先: `/Users/naru/Walkers_naru/03_projects/オーケーウェブ/repos/aikata`
- naru の GitHub アカウント: **`narudev4`**（opensite-lvs org メンバー active、scope: gist/read:org/repo/workflow）

### aikata 内構造（モノレポ）
```
aikata/
├── admin-frontend/      # 新管理画面 (Vite + React + TS、モック段階)
├── frontend/            # 新ユーザー画面 (Expo SDK 56 + Expo Router + RNW)
├── docker/              # ローカル開発スタック定義
│   ├── apache/, mysql/, dynamodb/, minio/, php/
│   └── overrides/       # CodeIgniter dev 設定を非破壊で被せる場所
├── docs/                # AI_FRONTEND_DEVELOPMENT.md / LOCAL_DB_SCHEMA.md など
├── repos/               # 既存システム一式を直接同梱（commit済み）
│   ├── love-search_user      # ユーザーWeb (CI3) — 主要API提供元
│   ├── love-search_admin     # 管理画面 (CI3) — DBマイグレ含む
│   ├── love-search_html      # 静的HTMLモック・LP素材
│   ├── love-search_submodule # ★★ 既存決済モジュール本体 ★★
│   ├── love-search_ansible   # 本番 Vagrant + Ansible
│   ├── love-search-match     # iOS fastlane (証明書本体は除外)
│   ├── love_search_ios       # 既存 iOS (Swift)
│   └── love_search_android   # 既存 Android (Kotlin)
├── scripts/             # bootstrap.sh / dump-staging-*.sh
├── docker-compose.yml
├── CLAUDE.md            # プロジェクト規約（必読）
└── README.md
```

旧 `03_projects/オーケーウェブ/repos/` 配下の8リポ（個別の love-search_*）は**歴史的ミラー**で、**aikata 内の `repos/` の方が新しい**。今後の作業は aikata 内で完結。reverse-sync は当面行わない方針。

### 関係しない別物
- `03_projects/オーケーウェブ/aikata-auth-test/` — SMS認証+eKYCの**別テスト環境**（Expo+Vercel構成）。aikata本体とは別。Stripe実装には使わない。

---

## 4. 既存システム技術スタック（aikata の README/CLAUDE.md より）

| Layer | 技術 |
|---|---|
| PHP | 7.2（EOL、現状維持） |
| Framework | CodeIgniter 3.1.x |
| Web | Apache 2.4 + mod_php |
| DB | MySQL 8.0（本番 AWS RDS Aurora MySQL）／**154 テーブル**（2026-02 スキーマ、staging Aurora dump） |
| Cache/Session | Redis 7 |
| Templating | Twig (kenjis/codeigniter-ss-twig) |
| Auth | ion_auth + HybridAuth (Twitter/FB/Google/Yahoo SSO) + Yahoo YConnect |
| Storage | AWS S3 `neo-lv-production` / DynamoDB `user_marks` |
| Push | APNs (`edamov/pushok`) + FCM (`sly/notification-pusher`) |
| In-app purchase | **`aporat/store-receipt-validator`**（iOS App Store + Google Play レシート検証ライブラリ既存） |
| Mail (dev) | MailHog |
| 本番OS | AlmaLinux 8 |
| IaC | Vagrant + Ansible |
| 既存 Web フロント | Mithril.js 1.x + TS3 + Webpack 4（≈2018、刷新対象） |
| 既存 iOS | Swift（RxSwift, Moya 等。刷新対象） |
| 既存 Android | Kotlin（刷新対象） |

---

## 5. ローカル開発環境

### 起動
```bash
cd /Users/naru/Walkers_naru/03_projects/オーケーウェブ/repos/aikata
./scripts/bootstrap.sh        # 初回（vendor復元等）
docker compose up -d
```

### ローカル URL
| URL | 用途 |
|---|---|
| http://localhost:8080/ | 静的HTMLモック (love-search_html) |
| http://localhost:8080/login | ユーザーログイン (Twig) |
| http://localhost:8080/member/ | ユーザーアプリ entrypoint |
| http://localhost:8080/member/api/... | モバイルAPI |
| http://localhost:8080/admin/ | 管理画面 |
| http://localhost:8025/ | MailHog |
| http://localhost:9000/ | MinIO S3 API |
| http://localhost:9001/ | MinIO console (`minioadmin`/`minioadmin`) |
| http://localhost:8000/ | DynamoDB Local |
| http://localhost:19006/ | Expo Web build (aikata frontend) |
| http://localhost:19000/ | Expo manifest（実機 Expo Go QR） |

### ローカル credentials
- MySQL: `127.0.0.1:3306`、`root/root`、DB=`love_search`
- 管理画面ログイン: `kenichi.ando@seezoo.co.jp` / `12345678`（他 `admin@seezoo.co.jp`, `staff@seezoo.co.jp` 同pass）
- ユーザーテスト: `dev1001@aikata.local` 〜 `dev1010@aikata.local` / `test1234`（10人合成 persona）

### MinIO / DynamoDB
- MinIO = S3代替、バケット `neo-lv-development` が自動作成（public-read）
- DynamoDB = テーブル `neo-lv-development-user_marks` が自動作成（足あと/お気に入り系）
- `docker/overrides/.../aws_account.php` で AWS本物キーを MinIO 用に被せる

### VPN
- クラウド Staging 接続時のみ **WireGuard ON**。普段は OFF（Claude Code との帯域競合のため）

---

## 6. 決済仕様（5/25 中野氏作成「決済仕様変更まとめ」）

一次情報: https://docs.google.com/document/d/1hVJTM4JYQmd91YDUYMM_0ITPJdtJKs975Op4Kd0m2Xg/edit

### 決済代行（4種類併存、naru担当はStripeのみ）

| 用途 | 代行 | naru担当 |
|---|---|---|
| 新規会員の月額課金 | **Stripe** | ✅ |
| 既存会員の継続課金 | AXES / テレコム / ゼウス | ❌（既存維持） |
| ポイント購入（全会員） | **Stripe** | ✅ |
| 既存会員プラン変更後 | **Stripe**（変更分から移行） | ✅ |

`BitCash` は廃止。

### サブスク仕様（Stripe実装の核）
- **周期**: 30日一括前払い、プラン 30/90/180/360日（料金表では24ヶ月=720日も）
- **内部**: 日数管理、全て JST
- **更新**: 契約日を1日目、満了翌日 0:00 に更新決済
- **解約・プラン変更期限**: 次回更新の **24時間前** まで
- **プラン変更**: 即時反映せず**「変更予約」**→現プラン満了時に新プラン決済→成功で切替
- **日割りなし／返金なし**

### 解約
- APP決済はストアで停止、WEB決済はサービス内で操作
- 契約満了までは利用可能、次回更新は走らない
- 退会しなければ満了後に**無料会員**へ移行
- **既存会員例外**: 旧代行制約で「退会させずに無料へ戻す」不可 → 無料化は一度退会＋再登録

### 決済失敗リトライ
- 新仕様（Stripe）: **24時間後 → 10日後 → 最終失敗で無料化**
- 既存: 5日 / 15日 / 28日 月3回
- 「期限切れ」ステータスは新仕様で無料会員へ統一する方向（議論中）
- 通知: 画面 + メール + （可能なら）PUSH

### APP / WEB 重複課金防止
- 有効サブスクがある間は他PFで追加契約不可
- **先に有効化された方を優先**（エッジケース挙動は未定義）

### ポイント
- Stripeのみ、全会員、サブスクと別、即時、**有効期限 180日**

### 必要な状態管理（DB設計指針）
現在プラン / 予約プラン / 決済代行会社 / 契約開始日時 / 次回更新日時 / 解約予約 / 決済状態 / 決済失敗状態

### キャンペーン（リリース時）
- 既存会員: メンテ前までに登録済みの全員へ **50pt付与**
- 特定メディア経由: リリース当月の登録＋有料プラン契約で **初月30日0円**（WEB×カード決済のみ）

---

## 7. 料金（「機能一覧」スプレッドシート → 確定_課金・ポイント シート）

https://docs.google.com/spreadsheets/d/1wAeRLtd3K-3Du98zojy68Vh9fSJghzKInS35cjhAkQY/edit （gid=485972706）

### 新プラン（男性月額、Stripe対象）

| プラン | 定価 → 価格 |
|---|---|
| 1ヶ月 | 5,980 → **4,980** |
| 1ヶ月 Premium | 7,980 → **5,980** |
| 3ヶ月 | → **4,500** |
| 6ヶ月 | → **3,800**（長期特典でブースト等付与） |
| 12ヶ月 | → **2,200** |
| 24ヶ月 | → **1,600** |

### オプション

| メニュー | 価格 |
|---|---|
| 追加いいね 10 / 20 回 | 1,000 / 1,800 |
| メッセージ付きいいね 10 / 20 回 | 1,000 / 1,800 |
| ブースト表示 2週間 | 2,000 |
| 誠実バッヂ（絞り込み） | 1,500 |
| 独身証明バッヂ（絞り込み） | 未確定 |
| 既読 / 未読 | 未確定 |

---

## 8. Stripe アクセス状況

- **Stripe アカウント**: オープンサイト側の既存アカウントを共用
- **naru の招待**: 5/14 21:56 滝川 emi 氏が `naru.hosoya@walker-s.co.jp` を**開発者権限**で招待済み
- **本人確認（身分証）**: 伊藤氏経由で手配中（5/14時点、進捗未確認）→ **Test mode 中心で進める前提**
- 着手前に: メール受信 + Stripe Dashboard ログイン疎通を確認

---

## 9. Slack コンテキスト

### 関連チャンネル
- `dev-opensite` (`C0AR06FNRBQ`) — Walkers ⇔ OKWEB ⇔ Opensite 合同開発
- グループDM (`C0AUZ68LF1V`) — Walkers（野呂・古谷）＋三國（環境調整、naruへのタスク振り元）

### Slack MCP セットアップ済み（read-only）
- `slack-mcp-server` via npx, stdio（`.mcp.json`）
- **xoxc/xoxd ブラウザトークン**方式（gitignore された `.mcp.json` に naru ローカルで注入）
- **書き込みツール無効化済み**（`chat_post_message` / `add_reaction` 公開なし）
- 残る更新系（`conversations_join` / `usergroups_*` 等）は明示指示なき限り呼ばない方針

### 直近のSlack要旨
- **5/14**: Stripe招待〜権限／本人確認の経緯（`dev-opensite` p1778745312780669 スレッド）
- **5/22**: 削除予定機能の確定（ラブアンサー、お誘い掲示板、コミュニティ、ガチャ／ロト）
- **5/22 18:55**: 決済方法 **4種類併存**方針が中野氏から共有
- **5/24 21:45**: 野呂さんが Docker環境構築完了アナウンス（aikata pushed）
- **5/24 21:46**: 野呂さん→naru「Stripeまわりの実装お願い」
- **5/25 17:46**: 中野氏「決済仕様変更まとめ」doc 公開
- **5/25 16:35**: リリース時の作業（保守体制切替）について確認
- **5/26 10:55**: 中野氏「退会後ユーザーの表示（非表示 vs 退会済み表示）どっち？」と質問中（決済の退会仕様と関連、要回答）

---

## 10. 既知のセキュリティ事項（顧客対応待ち、触らない）

- `repos/love-search_{user,admin}/application/config/{development,staging,production}/aws_account.php` に **AWS IAM キー平文コミット**
- `application/config/staging/database.php` に **staging Aurora root パスワード平文コミット**
- 上記は既存ミラーからの引継ぎ、顧客側でローテーション + secrets化予定
- ローカル dev では override で MinIO に置換されるので実行時参照されない
- **触らない、新たな leak も書き込まない**

---

## 11. 一次情報リンク

| 種別 | リンク |
|---|---|
| 決済仕様まとめ（最重要） | https://docs.google.com/document/d/1hVJTM4JYQmd91YDUYMM_0ITPJdtJKs975Op4Kd0m2Xg/edit |
| 機能一覧スプレッドシート（料金/スコープ/API/会員情報など16シート） | https://docs.google.com/spreadsheets/d/1wAeRLtd3K-3Du98zojy68Vh9fSJghzKInS35cjhAkQY/edit |
| Sincerely yours 設計書（図・表）3版 | https://docs.google.com/document/d/1yaiytOah6PXmdUVICkl00lNJ-ZwWYkW__zlA_ZXYgwg/edit |
| 4/24 MTG議事録 | https://docs.google.com/document/d/1_R1kSm8c4UUEqJGYnooMZe6m01L4ixD0HDDkFrlZxLA/edit |
| Slack: 決済方針スレッド (4種類併存判明) | https://walker-s.slack.com/archives/C0AR06FNRBQ/p1779443703723849 |
| Slack: 環境構築DM（野呂さんからのタスク振り） | https://walker-s.slack.com/archives/C0AUZ68LF1V/p1779659202960749 |
| Slack: Stripe招待経緯 | https://walker-s.slack.com/archives/C0AR06FNRBQ/p1778745312780669 |
| GitHub: 実装リポ | https://github.com/opensite-lvs/aikata |
| aikata 内のプロジェクト規約（必読） | `repos/aikata/CLAUDE.md`（12k） |
| aikata 内の README | `repos/aikata/README.md`（12k） |

---

## 12. オープン課題（着手前/着手中に詰める）

1. **AXES の所在特定**: 4社のうちAXESがコード上で未確認（テレコム/ゼウス/iTunes/GooglePlay は確定）。`repos/love-search_submodule` を読めば判明する可能性
2. **「期限切れ」ステータス**: 新仕様で無料化に統一する方向だが最終合意未取得（中野⇔滝川コメント中）
3. **既存→新の決済代行切替制御**: 既存会員プラン変更時に旧代行の請求を「退会させずに止める」必要があるが、現行は「継続更新停止＝退会 or 決済失敗」しかない
4. **APP/WEB 重複防止の優先ルール**: 「先に有効化された方を優先」のエッジケース未定義
5. **銀行振込の手動運用フロー**: 誰がどこで入金確認するか最終確定
6. **リリース日とキャンペーン適用窓**: 6月リリース想定、メンテ告知必要
7. **退会後のユーザー表示**: 「非表示」vs「退会済み表示」どっち（5/26 中野氏質問）— 決済の退会仕様と関連
8. **Stripe本人確認**: 伊藤氏経由で手配中、未完了の可能性 → Test mode で進める

---

## 13. 次セッション（実装セッション）の起動

`aikata` ディレクトリで新セッションを起動するのが最適:

```bash
cd /Users/naru/Walkers_naru/03_projects/オーケーウェブ/repos/aikata
claude
```

最初に読むファイル（順序）:
1. `./CLAUDE.md`（プロジェクト規約・落とし穴・触ってよい場所/ダメな場所）
2. `./README.md`（起動手順・ディレクトリ構成）
3. `../../CONTEXT.md`（このファイル、案件全体コンテキスト）
4. `../../STRIPE_TASK.md`（Stripe実装の焦点ブリーフ、別ファイル）
5. `./repos/love-search_submodule/`（既存決済モジュール、最初に読む対象）
