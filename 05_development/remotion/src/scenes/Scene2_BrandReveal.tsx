import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { COLORS, FONTS, fullCenter } from "../styles";

export const Scene2_BrandReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ロゴのスプリングアニメーション
  const logoScale = spring({
    frame,
    fps,
    config: { damping: 8, stiffness: 80, mass: 1.2 },
  });

  const logoOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  // サブタイトルの登場
  const subOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subY = interpolate(frame, [30, 50], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // URL表示
  const urlOpacity = interpolate(frame, [55, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // アクセントリング
  const ringScale = spring({
    frame: Math.max(0, frame - 5),
    fps,
    config: { damping: 15, stiffness: 60 },
  });
  const ringOpacity = interpolate(frame, [5, 20, 60, 80], [0, 0.15, 0.15, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // フェードアウト
  const fadeOut = interpolate(frame, [100, 120], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.darkBg,
        ...fullCenter,
        opacity: fadeOut,
      }}
    >
      {/* 背景のアクセントリング */}
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          border: `2px solid ${COLORS.accent}`,
          opacity: ringOpacity,
          transform: `scale(${ringScale * 1.5})`,
        }}
      />

      {/* ロゴ */}
      <h1
        style={{
          color: COLORS.white,
          fontSize: 120,
          fontFamily: FONTS.heading,
          fontWeight: 700,
          letterSpacing: 16,
          margin: 0,
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
        }}
      >
        Walkers
      </h1>

      {/* サブタイトル */}
      <p
        style={{
          color: COLORS.accent,
          fontSize: 28,
          fontFamily: FONTS.japanese,
          letterSpacing: 6,
          marginTop: 20,
          opacity: subOpacity,
          transform: `translateY(${subY}px)`,
        }}
      >
        経営コンサルティング × AI/DX支援
      </p>

      {/* URL */}
      <p
        style={{
          color: COLORS.gray,
          fontSize: 20,
          fontFamily: FONTS.heading,
          letterSpacing: 3,
          marginTop: 30,
          opacity: urlOpacity,
        }}
      >
        walker-s.co.jp
      </p>
    </AbsoluteFill>
  );
};
