# 意思決定の記録と理由

<!-- 決定事項、その理由、決定日を記録 -->

## 2026-07-14: 提案書ドラフトに内部戦略メモを書かない（ニアミス発生）

**決定**: 対外提出物（提案書・RFP回答等）の下書きファイルに、価格戦略・受注スタンス等の内部メモを一切書かない。内部メモは `decisions.md`／`DAILY.md` に分離する。

**経緯**: エクシーキャンパス合同会社RFP対応で、提案書ローカルmdの先頭に「価格方針メモ: 総額300万円。『取りたくない案件』のため相場より高めの固定額で提示...」という内部メモを書いた。そのmdファイルをそのまま`import_to_google_doc`でGoogle Docs化したため、内部メモが提出予定の提案書ドラフトにそのまま入り込んだ状態になった。先方提出直前にnaruが気づき事故を回避（提出はしていない）。2026-04-16の議事録事故と同種のパターン（内部戦略が先方向けファイルに混入）。

**運用ルール**:
- 対外提出物のドラフト作成時、価格方針・受注スタンス・実績の弱さ等の内部判断は、ドラフトファイル自体に書かず `decisions.md` かその場のチャット内メモに留める
- 既存ファイルをGoogle Docs／PDF等に変換する前に、内部向け注記が本文に混入していないか本文全体を読み直してから変換する
- 提出直前は必ず変換後のファイル本文を通しで確認する（ローカル原稿ではなく変換後の実体を見る）

## 2026-04-16: 議事録の保存先はローカルのみ（当面）

**決定**: 議事録はローカル（`03_projects/{プロジェクト名}/minutes/`）のみに保存し、Google Driveには保存しない。

**理由**:
- Google Driveの共有フォルダに誤って保存すると、先方（クライアント）に内部議事録が見えてしまう事故が発生しうる
- 2026-04-16のPTJ案件で、共有フォルダに議事録を保存してしまい削除する事故が発生した
- 議事録には内部戦略・価格戦略の裏側・競合分析の深掘りなど、先方に見せられない内容が含まれる

**運用ルール**:
- `/meeting-minutes` スキル実行時、Google Docs作成はスキップする
- ローカル保存（`03_projects/{プロジェクト名}/minutes/YYYY-MM-DD_{会議名}.md`）のみ行う
- クライアント共有用のサマリが必要な場合は、別途「共有用議事録」として決定事項・ネクストアクションのみに絞って作成する
- このルールを解除する場合は、naruが明示的に指示する

## 2026-05-25: tl;dv 代替の自社スキル `meeting-transcribe` を新設

**決定**: tl;dv（有料サブスク）と Google Meet の Gemini メモ（内容省略が多い）を置き換えるため、`/meeting-transcribe` スキルを新設し、自社の S3 同期基盤に統合する。

**設計の核**:
1. **方向**: 既製 OSS（Meetily等）導入ではなく、既存の `video-to-manual`（mlx-whisper 逐語パイプライン）と `meeting-minutes`（要約・案件紐付け）の組み替えで自作。Claude Code 内で完結・無料・カスタム自由
2. **録音**: 当面は Google Meet の自動録画（Drive 保存）を使用。将来的に OBS のローカル別トラック録音（macOS 13+ で ScreenCaptureKit、仮想ドライバ不要）に移行可能
3. **動画本体の置き場**: Drive または元のローカルパスに置き、**S3 には上げない**（`pre-sync-guard` が 100MB 超を弾く設計のため）。`minutes.md` のフロントマターにリンクを記載
4. **出力先**: `03_projects/{案件}/minutes/{YYYY-MM-DD}_{会議名}/` 配下に `transcript.txt`・`transcript_plain.txt`・`minutes.md`・`audio.json` の一式（既存「単一md」規約を「サブフォルダ」に発展）
5. **S3 同期**: スキル末尾で `/sync-up` を必ず呼ぶ（連鎖規約）。`walkers-context-prod` 経由で `context-view` が HTML 化し、CloudFront（`walkers-context-view`）からスマホ Safari で案件ごとに閲覧可能
6. **話者分離（v1）**: pyannote も OBS マイクトラック分離も使わず、スキル起動時に参加者リストを聞き、Claude が文脈推測する方式（推測には末尾 `?` を付与）。Gemini メモへの部分退化を最小化する妥協
7. **話者分離（v2）**: OBS のマイクトラック分離（自分の声=トラック1で確定）か、pyannote `speaker-diarization-3.1` を追加して精度向上

**理由**:
- Gemini メモは要約寄りで「内容が省略されすぎる」のが naru の主たる不満。逐語の全発言が残らないと、後日の判断機微を辿れない（Lark Minutes で評価されている逐語＋構造化の二段構えと同等の体験を狙う）
- tl;dv は 1 席年 ¥30,000 程度。既存資産の組み替えで等価以上の機能が作れるため自作が合理的
- 既に `03_projects/{案件}/minutes/` のフォルダ規約と S3 同期＋スマホ閲覧基盤が稼働しており、追加インフラは不要

**実証**:
- 2026-05-25, Drive の Meet 録画 `not-wdya-kbb (2026-02-19 16:00)`（28.7分・395MB）でフルパイプライン検証
- 副産物: `video-to-manual` の `clean_hallucination` が MTG 音声で **8.2分で誤打ち切り**する欠陥を発見。「最初のN連続スパンで打ち切り」を「**スパン単位で除去＋継続、相槌は SHORT_OK で保護**」に改良し、27.2分の有効逐語を救出。改良は `video-to-manual` にも還元済み

**運用ルール**:
- 起動時に `案件 / 会議名 / 参加者リスト` を必ず聞く（参加者リストは話者推測の根幹）
- 案件固有の固有名詞精度を上げたい場合は `03_projects/{案件}/.minutes-prompt.txt` に補助金名・社名・専門用語を列挙し、Phase 4 の `--initial-prompt` に注入
- 既存 `/meeting-minutes` スキル（Gemini メモ→ワークブック反映）は併存。トリガーで分岐

## 2026-05-26: 福岡県環境部「みんなの環境」デジタル化案件のモック方針確定

**決定**:
- 副読本デジタル化が**本体**、クエスト/VR/スタンプは **+α 機能**（古谷さんトーン確認済み）
- 副読本UIは標準的なデジタル教科書パターン（**目次 → 見開き → ページナビ**）を採用
- サンプル実装は **p.20-21「ごみの処理」1見開きのみ**、他章は「準備中」表示で全体像を示す
- クエスト①は現状の「10問クイズ→アバター成長」型のままで OK（+α 想定なので作り直し不要と判断）
- 副読本に**検索機能**を追加（議事録「クリックによる検索機能」明記の要件）
- 副読本の TTS（音声で聞く）機能は除去（naru 判断 / 5/28 デモで不要）

**実証**: 2026-05-26 古谷さんから「いいじゃん」評価獲得 → 5/28 先方 MTG に進む。

**理由**:
- 先方（福岡県地球温暖化対策係）は具体 UI イメージを持っていない（行政・教育系発注の通例）
- そのため「先方の頭の絵を当てる」のではなく「**先方が見て選べる叩き台を出す**」のがゴール
- 既知パターン（光村図書 / Lentrance / 超教科書 等のデジタル教科書UI）に寄せると、教育現場の人が即理解して反応を返せる

**成果物**:
- `output/deploy/pref-fukuoka-eco-mockup/` （Next.js 16 + React 19 + Tailwind v4）
- `/textbook`（目次・全56ページ4章構成）/ `/textbook/gomi`（p.20-21見開き完成版）/ `/vr` / `/quest/challenges` / `/quest/stamp`
- 議事録: `Drive: 1I_Y194yjyaOwZdFqt50JoVMChozU800kkJZHhWPYmxM`（5/20 初回MTG）

## 2026-05-26: 案件解釈プロセスの改善方針（naru 入社初期の課題対策）

**決定**: MTG 同席後の手戻りを減らすため、以下の運用に切り替える。

1. **MTG 同席後すぐ「自分の解釈」を Claude と一緒に Step ①〜④ で言語化する**
   - ① 先方の原文 ② キーワード分解 ③ 各キーワードの採用解釈 + 別解釈 ④ 採用根拠
2. **③ の "別解釈" が複数出てきたら、古谷さんに「これで合ってる？」を即確認**（モック作成前）
3. **`meeting-transcribe` スキルに将来、解釈ノートのテンプレ生成 Phase を追加**

**理由**:
- naru は入社初期で業界文脈（教育/行政/補助金等）の解像度が低く、MTG での発言の重要度判定が難しい
- 古谷さんは年季で「コア要件 vs 具体例 vs 議論メモ」を瞬時に分類できるが、naru はその経験値が無い
- これは矯正で埋まらない → **外部装備（Claude + テンプレ）で補う**設計が正しい
- 議事録（インプット）と実装（アウトプット）の間の「**解釈プロセス（変換）**」がブラックボックスだったのを、Claude と並走して言語化する仕組みに変える

**重要な学び（一次情報の扱い）**:
- Gemini 議事録は「論理構造」は拾うが「現場の温度感・強調・ニュアンス」は拾わない（二次情報）
- 同席した naru の体感（一次情報）と議事録構造が矛盾する場面では、**naru 体感を採用**するのが正しい
- 2026-05-26 福岡県案件で「副読本がメイン／4つ並列か」の認識ズレが起き、naru 体感「副読本がメイン」を採用 → 古谷さん承認で正しさ確認

**今後の連鎖**:
- MTG 直後 → 解釈ノート化（naru + Claude） → 古谷さん確認 → モック作成 → 先方 MTG
- このサイクルを毎案件回すことで、naru が古谷さんの読解パターンを並走で吸収していく

## 2026-05-26: 案件ごとの 03_projects/ ディレクトリ運用を標準化

**決定**: 新規案件のキックオフ時に、必ず `03_projects/{案件名}/` ディレクトリを作成し、以下の標準構成で立ち上げる。

```
03_projects/{案件名}/
├ CONTEXT.md          # 案件メタ（概要・先方キーパーソン・商談履歴・スケジュール・Next Actions）
├ minutes/            # 議事録（YYYY-MM-DD_{会議名}.md）
│   └ Drive リンク + naru の解釈ノート（Step ①〜④）を併記
├ research/           # 先方資料解析・競合調査・PDF/データ分析
├ proposal/           # 提案書（先方提示用）
└ mockup-link.md      # output/deploy/ 配下の実装本体へのポインタ + 主要URL + 起動方法
```

**運用ルール**:
1. **モック・実装本体は `output/deploy/{案件名}/` に置く**（CLAUDE.md の規約通り）。案件ディレクトリには `mockup-link.md` でポインタだけ持つ
2. **議事録は `minutes/` に保存**（既存ルール継続）。Drive リンク + 解釈ノート（Step ①〜④）を併記
3. **CONTEXT.md は更新日と案件ステータスを常に最新化**。MTG 毎に商談履歴セクションを追記
4. **案件キックオフ時のチェックリスト**:
   - [ ] ディレクトリ作成（`mkdir -p 03_projects/{案件名}/{minutes,research,proposal}`）
   - [ ] CONTEXT.md 雛形作成（既存案件のテンプレ流用、特に `03_projects/エンパクト/CONTEXT.md` や `03_projects/福岡県環境部/CONTEXT.md` を参考）
   - [ ] mockup-link.md 雛形（モックが既にあれば）
   - [ ] decisions.md に案件追記（重要決定があれば）

**命名規則**:
- 既存パターン: `略称_日本語`（PTJ_、OJT_）／ `日本語のみ`（エンパクト、福岡県環境部、落合コーポレーション）／ `略称のみ`（OKWEB、anything）
- 推奨: 短く覚えやすい日本語またはアルファベット略称。先方組織名そのまま長いものは避け、最上位の部署名や略称で

**理由**:
- 案件情報がローカルファイル・Drive・モック実装・議事録に分散しがちで、後で振り返れない
- 案件ディレクトリに集約しておくと、過去案件の参照・同種案件への再利用・新規メンバーへの引継ぎが楽になる
- 既に PTJ・エンパクト・OKWEB 等で運用されている `CONTEXT.md` パターンを全案件に展開する
- `decisions.md`（横断的）と `03_projects/{案件}/CONTEXT.md`（案件固有）を併用することで、横串と縦串の両方をカバー

**実証**:
- 2026-05-26 福岡県環境部案件で本ルールに基づき `03_projects/福岡県環境部/` を立ち上げ（CONTEXT.md + minutes/2026-05-20_初回ヒアリング.md + research/minna-no-kankyo-r8-toc.md + mockup-link.md）。次回 MTG 後に minutes/2026-05-28_第2回MTG.md を追記予定

## 2026-06-01: 「作り方」系記事の新規執筆スキル `howto-article-new` を新設

**決定**: 鳳汰さんの依頼（録画 2026-05-29「〇〇 作り方系の新規記事執筆 お願い」）を受け、既存 `howto-article`（リライト専用）とは別に、**0→1新規執筆**用の `howto-article-new` スキルを新設した。

**背景・解釈**:
- 依頼は「リライトの続編＝まだ作り方記事が無いアプリを新規に書く」。対象は Notion 優先施策ビューの約29アプリ（多くは開発費用系が完成済み）を上から順に量産（鳳汰「20本くらい執筆するっぽいのでSKILL化すべき」）。
- Notion メタの「対談形式」は山口・古谷・渡辺・池田が担当する別トラック（スライド/動画系）であり、naru=細谷 の成果物は見本記事 `matchingapp-development` 準拠の**構造化記事**（見本記事の実物確認で確定）。

**設計の核**:
1. 既存 `howto-article`（リライト）とは作業種別が違うため**別スキル**（兄弟）。共通の予約システムv2ルールは `references/howto-v2-rules.md` に出典付きで一元集約し両スキルから参照。
2. 出力の着地点は **Claude in Chrome で WordPress 下書き作成**（REST APIではなく、ログイン済みブラウザを操作）。
3. Phase 4 はテンプレ（予約システム post=10813）**複製＋テキスト差し替え**を主経路（オレンジリスト・太字・AIヒアリングライン・動画枠は Gutenberg ブロックで、空投稿ペーストでは壊れるため）。これは `howto-article` のブロック編集と同一技術で、違いは元ネタだけ。
4. **status=draft 厳守**（publish はスキル外・人手）。フロー: naru レビュー → 鳳汰へ Chat 共有 → FB → 動画録画（手順①③=claude.ai／④⑤=Claude Code）→ 公開。

**品質検証（empirical-prompt-tuning）**:
- ヘルスケア(10步)・社内システム(9步)・デリバリー(10步 hold-out) の3シナリオを白紙subagentで実行 → 全て精度100%・[critical]全○。
- iter1で「正例 `reservation-system_rewrite.md` の装飾（手順間`---`・太字ゼロ）を写経すると要件を落とす」構造的曖昧を検出 → v2ルール §冒頭に⚠️写経トラップ注記を追加 → iter2(hold-out)で「迷わなかった」と確認し収束。

**未確定（要すり合わせ）**:
- 費用系3章の含有可否（暫定: 開発費用記事が完成済みなら要約＋内部リンク、選び方ポイントは残す）
- テンプレ複製機能（Duplicate Post 等）の有無 → 初回に Claude in Chrome で偵察予定
- 正確な29アプリ一覧（Notion真理源、動画読み取りは28項目）

**成果物**: `.claude/skills/howto-article-new/SKILL.md` + `references/howto-v2-rules.md`、依頼ブリーフ `output/manuals/howto-article-brief/manual.md`

## 2026-06-04: `howto-article-new` スキルを完成扱いに（end-to-end 実証済）

**決定**: SaaS記事(post=11062)で Phase 0-5 を実機で通し、鳳汰FBも1巡反映した時点で、スキルを**完成**とする（naru判断）。残り記事はこのスキルを使い、鳳汰FBをもらいながら量産する。

**実証・確定した要点**:
1. **既定テンプレ＝見本 matchingapp(7240)**（10ステップ・とは/注意点あり・「9割」H2なし）。予約型(7307・9ステップ・9割先頭)は別バリアントで、使うのは naru 明示確認時のみ。当初 予約型で作ったが鳳汰FBで見本型に作り直した。
2. **Phase 4 実装**: Yoast「新規下書き」で見本を複製 → Claude in Chrome の `wp.data` でブロックのテキストのみ find→replace → **`resetBlocks(wp.blocks.parse(c))` で確定反映** → `savePost`。`editPost({content})` と `updateBlockAttributes` の混在は巻き戻るので禁止（実測）。保存後 `getCurrentPost().content.raw` で再検証。**publish 厳禁・draft維持**。
3. **複製で引き継ぐ＝人手差し替え**: 冒頭動画embed(新規は削除)・アイキャッチ・本文図解(naruがFigma)・スラッグ・費用数値・内部リンク。
4. **鳳汰FB(2026-06-04・動画)**: 冒頭動画削除／略語テーマ(SaaS等)は「とは」に読み方・正式名称／画像はFigmaで全更新／プロンプトはこちらで作成。
5. **運用フロー変更**: 次からは**プロンプト確定＋録画＋Figma画像まで仕上げてから鳳汰に提出**（手戻り削減）。プロンプトは「マーケ用リンク」スプシ「作り方リライト」タブ(gid=873328683)に台帳化。録画ツールは手順①③=claude.ai／④⑤=Claude Code。

**SaaS記事(11062)の残**: Figma画像差替・録画・スラッグ等は naru 作業（スキル外の人手工程）。本文・冒頭動画削除・SaaS読み方・確定プロンプトは反映済。

**関連**: `.claude/skills/howto-article-new/`（SKILL.md / references/howto-v2-rules.md）、`yamaguchi-feedback-log.md`（2026-06-04）、`output/articles/howto-article/2026-06-01_saas_draft.md`

## 2026-06-01: google-workspace MCP を共有HTTP常駐(:8000)化、stdio廃止

**決定**: `google-workspace` MCP を streamable-http の launchd 常駐サーバ1個（`http://localhost:8000/mcp`）へ集約し、stdio 版（各セッションが自前起動）を廃止（Option C）。複数セッションが固定ポート8000と共有 credentials dir を奪い合い、2セッション目以降が断続切断していた問題を解消。

**構成**:
- 実行: `~/.local/bin/workspace-mcp --transport streamable-http --single-user --tool-tier complete`（`uv tool install workspace-mcp==1.21.1` でピン留め＝uvx 都度解決を回避）
- 起動スクリプト: `05_development/scripts/mcp/workspace-mcp-serve.sh`（git管理対象・secret無し。secret は `credentials/workspace-mcp/serve.env` を source、git管理外・chmod600）
- 常駐: launchd `~/Library/LaunchAgents/com.walkers.workspace-mcp.plist`（RunAtLoad/KeepAlive、ログ `~/Library/Logs/workspace-mcp.{out,err}.log`）
- `.mcp.json` の google-workspace = `{"type":"http","url":"http://localhost:8000/mcp"}`。旧 stdio ブロックは `.mcp.json.bak-stdio-20260601` にバックアップ（共に gitignore 済み）。

**運用上の注意**:
- localhost(127.0.0.1)バインド限定・MCP層認証なし → 同一マシンの他プロセスから叩ける（Google 全権限）。**LAN 公開しないこと**。
- サーバ停止＝全セッションで Google 不可（KeepAlive で自動復活）。手動再起動: `launchctl kickstart -k gui/$(id -u)/com.walkers.workspace-mcp`。停止: `launchctl bootout gui/$(id -u)/com.walkers.workspace-mcp`。
- 旧 stdio へ即時復帰: `.mcp.json.bak-stdio-20260601` を `.mcp.json` に戻し、launchd を bootout。
- .mcp.json 変更は**起動中セッションに反映されない** → 切替時は全セッション再起動が必要。
- 検証済: lsof :8000 単一プロセス / 3クライアント同時接続成功 / kill→KeepAlive 自動復活(:8000) / 実 Google トークン（credentials dir）再利用で list_calendars 成功。
- 未確認: Google Cloud OAuth クライアントへの redirect URI `http://localhost:8000/oauth2callback` 登録（キャッシュトークンで現状動作するため当面不要だが、再同意が発生する場合は要登録）。

## 2026-06-03: 獣医論文サブスク モックアップ（VetLit 仮）作成・デプロイと Vercel 新規プロジェクトの落とし穴

**決定**: 合同会社どうぶつとひと出版／Aメディカル制作所（櫻井様）の 6/4 MTG 用に、獣医師向け論文お知らせサブスクのモックアップを作成・本番デプロイした。
- 成果物: `output/deploy/vetlit/`（Next.js 16 + TS + Tailwind v4）。本番 URL **https://vetlit.vercel.app**（nalus-projects/vetlit、保護なし）。
- 画面: テストハブ / LP / 記事フィード / 記事詳細(ペイウォール) / マイBOX / 文献検索 / マイページ / 会員登録 / LINE通知プレビュー の9枚。
- デザイン: naru 承認で「学術エディトリアル」（明朝 Noto Serif JP / ディープグリーン×アンバー / クリーム）を採用。
- 課金の核 = 記事詳細で「AI要約まで無料 → 著者の解釈コメントはプレミアム(月400円)」をブラー＋CTAで体験できる構成。先方仕様に厳密準拠（☆記事の全文検索=有料、PubMed文献検索=無料の+α、と明示）。

**Vercel デプロイの再発防止知見（重要・次回モック時に参照）**:
1. **`output/deploy/deploy.sh` は存在しない**。`.claude/refs/vercel-deploy.md` の記述と実体が乖離。モックは手動デプロイで対応した。
2. **`vercel project add` で先に空プロジェクトを作ると framework=null になり、deploy しても全パスが `x-vercel-error: NOT_FOUND`（404）**。`framework:"nextjs"` を設定して再デプロイで解消。今後は project add を使わず、リンク済み（.vercel/project.json あり）なら `vercel deploy --prod --scope nalus-projects`（--yes 不要）が安全。
3. **新規プロジェクトはデフォルトで Deployment Protection（Vercel Authentication）が有効**になり 401。クライアント共有用は無効化が必須（API で `ssoProtection:null` / `passwordProtection:null`）。osusuma 等の既存モックも無効化済み。
4. スコープは必ず `--scope nalus-projects` を明示（`vercel --yes` 単独はデフォルトスコープ事故のため禁止のまま）。

**検証の学び**: HTTP 200 + grep は「届いている」証明であって「正しく描画されている」証明ではない。Playwright で 明朝レンダリング(`serifLoaded_JP:true`)・ペイウォール描画・モバイル375px・hydrationエラー0 を実機確認して初めて done とした（advisor 指摘で軌道修正）。

## 2026-06-08: 1LC Airtable 削減 — 削除候補の洗い出し完了、削減プランは「案B（約9.5万件）」推奨

**決定（MTG提案方針）**: Airtable ベース `appksEWIuKl7N2ftS` の削減で、**案B（チタン物件一覧の「滞留かつ紹介実績ゼロ」49,685件 ＋ ★物件紹介履歴の「3ヶ月超前」45,049件 ＝ 約94,734件削除）を推奨**。実削除は基準合意後の別ステップ（今回は候補特定・件数試算まで、実削除なし）。

**Claude in Chrome で全14テーブルを実測した一次情報**:
- **ベース総数 = 192,722件**（上限125,000を67,722件超過）。文脈の「約140,000件」は過小。大物2テーブル＝★物件紹介履歴94,835＋チタン物件一覧84,284＝179,119（全体の93%）。残り12テーブルは計13,603（マスター/小規模）。
- 削除軸の根拠（Automationコードで確認）: 物件取得(`wflqREpmCKeVl0oQz`)は6h毎に公開用URLでupsert、フィードから消えた物件は放置→滞留。**新規登録日=Date(作成時default現在日付・安定)、更新日=Last modified time(滞留度シグナル)**。→ チタンは「更新日（滞留）＋紹介実績ゼロ」軸、★物件紹介履歴は「紹介日時」軸。
- 孤児化: ★物件紹介履歴(子)→チタン物件一覧(親)・個人投資家/企業へリンク。チタン削除は履歴を孤児化、履歴削除はチタン無傷。→ **実行順=①古い履歴削除 ②チタンのゼロ孤児stale削除**。
- toCマッチング(`wflu54U87Lag1xNLV`)は★物件紹介履歴をdedupで読む＝死んだログではない。ただし古い紹介は対象物件が消滅済みで再送リスクなし。

**重要な判断の分岐（advisor 指摘で軌道修正）**: 当初「案A（約6.8万件）でも上限復帰」としたが、全テーブル実測で**案Aは削除後124,994件＝上限を6件下回るだけ＝翌日再超過＝実質不十分**と判明。**案B必須**＋恒久策（自動アーカイブ）が必要。憶測でテーブルを「小さい」と仮定せず実測したのが正解。

**成果物**: `03_projects/1LC/削除候補レポート_2026-06-08.md`（MTG用・全数値と推奨実行順・CSV検証チェックリスト）。調査用Personalビュー3つ作成（実害なし、実削除時に整理）。

**実削除前の必須**: 両テーブルCSVバックアップ、CSV精密検証（bulk汚染除外・現役物件混入サンプル確認・最近履歴の再送精査・toB dedup確認）、Automationと衝突しない時間帯でレコード削除のみ（`viwPDkWFB8zHPraRL`等の参照ビューは触らない）。

## 2026-06-10: PTJ POC 枝光様FB（6/9受領）の対応方針確定 — 実機検証で原因特定済み

**決定**: 枝光様FB5点の対応方針を以下で確定。実装は別セッション（方針メモ: `03_projects/パーソナルトレーナージャパン/app/docs/2026-06-10_edamitsu-fb-plan.md`）。
- **①文字サイズ**: 一段下げ＋sticky動画を28vh程度に圧縮。極端に小さくしない（実ユーザーは50-60代、枝光様は監修者）。1問1答スライド版への全面切替は見送り。
- **②側屈・回旋の左右**: **左右を2ステップ（2画面）に分割**（動作5→7）。部位ラベルでは動作方向の左右が記録できず、診断ロジック（古谷さん重み付けシート）が左右差を使うため。`movement-knowledge.ts` に左版ナレッジ追加が必要。
- **③診断コメント**: 担当は**naru**（6/10訂正: 当初「古谷さん領域」と誤認していた。古谷さんは重み付けシートの作成支援のみで、診断ロジック実装はnaru）。PTJのシート回答受領後にnaruが実AI診断を実装。FB③の実体は「判断ロジック未実装の固定文を、枝光様が実診断と誤認して評価した」構図のため、枝光様へ「現状は仮の固定文。シートのご回答がロジックの元データになる」と説明が必要（次回MTG 6/11が候補）。
- **④動画から戻れない**: `target="_blank"`廃止→結果ページ内モーダル/インライン再生。
- **⑤症状ごと「問題なし」**: 固さ/痛み/詰まり/痺れ各質問に「問題なし」チップ追加（既存の未使用定数 `NONE_VALUE` を使用）。

**実機検証で確定した一次情報（Playwright・モバイル幅）**:
- デプロイ版（ptj-poc-ai-trainer.vercel.app）は DEMO_MODE=1 で、入力と無関係に**常に腰の固定文**が出る。「ふくらはぎの固さ」のみ入力しても、やっていない「側屈」「片足立ち」の所見が診断文に出た。→ FB③「コメントが分からない」の主因は文章でなく**回答と診断の不整合**。
- 「動画を見る」は新規タブで実在しないYouTube（dummy-N）を開き戻る導線なし → FB④はLIFF/webviewで確実に詰む。

**⚠️ 技術ギャップ（naru対応・6/10訂正）**: 実AI経路 `app/lib/claude.ts` は `execFile('claude', ['-p'])` で**ローカルCLI前提**。Vercel上に claude コマンドは無いため、**DEMO_MODE を外すと本番 /api/diagnose は500になる**。本番はAnthropic API（SDK）等への置き換えが必須。（※③がnaru領域のため「古谷さんへ共有」タスク自体が解消。naruが実AI診断実装時に対応＝スプシ作業一覧2-2）

**運用追記（6/10）**: PTJの仕様書はスプシ「【PTJ様】PoC実装」のタブで管理する方針に拡張（方針メモ等のローカルmdは下書き。「FB対応方針」タブを仕様の正とする）。詳細は案件 `CLAUDE.md`。

## 2026-06-10: 落合 — 請求書メールはB案（Shopify1通化）を採用

**決定**: ③都度払いの請求書配信は **B案＝Shopify注文確認メール1通に請求書リンクを集約**（naru判断）。MFからのメール送信（A-2 Playwright自動化・2026-06-10に実証済み）は**本番では使わない**（デモ・予備手段として保持）。

**理由**: 2通届く顧客体験のくどさ＋A案はPlaywright用コンテナ環境・MFセッション定期再ログインという重運用が残る。B案ならMF APIの請求書作成＋PDFプロキシだけで完結し、軽量Functions系ホスティングで済む。

**確定済みの技術前提**: MF APIに顧客向け閲覧URLは無い（pdf_urlのみ・無認証401実測）／Shopify確認メールは注文と同時送信のため個別URL直接差し込みは構造的に不可→固定形式の自前リンク＋PDFプロキシ方式。

**残タスク**: C-1（メールテンプレで使える推測不能トークンの一次情報確認）→ プロキシ実装 → テンプレ差し込み → e2e。**先方確認**: 差出人にMFが登場しなくなる点の許容（スプシ確認事項#1・未確認）。

## 2026-06-11: 作り方記事の量産運用 v3（夜間バッチ＋スプシ・チェックシート）

**決定**: 「〇〇 作り方」系新規記事は以下の分業・フローで量産する（naru 指示）。

1. **下書きはまとめてバッチ作成**: naru が寝る前に定型プロンプト（`output/articles/howto-article/next-session-prompt.md`）を投入 → Claude が「記事生成 → WP下書き(draft) → 公開前チェックシート記入」まで夜間に完了
2. **チェックシート運用**: スプシ「ブログ記事公開前のチェックリスト のコピー」（`10uDKmgK9wYetbhJB5T32A1WpSiIA7tCBnIDWT-DXVdo`）で、記事ごとに「Walkersメディア」タブを複製→「{テーマ}作り方」にリネーム。Claude が確認できる11項目はAIがチェックし、D列に根拠メモを残す（第1号=「SaaS作り方」タブ）
3. **分業**: 動画（録画・埋込）と Figma 画像差し替えと最終目視（スマホ・誤字脱字）= naru／下書きFB = 鳳汰（投稿時）
4. **公開**: 最初の記事は鳳汰と確認しながら投稿 → 慣れたら naru が確認して投稿。**Claude は publish 厳禁**

**理由**: 約20本の反復作業を「AIが夜間に消化→人は朝レビューと動画・画像だけ」に固定化し、品質はチェックシート（17項目）で担保する。チェック根拠をD列に残すことで、naru が WP 初心者でも何を確認すべきか追える。

**記録**: SKILL.md（howto-article-new）に v3 運用・Sheets 操作ノウハウ・post-link カード後処理を反映済み。

## 2026-06-13: 開発ハーネス構築（〜6/22）フェーズ1・2の設計決定

**決定（フェーズ1: スプシ駆動の中核）**:
1. スプシ標準構造は「固定シートセット」ではなく**派生モデル**: 親=作業一覧（`ID/フェーズ/タスク/作業内容/ステータス/担当/naru確認`）。naru確認列は人間専用。常設=確認事項・環境情報。検収は対象（画面/機能/DB/API）ごとに発行し**AI記入列と人力確認列を分離**
2. ステータス5値 `未確認/未着手/着手可能/対応中/✅完了`（PTJ条件付き書式を全案件標準化）。「未確認」=AIが精査していない行。✅完了にできるのはテストPASS時のみ
3. /goal 完了条件の標準形=**作業一覧基準**（対象Phase全行が✅完了）。発射判定は `/goal-check` でClaude自身が7項目+行単位精査→naruには不足リストだけ提示
4. 自走停止は2層: **層A**=仕様の空白・矛盾は確認事項に起票し続行（全タスクブロック時のみ停止）/ **層B**=即時停止5種（不可逆操作・課金契約・絶対NG抵触・同一エラー3回・シークレット境界）
5. /loop を /goal の自動再開装置に採用（確認事項巡回・受領物監視。層B承認待ちは「承認」記入まで再開しない）/ Verifier sub-agent で実装者≠検証者≠判定者の3層分離 / 案件クローズ時に distill で memories+インシデント記録へ蒸留
6. Sheets操作は google-workspace MCP を正とする

**決定（フェーズ2: 構造・ルール）**:
1. ワークスペース新構造（**設計承認済み・移行実施は後日**）: `context/`(旧00+空き家01/02/04/06吸収) `clients/`(旧03_projects) `archive/`(新設) `dev/`(旧05_development)。番号体系廃止
2. 案件標準構成: `CLAUDE.md + CONTEXT.md + minutes/ + proposal/ + mockups/ + app/(単一リポ) または repos/{名}/(複数リポ大型案件)`
3. CLAUDE.md 4層: L1個人(~/.claude)→L2母艦(横断ルール・大幅減量)→L3案件(スプシID・フェーズ・関係者)→L4開発(スタック・コマンド)。**矛盾を作らない=各層で書く内容の種類を分離**（公式に優先順位規定なしのため）
4. 新規案件は `/project-init` がL3雛形をCONTEXT.md・議事録から自動生成。手書きCLAUDE.mdゼロ運用
5. スキル3層: walkers-plugin「業務OS」(スプシ駆動/goal-check/verifier/distill/project-close/carveout/commit) / 母艦=使用実績ある営業系のみ / 案件app/=L4のみ
6. **S3クロスデバイス同期は凍結**（naru「スプシでいいや」）: CLAUDE.mdのCRITICAL節削除・同期5スキル退避・S3バケット放置。DAILY.mdは薄いインデックス化（詳細はスプシへ一本化）
7. ゼロ使用スキル27+コマンド13は物理削除（git履歴で復元可）。実測根拠: 2,319セッションのログ集計（2026-04-02〜06-12）
8. 開発ルールは古谷マニュアル準拠: Vercel正規チーム+Neon/Supabase+GitHub Private / main(直コミ禁止)/develop/feature / feat:fix:docs:refactor: / Codexレビュー / 検収=AI総当たり→人力

**理由**: コンテキスト溢れの真因は (a)YourAI経営管理テンプレと実業務の不一致による空き家 (b)スキル増殖（51中27がゼロ使用） (c)全業務1ワークスペース起動。対策は「app/起動の標準化 + CLAUDE.md層分離 + スキル削減」。上司の質問力・プロセスは「Walkers受託開発マニュアル v1.0」(スプシ 1jU3MZDJOHg783_LuLAyQVSFNDzYq3ewBIFhdmFlGVa8) としてすでに型化されており、ハーネスはこれのコード化。

**後日テーマ**: Windows常駐エージェントサーバー構想（agent-runtime.mdと統合検討）/ 移行スクリプト実行日 / aikataクローズ時の/project-closeパイロット

## 2026-06-16: 開発ハーネス フェーズ3（品質ゲート・Hooks）決定

**決定**:
1. **コードチェック = 編集後警告 + コミット前ゲート**:
   - 編集後（PostToolUse Write|Edit）: 編集したコードファイルだけ eslint し非ブロック警告（Claude 自己修正）。`docs/harness/hooks/check-after-edit.sh`
   - コミット前（PreToolUse Bash で `git commit` 検知）: lint+typecheck+test を実行し、失敗なら exit 2 でブロック。`docs/harness/hooks/gate-before-commit.sh`
   - 両スクリプトは degrade gracefully（設定/スクリプト無ければ素通り）。隔離リポで失敗ブロック・通過・項目なしの3ケース検証済み
2. **配置 = app に scaffold**: carveout/project-init が `app/.claude/hooks/` にスクリプト、`app/.claude/settings.json` に hooks 定義（`docs/harness/hooks/settings.app.json`）を配置。naru は触らない
3. **Bash 危険操作ガードは今は入れない**: `.gitignore` が秘匿を完全カバー（credentials/.env/.mcp.json/*.key/*.pem、git check-ignore 確認済み）+ defaultMode=ask で危険操作は権限プロンプトが出る。Claude Code 標準制御で対話作業は十分（naru 判断・同意）
   - **後日トリガー**: `/goal` を権限を緩めて無人自走させる日に、不可逆操作（force-push main・rm -rf・本番DB削除）の最小 PreToolUse ガードを足す
4. **人間レビューのタイミング**: 自動レビュー=編集後警告+コミット前ゲート+verifier(3層分離)。人間(naru)レビュー=作業一覧の naru確認列 + 層B承認待ち行。これで「AI総当たり→人力」（古谷マニュアル）を実装
5. **既存グローバル hooks（~/.naru/ の naru-memory: Stop保存・UserPromptSubmit注入）は触らない**。ただし memory.py が4/2未更新で L1 から参照削除済みのため、稼働中hookとの整合は後日確認（全プロジェクト影響のため個人判断）

**根拠**: Hooks の価値は「Claude の記憶に依存しない決定的強制」。本当に決定的強制が要るのは (a)コミット品質 (b)無人自走時の不可逆操作 の2つ。(a)は app scaffold で実装、(b)は無人運用開始日まで保留。それ以外は CLAUDE.md 記述 + Claude Code 標準制御で足りる。

## 2026-06-16: 開発ハーネス net-new 成果物ビルド完了

**ビルドした成果物**（全て `docs/harness/` と `05_development/walkers-plugin/`）:
- スキーマ定義書 `docs/harness/spreadsheet-schema.md`（派生モデル・作業一覧/確認事項/検収シート列定義・ステータス5値）
- スプシ駆動スキル `walkers-plugin/skills/spreadsheet-driven/`（業務OS中核）
- goal-check スキル（発射前検査・行単位精査→不足リストだけ提示。naru の解像度不足を AI が補う）
- project-init スキル（L3雛形生成 + app hooks scaffold）
- project-close スキル（distill→検収確認→軽量化→archive。aikataがパイロット）
- distill スキル（学びを decisions.md / incidents.md へ蒸留。goal-check が consult）
- verifier エージェント `walkers-plugin/agents/verifier.md`（実装者≠検証者≠Haiku判定の3層分離）
- 運用1枚図 `docs/harness/operations-map.svg`
- L2/L3/L4 テンプレ・hooks（フェーズ2-3で作成済み）

**ハーネス6成果物すべて完成**（L1適用済み / L2-4テンプレ / スキル群 / Hooks / スキーマ書 / 運用図）。

**残（後日）**: (1)移行実施＝docs/harnessのステージングを母艦へ適用＋番号ディレクトリ改名＋ゼロ使用スキル削除 (2)新6スキルの empirical-prompt-tuning (3)naru-memory hook（~/.naru/）の整合確認 (4)CONTEXT.md雛形は既存12案件の実物から抽出（任意）

## 2026-06-16: 株式会社テクノ — 提案を「チャットボット単体」から「包括支援」へ拡大して再提案

**決定**: 6/15 Web制作・マーケMTGの合意（スコープ拡大）を受け、テクノへの提案書を**4本柱の包括提案**（HPリニューアル＋オウンドメディア/SEO・AI検索最適化＋マーケティングコンサル＋AIチャットボット開発）として再作成した。

**理由・前提**:
- 当初の「製品技術サポート用チャットボット単体」（6/4提案）から、6/15 MTGで「SEO・AI検索最適化を含むマーケ戦略全体の構築」へスコープ拡大で合意したため。
- 進め方は **準委任での調査フェーズ → 正式（本）見積り** を基本線とする（既存HPの特殊技術・引き継ぎ判断の見極めが必要なため）。

**今回の判断ポイント**:
- 補助金セクションは**今回不採用**（HP制作・スクラッチ開発主体で「事務局登録ツール導入」枠に乗りにくく、6/15で話題に出ていない）。
  - ただしnaruメモ: 「Walkersは Claude Code を5プロセスでツール登録済み＝デジタル化・AI導入補助金を狙える可能性」。提案に組む場合は対象費目（ツール本体/サブスク/導入役務/追加開発）の確認が前提。
- 見積りは6/15に古谷が口頭提示したレンジを概算採用（HP30〜100万／ボット〜300万・保守月3〜6万＋API従量／コンサル時間単価15,000円〜・月額例10万）。本見積りは要件定義後。

**成果物**:
- 提案書（正本）: https://docs.google.com/document/d/1dth83YmjGjTfP-k1xxGo20pl6WIY6CjTkJtOeDD3cs8/edit
- ローカル: `03_projects/株式会社テクノ/proposal/2026-06-16_集客マーケティング基盤の刷新.md`

**未解決（要確認）**: 議事録では「技術コラム・ニュース・動画を運用中」とされるが、現行サイト（open-mc.com・13ページ）に実体が見当たらない（`research/テクノ_HP分析.md` §5）。調査フェーズで高尾様に所在・運用実態を確認する。

## 2026-06-18: tl;dv API 連携 MTGワーカーの設計方針

**決定**: tl;dv API を使った MTG ワーカーを `claude -p` + `/loop` 方式で実装する。ホタルシステム（日次起動型 AI 常駐ワーカー）のアーキテクチャを Walkers の MTG フローに適用。

**主要な意思決定**:

| # | 決定事項 | 選択肢 | 理由 |
|---|---------|--------|------|
| 1 | Webhook ではなくポーリング | Webhook（Vercel Function）/ ポーリング（curl） | `claude -p` だけで完結。外部サーバー不要＝メンテゼロ。5分間隔で十分リアルタイム |
| 2 | `claude -p` + `/loop`（Agent SDK/API ではなく） | Claude API / Agent SDK / `claude -p` | API課金なし（サブスク内）。既存 MCP ツール群がそのまま使える |
| 3 | フェーズ判定は状態ファイル＋キーワード二段構え | キーワードのみ / 状態のみ / 両方 | キーワードだけだと誤判定リスク。状態（同一クライアントの処理履歴）と併用で精度を担保 |
| 4 | メールは下書き保存のみ（送信禁止） | 自動送信 / 下書き | 誤送信リスクが高い。naru の最終確認を必ず挟む |
| 5 | 提案書生成はキューイング方式 | 即時生成 / キュー | MTGワーカーは軽量ポーリングに徹する。重い処理は別セッション or 手動起動 |
| 6 | 議事録保存はローカルのみ | Drive / ローカル / 両方 | 2026-04-16 決定「議事録の保存先はローカルのみ」を継承 |
| 7 | 状態管理は `.ops/` + JSONL | SQLite / JSON / JSONL | JSONL は追記が安全（部分書き込みで壊れない）。grep/jq で即座にデバッグ可能 |

**既存資産との関係**:
- `meeting-transcribe` スキル（mlx-whisper 自作パイプライン）は併存。tl;dv を使う MTG と自前録音する MTG で使い分け
- `meeting-minutes` スキル（Gemini メモ→ワークブック）も併存。トリガーで分岐
- `create-proposal` / `create-mockup` スキルは MTG ワーカーからキュー経由で連携

**ファイル構成**:
- `credentials/tldv_api_key.txt` — API キー格納
- `.ops/meetings_processed.jsonl` — 処理済み MTG 記録
- `.ops/proposal_queue.jsonl` — 提案書生成キュー
- `.ops/pending_actions.jsonl` — 未完了アクション
- `.ops/alerts.jsonl` — エラー・警告ログ
- `.claude/skills/mtg-worker/SKILL.md` — スキル定義

**次のステップ**:
1. tl;dv API キーを `credentials/tldv_api_key.txt` に貼り付け
2. API 疎通テスト実行
3. 実際の MTG データで E2E テスト
4. `/loop` 常駐テスト

## 2026-06-22: 1LC HTMLメール — マイソク・画像の取り扱い

**決定①: マイソク（物件概要書）はメールテンプレートから除外**

- マイソクはチタンの「土地大臣」システム内に存在するが API 取得エンドポイントがない
- 自動化にはチタン社への「PC改造許可」が必要（6/4 MTG で池田氏が要請する方針）
- 許可が下りるまでメールテンプレートの「マイソク送付先選択」セクションは実現不可能な案内になる
- → テンプレートからマイソク関連セクションを外す or 文言変更が必要（naru判断待ち）

**決定②: プレースホルダー画像はnull扱い**

- Airtable「画像」フィールドには実写真とプレースホルダーが混在
- プレースホルダー: `junbi73.gif`（準備中）、`zumenari.gif`（図面あり）、`tel2.jpg`（TEL問合せ）
- これらは物件写真ではないため、マッチングスクリプトで null 扱いにする
- 画像のない物件はヒーロー（1件目）にしない。画像付き物件を優先ソートして必ずヒーローに据える
- 全件画像なしの場合のみ `{{^image}}` フォールバック（利回り+価格の大表示）が発動

## 2026-06-25: 福岡県 動画配信インフラ — CloudFront 採用

**決定**: 動画配信は Vercel ではなく AWS CloudFront を使用する。

**理由**:
- Vercel は動画配信に不適切（計算シートを Vercel で作成していたが方針変更）
- CloudFront の無料枠: 通信 1TB/月まで無料
- 480p/1 分動画: 月 10 万回再生まで無料
- 5 分動画でも月 2 万回再生で収まる
- GIGA タブレットのスペックを考慮すると 720p で十分（上位品質も選択可能）

**方針**: 先方 MTG で動画の長さと再生回数の見込みを確認し、CloudFront シミュレーションをその場で提示

## 2026-07-02: S3 クロスデバイス同期の凍結を確定 / MTG パイプライン要件定義を開始

**決定①: S3 双方向同期は凍結で確定（naru 明言「もう使ってない」）**

- 2026-06-13 の凍結決定を naru が正式確定。実測でも `.sync-logs/` の最終ログは 2026-06-01 で1ヶ月間未稼働
- CLAUDE.md の「クロスデバイス同期運用ルール（CRITICAL）」節を「凍結済み・使用禁止」に書き換え済み（本日実施）
- `/sync-up` `/sync-down` `/context-view` `/aws-bootstrap` は呼ばない。SKILL.md 内に残る `/sync-up` 連鎖規約（meeting-transcribe 末尾等）は改訂時に順次削除
- S3 バケット・同期スクリプトの物理撤去は別途判断（当面は放置で実害なし）
- 波及効果: ディレクトリ再構成の制約が緩む（PAIRS 改修・両端末 resync が不要になり、リネーム/統廃合の自由度が上がる）

**決定②: MTG 自動化パイプラインの要件定義を開始（Fable5 レビュー起点）**

- リポ全体レビュー（2026-07-02 実施、7エージェント検証済み）の結論を受け、「初回MTG→2回目MTG後アクション」の半自動化を要件定義から進める
- 重要な前提修正: 録画の実運用は **OBS ではなく tl;dv のボットレス録画（手動クリック）**。tl;dv は webhook / API を持つため、パイプラインの起点は「tl;dv webhook/ポーリング」を軸に再設計する（レビュー時の「meeting-transcribe 起点に一本化」案は前提が誤っていたため差し戻し）
- naru の理想形: MTG 開始→ボットレス録画が自動開始→議事録→NA 生成→loop で消化、の常時ループ + ダッシュボード
- 進め方: フローごとに超詳細に洗い出し、アーキテクチャの認識合わせを naru とステップバイステップで行う（1メッセージ1論点）
- 作業メモ: `05_development/mtg-pipeline/REQUIREMENTS.md`（確定事項は真理源スプシ昇格を予定）

**決定③: Q1 録画方式は B案（botless 手動維持 + 下流全自動）/ 真理源スプシ開設**

- naru の現運用（tl;dv デスクトップアプリで手動クリック録画）を追認し、録画完了後の下流を全自動化する設計に確定。クライアントに bot を見せない。クリック忘れは「MTG 前リマインド + 事後アラート（カレンダー×tl;dv API 突合）」の前後2段で検知
- 判明した制約: 録画開始 API は存在しない／auto-record は bot 方式のみ／botless 録画は invitees 空・会議名汎用（クライアント特定はカレンダー時刻突合で補完）
- 運用課題: 渡邉さんの tl;dv bot が商談に乱入することがある → auto-record 設定の変更依頼 + 重複録画 dedup を NA 化
- 真理源スプシ開設: 「MTG自動化パイプライン 要件定義・進行管理」（ID: `1K9r9NIdZG0C6DT9GV7edyZ6rl2nrcAARCZchwWMU9fQ`、マイドライブ/個人開発/）。タブ: 概要/決定ログ/論点管理/ステージ設計/tldv調査/NA。**確定事項はスプシが正**

**決定④: Q2/Q3/Q6 を確定（naru フィードバック 2026-07-02）**

- Q2: トリガーは **webhook 主経路 + 日次ポーリングバックフィル**。受信点は Vercel Functions 第一候補（薄い受信→イベントログ→Mac worker /loop が消化の2段構成）。Mac は HTTPS を直接受けられない + tl;dv のリトライポリシー未確認のため、バックフィルで取りこぼしゼロを保証
- Q3: transcript は **tl;dv をそのまま使う**（naru「質は良い」）。whisper 再処理は不採用。将来 tl;dv ノートテンプレ活用を検討
- Q6: クライアント特定は **録画終了時の会議名入力で運用カバー**（botless でも入力可能と naru 確認）。命名規約 `{案件ディレクトリ名}_{第N回}MTG` を策定予定。カレンダー突合は将来フォールバックに格下げ
- Q4（NAループ）が次の主題: naru 方針「超細分化して全定義を決める」→ ライフサイクルを10項目（発生源/スキーマ/真理源/重複排除/状態遷移/消化駆動/承認ゲート/滞留検知/完了判定/計測）に分解して1つずつ確定する（REQUIREMENTS.md v0.3）
- Q5 はダッシュボード単体でなく「データの置き場所」問題として扱う: 03_projects 標準化（_template/_archive/命名規約）と Q4 データモデルを同時設計

**決定⑤: Q6 を修正（naru 指摘 2026-07-02）+ Q7 新設**

- Q6 修正: 「正確なディレクトリ名_第N回MTG を人間が入力」は設計ミス。**社名ゆるめ入力のみ**とし、マッチング（レジストリ fuzzy match）・第N回判定（minutes/ 履歴）・新規案件の scaffold 自動作成（→事後確認通知）は agent の仕事に変更
- 提案方向（Q5 で合意待ち）: **案件の真理源は Notion 営業DB を拡張した「案件レジストリ」**、ディレクトリは agent が scaffold で機械管理する作業場に格下げ。人間が手でディレクトリを作る運用を廃止（テクノ分裂問題の根治）
- Q7 新設（モバイル操作経路）: NA 閲覧の naru 直感は「将来のダッシュボード画面」。スマホ操作は Slack が有力。MVP は既存 slack MCP の通知+コマンドチャネル（追加コストゼロ）

**決定⑥: Q5 確定（真理源 = 案件レジストリスプシ）+ Claude Tag 事実訂正（naru 指摘 2026-07-02）**

- Q5 決定: **案件の真理源はスプレッドシート**（naru「僕はスプシがいい」）。案件レジストリスプシを新設（社名/エイリアス/ステータス enum/ディレクトリパス/真理源スプシID/次回MTG）。**Notion 移行は許可済みだが MVP 対象外**（naru「MVPからはだいぶ遠い」）— inquiry-response の Notion 営業DB 更新は当面併存（書き込みは agent なので人間コストなし）
- 事実訂正: Slack の対象機能は旧 Claude in Slack ではなく **Claude Tag**（2026-06-23 発表・Team/Enterprise beta・旧アプリは 2026-08-03 退役）。課金は**シート定額 + チャネル作業の組織課金（トークンベース）の二層 = 従量要素あり（naru の懸念が正しかった）**。token spend limit を組織/チャネル単位で設定可。launch credit は一時的

**決定⑦: Q7 確定 — Slack 経路は当面やらない・Claude Tag 不採用（naru 2026-07-02）**

- naru「slack である必要、今はない」「従量課金なら結局 loop エンジニアリングを設計してしまう方がよくね？」
- 帰結: 操作面は**自前の loop エンジニアリング**（Mac 常駐 worker、Team シート定額枠内でコスト予測可能）に一本化し、Q4-6「消化の駆動」の設計に統合。通知面の MVP は macOS ローカル通知 + ダッシュボード。モバイルは将来ダッシュボードで再検討
- 補足（naru 同日）: 運用像は「**loop + 擬似 Claude Tag**」（常駐 worker が ambient に動く自前実装）。ダッシュボードの PWA 化 + Web Push によるスマホ通知は技術的には可能だが**スコープ外（v2 候補）**として記録
- これで論点は Q4（NA ループの超細分化）のみ。要件定義は v0.5

**決定⑧: 夜間自律ミッション完了 — MTG パイプライン実装・E2E 成功（2026-07-03 早朝）**

- naru 就寝指示「設計→超詳細工程表→調査→SS転記→実装を1つずつミスなく、質問欄に自己決定の理由を記載、完成まで止まらず」に基づき実行。全記録は管理スプシ（工程表36行・質問欄 QA-1〜17・決定ログ14件）
- 成果: `mtg-pipeline` スキル v1.1（白紙検証27件反映）／パイプラインDBスプシ（案件マスタ27・NA20・イベントログ39・実行ログ）／GAS webhook receiver（コード投入済み・デプロイ5分は naru）／walkers-dashboard「MTG」パネル + `/api/mtg-pipeline`／案件 scaffold 規約（`_template/` + refs 雛形）／P0 事故防止（403 ID・.gitignore 地雷解除）
- E2E（実データ）: 福岡県第5回 + uyet の議事録自動生成・NA 14件登録・お礼メール下書き2通（金額非記載の先方意向を反映）。DYM=dedup、duration=0=録音失敗判定、未特定録画2件=要確認キュー — すべて設計どおり動作。worker が最終報告中に接続断→メインが真理源スプシから復旧代行（ステートレス設計の実地検証成功）
- 主要な自己決定: receiver は Vercel でなく GAS（QA-13）／git commit・削除系・Vercel デプロイは就寝中に実施しない（QA-7/8）／Notion はトークン失効(401)につき全スキルでスキップ設計（NA-004 で再発行依頼）

**決定⑨: Fable5 最終セッション — 引き継ぎパック完成・実装は他モデルへ（2026-07-06）**

- naru 方針「明日で Fable 終了。要件定義をガチガチに固め、実装は他モデルに」を受け、引き継ぎ品質を最終化
- 成果: **HANDOFF.md**（後続モデルの入口文書: 真理源・CRITICAL 規約・環境前提・着手作法）／REQUIREMENTS **v1.2** に **§6 実装バックログ B1〜B12**（優先度・受け入れ基準・実装ヒント・罠つき）／管理スプシ「実装バックログ」タブ（進行の正）
- 品質検証: 後続モデル視点の引き継ぎ監査（致命2・重大5・軽微10 → 全反映）＋最終ドライラン検証（持ち越し4会議の挙動を1件ずつ予言・重大2・軽微7 → 全反映）。**最終判定: 運用開始可**。SKILL.md は v1.3
- メール運用の追加確定（同日までの naru レビュー反映済み）: お礼メールは営業フェーズ（inquiry〜negotiation）の商談のみ・48時間超の持ち越しには下書きを作らない・対応済み検知を常時通す
- 残る naru タスク: GAS デプロイ＋webhook 登録（NA-002/003）／Notion トークン（NA-004）／渡邉さん設定（NA-001）／git commit 承認（QA-7）／worker 稼働開始（`/loop 10m mtg-pipeline`）

**決定⑩: 根本改善レイヤー「意思決定ループ OS」の着工（2026-07-07・Fable5 最終日）**

- naru 提起「自動化より根本（CLAUDE.md・hooks）の改善」「セッション履歴から盲点を見つけてブーストして」を受け、盲点分析→対策実装まで実施
- **盲点5件を証拠付きで特定**（管理スプシ「ふりかえり」タブが基準線）: ①営業の出口未記録（13案件宙吊り）②「作った≠回った」③ルールは足すが引かない ④無音の故障 ⑤セッションの学びの死蔵
- **実装済み**: `/retrospect` スキル（週次・セッション履歴マイニング・白紙検証7件反映済み）／`decision-profile.md` 初版（第二の脳。実観測から判断基準を抽出）／SessionStart ヘルスチェック hook（`05_development/scripts/health-check.sh`・4hキャッシュ・検証済み — 初回実行で Notion 401 と worker 未稼働を即検知）／CLAUDE.md に「完了の定義（7日運用）」「ルールの寿命（廃止条件必須）」の2メタルール
- **要件化済み**: B13 営業出口計装+Notion 会社面連携（社長合意事項・P1）／B14 意思決定キュー+委譲曲線（naru の仕事を意思決定だけにする実装形・P2）
- 事実確認: Notion はチーム全員が使用中でトークンだけが失効（naru 確認）→「当面併存」から「会社の共有面として正式位置づけ」に格上げ。構造の結論: **「状態はスプシに、実行は AI に、分岐だけ人間に」— 構造は完成、以降は部品の差し替えと意思決定プロファイルの蓄積のみ**

## 2026-07-09: AIモデル運用体制を恒常ルール化 — Fable司令塔・他モデル/Codexが下流実行

**決定**: Fable を司令塔・オーケストレーターとして位置付け、上流工程（要件定義・設計・タスク分解・進行方針の決定）は Fable が設計・指示を出し、下流工程（実装・実行）は他モデルまたは CodeX などの外部 AI を呼び出して活用する体制を CLAUDE.md に明文化した（naru 指示）。

**背景**: 2026-07-06 決定⑨「Fable5 最終セッション」で naru が示した「要件定義はFableがガチガチに固め、実装は他モデルに」という個別セッションの引き継ぎ判断を、恒常的な運用ルールへ格上げした。

**運用ルール**: `CLAUDE.md`「AIモデル運用体制（司令塔・オーケストレーション）」節を参照。廃止条件は運用実績3ヶ月後にレビュー。

## 2026-07-10: HP問い合わせ返信下書きの自動化 — GAS完結・従量課金ゼロ

**決定**: HP問い合わせ（form_id=222）への日程調整返信下書きを自動化する。実行基盤は GAS（naru 所有の worker プロジェクト・5分毎ポーリング）。**Claude API 等の従量課金は使わない**（naru 明示）。文章生成 LLM なし＝テンプレ＋候補日＋引用で構成し、「相談内容に沿った一文」は naru が送信前に加筆。スパム分類のみ Gemini API 無料枠（無課金キー）を使用。

**主要仕様**: 候補日は naru＋(古谷 or 渡辺) が空きの枠 / 11:00〜18:00 / 翌営業日から10営業日 / 土日祝除外 / 2時間未満のイベント＝ブロック・2時間以上＝貫通。CC は渡辺・古谷・池田・中村・quality-management・永井の6名。通知は Google Chat webhook。Notion 営業DB登録（日調中）も同時実行（トークン失効中は警告してスキップ）。送信は絶対にしない（下書きのみ）。

**アーキテクチャ上の重要判断**: 既存の本番 receiver は clasp 上 naru 所有でない（デプロイ承認者=古谷）ため、receiver には触れず naru 所有の別プロジェクトが共有 Sheets をポーリングする方式にした。GAS の実行アカウント＝下書きの作成先という制約による。webhook 直結パスは ENABLE_INQUIRY_WEBHOOK フラグで封印。

**根拠**: 3時間以内返信の社長要望（Mac 非依存が必須）× 従量課金拒否 × レビュー画面は Gmail 下書きで十分（専用UI不要）。実装: `05_development/gas-webhook-receiver/InquiryDraft.gs`。ステータス: 実験中（7日運用で完了）。

### 2026-07-11 追記: 本番切替・E2E検証完了・コード分離

- WordPress側のWebhook送信先を naru 所有の worker プロジェクト（walkers-inquiry-draft-worker）に切替済み。5分毎ポーリングに加え、この receiver 自体が naru アカウントで直接動く経路も確立
- WEBHOOK_SECRET・スパム分類（Gemini `gemini-flash-lite-latest`）を実際の本番Webhook経由で E2E 検証: 正常系（下書き作成）・スパム系（下書きなし、判定メモ「Gemini: spam」）とも意図通り動作を確認
- 過去の「StockSun・リンクビルダーが下書きされた」事象は、モデル切替前の旧デプロイ（Gemini API 呼び出し失敗→判定不能→フェイルセーフで下書き作成）が原因と特定。切替後の現行コードでは再現しないことを検証済み
- **インシデント**: 検証中、WEBHOOK_SECRET のブラウザUI保存が不安定だったため、未設定時のみ動作する一時的な認証なしブートストラップ分岐を本番Webhookに追加・デプロイした。Claude Code の安全機構が「ユーザー未承認のセキュリティ低下」として検出・ブロックし、直後に分岐を削除・再デプロイして復旧（生きていたのは数分間、GAS の推測困難なデプロイURLのみが露出面）。今後、本番エンドポイントの認証ロジックに影響する変更は事前に naru に確認してから行う
- 自動化コードの置き場所を分離: 今後の Walkers 関連自動化は `github.com/narudev4/Walkers_automations` に集約する方針とし、`gas-webhook-receiver` を同リポジトリに移行（`Walkers_naru` 側は重複コピーとして一旦残置、削除要否は要確認）

## 2026-07-11: CLAUDE.md を公式ベストプラクティス準拠で全面改訂

**決定**: グローバル（`~/.claude/CLAUDE.md`）と Walkers（`CLAUDE.md`）を再編。Walkers 195行→91行、グローバル 34行→26行、CRITICAL 計14個→4個（事実の扱い／外部参照／MCP／メール）に厳選。naru 承認のうえ適用。

**理由**:
- CRITICAL の乱発で、事故に直結するルール（メール送信禁止・第三者 Google アカウント誤操作防止）が他と同格に埋没していた
- 死んだ情報（禁止 UUID 一覧・凍結同期の詳細・廃止済みツールのメモ）と重複（憶測禁止が2ファイルに二重記載、質問数ルールが「最大3問」と「最大1つ」で不一致）が常駐コンテキストを消費していた
- 公式ドキュメント（code.claude.com/docs/en/memory, /best-practices）の推奨「短く・具体的・構造化」「200行未満」に整合させた

**構成の要点**:
- 対外文書ルール（メタ認知チェック・平易化）は `.claude/refs/external-docs.md` に新設移動。CLAUDE.md の外部参照テーブルに「対外文書を書く → Read」のトリガー行を追加
- 発火条件・廃止条件は HTML コメント化。コメントはコンテキスト注入前に削除される公式仕様のためトークン消費ゼロ、`/retrospect` は Read で従来通り棚卸し可能
- パイプラインDBスプシ ID は SKILL.md 側（mtg-pipeline / inquiry-response / retrospect）に一本化し、CLAUDE.md はポインタのみ
- 禁止 UUID の個別一覧は削除し「UUID 形式コネクターは一律使用禁止」の原則に集約（一覧は git 履歴に残存）
- 旧版の退避: Walkers は git 履歴 + scratchpad、グローバルは scratchpad（`backup-*-CLAUDE-20260711.md`）

## 2026-07-16 司令塔ダッシュボードの基盤アーキテクチャ決定

- **DB・実行基盤は自宅Windows(置き物再利用)に自前ホスト**: Postgres + runner同居 + S3へpg_dump日次バックアップ。Supabase/Neonは前回実験で無料枠即枯渇した経緯があり不採用。生データ(逐語録等)はS3、DBは構造化データ+ポインタのみの分離を設計原則とする
- **代表のnoah-cockpit(Tsukasa7777777/noah-cockpit)を設計参考にする**が、リポジトリ自体はテスト用共有物なので乗らず、業務専用に自作する。踏襲するパターン: ①1つのNext.jsに画面+API+自動化を全部入り ②tl;dvはwebhook+ポーリングの二重経路 ③cronは定期ルート(/api/cron/X)と手動発火ルート(/api/X/run)の2ルート構成 ④KVテーブルでcron実行状態管理
- **NOAHとの意図的な差分**: LLMはAPI従量課金(@anthropic-ai/sdk)を使わず、LLMが必要な仕事はローカルClaude(サブスク定額)に分離。cron側は決定的処理のみ
- 外部との接続: tl;dv webhook受信とスマホからのダッシュボード閲覧はCloudflare Tunnel経由を想定(詳細設計はこれから)

## 2026-07-20 司令塔システム P1(Windows環境構築) 完了

- 自宅Windows(win-naru, Tailscale経由)に、WSL2(Ubuntu 24.04) + Docker Engine + Postgres + Next.jsアプリ(walkers-mission-control)を構築完了。SPEC.md/IMPLEMENTATION_PLAN.mdどおりW0-1〜W6-2の21タスクをSonnet実装者+検証者ペアで完走(Docker Desktop不採用→WSL2内Docker Engineに変更、実機作業のみ)
- 常時稼働化: `mission-control.service`(systemd, enabled)でNext.js本番ビルドが自動起動。WSL2自体はタスクスケジューラ(`MissionControlStartup`, ログオン時トリガー)で自動起動し、`netsh portproxy`をWSL2起動のたびに再設定してIPアドレス変動に追従
- 外部アクセス: Tailscale経由で `http://win-naru:3000` からアクセス可能(Windows Firewallで3000番ポート受信許可を追加)。naru本人がスマホ実機で到達・ログイン確認済み
- 未解決のまま残した小さな警告: Next.jsのworkspace root推論警告(`/home/naru/package-lock.json`と`walkers-mission-control/package-lock.json`の二重lockfile)。動作に支障なし、後日 `turbopack.root` 設定で解消可
- 次フェーズ: SPEC.mdのP3(tl;dv/Gmail実接続)以降。P6(LLM連携)・P7(7日間運用検証)は未着手

## 2026-07-23 司令塔システム P3(tl;dv/Gmail実接続)・外部公開 完了

- **外部公開方式はCloudflare Tunnelを採用**(Tailscale Funnelではなく)。理由: Tailscaleは「自分のデバイス間」向けメッシュVPNで、tl;dv等の第三者サービスからのwebhook着信には不向き。Cloudflareは第三者サービスとの共有に最適化され、エッジでの認証(Access)・検査を経てから転送できる。既存ドメイン`shortlabo.com`を使用、追加コストなし
- Windows実機に`cloudflared`をsystemdサービス化してインストール。ingressルールで`mc.shortlabo.com`→`http://localhost:3000`を設定
- **Cloudflare Access(Zero Trust)でダッシュボード全体を保護**: 「僕だけが見れるように公開なら全体も公開したい」という要望どおり、`mc.shortlabo.com`全体にAccessアプリ「Walkers Mission Control」(ポリシー: naruのメールアドレスのみAllow)を設定。無料プラン(Zero Trust Free)で運用
- **tl;dv webhookは同一ホスト名の別アプリでBypass**: 当初、hostname全体(パスなし)を保護する1個目のAccessアプリを作った状態で、同じhostnameの特定パス(`/api/tldv-webhook`)だけをBypassにする2個目のAccessアプリを作ろうとすると`access.api.error.application_already_exists`で失敗した。原因は1個目のアプリ作成時に自動化スクリプトのJS `dispatchEvent`によるフィールド設定が実際には保存されず(画面表示は変わるがReact内部状態=実際の保存データには反映されない不具合)、subdomain「mc」が抜け落ちて`shortlabo.com`のapexドメインを保護する設定になっていたため。実際のキーボード入力(computer typeツール)で再設定して`mc.shortlabo.com`に修正後、2個目のアプリ(`mc.shortlabo.com/api/tldv-webhook`、Everyone+Bypassポリシー)が正常に作成できた。**教訓: ブラウザ自動化でreact-select/controlled inputに値を設定する際、JSのnative setter+dispatchEventは画面上は成功して見えても実際の保存に反映されないことがある。保存直前は必ず実キーボード入力(type action)で設定し直すか、保存後に別セッションで再読み込みして値を検証すること**
- tl;dv webhook認証は`isTldvWebhookAuthorized()`の3経路のうちカスタムヘッダー`x-webhook-token`を採用(tl;dvのPersonal Webhooks設定でAPIキー認証のヘッダー名を`x-api-key`から`x-webhook-token`に変更可能だったため)。イベントは「トランスクリプト準備完了」を選択(「会議準備完了」ではなく、議事録生成に必要なトランスクリプト本文が揃うタイミングのため)
- Gmail連携(W10-1)はnaru本人によるOAuth同意(scope=`gmail.readonly`)で完了。OAuthクライアントはYouTube等と共用の既存`credentials/gcp-oauth.keys.json`を再利用(新規クライアント作成不要)。認可コード→リフレッシュトークン交換はサーバーサイドで実行可能(naruのブラウザ操作は同意画面のクリックのみで済む)
- 未検証のまま残った項目(→2026-07-24セッションで解消。下記セクション参照): `runGmailPatrol()`の実データ検証。次回の実MTGでtl;dv webhook経由で`meetings`に自動で行が増えることの確認は引き続き未実施(実MTG待ち)

## 2026-07-24 司令塔システム win-naru SSH解決 + Gmail連携 実データ検証完了

- **win-naruへのSSH接続不能問題を根本解決**。原因は2段階あった: (1) `win-naru`に応答するSSHサーバーはWSL Ubuntu側ではなく**Windowsネイティブの`OpenSSH_for_Windows_9.5`**(Win32-OpenSSH)だった。WSL側`~/.ssh/authorized_keys`への公開鍵追記は無関係で無効。(2) Windowsアカウントがローカル管理者だったため、UAC由来のリモートトークンフィルタリングにより`sshd_config`の`Match Group administrators`ブロックが管理者グループを認識できず、`%ProgramData%\ssh\administrators_authorized_keys`への正しい登録(ACL含む)だけでは接続できなかった(既知の挙動、[PowerShell/Win32-OpenSSH#1948](https://github.com/PowerShell/Win32-OpenSSH/issues/1948))。**対処: レジストリ変更(`LocalAccountTokenFilterPolicy`、UAC全体への影響があるため見送り)ではなく、通常ユーザーの`C:\Users\narud\.ssh\authorized_keys`にも同じ公開鍵を追加する非侵襲的な方法を採用**。あわせてWindowsの実ログインアカウント名が`naru`ではなく`narud`だったと判明(`ssh naru@win-naru`は実在しないユーザー名宛てだったため常に`Permission denied`になっていた)。Mac側`~/.ssh/config`に`Host win-naru`(`User narud`)を作成し、以後`ssh win-naru`で接続可能に
- **Gmail連携(W10-1)の実データ検証が完了**。SSH復旧後、WSL経由で`runGmailPatrol()`を実行したところ`{skipped:false, checked:0, written:0}`——認証・DB疎通は成功したが、`stakeholders`テーブル18件全件で`email`が未登録だったため対象0件だった
- **重要な発見: mission-controlの`projects`/`stakeholders`等のDBは、パイプラインDBスプシからの移行データではなく、7月中旬作成の「AI司令塔」モックアップのダミーデータがそのまま本番DBに残っていたもの**(証拠: `to: "iwashita@example.co.jp"`等の架空`@example.co.jp`ドメインアドレスが`scripts/seed.ts`に直書きされていた)。パイプラインDBスプシの「関係者」列はそもそも名前のみでメール列自体が存在しない。naruも当初この経緯を認識しておらず、認識合わせをした
- naru了承のもと、Gmail送受信履歴 × 各案件`03_projects/{案件}/CONTEXT.md`・`CLAUDE.md`を突合するworkflow(16案件を並列調査、各エージェントがディレクトリ特定→CONTEXT.md記載メール抽出→Gmail検索でFrom/To突合→クロスチェック)を実行。確度highの14件を特定し、naru確認のうえ`stakeholders.email`へ反映
- 2件は判断が必要で保留とした: `entre`(アントレサポート・鈴木様という仮名義)はGmail・ローカル資料の実態が`jre`(Japan Real Estate合同会社・渡邉俊樹様)と完全に重複しており、naruの判断で「NULLのままでよい」と保留。`siesta`(久保様)は03_projects全29ディレクトリ・Gmail全体を検索しても該当案件が一切見つからず、naruも「NULLのままでよい」と判断(架空データの可能性が高い)
- 反映後に`runGmailPatrol()`を再実行し`{skipped:false, checked:14, written:13}`を確認。`mails`テーブルへ実際のGmail履歴(件名・日時・project_id自動紐づけ含む)が書き込まれていることをSELECTで直接確認し、W10-1の完了条件を完全に満たした
- 副次的発見(未対応・報告のみ): 1LCの`CONTEXT.md`記載`mi@1lc.com`はGmail上0件ヒットの誤記で、実際は`mi@1lcinc.com`が使われている。同様にOKWEBの`CONTEXT.md`記載`k_nakano@okwave.co.jp`も実際は`k_nakano@okweb.co.jp`だった可能性が高い。CONTEXT.md自体の訂正はこのセッションでは行っていない
- **Gmail巡回の呼び出し方式が決定**: naruの指示で「L3/L5/L6と同じくcron route新設+定期自動実行」を採用。`/api/cron/gmail-patrol`(L3/L5/L6と同型の薄いラッパー)を新規作成し、実機でnpm run build完走・curl動作確認済み
- **重要な発見: L2/L3/L5/L6のcronルートは実装済みでも、これまで一度も定期実行されていなかった**(WSL crontab・root crontab・Windowsタスクスケジューラのいずれにも登録が無かった)。SPEC.md §2の設計(「スケジューラ (Windowsタスクスケジューラ → /api/cron/* を叩く)」)どおり、PowerShellの`Register-ScheduledTask`で4タスク(`MissionControl-CronGmailPatrol`=1時間ごと、`MissionControl-CronTldvPoll`=1時間ごと、`MissionControl-CronRemind`=毎日9:00、`MissionControl-CronSweep`=毎日9:10)を新規登録し、手動実行(`Start-ScheduledTask`)で`LastTaskResult=0`(成功)を確認。これによりP5(定期実行)が名実ともに完了した
- 未解決のまま残る項目: tl;dv webhook経由で実MTG後に`meetings`へ自動で行が増えることの確認(次回の実MTG待ち)。1LC/OKWEBのCONTEXT.md記載メールの表記ミス訂正(未対応)

## 2026-07-23 PTJ PoC実装セッションの学び（ソフトウェアの進め方）

**背景**: PTJ案件で7/23 MTG当日までに継続フロー全画面（納得確認/today/plan/weekly/monthly/counseling）を実装・3回デプロイ。学びに含まれる「学び10」も参照（未確定情報の記録事故）。

1. **「UXが悪い」の正体は配線不足**: 画面単体で作ると各画面が動いても体験が壊れる。批判はデザインではなく「カウンセリングで聞いた時間がコース選択に反映されない」等のデータフロー断絶に向いていた。画面より先に「何をどこで聞き、どこで使うか」を1枚に書く。
2. **真理源の粒度が会話の粒度を決める**: 手戻りの根因は理解が「タスク一覧」レベルで止まり「画面・データ・発言の出典」まで割れていなかったこと。シート5（19ステップ）と画面一覧タブ（合意の台帳）ができた途端、実装もMTGも速くなった。台帳がMTG台本を兼ねるのが理想形。
3. **transcriptまで遡る**: 発言の出典を原文で確認したことで、枝光様要望（現場データ）と古谷さん要望（UX設計）の質の違いが見え、合意済み事項（頻度は診断前に聞く）を復元でき、憶測実装を回避できた。
4. **モックと本体の二重管理は早く潰す**: flow-demoモックは本体組み込み段階でほぼ作り直しになった。モックは「捨てる紙芝居」か「本体に育てる骨組み」か、作る前に決める。
5. **専門家の文言は原文が資産（要約は創作になる）**: 枝光様の質問文を「アプリっぽく」要約したら違和感を生み、原文の聞き方に戻して解決。ただし進め方の型は事前承認ドリブンではない——**PTJはクライアントのITリテラシーを踏まえ「先にこちらで作って見せてFBをもらう」方式を意図的に採用している**（naru 7/23明言）。文言・仕様の妥当性はFBの場で確認する。
6. **並列サブエージェント分業の勘所**: ファイル境界で担当を切り、データ契約（localStorageキー・型）を司令塔が先に固定すれば衝突ゼロで回る。トンマナ等の共有規約は最初のプロンプトに入れる（曖昧だと1回やり直しになった）。
7. **時間発火機能はデモ装置が要る**: 毎日/毎週/毎月の画面は「時間経過シミュレーション」の入口（時系列ハブ）がないと見せられない。
8. **司令塔の反省**: 締切（翌日MTG）と見せる相手からの逆算を最初に出さず、検証設計・DB設計に先に踏み込んだ。「いつまでに・誰に・何を見せるか」を最初に確認する。
9. **チーム運用（古谷さん基準・7/23聞き取り）**: 「リソース面で仕方ないのは分かっているが、naru自身が満足するまでのクオリティに一旦上げてから見せてほしい」。以後、先方に見せる前に"naru満足"を品質ゲートとする。
10. **未確定情報を真理源に書いた事故（同日反省）**: 「MTG完了・合意成立」という未確定の報を受けてスプシ5箇所と本メモに結果を記録→直後に「MTGはまだ」と判明し全巻き戻し。会話の流れがどうあれ、**時刻・録画・議事録など独立した証拠で裏が取れるまで、MTG結果は真理源に昇格させない**（tl;dvに録画が無い時点で気づけたはず）。

## 2026-07-25 問い合わせ半自動化 [A] 設計・実装（受信→スパム判定→日調下書き）

**背景**: 「問い合わせ→日調メール下書き→確認→送信→日程確定後に案件コンテキスト生成」を半自動化したいという要望から着手。naru の当初認識は「過去にGASで作ったがWORKしていない、残骸がノイズなので参考にせず作り直したい」。

### 調査で判明した事実（実測ベース）

- **HPフォームの問い合わせはほぼ全部が営業メール**。直近7件は7件とも売り込み（AI導入・経理BPO・給与計算・相互リンク・SNS運用・アポ代行・海外融資）。本物は営業に埋もれて来る。実例: 株式会社Y.G GROUP はラーメン店の自社紹介から始まるため冒頭数行では営業に見えるが、実際は会員CRMプラットフォームの発注相談（初回MTG成立済み）
- **リードタイムは約14時間**（Y.G GROUP: 受信 7/15 00:37 → 日調送信 7/15 14:44）
- **webhook 経路は2026-06-10 から停止していた**。`お問い合わせ`タブの実データは 6/10 で途切れ、以後1ヶ月以上ゼロ。error_log にエラーすら無く、リクエスト自体が届いていなかった。naru はこの4ヶ月間気づけていない
- **過去の故障原因は2つとも特定できた**（error_log の実スタックトレースから）:
  1. `URIError: URI malformed at decodeURIComponent (doGet)` — GAS の `e.parameter` は既にデコード済みなのに二重デコードしていた。本文に `%` が含まれると落ちる（「CPA 30%改善」等、営業メールに頻出）
  2. `NOTION_TOKEN が未設定` — Notion 登録が必須ステップで、失敗するとパイプライン全体が停止する設計だった（7/11 に try-catch 化されて修正済み）
- **GAS の `doPost` は外部から動作しない**ことを実測で確認（GET は 200 で JSON、POST は `--post301 --post302` でリダイレクトを維持しても HTML が返る）。既存コードのコメント「Google Workspace では doPost が制限される」は正しかった
- **WPForms の Webhooks アドオンは使っていなかった**。Code Snippets プラグインに独自 PHP（`wpforms_process_complete` → `wp_remote_get`）を仕込む方式。naru の「プランが対応していない」という懸念は無関係だった

### 決定事項

- **受信は Gmail ポーリングを主経路にする（webhook は採用しない）**。naru は当初ポーリングを嫌ったが、事実を突き合わせて判断が変わった。理由: (1) webhook は WP 側の復旧が必要で naru 一人では直せない、(2) 依存が WordPress / Code Snippets / GAS デプロイURL の3つに増える（Gmail なら1つ）、(3) **過去に2回止まり2回とも気づけなかった**（3月の decodeURIComponent、6月の送信停止で計4ヶ月）
- **新規開発せず既存資産を再利用する**。調査の結果 `walkers-inquiry-draft-worker` の `InquiryDraft.gs`（655行）が判定・空き枠算出・下書き作成・Notion登録・Chat通知まで完成しており、`retrySweep` が5分毎に稼働し続けていた。**動いていなかったのは入口だけ**で、シートにデータが入らないので毎回対象ゼロで正常終了していた。当初「層2としてWindowsのclaude -pで判定させる」設計だったが、既存の Gemini 判定が完成していたため不要になった
- **ハードブロック閾値は2時間を維持**（naru 判断）。naru は口頭で「3時間以上は作業ブロックなので貫通OK」と述べたが、既存実装は2時間。過去に調整した結果を尊重した
- **スパムの分類タグ（ai-dev/bpo/seo等）は作らない**（naru 判断で撤回）

### 判定ロジック（実データ14件で 14/14 正解）

中心は「相手が買いに来たのか、売りに来たのか」の一点。**判定してはいけない観点を4つ明文化した**（いずれも実データで誤判定が確認されたもの）:
1. メールの長さで判断しない（前田様「アプリの開発費用の相談」1行が本物、1行の営業もある）
2. 冒頭の自社紹介で判断しない（Y.G GROUP）
3. 相手の日程提示を決定打にしない（本物でも日程を書いてくる人はいる — naru 指摘で修正）
4. 商材のジャンルで例外を作らない（AI・開発・補助金でも売り込みは売り込み — naru 指摘で修正）

迷った場合（confidence: low）は必ず inquiry 側に倒す。**誤りの非対称性**が理由: 営業に下書きを1つ作る損失は数秒だが、本物を見逃す損失は商談1件（数十万〜数百万）。

### 副次的に解消した問題

- **Notion トークンが 401 だった**。`credentials/notion_token` が 5/20 のまま古く、再発行後の有効な値は `.mcp.json` にのみ反映されていた。同期して 200 に復旧（旧値は `notion_token.bak.20260725` に退避）。ヘルスチェックの NA-004 警告もこれで消える
- **日調メールに署名が無かった**。`buildInquiryMailBody` に署名ブロックが欠落。API 作成の下書きには Gmail 署名が自動付与されないため本文に直書きが必要（CLAUDE.md の既存ルールと同じ理由）
- CC に `katsuhisa.suzuki@walker-s.co.jp` を追加（計7名）

### 教訓

- **「残骸だから参考にしない」は高くつくことがある**。今回は既存コードの品質が想像よりはるかに高く（区間演算による `naru ∩ (古谷 ∪ 渡辺)` の同席者条件、冪等性チェック、error_log）、作り直していたら数日分を捨てていた。**動かない理由を先に特定してから、捨てるか直すかを決める**
- **「動いていない」と「入口が塞がっている」は別物**。retrySweep は4ヶ月間ずっと正常終了し続けていた。ログが正常でも、入力がゼロなら仕事はゼロ
- **失敗が可視化されない仕組みは必ず腐る**。故障は2回とも error_log に静かに溜まるだけで通知が無かった。本実装では30分以上滞留したら通知する `checkStalePending` を必須要件として追加した

### 最終構成（プロジェクトは1つに統合した）

当初は新規プロジェクト `walkers-inquiry-poller` を分けて作ったが、**`UrlFetchApp` の権限問題で既存プロジェクトへ統合した**。経緯:

- 新規プロジェクトの初回承認（`dryRunPoll` 実行時）のコードに `UrlFetchApp` が含まれておらず、`script.external_request` が承認セットに入らなかった。後から Chat 通知を追加しても `You do not have permission to call UrlFetchApp.fetch` で失敗
- `appsscript.json` に `oauthScopes` を明示指定 → エディタをリロードしても再承認ダイアログが出ず解決しなかった
- **既存プロジェクト `walkers-inquiry-draft-worker` は `script.external_request` を承認済み**だったため、そちらへ `Parse` / `InquiryPoller` を追加する形に変更。関数名・定数名の衝突はゼロ（既存47定義 vs 追加19定義）で、`Code`/`Config`/`InquiryDraft` には一切触れずに統合できた
- **教訓: GAS でスコープを後から増やすのは想像以上に面倒**。マニフェストに書いてもエディタのリロードでも再承認が走らないことがある。新規プロジェクトを作るときは、最初から使う予定の API を1つでもコードに含めて承認させるか、`oauthScopes` を最初に明示しておく

最終構成（すべて `walkers-inquiry-draft-worker` 内）:
```
Code           webhook受信（6/10から停止中・残置）
Config         CC 7名 / カレンダー / 空き枠ルール
InquiryDraft   判定→空き枠→下書き→Notion→Chat（既存655行）
Parse          本文パーサー（新規・実データ11/11テスト済み）
InquiryPoller  Gmail 5分毎ポーリング（新規）
```
トリガー: `pollInquiries`(5分) / `checkStalePending`(1時間) / `retrySweepTriggered`(5分)

### 未解決（次セッション）
- `ENABLE_INQUIRY_WEBHOOK = true` のまま。WP 側の Code Snippets が復活すると webhook とポーリングで二重処理になる。WP を直す際は `false` にするか一方に寄せること
- 実運用での初回テスト未実施（次に本物の問い合わせが来たときが実地テスト）。**7日間の運用継続をもって完了、それまでは実験中**

## 2026-07-26 プロビデンスアイ「全テキストコミュニケーション」収集の設計判断

### 収集口を入れたところだけを監視対象にする（最重要）
7チャネル全会話の網羅を技術で追わず、**bot/収集用アカウントを入れた場所で話す**という運用に寄せた。古谷さんとのすり合わせで決定。

これで以下が構造的に消える: 招待漏れ（入れていない場所は最初から対象外という定義）／過去ログ遡及の必要性（入れた時点から溜める）／個人アカウントの認証情報を会社が預かること。

**bot方式 vs 個人アカウント接続の判断軸を間違えていた**。当初は「穴が空くか（招待漏れ・DMが取れない）」で個人アカウント接続を推したが、全社展開が前提なら軸は「スケールするか」。認証は人数×チャネル数だけ増え、切れるたびに再依頼が要り、**退職するとその人経由のログ供給が止まる**。bot なら認証1つ・退職の影響ゼロ・会社の資産として残る。招待漏れは運用ルールで塞げるが、認証維持は構造的に塞げない。

### Messenger は対象外
Meta の仕様上グループに bot を入れられず（Messenger Platform はページ↔個人の1:1のみ）、非公式接続はアカウント凍結＝業務停止のリスク。用途も「友人関係からの営業」に限られ不要と naru が判断。

### 管理者権限を使う案（DWD）は方針違反だった
Gmail 収集にサービスアカウント＋ドメインワイド委任を提案したが、eye-of-providence の CLAUDE.md に「管理者権限は使わない（2026-07-24決定・中村さん方針）」と明記されていた。**リポジトリの CLAUDE.md を先に読めば防げた提案ミス**。cc 運用が唯一の正解だった。

### 実データを流さないと分からないバグがある
PocketBase の text フィールドは `max` 未指定だと「無制限」ではなく**既定5000文字制限**。しかも API 上は `max: 0` と返るため無制限に見える。Google Chat の実データ744件を流して初めて発覚した。メール本文は簡単に超えるので、テストだけで本番投入していたら**長文が静かに落ち続けていた**。

教訓: 「テスト全通過」は実データ検証の代わりにならない。特に**外部サービスのデータは想定より長い・欠けている・型が違う**。

### サブエージェントのレビューは前提を確認してから採る
DB設計を技術/要件の2観点でレビューさせ有用な指摘を多数得たが、「Gmailは複数メールボックスから収集するので重複排除が効かない」という指摘は**quality-management@ 1箇所に集約する前提が伝わっていなかった**ための誤り。レビュー結果は鵜呑みにせず、自分が持っている前提と突き合わせて採否を決める。

## 2026-07-29 Vercel プラグインを無効化

`vercel@claude-plugins-official` を無効化（`~/.claude/settings.json` の `enabledPlugins` を `false`）。2026-04-06 のインストール以降、毎セッション・毎プロンプトで Vercel スキルの注入ノイズが出続けていた。

### 判断根拠: CLI とプラグインは別物
`vercel` CLI 自体は現役（直近 2026-07-27 に maren-membership をデプロイ）。一方プラグインが提供する `/vercel:deploy` 等はスラッシュコマンドなので、naru が自然文で「デプロイして」と言う限り**一度も発火しない**。実運用は一貫して Bash での CLI 直叩きだった。使っていない層だけを切った形。

### ノイズの正体は hook であってスキルではない
プラグイン同梱の `hooks/hooks.json` が 7 イベントに計 14 本の hook を登録しており、`user-prompt-submit-skill-inject.mjs`（毎プロンプト）と `pretooluse-skill-inject.mjs`（毎 Bash/Read/Edit/Write）がスキルを注入していた。**スキルが hook を呼ぶのではなく、hook がスキルを押し込む**という逆方向。

`inject-claude-md.mjs` は `.vercel/` や `next.config` の有無を一切見ず**無条件で**毎セッション注入する設計。user scope 有効化だったため全プロジェクトで発火していた。「Walkers ディレクトリだから出る」わけではなかった。

### 副次: refs が現実とズレていた
`.claude/refs/vercel-deploy.md` に「`output/deploy/deploy.sh` を使う」とあったが、**deploy.sh は 20 プロジェクトのどこにも実在しなかった**。実運用が CLI 直叩きへ移行した際に refs だけ取り残されていた。CLI 直叩き手順に修正済み。

教訓: 参照ファイルに書いた手順は、実体が消えても誰も気づかない。ルールを書いた時点の正しさは保証されない。

## 2026-08-05 Claude in Chrome を claude1/claude2 の2ペア構成に

「claude1 からも claude2 からも naru.hosoya のブラウザ環境を操作したい」を実現するため、CLI ごとに専用 Chrome プロファイルを割り当てた。

### 仕様の確定: ペアリングは claude.ai アカウント単位
拡張は「その Chrome プロファイルで claude.ai にログイン中のアカウント = Claude Code の CLI アカウント」の場合のみ接続できる（接続エラーメッセージと `list_connected_browsers` の設計で確認）。7/31 調査の「拡張はセッション分離設計だから両立可」は**同一アカウント内の複数セッション**の話で、別アカウントの CLI 2本が1つの拡張を共有することはできない。8/3 の 1LC 画面テストで claude1 が接続できなかった根本原因はこれ。

### 構成
| Chrome プロファイル | Google | claude.ai | ペア CLI |
|---|---|---|---|
| Profile 4「walker-s.co.jp」 | naru.hosoya | naru.hosoya | claude2 |
| Profile 7「walker-s (claude1用)」新設 | naru.hosoya | narudev4 | claude1 |

### Cookie はファイルコピーで移植できた
Chrome の Cookie 暗号化キー（macOS Keychain「Chrome Safe Storage」）は**インストール単位で全プロファイル共有**のため、同一マシン内なら Cookie DB（SQLite）のコピーで仕事サイトのログインを移植できる。Profile 4 → Profile 7 へ 3710 行をマージし、claude.ai / anthropic.com 行だけ除外して narudev4 セッションを温存した（丸ごとコピーすると拡張が walker-s に従い本末転倒）。作業は Chrome 完全終了中に実施。claude1 からのタブ操作と myaccount.google.com の naru.hosoya 表示まで検証済み。

### 注意
- Cookie は一回限りのスナップショット。以後のログインは各プロファイルで独立に管理される
- localStorage にログイン状態を持つサイトは Cookie だけでは復元されない（発生時に個別ログイン）
- ラベルは「実験中」。7日間の運用継続（〜08-12）で完了扱い

## 2026-08-20: mtg-pipeline の削除（MTG自動化パイプライン終了）

- 判断: naru 指示「使ってないので完全に削除」。worker 最終出力は約48日前で実質未稼働だった
- 削除: `.claude/skills/mtg-pipeline/`／`05_development/mtg-pipeline/`（receiver・watch・docs）／`walkers-dashboard/mtg-pipeline.json`／health-check.sh のパイプライン鮮度チェック／CLAUDE.md・refs・関連スキルの参照
- 追記（同日）: ローカル watcher の launchd `com.walkers.mtg-watch`（`watch/mtg_watch.py` を5分毎実行）を発見。スクリプト本体はディレクトリ削除で消滅済み（git 未追跡・復元不可）。停止と plist 削除は naru が手動実行
- 残置: パイプラインDBスプシ（データ保全）／GAS「mtg-pipeline-receiver」＋tl;dv webhook 登録（クラウド側・naru 確認待ち）／`mtg-worker` スキル（凍結のまま）／walkers-dashboard の MTG パネル（死にパネル化）
- 議事録の経路: `meeting-minutes`（Gemini メモ起点）/ `meeting-transcribe`（録画ファイルあり）
