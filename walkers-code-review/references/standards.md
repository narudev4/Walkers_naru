# 基準と対応関係

観点体系を更新・監査する時だけ使う。通常レビューでは `checkpoints.md` を正本として巡回する。

## 採用基準

- OWASP Top 10:2025: https://owasp.org/Top10/
- OWASP Application Security Verification Standard 5.0.0: https://owasp.org/www-project-application-security-verification-standard/
- OWASP Secure Code Review Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html
- OWASP Web Security Testing Guide: https://owasp.org/www-project-web-security-testing-guide/latest/
- NIST Secure Software Development Framework 1.1: https://csrc.nist.gov/pubs/sp/800/218/final
- Claude Code Skills: https://code.claude.com/docs/en/skills

## OWASP Top 10:2025対応

| OWASP | 主なチェックポイント |
|---|---|
| A01 Broken Access Control | S4, S9 |
| A02 Security Misconfiguration | S5, S11 |
| A03 Software Supply Chain Failures | S10 |
| A04 Cryptographic Failures | S6 |
| A05 Injection | S2, S8 |
| A06 Insecure Design | D2, S9, F3, F4 |
| A07 Authentication Failures | S3 |
| A08 Software or Data Integrity Failures | S10, F3, F4, Q6 |
| A09 Security Logging and Alerting Failures | S12, Q5 |
| A10 Mishandling of Exceptional Conditions | S13, F6, F7 |

Top 10は認知用のリスク一覧であり、網羅的な検証標準として単独使用しない。詳細な技術統制はASVS、手法はSecure Code Review Cheat SheetとWSTG、開発プロセスはSSDFで補う。

## 非セキュリティ品質

- D/F/T/Q群で、仕様整合、契約、データ不変条件、エラー、テスト、性能、保守性、観測性、migration、文書、プライバシーを扱う。
- 組織固有の運用として、S11で納品時のアカウント・所有権移管を確認する。
- プラットフォーム固有制約やAI固有境界はS14に隔離し、一般セキュリティ観点と混同しない。

## 更新ルール

1. 公式の安定版だけを基準にする。
2. バージョンをこのファイルへ明記する。
3. 既存IDを安易に再利用しない。意味が変わる場合は新IDを追加する。
4. `node --test scripts/review-state.test.mjs` を実行する。
5. `review-state.mjs init` と `validate` を再実行し、全見出しを認識できることを確認する。
6. 前方テストで実コードをレビューし、見落とし・過剰指摘・運用負荷を確認する。
