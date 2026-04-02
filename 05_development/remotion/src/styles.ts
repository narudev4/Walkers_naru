import React from "react";

// カラーパレット
export const COLORS = {
  darkBg: "#0a0a1a",
  darkBlue: "#0f1a2e",
  navy: "#16213e",
  accent: "#4fc3f7",    // ライトブルー
  accentDark: "#0288d1",
  red: "#e94560",
  white: "#ffffff",
  gray: "#a0a0b0",
  lightGray: "#d0d0e0",
  gold: "#ffd700",
};

// 共通スタイル
export const FONTS = {
  heading: "'Helvetica Neue', Arial, sans-serif",
  body: "'Helvetica Neue', Arial, sans-serif",
  japanese: "'Hiragino Sans', 'Noto Sans JP', sans-serif",
};

export const fullCenter: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  flexDirection: "column",
};
