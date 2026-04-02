import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { COLORS, FONTS, fullCenter } from "../styles";

export const Scene6_CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // ロゴ
  const logoScale = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 80 },
  });
  const logoOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  // CTA テキスト
  const ctaOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ctaY = interpolate(frame, [30, 50], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ボタンアニメーション
  const btnScale = spring({
    frame: Math.max(0, frame - 55),
    fps,
    config: { damping: 8, stiffness: 100 },
  });
  const btnOpacity = interpolate(frame, [55, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // URL
  const urlOpacity = interpolate(frame, [75, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 背景グロー
  const glowSize = interpolate(frame, [0, 150], [300, 500]);
  const glowOpacity = interpolate(frame, [0, 30], [0, 0.15], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.darkBg,
        ...fullCenter,
      }}
    >
      {/* 背景グロー */}
      <div
        style={{
          position: "absolute",
          width: glowSize,
          height: glowSize,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${COLORS.accent} 0%, transparent 70%)`,
          opacity: glowOpacity,
        }}
      />

      {/* ロゴ */}
      <h1
        style={{
          color: COLORS.white,
          fontSize: 90,
          fontFamily: FONTS.heading,
          fontWeight: 700,
          letterSpacing: 12,
          margin: 0,
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
        }}
      >
        Walkers
      </h1>

      {/* CTA */}
      <p
        style={{
          color: COLORS.lightGray,
          fontSize: 32,
          fontFamily: FONTS.japanese,
          marginTop: 30,
          opacity: ctaOpacity,
          transform: `translateY(${ctaY}px)`,
          letterSpacing: 4,
        }}
      >
        AI時代の経営パートナー
      </p>

      {/* ボタン風CTA */}
      <div
        style={{
          marginTop: 50,
          padding: "18px 60px",
          borderRadius: 50,
          border: `2px solid ${COLORS.accent}`,
          opacity: btnOpacity,
          transform: `scale(${btnScale})`,
        }}
      >
        <span
          style={{
            color: COLORS.accent,
            fontSize: 24,
            fontFamily: FONTS.japanese,
            fontWeight: 600,
            letterSpacing: 4,
          }}
        >
          まずはご相談ください
        </span>
      </div>

      {/* URL */}
      <p
        style={{
          color: COLORS.gray,
          fontSize: 22,
          fontFamily: FONTS.heading,
          marginTop: 40,
          opacity: urlOpacity,
          letterSpacing: 2,
        }}
      >
        walker-s.co.jp
      </p>
    </AbsoluteFill>
  );
};
