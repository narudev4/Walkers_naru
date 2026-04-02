import React from "react";
import { Composition } from "remotion";
import { WalkersIntro } from "./WalkersIntro";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="WalkersIntro"
        component={WalkersIntro}
        durationInFrames={1125}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
