import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { COLORS, FONTS, fullCenter } from "../styles";

const services = [
  { icon: "📊", title: "経営戦略コンサルティング", desc: "事業の方向性を見極め、成長戦略を策定" },
  { icon: "🤖", title: "AI導入・活用支援", desc: "100以上のAIツールから最適解を提案" },
  { icon: "🔄", title: "DX推進支援", desc: "業務プロセスのデジタル変革を伴走" },
];

export const Scene3_Services: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // セクションタイトル
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [0, 20], [30, 0], {
    extrapolateRight: "clamp",
  });

  // フェードアウト (270f duration)
  const fadeOut = interpolate(frame, [250, 270], [1, 0], {
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
      {/* セクションタイトル */}
      <div
        style={{
          position: "absolute",
          top: 140,
          ...fullCenter,
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
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
          Our Services
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
          サービス紹介
        </h2>
      </div>

      {/* サービスカード */}
      <div
        style={{
          display: "flex",
          gap: 60,
          marginTop: 80,
        }}
      >
        {services.map((service, i) => {
          const delay = 30 + i * 20;
          const cardScale = spring({
            frame: Math.max(0, frame - delay),
            fps,
            config: { damping: 12, stiffness: 100 },
          });
          const cardOpacity = interpolate(
            frame,
            [delay, delay + 15],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          return (
            <div
              key={i}
              style={{
                width: 420,
                padding: "50px 40px",
                borderRadius: 20,
                backgroundColor: "rgba(255,255,255,0.04)",
                border: `1px solid rgba(79, 195, 247, 0.15)`,
                ...fullCenter,
                gap: 16,
                opacity: cardOpacity,
                transform: `scale(${cardScale})`,
              }}
            >
              <span style={{ fontSize: 56 }}>{service.icon}</span>
              <h3
                style={{
                  color: COLORS.white,
                  fontSize: 28,
                  fontFamily: FONTS.japanese,
                  fontWeight: 600,
                  margin: 0,
                  textAlign: "center",
                }}
              >
                {service.title}
              </h3>
              <p
                style={{
                  color: COLORS.gray,
                  fontSize: 20,
                  fontFamily: FONTS.japanese,
                  margin: 0,
                  textAlign: "center",
                  lineHeight: 1.6,
                }}
              >
                {service.desc}
              </p>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
