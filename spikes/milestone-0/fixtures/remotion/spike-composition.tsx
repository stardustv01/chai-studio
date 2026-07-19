import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';

export const SpikeComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, 59], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const enter = interpolate(frame, [0, 18], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{backgroundColor: '#07090d', color: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif', alignItems: 'center', justifyContent: 'center'}}>
      <div style={{width: 440, padding: 34, border: '1px solid rgba(34,211,238,.4)', borderRadius: 24, background: 'rgba(17,24,39,.92)', transform: `translateY(${(1-enter)*28}px) scale(${0.97+enter*0.03})`, opacity: enter}}>
        <div style={{color: '#67e8f9', fontSize: 15, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 12}}>Milestone 0</div>
        <div style={{fontSize: 42, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.035em'}}>One clock. Native engines.</div>
        <div style={{width: '100%', height: 8, marginTop: 26, overflow: 'hidden', borderRadius: 999, background: '#252b38'}}>
          <div style={{width: `${progress*100}%`, height: '100%', background: 'linear-gradient(90deg,#22d3ee,#8b5cf6)'}} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
