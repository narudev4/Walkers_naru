# youtube/ — YouTube AI動画制作ワークスペース

## HeyGen 自動化を触るとき

`_shared/heygen-setup.py` / `heygen-audio-upload.py` を編集する前に、**必ず**
`_shared/heygen-automation-learnings.md` を読む。踏んだ罠（シーン誤マッチ・
React click 吸収・`moveable.request()` リサイズ・FileChooser 2 パターン・
仮想スクロールなど）はすべてそこに集約されている。新しく罠を踏んだら同ファイルに追記する。

### エラーで止まった時のルール（CRITICAL・絶対厳守）

**`_shared/heygen-setup.py` は憶測での編集禁止。** 途中で止まった・失敗シーンが出た場合、
**`HEYGEN_START=N` で再実行する**（N は止まったシーン番号）。

**ルールはこれだけ:**
- ✅ `HEYGEN_START=N` で **最大5回再実行**（カウント起点: `HEYGEN_START=N` を叩いて失敗した回数。5回失敗で報告 = 6回目はやらない）
- ✅ 5回試しても同じ場所で詰まる場合のみユーザーに報告
- ❌ コードを編集しない（憶測での sleep 削除・scroll 高速化等は禁止）
- ❌ 5回未満でユーザーに相談しない（相談不要、もう一度叩け）

**理由**: setup.py は既に多数の罠を踏み抜けた実績コード。エラーの多くは UI 状態の一時的ズレで、
**HeyGenの右パネルが前シーンを残したままナビゲーション検証が落ちる現象は再実行で勝手に解消する**（learnings Section 11 で実証。実例: 2回目で抜けて 28/28 完走）。
憶測での修正は過去に踏んだ罠を再発させるリスクが高い。ユーザーから明示的に改善を頼まれた場合のみコード変更可（実機検証必須・learnings.md に追記）。

**現状版に既に入っている最適化・対策**（戻すと劣化するもの）:

| 項目 | 内容 | learnings 参照 |
|---|---|---|
| 速度最適化 (α+β) | scrollIntoView instant化、sleep 圧縮、scrollTop=0 リセット廃止。約 50% 高速化 | Section 10 |
| 仮想スクロール (16+) 対策 | `locator().click()` で左パネル更新（DOM `.click()` は React に届かない） | Section 6 |
| moveable.request() | アバターサイズ 200px を 1px 精度で達成（ドラッグ調整は不可能） | Section 2.4 |
| Phase 0 Playwright CDP化 | browser-use CLI 依存撤廃、Shadow DOM 罠を回避 | Section 8 |

## どこに何があるか

| 目的 | 場所 |
|--|--|
| 制作パイプラインの起動 | `/yt-produce`（`.claude/skills/yt-produce/SKILL.md`） |
| 各ステップの仕様 | `.claude/skills/yt-*/SKILL.md` |
| 人間向け手順書 | `docs/MANUAL_yt-produce.md` |
| HeyGen 罠の一次資料 | `_shared/heygen-automation-learnings.md` |
| 共通コード・雛形 | `_shared/` |
| 進行中案件 | `projects/{slug}/` |
