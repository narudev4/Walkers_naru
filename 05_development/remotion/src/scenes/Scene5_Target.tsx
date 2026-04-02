import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { COLORS, FONTS, fullCenter } from "../styles";

const targets = [
  { label: "AIを導入したいが\n何から始めればいいかわからない", icon: "💡" },
  { label: "DXを推進したいが\n社内にノウハウがない", icon: "🏢" },
  { label: "経営戦略を\nテクノロジーで加速したい", icon: "🚀" },
];

export const Scene5_Target: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  // フェードアウト (195f duration)
  const fadeOut = interpolate(frame, [175, 195], [1, 0], {
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
      {/* タイトル */}
      <div
        style={{
          position: "absolute",
          top: 140,
          ...fullCenter,
          opacity: titleOpacity,
        }}
      >
        <p
          style={{
            color: COLORS.accent,
            fontSize: 18,
            fontFamily: FONTS.heading,
            letterSpacing: 6,
            margin: 0,
            textTransform: "uppercase",
          }}
        >
          For You
        </p>
        <h2
          style={{
            color: COLORS.white,
            fontSize: 48,
            fontFamily: FONTS.japanese,
            fontWeight: 700,
            margin: "12px 0 0 0",
          }}
        >
          こんなお悩みはありませんか？
        </h2>
      </div>

      {/* 課題カード */}
      <div
        style={{
          display: "flex",
          gap: 50,
          marginTop: 80,
        }}
      >
        {targets.map((item, i) => {
          const delay = 30 + i * 25;
          const slideX = interpolate(
            frame,
            [delay, delay + 20],
            [80, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const cardOpacity = interpolate(
            frame,
            [delay, delay + 20],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          // ホバー風のパルス
          const pulse = Math.sin((frame - delay) * 0.05) * 2;

          return (
            <div
              key={i}
              style={{
                width: 420,
                padding: "50px 40px",
                borderRadius: 20,
                background: `linear-gradient(135deg, rgba(79,195,247,0.08) 0%, rgba(15,26,46,0.8) 100%)`,
                border: `1px solid rgba(79, 195, 247, 0.2)`,
                ...fullCenter,
                gap: 24,
                opacity: cardOpacity,
                transform: `translateX(${slideX}px) translateY(${frame > delay + 20 ? pulse : 0}px)`,
              }}
            >
              <span style={{ fontSize: 56 }}>{item.icon}</span>
              <p
                style={{
                  color: COLORS.lightGray,
                  fontSize: 24,
                  fontFamily: FONTS.japanese,
                  margin: 0,
                  textAlign: "center",
                  lineHeight: 1.8,
                  whiteSpace: "pre-line",
                }}
              >
                {item.label}
              </p>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
