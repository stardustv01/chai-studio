import React from 'react';
import {AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame} from 'remotion';

const captions = [
  {from: 0, duration: 60, text: 'One master clock.'},
  {from: 60, duration: 90, text: 'Native engines, shared authority.'},
  {from: 150, duration: 150, text: 'Every frame and sample is accounted for.'},
];

export const MixedComposition: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{backgroundColor: '#07090d', color: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif'}}>
      <OffthreadVideo src={staticFile('raw-video.mp4')} muted style={{width: '100%', height: '100%', objectFit: 'cover', opacity: 0.28}} />
      <Img src={staticFile('fixture-image.svg')} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.42}} />
      <Sequence from={60} durationInFrames={60}>
        <OffthreadVideo
          src={staticFile('hyperframes-fixture.mp4')}
          muted
          style={{position: 'absolute', width: 416, height: 234, right: 28, top: 28, borderRadius: 18, boxShadow: '0 22px 80px rgba(0,0,0,.5)'}}
        />
      </Sequence>
      <Sequence from={120} durationInFrames={60}>
        <Img
          src={staticFile(`alpha-sequence/frame-${String(frame - 119).padStart(4, '0')}.png`)}
          style={{position: 'absolute', width: 320, height: 180, left: 0, top: 0}}
        />
      </Sequence>
      <div style={{position: 'absolute', left: 36, top: 28, color: '#c4b5fd', fontSize: 14, fontWeight: 800, letterSpacing: '.18em'}}>MIXED-ENGINE FINISH</div>
      {captions.map((caption) => frame >= caption.from && frame < caption.from + caption.duration ? (
        <div key={caption.from} style={{position: 'absolute', left: 54, right: 54, bottom: 34, padding: '12px 18px', borderRadius: 14, background: 'rgba(3,7,18,.82)', textAlign: 'center', fontSize: 25, fontWeight: 700}}>{caption.text}</div>
      ) : null)}
      <Audio src={staticFile('offline-mix.wav')} />
    </AbsoluteFill>
  );
};
