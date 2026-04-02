import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";
import { COLORS, FONTS, fullCenter } from "../styles";

export const Scene4_Strength: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 数字のカウントアップ
  const countTarget = 100;
  const count = Math.min(
    countTarget,
    Math.floor(
      interpolate(frame, [20, 80], [0, countTarget], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    )
  );

  // 数字の登場
  const numScale = spring({
    frame: Math.max(0, frame - 10),
    fps,
    config: { damping: 10, stiffness: 80 },
  });

  // テキストの登場
  const textOpacity = interpolate(frame, [40, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const textY = interpolate(frame, [40, 60], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // 説明文
  const descOpacity = interpolate(frame, [70, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // アクセントバー
  const barWidth = interpolate(frame, [85, 110], [0, 600], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // フェードアウト (210f duration)
  const fadeOut = interpolate(frame, [190, 210], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at center, ${COLORS.darkBlue} 0%, ${COLORS.darkBg} 70%)`,
        ...fullCenter,
        opacity: fadeOut,
      }}
    >
      {/* 背景の装飾グリッド */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `linear-gradient(rgba(79,195,247,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(79,195,247,0.03) 1px, transparent 1px)`,
          backgroundSize: "80px 80px",
        }}
      />

      {/* メイン数字 */}
      <div style={{ ...fullCenter, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              color: COLORS.accent,
              fontSize: 180,
              fontFamily: FONTS.heading,
              fontWeight: 800,
              transform: `scale(${numScale})`,
              lineHeight: 1,
            }}
          >
            {count}
          </span>
          <span
            style={{
              color: COLORS.accent,
              fontSize: 48,
              fontFamily: FONTS.heading,
              fontWeight: 600,
              opacity: textOpacity,
            }}
          >
            +
          </span>
        </div>

        <p
          style={{
            color: COLORS.white,
            fontSize: 40,
            fontFamily: FONTS.japanese,
            fontWeight: 700,
            margin: 0,
            opacity: textOpacity,
            transform: `translateY(${textY}px)`,
            letterSpacing: 4,
          }}
        >
          AIツールを実務で検証
        </p>

        {/* 区切り線 */}
        <div
          style={{
            width: barWidth,
            height: 2,
            backgroundColor: COLORS.accent,
            opacity: 0.4,
            marginTop: 20,
            marginBottom: 20,
          }}
        />

        <p
          style={{
            color: COLORS.gray,
            fontSize: 26,
            fontFamily: FONTS.japanese,
            margin: 0,
            opacity: descOpacity,
            textAlign: "center",
            lineHeight: 1.8,
            maxWidth: 800,
          }}
        >
          机上の空論ではなく、実際のビジネスで使える
          <br />
          AI活用ノウハウを蓄積しています
        </p>
      </div>
    </AbsoluteFill>
  );
};
