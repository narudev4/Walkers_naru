# モーション系 AI / API 調査レポート

作成: 2026-05-26 / naru
背景: 5/21 MTG で古谷さん・枝光さんから出た要望（と naru が記憶している範囲）
ゴール: ヒアリングアプリの質問項目に「モーション検知」を組み込み、「どの筋肉がどう使われているか」をAIに判断させられるか、実装可否と推奨手段を整理する

> ⚠️ **重要な前提**
> - 本レポートは naru が 5/21 MTG での議論を再構成したスコープに基づく **初期調査**。Gemini自動議事録の取得・突き合わせはまだ。古谷さん・枝光さんの実発言と齟齬がある可能性がある
> - 共有時は「方向性合っているか」「スコープがズレていないか」の確認を先に取る
> - LIFF (LINE WebView) 内での `getUserMedia()` 動作は **未検証**（後述「§9 オープン項目」参照）

---

## 1. PTJ アプリ側の前提

| 項目 | 内容 |
|------|------|
| フロント | Next.js 16 + React 19 |
| 配信 | Vercel + LIFF（LINE Front-end Framework）でLINE内ブラウザ起動 |
| 動作端末 | iOS Safari / Android Chrome（LINE内 WebView） |
| カメラ取得 | `getUserMedia()` での動作は **未検証** ← 要 PoC |
| 制約 | iOS Vision Framework や ARKit はネイティブ専用 → **使えない**。Web で完結する必要がある |
| 既存ヒアリング | `app/app/hearing/page.tsx`。データ型は `HearingQuestion`（テキスト + 選択肢 + フリー入力 + 任意 zod スキーマ）。痛み・違和感ベースの問診 |
| カメラ既存利用 | **なし**（`getUserMedia` の参照箇所が0件） |

→ 検討対象は **Web/JavaScript で動くもの** に絞る。ネイティブ専用ソリューション（Apple Vision など）は今回は対象外。
→ ヒアリングは現状「テキストUI」前提なので、動画撮影ステップは「**新しい質問タイプ**」を追加して既存フローに自然に挟む形が現実的（後述）。

---

## 2. 「どの筋肉が使われているか」をAIに判断させるための論点整理

| 論点 | 状況 |
|------|------|
| 骨格・姿勢の検出 | 成熟。Webブラウザで33ランドマーク（MediaPipe Pose 等）が無料・リアルタイムで取れる |
| エクササイズのフォーム正誤判定 | 成熟。Sency / Kemtai / KinesteX / VAY 等の商用SDKがある |
| **骨格動作 → 筋活動量の推定** | **研究段階**。OpenSim + 機械学習で姿勢から筋活動を推定する論文が 2025 年に出ているが、**商用 API として「筋肉別の活動量を数値で返す」サービスは見つからなかった** |
| 現実解 | エクササイズ識別＋「そのエクササイズで主に使う筋肉」の静的マッピングをAIに渡して、自然言語で説明させる |

つまり「動作 → どの筋肉が動いてるか」を**AIで厳密に推定する商用APIは現時点でほぼ無い**。
**現実的には「骨格検出 + エクササイズ識別 + 筋肉マッピング辞書 + Claude/GPT の自然言語要約」のハイブリッドが最短ルート**。

---

## 3. 選択肢 A: オープンソース（自前実装）

| 候補 | 概要 | Webブラウザ | 精度 | コスト | PTJ適合 |
|------|------|:---:|:---:|:---:|:---:|
| **MediaPipe Pose Landmarker** (Google) | 33ランドマーク、JS版あり、`@mediapipe/tasks-vision` npm | ◎ | 中〜高 | 無料 | ◎ |
| **MoveNet** (Google, TFJS) | Lightning 7ms/Thunder 20ms、17ランドマーク | ◎ | 中 | 無料 | ◎ |
| **BlazePose** (TFJS) | フィットネス/ヨガ/ダンス向けに最適化 | ◎ | 高 | 無料 | ◎ |
| OpenPose | 多人数・高精度だが重い、要サーバGPU | △ | 最高 | 無料 | × (重すぎ) |
| YOLOv8-Pose | サーバ寄り | △ | 高 | 無料 | × |

**コメント**:
- MediaPipe Pose が Web/モバイル両対応の事実上の標準。React/Next 16 と相性が良い
- 「どの筋肉」は出ない。33点の関節座標から自分で「関節角度」「重心」「動作スピード」を計算して、それを Claude/GPT API に渡すか、辞書ルックアップで筋肉マッピングする必要あり
- 既知の限界: 手足がカメラに向くと反転する誤検出あり、機材が映ると混乱する（it-jim.com / Roboflow ブログより）

---

## 4. 選択肢 B: 商用 SaaS / SDK（フォームチェック丸ごと）

| 候補 | 提供形態 | Web SDK | 主な機能 | 価格 | PTJ適合 |
|------|---------|:---:|------|------|:---:|
| **Sency Motion SDK** | SDK | ◎（1行統合と謳う） | 動作識別・Rep数・アセスメント、`smkit-sdk` 公開 | 月100ユーザーまで無料、超過は従量課金 | ◎ |
| **KinesteX AI** | SDK | ◎（HTML-JS / PWA / React Native / Swift / Kotlin / Flutter） | 動作識別・Rep・カロリー・ROM・疲労検知・転倒検知、90%以上精度、HIPAA/GDPR、エッジ処理可 | 要問合せ（無料体験あり） | ◎ |
| **Kemtai** | API + 埋込 | ◎（iframe / API） | 111点、2000種類エクササイズ、PT/リハ寄り、3Dモーションラボと検証済 | 要問合せ（B2B） | ○ |
| **VAY (Bowflex/Nautilus)** | Pure SaaS API | ○ | カメラだけでフォーム矯正、Bowflex JRNYで運用中 | 要問合せ、商談ベース | △ |
| Fitbod / Tonal 等 | アプリ単体 | × | 自社アプリ向けで外部SDK提供なし | — | × |

**ハイライト**:
- **Sency**: 「無料で100ユーザーまで使える」の入りやすさが圧倒的。検証フェーズに最適。GitHub に `smkit-sdk` を公開
- **KinesteX**: SDK種類が最多（PWA含む）、ヘルスケア領域のコンプラ（HIPAA/GDPR）も対応で安全性◯。Next.jsと相性最良
- **Kemtai**: 医療・リハビリ寄り。PTJの将来サービス（高齢者ケアや姿勢改善）に親和性
- **VAY**: 信頼性は高いが B2B 商談スタートで個別 PoC 価格感が見えない

---

## 5. 「筋肉別活動」を出すアプローチ比較

| アプローチ | 実現性 | 精度 | 期間 | 備考 |
|-----------|:---:|:---:|------|------|
| ① ポーズSDK + 静的「エクササイズ→筋肉群」辞書 + LLM要約 | ◎ | 中 | 2〜3週 | **PTJの最短ルート**。「スクワット = 大腿四頭筋・大臀筋・ハムストリングス」みたいな辞書をLLMが解釈・出力。実装容易 |
| ② ポーズSDK + 関節角度計算 + 簡易ルールベース（膝/腰/肩の角度から負荷判定）+ LLM | ○ | 中〜高 | 1〜2ヶ月 | フォームの良し悪し、可動域の偏りも検知できる |
| ③ ポーズSDK + OpenSim ベース筋活動推定モデル + LLM | △ | 高 | 半年〜 | 研究実装ベース、商用ライセンス要確認、Webで動かすには重い。やる価値は将来的フェーズ |
| ④ EMG（筋電センサー）デバイス連携 | × | 最高 | — | ハードウェア配布が必要、PTJのオンラインサービスとモデルが合わない |

**推奨**: フェーズ1で ① を実装、フェーズ2 で ② に拡張、③以降は別事業（医療連携など）の段階。

---

## 6. PTJ のヒアリングへの組み込みイメージ（提案）

### フェーズ1（補助金申請レンジ・PoC）
- 既存の `HearingQuestion` 型に `type: 'motion'` 系のバリアントを追加（カメラ起動・ガイド動作・終了判定を持つ専用コンポーネント）
- 質問例: 「痛みのある部位（q1で取得済）に対応する動作を、ご自身のスマホカメラで撮影してください」
  - 腰選択 → 前屈テスト10秒
  - 膝選択 → スクワット5回
  - 肩選択 → 腕を上げる動作
- ブラウザで MediaPipe Pose を起動 → 動作中のランドマークを JSON で記録
- 動作終了後、関節角度から「膝の内倒れ・腰の屈曲・しゃがみの深さ・可動域」を計算
- 「スクワット = 大腿四頭筋・大臀筋・ハムストリングス・体幹」のマッピングと組み合わせて Claude API に渡す
- 「あなたの膝はやや内倒れ。大腿四頭筋外側に負担集中の可能性。内転筋強化を推奨」みたいな自然言語アドバイスを返す
- **動作素材は2〜3種類でOK**（スクワット・前屈・片足立ち 等）
- ヒアリングの「痛みベース」設計と相性が良い: **「気になる痛み」と「動かしたときの可動域・フォームの偏り」を組み合わせて根本原因仮説を立てる** という強い文脈になる

### フェーズ2（リリース後）
- Sency or KinesteX の Web SDK を統合してエクササイズ判定の精度向上 + Rep カウント
- 月次でフォーム比較を可視化 → 継続インセンティブに

### フェーズ3（差別化）
- OpenSim ベースの筋活動推定モデルを Workers / Vercel Functions に載せて非同期計算
- 「あなたの大臀筋活動は標準より17%低い」のような数値化

---

## 7. コスト・実装難度サマリ

| 項目 | フェーズ1 (PoC) | フェーズ2 (本番) |
|------|----------------|------------------|
| SDK費 | 0円（MediaPipe） | Sency: 100ユーザーまで0円、以降従量。KinesteX: 商談 |
| 実装工数 | 2〜3週（1人月以内） | 1〜2ヶ月 |
| 端末要件 | iOS/Android スマホブラウザ、カメラ許可 | 同じ |
| サーバ負荷 | クライアント完結（ブラウザJS実行） | ハイブリッド（識別はクラウド側にも） |
| プライバシー | 動画は端末内処理＆破棄、ランドマーク数値のみ送信 で説明可能 | SDK次第（KinesteXはエッジ処理選択可） |
| 補助金的な訴求 | 「DX」「AIによる健康アドバイス」「在宅ヘルスケア」で加点しやすい | 同 |

---

## 8. 結論・次のアクション（叩き台）

### 推奨方針
1. **PoC段階は MediaPipe Pose (無料)** + Claude API で「動作 → 筋肉マッピング → 自然言語アドバイス」を実装
2. **本番リリースで Sency か KinesteX の Web SDK** を採用（コンプラ・Rep認識・エクササイズ辞書を任せる）
3. 「どの筋肉が」は AI による静的マッピング + LLM 解釈 で出す。研究レベルの筋活動推定は事業フェーズ3以降

### 次の意思決定ポイント（古谷・枝光さんに聞きたいこと）
- a) MTGでの想定スコープは「補助金申請に書く"AI活用"の補強」なのか「実装に踏み込んだ機能追加」なのか
- b) ヒアリングに動画撮影ステップを入れることへの抵抗（離脱リスク）への許容度
- c) 競合（既存 AIフィットネスSaaS）との差別化軸として「筋肉別アドバイス」をどの強度で打ち出すか

### 次のタスク（naru側）
- [ ] 5/21 MTG Gemini 議事録を Drive から取り出し → 本レポートのスコープと突き合わせる
- [ ] **LIFFカメラ動作の 30分PoC**: `liff.init` 済の状態で `navigator.mediaDevices.getUserMedia({video:true})` が iOS LINE / Android LINE 内で動くか確認。動かない場合は `liff.openWindow({external:true})` で Safari/Chrome に逃がす設計を検討
- [ ] 本レポートを枝光・古谷さんに共有 → 方向性確認
- [ ] MediaPipe Pose Web の 1日 PoC（ブラウザで関節角度を出して画面に表示するだけ）
- [ ] Sency / KinesteX に問い合わせフォーム送付（PoC可能性、価格、サンプル動作確認）

---

## 9. オープン項目（共有前に解像度を上げたい）

| # | 項目 | 影響度 | 解像度の上げ方 |
|---|------|:---:|-------------|
| 1 | LIFF（LINE WebView）内で `getUserMedia` が動くか | **致命** | 30分 PoC。動かない場合は外部ブラウザに逃がすUX設計が必要 |
| 2 | 5/21 MTGで実際に出た要件 | 高 | Gemini自動議事録取得 or 古谷さんに確認 |
| 3 | 補助金申請（4/27目標）の現在ステータス | 中 | 4/20議事録時点で「申請書完成目標4/27」だった。完了済 or 進行中 or 提出後の追加でも有効か |
| 4 | 「動画撮影ステップ」のヒアリング離脱率許容ライン | 中 | 既存ヒアリングの完了率を確認、撮影ステップは optional にすべきか |
| 5 | Sency/KinesteX の商用ライセンス費用感 | 中 | 問い合わせ・価格交渉 |
| 6 | 「主働筋・補助筋」マッピング辞書の出所 | 低 | NSCAテキストや既存PT業界資料を典拠化（枝光さんが持ってる可能性高） |

---

## 参考文献

### 姿勢推定SDK
- [MediaPipe Pose Landmarker (Web)](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
- [BlazePose with TensorFlow.js](https://blog.tensorflow.org/2021/05/high-fidelity-pose-tracking-with-mediapipe-blazepose-and-tfjs.html)
- [MediaPipe for Sports Apps（it-jim 既知の限界）](https://www.it-jim.com/blog/mediapipe-for-sports-apps/)
- [Best Pose Estimation Models (Roboflow)](https://blog.roboflow.com/best-pose-estimation-models/)
- [Apple Vision VNDetectHumanBodyPoseRequest](https://developer.apple.com/documentation/vision/vndetecthumanbodyposerequest)

### 商用 SaaS / SDK
- [Sency Motion SDK](https://www.sency.ai/motion-sdk) / [Sency Pricing](https://www.sency.ai/pricing) / [GitHub smkit-sdk](https://github.com/sency-ai/smkit-sdk)
- [KinesteX AI](https://www.kinestex.com/) / [GitHub: KinesteX SDKs](https://github.com/KinesteX)
- [Kemtai API Integration](https://kemtai.com/api-integration/)
- [VAY Sports](https://vay-sports.com/) / [vay.ai](https://vay.ai/)

### 筋活動推定（研究）
- [Muscle Activation Estimation by Optimizing Musculoskeletal Model (arXiv 2502.13760)](https://arxiv.org/html/2502.13760v2)
- [Muscles in Time dataset (arXiv 2411.00128)](https://arxiv.org/pdf/2411.00128)
- [Estimating Ground Reaction Forces from 2D Pose](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9823796/)
- [AI Pose Analysis and Kinematic Profiling (arXiv 2510.20012)](https://arxiv.org/pdf/2510.20012)

### 業界トレンド
- [Best AI Fitness Apps 2026 (Fitbod)](https://fitbod.me/blog/best-ai-fitness-apps-2026-the-complete-guide-to-ai-powered-muscle-building-apps/)
- [Top 5 AI trends for gyms 2026 (Virtuagym)](https://business.virtuagym.com/blog/ai-trends-gyms/)
- [AI in Fitness 2026 (Orangesoft)](https://orangesoft.co/blog/ai-in-fitness-industry)
