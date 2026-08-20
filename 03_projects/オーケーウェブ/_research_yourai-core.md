# React Native アプリ(aikata/frontend) eKYC実装調査報告書

**調査日**: 2026-06-09  
**対象アプリ**: /Users/naru/Walkers_naru/03_projects/オーケーウェブ/repos/aikata/frontend  
**プロジェクト**: aikata (シンシアリーユアーズ / love-search マッチングサプリサービス)  

---

## 1. 既存eKYC実装

### 1.1 eKYC/本人確認関連ファイル・画面一覧

#### フロントエンド画面(React Native)
| ファイル | 行 | 役割 |
|---|---|---|
| `/frontend/src/app/(onboarding)/photo-notice.tsx` | 1-276 | 顔写真撮影ガイド画面。カメラ撮影UI、注意事項表示 |
| `/frontend/src/app/(onboarding)/photo-analysis.tsx` | - | AI画像判定（実装未完） |
| `/frontend/src/app/(onboarding)/photo-result.tsx` | - | 写真分析結果表示画面 |
| `/frontend/src/app/(onboarding)/photo-error.tsx` | - | 写真NG時の再撮影案内画面 |
| `/frontend/src/app/(onboarding)/photo-guide.tsx` | - | 写真撮影のティップス提示 |
| `/frontend/src/app/(onboarding)/photo-start.tsx` | - | 写真登録フロー開始画面 |
| `/frontend/src/app/(tabs)/mypage.tsx` | 32-36 | マイページの「本人確認済み」バッジ表示 |
| `/frontend/src/app/profile/[id].tsx` | - | プロフィール表示時の「本人確認済み」バッジ |
| `/frontend/src/app/search/filter.tsx` | - | 検索フィルタの「本人確認済みのみ」チェックボックス |

#### API/機能実装
| ファイル | 行 | 役割 |
|---|---|---|
| `/frontend/src/features/upload/api.ts` | 1-39 | アバター・顔写真アップロード機能 |
| `/frontend/src/features/upload/image-picker.native.ts` | - | ネイティブカメラ撮影実装 |
| `/frontend/src/features/upload/image-picker.web.ts` | - | Web版カメラ・ファイル選択実装 |
| `/frontend/src/features/profile/types.ts` | 26 | `verifications: unknown[]` — 検証バッジ情報（未定義） |
| `/frontend/src/features/auth/api.ts` | 1-52 | ログイン・セッション管理（本人確認機能なし） |

### 1.2 現状eKYCフロー（実装箇所）

```
photo-start.tsx
  ↓
photo-notice.tsx
  ├─ pickImage({ source: 'camera' })          [/features/upload/image-picker.native.ts:行未特定]
  └─ uploadAvatar(asset)                       [/features/upload/api.ts:25]
       └─ POST /api/rn/profile/avatar
  ↓
photo-analysis.tsx
  ├─ (⚠️ AI 画像判定本体: 実装未完)             [/app/(onboarding)/photo-analysis.tsx:コメント]
  └─ (⚠️ 要確認 ai/INT-Q001)
  ↓
photo-result.tsx
  └─ (AI 分析結果の O/NG 判定)                 [/app/(onboarding)/photo-result.tsx:61]
  ↓
photo-error.tsx / notification.tsx
  └─ (撮影やり直し or 次フロー進行)
```

**要点**:
- **現状フロー**: 顔写真 → アップロード → AI判定(未実装) → 結果表示
- **OCR実装**: 該当なし
- **身分証自動撮影**: 該当なし
- **デジタル認証**: 該当なし
- **文言**: "顔写真の注意事項" (身分証ではなく**顔写真のみ**)

### 1.3 認証方式を分岐するUI/ロジック（「eKYC分岐画面」）

**該当なし**。  
現状は以下の単一フロー:

```
photo-start.tsx
  →(固定) photo-notice.tsx
  →(固定) photo-analysis.tsx
  →(固定) photo-result.tsx
```

**証拠**:
- `/frontend/src/app/(onboarding)/` 内に複数認証方式の分岐ロジックなし
- `/features/upload/` / `/features/auth/` 内に「認証種別選択」コンポーネントなし

### 1.4 「本人確認未確認・確認する」等のステータス表示→遷移UIの場所

**表示のみ、遷移なし** （実装不完全）

| ファイル | 行 | 内容 |
|---|---|---|
| `/frontend/src/app/(tabs)/mypage.tsx` | 32-36 | `VERIFICATION_LABELS` 定数（'本人確認済み'等のラベル定義） |
| `/frontend/src/app/(tabs)/mypage.tsx` | 78 | `VerificationSection badges={normalizeVerifications(me.data.verifications)}` — ただし `verifications` の詳細仕様未確定 |
| `/frontend/src/features/profile/types.ts` | 26 | `verifications: unknown[]` — 型定義が `unknown[]` のまま |
| `/frontend/src/app/(tabs)/mypage.tsx` | 24-30 | `MENU_ITEMS` の「プロフィール編集」は `route?: string` 未設定のため遷移先なし |

**コメント内の要確認項目**:
```
⚠️ ASSUMED (要確認 common/INT-Q015):
マイページメニューと正式な遷移先が Figma/API で未確定のため、実在ルートなしは未実装として表示。
```
[出典: `/frontend/src/app/(tabs)/mypage.tsx:25-26`]

---

## 2. TRUSTDOCK/デジタル認証

### 2.1 TRUSTDOCK/trustdock/デジタル認証/マイナンバー/IC読み取り関連コード

**該当なし**  

#### 検索結果
```bash
$ grep -r "trustdock\|TRUSTDOCK\|mynumber\|IC\|ic" /frontend/src/**/*.{ts,tsx,js}
```
→ **0件** （false positive なし）

#### マイナンバー関連
```bash
$ grep -r "マイナンバー\|mynumber" /frontend/src/**/*.{ts,tsx,js}
```
→ **0件** （但し、既存 PHP バックエンド側に以下が存在）

| ファイル | 行 | 内容 |
|---|---|---|
| `/repos/love-search_user/application/controllers/Age_verification_mail_and_upload.php` | 40-44 | `public function my_number_card()` — マイナンバーカード証明書方式の機能 |

**重要**: バックエンド（PHP CodeIgniter）には「年齢確認」として以下の証明書方式がある:
- 運転免許証 (driver_license)
- 保険証 (insurance_card)
- **マイナンバーカード** (my_number_card)
- パスポート (passport)
- 住民基本台帳 (juki_card)

しかし RN フロント側には実装**なし**。

### 2.2 TRUSTDOCK SDK/npmパッケージ

**該当なし**

#### package.json確認
```bash
$ cat /frontend/package.json | grep -iE "trustdock|kyc|ekyc|mynumber|identity|verification"
```

**結果**: 0件

**現在の依存ライブラリ** (`/frontend/package.json:1-40`):
- expo 56.0.5
- react-native 0.85.3
- react-native-web 0.21.2
- expo-image-picker 56.0.14 （顔写真撮影用）
- expo-secure-store 56.0.4 （セッション保存用）
- expo-notifications 56.0.14 （プッシュ通知用）
- その他UI/ナビゲーション関連

**TRUSTDOCK未導入** ✓

---

## 3. SMS認証

### 3.1 SMS/OTP/電話番号認証/二要素実装有無

**部分実装**（電話番号登録フロー + OTP待機スタブ）

| ファイル | 行 | 実装内容 |
|---|---|---|
| `/frontend/src/app/(onboarding)/phone.tsx` | - | 電話番号入力画面 |
| `/frontend/src/app/(onboarding)/verify-code.tsx` | - | OTPコード入力画面 (6桁数字) |
| `/frontend/src/app/(onboarding)/phone.tsx` | コメント | `⚠️ ASSUMED (要確認 auth/INT-Q212): SMS送信API未結線のため、国内携帯番号は070/080/090で始まる11桁としてローカル検証する。` |
| `/frontend/src/app/(onboarding)/verify-code.tsx` | コメント | `⚠️ ASSUMED (要確認 auth/INT-Q213): 認証コード桁数と有効期限未確定のため、Figma表示に合わせて6桁の数字のみローカル検証する。` |

**検証コード待機時間**:
```typescript
// ⚠️ ASSUMED (要確認 auth/INT-Q213): 再送待機時間は Figma 表示の28秒を初期値として採用する。
```
[出典: `/frontend/src/app/(onboarding)/verify-code.tsx`]

### 3.2 認証基盤（Firebase Auth/Cognito/自前API）と初期化箇所

**自前API** （PHP バックエンド）

| ファイル | 行 | エンドポイント |
|---|---|---|
| `/frontend/src/features/auth/api.ts` | 14-25 | `POST /api/rn/auth/login` |
| `/frontend/src/features/auth/api.ts` | 27-33 | `POST /api/rn/auth/logout` |
| `/frontend/src/features/auth/api.ts` | 35-37 | `GET /api/rn/auth/session` |
| `/frontend/src/features/auth/api.ts` | 43-50 | `POST /api/rn/auth/forgot_password` |

**SMS関連エンドポイント**: 該当なし（mock stub のみ）

#### セッション初期化
```typescript
// /frontend/src/features/auth/session.ts
configureNativeSessionStorage()  // 初期化
restoreSession()                 // リストア
```

**Firebase/Cognito**: 該当なし

### 3.3 広告/計測SDK（AppsFlyer/Adjust/Firebase Analytics等）

#### RN フロント側：該当なし
```bash
$ grep -r "appsflyer\|adjust\|firebase.*analytics\|FirebaseAnalytics" /frontend/src/**/*.{ts,tsx,js}
```
→ **0件** (false positive: "adjustsFontSizeToFit" は属性名のみ)

#### 既存 iOS アプリ側（参考）
```
[出典: /repos/love_search_ios/Podfile:12]
pod 'AppsFlyerFramework', '4.10.3'
```

**解釈**: iOS 既存アプリは AppsFlyer を使用。RN フロント側は**未導入**。

---

## 4. 技術スタック

### 4.1 package.json（React Native フロント）

**ファイル**: `/frontend/package.json`

| 項目 | バージョン | 用途 |
|---|---|---|
| **react-native** | 0.85.3 | コアフレームワーク |
| **expo** | ~56.0.5 | ビルドツール・ネイティブ API ラッパー |
| **expo-router** | ^56.2.7 | ファイルベースルーティング |
| **react** | 19.2.3 | UI ライブラリ |
| **react-native-web** | ^0.21.2 | Web対応 (RNW) |
| **expo-image-picker** | ~56.0.14 | カメラ・フォトライブラリ |
| **expo-secure-store** | ~56.0.4 | キーチェーン/キーストア保存 |
| **expo-notifications** | ~56.0.14 | プッシュ通知 |
| **react-native-svg** | ^15.15.5 | SVG コンポーネント |

**ナビゲーション**: expo-router (ファイルベース)

**パス Alias**: `@/*` → `src/*`

**テスト**: jest-expo + React Testing Library

### 4.2 iOS/Android ネイティブ依存

#### iOS（既存アプリ参考）
**ファイル**: `/repos/love_search_ios/Podfile`

```ruby
pod 'Moya/RxSwift', '14.0.0-beta.6'
pod 'AppsFlyerFramework', '4.10.3'       # 広告計測
pod 'SwiftyStoreKit', '0.15.0'           # In-app purchase
pod 'Swinject', '2.6.2'                  # DI
pod 'RxCocoa'                            # Reactive
pod 'SwifterSwift', '5.0.0'              # 拡張ライブラリ
pod 'Fabric', '1.10.2' / 'Crashlytics'   # クラッシュレポート
```

#### Android（既存アプリ参考）
**ファイル**: `/repos/love_search_android/build.gradle` + `/app/build.gradle`

**確認コマンド**: `grep -rE "com\.(google|facebook|appsflyer)" /repos/love_search_android/app/build.gradle`

→ **実装詳細確認待ち** （node_modules除外対象のため詳細未読）

#### RN フロント側（Expo SDK 56）
- Expo が ネイティブ依存を抽象化（Podfile/build.gradle は自動生成）
- `expo-image-picker` → iOS Camera/PhotoLibrary、Android `android.permission.CAMERA`
- `expo-secure-store` → iOS Keychain、Android Keystore

### 4.3 認証API/バックエンド エンドポイント定義

**ファイル**: `/frontend/src/features/auth/api.ts`

| メソッド | エンドポイント | 認証 | 実装状況 |
|---|---|---|---|
| POST | `/api/rn/auth/login` | 不要 | ✓ 実装 |
| POST | `/api/rn/auth/logout` | ✓ 必須 | ✓ 実装 |
| GET | `/api/rn/auth/session` | ✓ 必須 | ✓ 実装 |
| POST | `/api/rn/auth/forgot_password` | 不要 | ✓ 実装 |

**プロフィール・アップロード**:

| メソッド | エンドポイント | 認証 | 実装状況 |
|---|---|---|---|
| POST | `/api/rn/profile/avatar` | ✓ 必須 | ✓ 実装 |
| GET | `/api/rn/profile/me` | ✓ 必須 | ✓ 実装 |

**本人確認関連エンドポイント**: 該当なし

---

## 5. ブランチ/README

### 5.1 README（aikata モノレポ）

**ファイル**: `/repos/aikata/README.md` (150行抜粋)

| セクション | 内容 |
|---|---|
| **アーキ概要** | モノレポ + Docker Compose 環境。PHP 7.2 + React Native + RNW 統合 |
| **ローカル動作** | `./scripts/bootstrap.sh` → `docker compose up -d` で即起動 |
| **DB** | MySQL 8.0 (staging Aurora dump 2026-05 ベース) + 153 BASE TABLE + 1 VIEW |
| **開発用ユーザー** | `dev1001@aikata.local` 〜 `dev1010@aikata.local` / password=`test1234` |
| **新フロント** | React Native + Expo SDK 56 + RNW、`http://localhost:19006/` で Web build |

**セットアップガイド**: [docs/AI_FRONTEND_DEVELOPMENT.md](docs/AI_FRONTEND_DEVELOPMENT.md)

### 5.2 git ブランチ一覧

```bash
$ cd /repos/aikata && git branch -a
```

| ブランチ | 状態 | 説明 |
|---|---|---|
| **feat/board-figma-fidelity** | ✓ local | 現在のワークブランチ |
| **main** | remote | canonical mainブランチ |
| **origin/HEAD** | remote | origin/main (default) |
| chore/unify-frontend-base | remote | フロント統一タスク |
| codex/frontend-real-api-review-base | remote | API連携レビュー用 |
| feat/frontend-rebuild-tonch-auto | remote | フロント再構築 |
| feat/profile-detail-brushup | remote | プロフィール詳細ブラッシュアップ |
| fix/rn-api-dev-routes | remote | RN API dev ルート修正 |

**重要**: `master` ブランチなし。**mainブランチが trunk** ✓

---

## 6. 未実装・TODO項目（コメント内の要確認事項）

### 認証フロー
```
⚠️ ASSUMED (要確認 auth/INT-Q210):
  SNS OAuth の実フロー未確定。account.tsx でスタブ実装。
```
[出典: `/frontend/src/app/(onboarding)/account.tsx`]

```
⚠️ ASSUMED (要確認 auth/INT-Q211):
  各画面の遷移先が Figma/API で未確定のため、指定ルートのみ先に接続。
```
[複数画面で頻出]

```
⚠️ ASSUMED (要確認 auth/INT-Q212):
  SMS 送信 API 未結線。ローカル検証のみ（国内携帯 070/080/090 の11桁）。
```
[出典: `/frontend/src/app/(onboarding)/phone.tsx`]

```
⚠️ ASSUMED (要確認 auth/INT-Q213):
  認証コード桁数・有効期限未確定。Figma の6桁数字をハードコード。
```
[出典: `/frontend/src/app/(onboarding)/verify-code.tsx`]

```
⚠️ ASSUMED (要確認 auth/INT-Q214):
  既存 PHP signup/register/activate 相当の RN JSON API は後フェーズ。
  useMocks 前提でローカル成功として進行。
```
[出典: `/frontend/src/app/(onboarding)/phone.tsx` 他]

### AI 画像判定
```
⚠️ ASSUMED (要確認 ai/INT-Q001):
  AI 画像判定への連携本体は photo-analysis/result(O6b) で扱う。
  現在は mock のみ。
```
[出典: `/frontend/src/app/(onboarding)/photo-notice.tsx:26`]

### プロフィール・検証

```
⚠️ ASSUMED (要確認 common/INT-Q004):
  profile/me の自分のアバター URL キーは未確定。
  既存 profile 系と同じ候補を順に解釈。
```
[出典: `/frontend/src/app/(tabs)/mypage.tsx:91-92`]

```
⚠️ ASSUMED (要確認 common/INT-Q010):
  mock 時は選択済みローカル uri を avatar path として扱う。
```
[出典: `/frontend/src/features/upload/api.ts:26`]

```
⚠️ ASSUMED (要確認 common/INT-Q014):
  mock login の session_id は ci_session 相当として扱う。
```
[出典: `/frontend/src/features/auth/api.ts:21`]

```
⚠️ ASSUMED (要確認 common/INT-Q015):
  マイページメニューと正式な遷移先が Figma/API で未確定。
  実在ルートなしは未実装として表示。
```
[出典: `/frontend/src/app/(tabs)/mypage.tsx:25-26`]

---

## 7. 結論・刷新への準備状況

### 現状サマリ
1. **OCR 実装**: なし
2. **身分証自動撮影**: なし
3. **デジタル認証（TRUSTDOCK/マイナンバー）**: なし
4. **SMS/OTP**: UI スタブ実装のみ（API 結線なし）
5. **AI 画像判定**: mock のみ、実装なし
6. **マイページステータス表示**: ハードコード、業務ロジック未定義

### TRUSTDOCK 導入への技術的検討事項
- **ネイティブ依存**: iOS/Android SDK がある場合、Expo-managed workflow では pod/gradle 依存を手動追加が必要（bare workflow への migration 可能性）
- **認証フロー**: 既存 `/api/rn/auth/login` の延長か、別 endpoint か要確認
- **デジタル証明書**: マイナンバーカード IC 読み取りには NFC/FeliCa ミドルウェア必要（iOS/Android ネイティブ実装）
- **セッション管理**: expo-secure-store で暗号化保存 → Cognito/Firebase に移行可能性あり
- **マイグレーション**: 既存ユーザー（既に顔写真アップロード済み）への対応戦略要確認

---

**報告者**: Claude Code (Claude Haiku 4.5)  
**調査方式**: grep / Read による事実ベース検索（憶測なし）  
**ファイル除外**: node_modules、.git、バイナリ
