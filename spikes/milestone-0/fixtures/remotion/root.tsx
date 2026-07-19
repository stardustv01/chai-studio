import React from 'react';
import {Composition} from 'remotion';
import {SpikeComposition} from './spike-composition';
import {MixedComposition} from './mixed-composition';

export const Root: React.FC = () => (
  <>
    <Composition
      id="ChaiMilestone0"
      component={SpikeComposition}
      durationInFrames={60}
      fps={30}
      width={640}
      height={360}
    />
    <Composition
      id="ChaiMixedFinish"
      component={MixedComposition}
      durationInFrames={300}
      fps={30000 / 1001}
      width={640}
      height={360}
    />
  </>
);
