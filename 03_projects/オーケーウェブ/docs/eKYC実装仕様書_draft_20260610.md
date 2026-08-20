# eKYC（本人確認）実装仕様書 — ドラフト v0.2

- 作成: 2026-06-10 細谷 / 更新: 2026-06-11
- 状態: すり合わせ完了（A-1〜A-9 決着）。**Web撮影経路のみ技術調査中**（`eKYC_Web経路_調査メモ_20260611.md` 参照）
- 実装状況: フロント/サーバ実装済み（feat/ekyc-flow）。サーバ→TRUSTDOCK実連携検証済み。
  残: Web撮影UIの起動条件特定（調査メモ Q-A〜Q-F）、iOS dev build 検証、PR
- 対象: aikata 本体（opensite-lvs/aikata、main ブランチ起点）
- 根拠: 中野氏 Slack 確定事項（6/4）、野呂氏指示（6/9）、TRUSTDOCK メール（5/29〜6/8）、main 実装調査（6/10、9783fd91 時点）

---

## 1. スコープ

| 含む | 含まない |
|---|---|
| 本人確認方式の選択 UI（ホ方式 / IC 読み取り） | SMS 認証（野呂氏側で組み込み） |
| 書類選択モーダル（確定 4 種） | 独身証明書の提出（既存フロー踏襲、要件 Doc 3.5 より） |
| TRUSTDOCK 連携（Native SDK / Browser SDK / サーバ API / Webhook） | 管理画面側の審査補助 UI |
| 審査ステータスの表示・反映 | |

## 2. 確定済みの前提（変更不可）

1. サイト側で必要なのは「**ホ方式 or IC 読み取りを選択する画面**」。ホ方式 → 書類選択モーダル表示／IC 読み取り → TRUSTDOCK SDK へ（中野氏 6/4）
2. 本人確認書類は 4 種で決定: **運転免許証／運転経歴証明書／マイナンバーカード（撮影）／マイナンバーカード（IC 読み取り）**（中野氏 6/4）
3. 起点 UI は「本人確認未確認・確認する」からの遷移（野呂氏 6/9）
4. TRUSTDOCK の eKYC ホプランは **WEB カメラ提出が開発・本番とも有効化済み**（6/2 環境調整、6/8 動作確認済み、運用定義書更新済み）
5. 対象プラットフォームは **ネイティブ（iOS/Android）+ Web** の両方
6. ステータスは 未提出 / 審査中 / 承認 / 差し戻し の 4 状態をマイページに表示（要件 Doc 3.3）

## 3. 画面フロー（案）

```
マイページ等の「本人確認未確認・確認する」
  └→ /verification（既存: 「本人確認をする」ボタン）
       └→ 【新規】方式選択画面（ホ方式 / IC読み取り の2択）
            ├─ ホ方式 選択
            │    └→ 書類選択モーダル（撮影系: 運転免許証 / 運転経歴証明書 / マイナンバーカード(撮影)）
            │         └→ TRUSTDOCK 撮影フロー起動（Native SDK or Browser SDK）
            └─ IC読み取り 選択
                 └→ TRUSTDOCK SDK 直行（マイナンバーカード IC読み取り）
                      ※ IC読み取りはネイティブのみ（NFC 必須）→ Web では非表示 or 案内表示
完了後 → 審査中表示 → Webhook で 承認/差し戻し を反映
```

🔶 **すり合わせ 1**: 書類 4 種のうち「マイナンバーカード（IC 読み取り）」を IC 側に割り当て、撮影系 3 種をホ方式モーダルに置く整理で良いか（中野氏の文面からの自然な解釈だが明文化されていない）
🔶 **すり合わせ 2**: 既存の `/identity/document-type`（書類 4 種フラット選択）は方式選択画面に**改修**する想定。画面を分けるか（方式選択 → 書類モーダルの 2 段）、1 画面に統合するか
🔶 **すり合わせ 3**: Web アクセス時の IC 読み取りの扱い（非表示 / 「アプリでご利用ください」案内）
🔶 **すり合わせ 4**: 差し戻し時の再提出導線（同フロー再走で良いか）

## 4. 技術構成

### 4.1 フロントエンド（frontend/、Expo + RNW）

| 経路 | 実装 | 状態 |
|---|---|---|
| Native（iOS/Android） | TRUSTDOCK Native SDK を Expo Custom Module（expo-trustdock）でラップ | テスト環境で verified 実績 2 件。aikata へ移植 |
| Web（RNW） | TRUSTDOCK Browser SDK（verification_helper.js v2）+ WEB カメラ提出 | プラン側有効化済み・動作確認済み。aikata へ組み込み |

- 既存画面の流用: `features/identity/screens.tsx`（verification 画面）、`app/identity/document-type.tsx`（→ 方式選択画面に改修）
- 書類リストを確定 4 種に修正（現状: 在留カードあり・運転経歴証明書なし → 要修正）
- 注意: Native Module 使用のため Expo Go 不可。development build 必須

### 4.2 サーバ（services/love-search-user、CodeIgniter 3）

`api/rn/Identity_api.php` を拡張:

| エンドポイント | 現状 | 変更 |
|---|---|---|
| GET /api/rn/identity/status | user_verifications 参照のみ | TRUSTDOCK 審査状態を反映した status を返す |
| POST /api/rn/identity/submit | user_verifications に insert のみ | TRUSTDOCK verification 作成 + comparing_data 送信 + public_id 返却 |
| POST /api/rn/identity/webhook 【新規】 | — | TRUSTDOCK Webhook 受信。審査結果（承認/差し戻し）を user_verifications に反映。リトライ考慮（要件 Doc 3.5） |

🔶 **すり合わせ 5**: comparing_data（氏名・生年月日等の比較データ）はどの時点のプロフィール入力値を使うか
🔶 **すり合わせ 6**: Webhook の受信 URL（本番ドメイン）と認証方式（TRUSTDOCK 側への登録が必要）

### 4.3 DB

- 既存 `user_verifications` テーブルを継続利用（Phase 1 設計踏襲）
- TRUSTDOCK verification_id（public_id）の保存カラムが必要 → 🔶 **すり合わせ 7**: カラム追加 or 別テーブル

## 5. 環境・クレデンシャル（E-Q3）

| 項目 | 開発環境 | 本番環境 |
|---|---|---|
| TRUSTDOCK API | api.test.trustdock.io（トークンは credentials/ に保有済み） | 🔶 **すり合わせ 8**: トークン発行状況・所在の確認（伊藤さん経由 or TRUSTDOCK 管理画面） |
| plan | c824c351（WEB カメラ有効） | 同 plan か要確認（運用定義書最新版参照） |
| 許可オリジン | auth-test-six.vercel.app 登録済み | 本番ドメインの登録申請が必要 |
| dev build 配布 | 🔶 **すり合わせ 9**: 検証用 iPhone への配布手段（ローカル run:ios / EAS Build / TestFlight） | — |

## 6. 実装ステップ（スプシ「eKYC」シート E-T1〜E-T9 と対応）

1. 本仕様書のすり合わせ・確定（E-T1）
2. 書類リスト 4 種修正（E-T2）
3. 方式選択画面 + 書類選択モーダル（E-T3）
4. expo-trustdock 移植（E-T4）／Browser SDK 組み込み（E-T5）
5. サーバ: TRUSTDOCK 連携（E-T6）／Webhook（E-T7）
6. 環境整備: dev build・本番トークン（E-T8）
7. E2E 評価: ホ・IC・Web の 3 経路（E-T9）

## 7. すり合わせ事項一覧（🔶 再掲）

| # | 内容 | 想定確認先 |
|---|---|---|
| 1 | ホ方式モーダルの書類割り（撮影系 3 種 + IC 1 種の整理） | 野呂氏（必要なら中野氏） |
| 2 | 方式選択画面の構成（2 段遷移 or 1 画面統合） | 野呂氏 |
| 3 | Web での IC 読み取りの扱い | 野呂氏 |
| 4 | 差し戻し時の再提出導線 | 野呂氏（必要なら中野氏） |
| 5 | comparing_data の入力元 | 野呂氏 |
| 6 | Webhook 受信 URL・認証 | 野呂氏 + インフラ |
| 7 | verification_id の保存先（カラム追加 or 別テーブル） | 野呂氏 |
| 8 | 本番 TRUSTDOCK トークン・plan・許可オリジン | 伊藤氏 / TRUSTDOCK |
| 9 | dev build 配布手段 | 野呂氏 |
