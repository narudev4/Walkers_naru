import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Sequence,
} from "remotion";

export const MyVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // タイトルのフェードイン
  const titleOpacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  // タイトルのスケールアニメーション
  const titleScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  // サブタイトルのフェードイン（1秒後から）
  const subtitleOpacity = interpolate(frame, [30, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* タイトル */}
      <Sequence from={0}>
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <h1
            style={{
              color: "white",
              fontSize: 80,
              fontFamily: "Arial, sans-serif",
              fontWeight: "bold",
              opacity: titleOpacity,
              transform: `scale(${titleScale})`,
              textAlign: "center",
              margin: 0,
            }}
          >
            Walkers
          </h1>
        </AbsoluteFill>
      </Sequence>

      {/* サブタイトル */}
      <Sequence from={30}>
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            marginTop: 120,
          }}
        >
          <p
            style={{
              color: "#e94560",
              fontSize: 36,
              fontFamily: "Arial, sans-serif",
              opacity: subtitleOpacity,
              textAlign: "center",
              margin: 0,
            }}
          >
            Innovation & Strategy
          </p>
        </AbsoluteFill>
      </Sequence>

      {/* フッターライン */}
      <Sequence from={60}>
        <AbsoluteFill
          style={{
            justifyContent: "flex-end",
            alignItems: "center",
            paddingBottom: 80,
          }}
        >
          <div
            style={{
              width: interpolate(frame - 60, [0, 30], [0, 400], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              height: 3,
              backgroundColor: "#e94560",
            }}
          />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
