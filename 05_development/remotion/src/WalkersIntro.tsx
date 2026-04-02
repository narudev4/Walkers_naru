import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Scene1_Opening } from "./scenes/Scene1_Opening";
import { Scene2_BrandReveal } from "./scenes/Scene2_BrandReveal";
import { Scene3_Services } from "./scenes/Scene3_Services";
import { Scene4_Strength } from "./scenes/Scene4_Strength";
import { Scene5_Target } from "./scenes/Scene5_Target";
import { Scene6_CTA } from "./scenes/Scene6_CTA";
import { COLORS } from "./styles";

/*
 * シーンタイミング (30fps):
 *   Scene1:   0 - 150  (5.0s)  オープニング
 *   Scene2: 150 - 270  (4.0s)  ブランドリビール
 *   Scene3: 270 - 540  (9.0s)  サービス紹介
 *   Scene4: 540 - 750  (7.0s)  強み
 *   Scene5: 750 - 945  (6.5s)  ターゲット課題
 *   Scene6: 945 -1125  (6.0s)  CTA
 *   合計: 1125f = 37.5s
 */

export const WalkersIntro: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.darkBg }}>
      {/* ===== BGM（全編通し・ナレーション時は音量を下げる） ===== */}
      <Audio
        src={staticFile("bgm.mp3")}
        volume={(f) =>
          interpolate(f, [0, 60, 1050, 1125], [0, 0.3, 0.3, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />

      {/* ===== ナレーション ===== */}
      {/* Scene1: "AI時代の経営を、ともに歩む。" */}
      <Sequence from={15}>
        <Audio src={staticFile("narr_scene1.mp3")} volume={0.9} />
      </Sequence>

      {/* Scene2: "ウォーカーズ" */}
      <Sequence from={170}>
        <Audio src={staticFile("narr_scene2.mp3")} volume={0.9} />
      </Sequence>

      {/* Scene3: "経営戦略、AI導入、DX推進。御社に寄り添い、伴走します。" */}
      <Sequence from={290}>
        <Audio src={staticFile("narr_scene3.mp3")} volume={0.9} />
      </Sequence>

      {/* Scene4: "100以上のAIツールを実務で検証。実践的なノウハウがあります。" */}
      <Sequence from={555}>
        <Audio src={staticFile("narr_scene4.mp3")} volume={0.9} />
      </Sequence>

      {/* Scene5: "AI導入、何から始めればいい？そんなお悩みありませんか。" */}
      <Sequence from={765}>
        <Audio src={staticFile("narr_scene5.mp3")} volume={0.9} />
      </Sequence>

      {/* Scene6: "Walkers。まずはお気軽にご相談ください。" */}
      <Sequence from={960}>
        <Audio src={staticFile("narr_scene6.mp3")} volume={0.9} />
      </Sequence>

      {/* ===== 効果音 ===== */}
      {/* Scene2 ロゴリビール時のチャイム */}
      <Sequence from={150}>
        <Audio src={staticFile("chime.mp3")} volume={0.5} />
      </Sequence>

      {/* Scene3 サービスカード登場のウーシュ */}
      <Sequence from={310}>
        <Audio src={staticFile("whoosh.mp3")} volume={0.3} />
      </Sequence>
      <Sequence from={340}>
        <Audio src={staticFile("whoosh.mp3")} volume={0.25} />
      </Sequence>
      <Sequence from={370}>
        <Audio src={staticFile("whoosh.mp3")} volume={0.2} />
      </Sequence>

      {/* Scene4 カウントアップ完了時のチャイム */}
      <Sequence from={640}>
        <Audio src={staticFile("chime.mp3")} volume={0.4} />
      </Sequence>

      {/* Scene5 課題カード登場のウーシュ */}
      <Sequence from={780}>
        <Audio src={staticFile("whoosh.mp3")} volume={0.25} />
      </Sequence>
      <Sequence from={810}>
        <Audio src={staticFile("whoosh.mp3")} volume={0.2} />
      </Sequence>
      <Sequence from={840}>
        <Audio src={staticFile("whoosh.mp3")} volume={0.15} />
      </Sequence>

      {/* Scene6 最終ロゴのチャイム */}
      <Sequence from={945}>
        <Audio src={staticFile("chime.mp3")} volume={0.5} />
      </Sequence>

      {/* ===== 映像シーン ===== */}
      {/* Scene 1: オープニング (0〜5s) */}
      <Sequence from={0} durationInFrames={150}>
        <Scene1_Opening />
      </Sequence>

      {/* Scene 2: ブランドリビール (5〜9s) */}
      <Sequence from={150} durationInFrames={120}>
        <Scene2_BrandReveal />
      </Sequence>

      {/* Scene 3: サービス紹介 (9〜18s) */}
      <Sequence from={270} durationInFrames={270}>
        <Scene3_Services />
      </Sequence>

      {/* Scene 4: 強み (18〜25s) */}
      <Sequence from={540} durationInFrames={210}>
        <Scene4_Strength />
      </Sequence>

      {/* Scene 5: ターゲット課題 (25〜31.5s) */}
      <Sequence from={750} durationInFrames={195}>
        <Scene5_Target />
      </Sequence>

      {/* Scene 6: CTA / クロージング (31.5〜37.5s) */}
      <Sequence from={945} durationInFrames={180}>
        <Scene6_CTA />
      </Sequence>
    </AbsoluteFill>
  );
};
