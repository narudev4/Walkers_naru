import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { COLORS, FONTS, fullCenter } from "../styles";

export const Scene1_Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 背景のグラデーションアニメーション
  const bgShift = interpolate(frame, [0, 150], [0, 30]);

  // キャッチコピーのフェードイン
  const line1Opacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const line1Y = interpolate(frame, [10, 30], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const line2Opacity = interpolate(frame, [35, 55], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const line2Y = interpolate(frame, [35, 55], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // アクセントラインの伸長
  const lineWidth = interpolate(frame, [60, 90], [0, 200], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // フェードアウト
  const fadeOut = interpolate(frame, [120, 150], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${135 + bgShift}deg, ${COLORS.darkBg} 0%, ${COLORS.darkBlue} 40%, ${COLORS.navy} 100%)`,
        ...fullCenter,
        opacity: fadeOut,
      }}
    >
      {/* 装飾パーティクル */}
      {[...Array(6)].map((_, i) => {
        const x = 200 + i * 280;
        const y = 150 + (i % 3) * 250;
        const size = 4 + (i % 3) * 2;
        const opacity = interpolate(
          frame,
          [i * 8, i * 8 + 20],
          [0, 0.3],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y + Math.sin(frame * 0.05 + i) * 10,
              width: size,
              height: size,
              borderRadius: "50%",
              backgroundColor: COLORS.accent,
              opacity,
            }}
          />
        );
      })}

      {/* メインテキスト */}
      <div style={{ ...fullCenter, gap: 30 }}>
        <p
          style={{
            color: COLORS.gray,
            fontSize: 32,
            fontFamily: FONTS.japanese,
            letterSpacing: 8,
            margin: 0,
            opacity: line1Opacity,
            transform: `translateY(${line1Y}px)`,
          }}
        >
          AI時代の経営を、ともに歩む。
        </p>

        <div
          style={{
            width: lineWidth,
            height: 2,
            backgroundColor: COLORS.accent,
          }}
        />

        <p
          style={{
            color: COLORS.lightGray,
            fontSize: 24,
            fontFamily: FONTS.japanese,
            letterSpacing: 4,
            margin: 0,
            opacity: line2Opacity,
            transform: `translateY(${line2Y}px)`,
          }}
        >
          経営戦略 × AI × DX
        </p>
      </div>
    </AbsoluteFill>
  );
};
