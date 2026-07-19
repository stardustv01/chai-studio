import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDir, '..');
const outputRoot = path.join(packageRoot, 'svg');
const proofRoot = path.resolve(sourceDir, '../../style-proof-v1/svg');

const icons = new Map();

function add(phase, category, name, body, accent = 'cyan') {
  if (icons.has(name)) throw new Error(`Duplicate icon: ${name}`);
  icons.set(name, { phase, category, name, body, accent });
}

function reuse(phase, category, name, accent = 'cyan') {
  add(phase, category, name, null, accent);
}

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
${body.trim().split('\n').map((line) => `  ${line.trim()}`).join('\n')}
</svg>
`;

// P0 — Workspace navigation
reuse('P0', 'workspace-navigation', 'workspace-edit');
add('P0', 'workspace-navigation', 'workspace-inspect', `
  <rect x="4" y="4" width="12" height="12" rx="2"/>
  <path d="M7 8h6M7 11h4M7 14h2.5"/>
  <circle cx="16.5" cy="16.5" r="3.5"/>
  <path d="M19 19l2 2" stroke="var(--chai-icon-accent, currentColor)"/>
`);
reuse('P0', 'workspace-navigation', 'workspace-media', 'amber');
reuse('P0', 'workspace-navigation', 'workspace-animation');
add('P0', 'workspace-navigation', 'workspace-deliver', `
  <path d="M4 7.5h10.5v11H4z"/>
  <path d="M8 4h12v12"/>
  <path d="M11 11h8M16 8l3 3-3 3" stroke="var(--chai-icon-accent, currentColor)"/>
`);

// P0 — Global shell and utilities
add('P0', 'global-shell', 'search', `
  <circle cx="10.5" cy="10.5" r="6"/>
  <path d="M15 15l5 5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'global-shell', 'project-open', `
  <path d="M3.5 7.5h6l2-2h9v13h-17z"/>
  <path d="M3.5 10h17M12 14h5M15 12l2 2-2 2" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'global-shell', 'project-new', `
  <path d="M3.5 7.5h6l2-2h9v13h-17z"/>
  <path d="M12 13.5h5M14.5 11v5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'global-shell', 'save-state', `
  <path d="M5 3.5h12l2 2V20H5z"/>
  <path d="M8 3.5v6h8v-6M8 20v-6h8v6"/>
  <circle cx="16" cy="7" r=".8" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
reuse('P0', 'global-shell', 'capture-exact');
reuse('P0', 'global-shell', 'render');
add('P0', 'global-shell', 'command-palette', `
  <rect x="3.5" y="5" width="17" height="14" rx="2"/>
  <path d="M7 10l2 2-2 2M11.5 15h5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'global-shell', 'diagnostics-truth', `
  <path d="M12 3.5l7 3v5c0 4.4-2.8 7.4-7 9-4.2-1.6-7-4.6-7-9v-5z"/>
  <path d="M8.5 12l2.25 2.25 4.75-5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'global-shell', 'panel-collapse-expand', `
  <rect x="3.5" y="5" width="17" height="14" rx="2"/>
  <path d="M9 5v14M13 9l3 3-3 3" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'global-shell', 'fullscreen', `
  <path d="M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>
  <path d="M4 9l4-4M20 9l-4-4M20 15l-4 4M4 15l4 4" stroke="var(--chai-icon-accent, currentColor)"/>
`);

// P0 — Program and source transport
add('P0', 'transport', 'seek-start', `
  <path d="M6 5v14"/>
  <path d="M17.5 6.5L9 12l8.5 5.5z" fill="currentColor" stroke="none"/>
  <path d="M6 20h12" stroke="var(--chai-icon-accent, currentColor)" opacity=".7"/>
`);
add('P0', 'transport', 'seek-end', `
  <path d="M18 5v14"/>
  <path d="M6.5 6.5L15 12l-8.5 5.5z" fill="currentColor" stroke="none"/>
  <path d="M6 20h12" stroke="var(--chai-icon-accent, currentColor)" opacity=".7"/>
`);
add('P0', 'transport', 'previous-frame', `
  <path d="M7 6v12M18 7.5L10 12l8 4.5z"/>
  <path d="M7 4v16" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'transport', 'next-frame', `
  <path d="M17 6v12M6 7.5l8 4.5-8 4.5z"/>
  <path d="M17 4v16" stroke="var(--chai-icon-accent, currentColor)"/>
`);
reuse('P0', 'transport', 'play');
add('P0', 'transport', 'pause', `
  <rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>
  <rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>
  <path d="M4 20h16M12 18.5v3" stroke="var(--chai-icon-accent, currentColor)" opacity=".75"/>
`);
add('P0', 'transport', 'loop-range', `
  <path d="M7 7h9a4 4 0 0 1 4 4M17 4l3 3-3 3"/>
  <path d="M17 17H8a4 4 0 0 1-4-4M7 20l-3-3 3-3"/>
  <path d="M9 12h6" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'transport', 'mark-in', `
  <path d="M8 5H5v14h3M16 8l-4 4 4 4"/>
  <path d="M5 12h7" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'transport', 'mark-out', `
  <path d="M16 5h3v14h-3M8 8l4 4-4 4"/>
  <path d="M12 12h7" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'transport', 'shuttle-backward', `
  <path d="M12 7l-6 5 6 5zM19 7l-6 5 6 5z"/>
  <path d="M5 20h14" stroke="var(--chai-icon-accent, currentColor)" opacity=".7"/>
`);
add('P0', 'transport', 'shuttle-forward', `
  <path d="M12 7l6 5-6 5zM5 7l6 5-6 5z"/>
  <path d="M5 20h14" stroke="var(--chai-icon-accent, currentColor)" opacity=".7"/>
`);
add('P0', 'transport', 'playback-rate', `
  <path d="M5 17a8 8 0 1 1 14 0"/>
  <path d="M12 12l4-3" stroke="var(--chai-icon-accent, currentColor)"/>
  <circle cx="12" cy="12" r="1.25" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
  <path d="M7 19h10"/>
`);

// P0 — Timeline and editing
add('P0', 'timeline-editing', 'select-tool', `
  <path d="M5 3.5l13 9-6 1.25-3.5 5.75z"/>
  <path d="M12 13.75l4.5 5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
reuse('P0', 'timeline-editing', 'blade-tool');
add('P0', 'timeline-editing', 'split-playhead', `
  <path d="M4 7h16M4 17h16" opacity=".6"/>
  <path d="M12 3v18" stroke="var(--chai-icon-accent, currentColor)"/>
  <path d="M8 10l4 2-4 2M16 10l-4 2 4 2"/>
`);
reuse('P0', 'timeline-editing', 'snap');
add('P0', 'timeline-editing', 'linked-clips', `
  <path d="M9.5 14.5l-1.25 1.25a3 3 0 0 1-4.25-4.25l3-3a3 3 0 0 1 4.25 0"/>
  <path d="M14.5 9.5l1.25-1.25A3 3 0 0 1 20 12.5l-3 3a3 3 0 0 1-4.25 0"/>
  <path d="M8.5 15.5l7-7" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'undo', `
  <path d="M8 8H4V4M4.5 8A8 8 0 1 1 5 17"/>
  <path d="M4 8l4-4" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'redo', `
  <path d="M16 8h4V4M19.5 8A8 8 0 1 0 19 17"/>
  <path d="M20 8l-4-4" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'nudge-left', `
  <rect x="9" y="6" width="10" height="12" rx="1.5"/>
  <path d="M12 12H4M7 9l-3 3 3 3" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'nudge-right', `
  <rect x="5" y="6" width="10" height="12" rx="1.5"/>
  <path d="M12 12h8M17 9l3 3-3 3" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'add-track', `
  <path d="M4 6h10v4H4zM4 14h10v4H4z"/>
  <path d="M18 9v6M15 12h6" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'delete', `
  <path d="M5 7h14M9 4h6l1 3M7 7l1 13h8l1-13M10 10v6M14 10v6"/>
  <path d="M9 4h6" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'duplicate', `
  <rect x="7" y="7" width="12" height="12" rx="1.5"/>
  <path d="M5 16H4V4h12v1"/>
  <path d="M13 10v6M10 13h6" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'copy', `
  <rect x="8" y="8" width="11" height="11" rx="1.5"/>
  <path d="M16 6V4H4v12h2"/>
  <path d="M11 12h5M11 15h5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'paste', `
  <path d="M8 5h8v3H8zM6 6H4.5v14h15V6H18"/>
  <path d="M9 12h6M9 16h4" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'track-lock', `
  <path d="M3.5 7h9v4h-9zM3.5 14h9v4h-9z"/>
  <rect x="14" y="11" width="7" height="7" rx="1.5"/>
  <path d="M16 11V9.5a1.5 1.5 0 0 1 3 0V11" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'track-mute', `
  <path d="M4 10h4l4-3v10l-4-3H4z"/>
  <path d="M16 10l5 5M21 10l-5 5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'track-solo', `
  <circle cx="12" cy="12" r="8"/>
  <path d="M15 8.5h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9" stroke="var(--chai-icon-accent, currentColor)"/>
`);
reuse('P0', 'timeline-editing', 'keyframe');
add('P0', 'timeline-editing', 'transition', `
  <path d="M4 6h8l-4 12H4zM20 6h-8l4 12h4z"/>
  <path d="M9 12h6" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'timeline-marker', `
  <path d="M4 18h16M12 4v14" opacity=".65"/>
  <path d="M8 4h8v6l-4 3-4-3z" fill="var(--chai-icon-accent, currentColor)" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P0', 'timeline-editing', 'compound-clip', `
  <rect x="3.5" y="6" width="17" height="12" rx="2"/>
  <path d="M7 10h4v4H7zM13 10h4v4h-4z"/>
  <path d="M11 12h2" stroke="var(--chai-icon-accent, currentColor)"/>
`);

// P1 — Media and source
add('P1', 'media-source', 'folder', `
  <path d="M3.5 7h6l2-2h9v14h-17z"/>
  <path d="M3.5 10h17" stroke="var(--chai-icon-accent, currentColor)" opacity=".75"/>
`);
add('P1', 'media-source', 'footage', `
  <rect x="3.5" y="5" width="17" height="14" rx="2"/>
  <path d="M7 5v14M17 5v14M3.5 9h3.5M17 9h3.5M3.5 15h3.5M17 15h3.5"/>
  <path d="M10 9l5 3-5 3z" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P1', 'media-source', 'interview', `
  <circle cx="9" cy="8" r="3"/>
  <path d="M4.5 18c.5-3.5 2-5 4.5-5s4 1.5 4.5 5"/>
  <path d="M17 8v7M14.5 11.5A2.5 2.5 0 0 0 19.5 11.5V8A2.5 2.5 0 0 0 14.5 8zM14 18h6" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'media-source', 'product-media', `
  <path d="M12 3.5l8 4.25v8.5L12 20.5l-8-4.25v-8.5z"/>
  <path d="M4 7.75l8 4.25 8-4.25M12 12v8.5"/>
  <path d="M8 5.6l8 4.3" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'media-source', 'audio-media', `
  <path d="M7 17V6l11-2v11"/>
  <ellipse cx="5" cy="17" rx="3" ry="2"/>
  <ellipse cx="16" cy="15" rx="3" ry="2"/>
  <path d="M7 9l11-2" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'media-source', 'graphic', `
  <path d="M12 3.5l2.4 5 5.1.7-3.7 3.6.9 5.2-4.7-2.5L7.3 18l.9-5.2-3.7-3.6 5.1-.7z"/>
  <circle cx="12" cy="12" r="2" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P1', 'media-source', 'composition', `
  <rect x="4" y="4" width="11" height="11" rx="1.5"/>
  <rect x="9" y="9" width="11" height="11" rx="1.5"/>
  <path d="M9 15h6V9" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'media-source', 'import-media', `
  <rect x="4" y="13" width="16" height="7" rx="1.5"/>
  <path d="M12 3v12M8 7l4-4 4 4" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'media-source', 'relink', `
  <path d="M9.5 14.5l-1.25 1.25a3 3 0 0 1-4.25-4.25l3-3a3 3 0 0 1 4.25 0M14.5 9.5l1.25-1.25A3 3 0 0 1 20 12.5l-3 3a3 3 0 0 1-4.25 0"/>
  <path d="M7.75 16.25l8.5-8.5M12 4v3M12 17v3" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'media-source', 'generate-proxy', `
  <rect x="3.5" y="5" width="8" height="14" rx="1.5"/>
  <rect x="15" y="8" width="5.5" height="9" rx="1.25"/>
  <path d="M9.5 12h7M13.5 9l3 3-3 3" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'media-source', 'validate-source', `
  <rect x="3.5" y="5" width="12" height="14" rx="1.5"/>
  <path d="M7 9h5M7 12h4"/>
  <circle cx="16.5" cy="16.5" r="3.5"/>
  <path d="M14.75 16.5l1.25 1.25 2.4-2.6" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'media-source', 'media-offline', `
  <rect x="3.5" y="5" width="17" height="14" rx="2"/>
  <path d="M7 15l3-3 2 2 2-2 3 3"/>
  <path d="M4 4l16 16" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'media-source', 'duplicate-hash', `
  <rect x="7" y="7" width="12" height="12" rx="1.5"/>
  <path d="M5 16H4V4h12v1"/>
  <path d="M11 10.5l-1 5M15 10.5l-1 5M9.5 12h6M9 14.5h6" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'media-source', 'metadata', `
  <path d="M4 5.5h10l6 6v7H4z"/>
  <path d="M14 5.5v6h6M8 10h2M8 14h7"/>
  <circle cx="17" cy="16" r="1" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);

// P1 — Animation and keyframes
add('P1', 'animation-keyframes', 'animated-property', `
  <path d="M4 6h8M4 12h5M4 18h8"/>
  <path d="M17 5l3 3-3 3-3-3zM17 13l3 3-3 3-3-3z"/>
  <path d="M17 11v2" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'animation-keyframes', 'key-add', `
  <path d="M9 5l5 5-5 5-5-5z"/>
  <path d="M17 12v8M13 16h8" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'animation-keyframes', 'key-remove', `
  <path d="M9 5l5 5-5 5-5-5z"/>
  <path d="M13 16h8" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'animation-keyframes', 'previous-key', `
  <path d="M14 7l5 5-5 5-5-5z"/>
  <path d="M5 7v10M9 12H5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'animation-keyframes', 'next-key', `
  <path d="M10 7l5 5-5 5-5-5z"/>
  <path d="M19 7v10M15 12h4" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'animation-keyframes', 'curve-editor', `
  <path d="M4 19V5M4 19h16" opacity=".65"/>
  <path d="M6 16c4 0 4-9 8-9 2.5 0 3 3 4 5"/>
  <circle cx="6" cy="16" r="1.25" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
  <circle cx="18" cy="12" r="1.25" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P1', 'animation-keyframes', 'graph-value', `
  <path d="M4 19V5M4 19h16" opacity=".65"/>
  <path d="M6 15l4-5 3 3 5-7"/>
  <path d="M15 6h3v3" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'animation-keyframes', 'graph-speed', `
  <path d="M4 19V5M4 19h16" opacity=".65"/>
  <path d="M6 17c5 0 2-10 12-10"/>
  <path d="M15 5l3 2-2 3" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'animation-keyframes', 'tangent-mode', `
  <path d="M4 17L20 7"/>
  <circle cx="4" cy="17" r="1.5"/>
  <circle cx="20" cy="7" r="1.5"/>
  <path d="M12 9l3 3-3 3-3-3z" fill="var(--chai-icon-accent, currentColor)" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'animation-keyframes', 'interpolation-hold', `
  <path d="M4 18V6M4 18h16" opacity=".65"/>
  <path d="M6 15h6V9h6"/>
  <circle cx="12" cy="15" r="1.25" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P1', 'animation-keyframes', 'interpolation-bezier', `
  <path d="M4 18V6M4 18h16" opacity=".65"/>
  <path d="M6 15c4 0 4-6 8-6 2 0 2.5 1 4 1"/>
  <circle cx="6" cy="15" r="1.25" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
  <circle cx="18" cy="10" r="1.25" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P1', 'animation-keyframes', 'distribute-time', `
  <path d="M4 5v14M20 5v14M4 12h16" opacity=".65"/>
  <path d="M8 9l3 3-3 3-3-3zM16 9l3 3-3 3-3-3z"/>
  <path d="M11 12h2" stroke="var(--chai-icon-accent, currentColor)"/>
`);

// P1 — Audio
reuse('P1', 'audio', 'waveform', 'amber');
add('P1', 'audio', 'gain', `
  <path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h10M18 18h2"/>
  <circle cx="14" cy="6" r="2"/>
  <circle cx="9" cy="12" r="2"/>
  <circle cx="16" cy="18" r="2" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'audio', 'pan', `
  <path d="M4 12h16M12 5v14" opacity=".55"/>
  <path d="M7 9l-3 3 3 3M17 9l3 3-3 3"/>
  <circle cx="12" cy="12" r="2.25" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P1', 'audio', 'fade-in', `
  <path d="M4 18h16M4 18c5 0 7-12 16-12"/>
  <path d="M4 6v12" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'audio', 'fade-out', `
  <path d="M4 18h16M4 6c9 0 11 12 16 12"/>
  <path d="M20 6v12" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'audio', 'crossfade', `
  <path d="M4 6c8 0 8 12 16 12M4 18c8 0 8-12 16-12"/>
  <circle cx="12" cy="12" r="1.25" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P1', 'audio', 'sync-anchor', `
  <path d="M12 3v18M5 8h14M7 16h10" opacity=".65"/>
  <circle cx="12" cy="8" r="2.25"/>
  <circle cx="12" cy="16" r="2.25"/>
  <path d="M12 5.75v12.5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'audio', 'ducking', `
  <path d="M3 8h3l1.5-3 2.5 14 2.5-11 2 7 1.5-7h5"/>
  <path d="M14 18h7M18 15l3 3-3 3" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'audio', 'channel-map', `
  <path d="M4 6h5v5H4zM15 13h5v5h-5zM15 4h5v5h-5zM4 15h5v5H4z"/>
  <path d="M9 8.5h3c2 0 3 1 3 3v4M9 17.5h3c2 0 3-1 3-3v-8" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'audio', 'loudness', `
  <path d="M4 10h4l4-3v10l-4-3H4z"/>
  <path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10"/>
  <path d="M20 5v14" stroke="var(--chai-icon-accent, currentColor)" opacity=".75"/>
`);

// P1 — Transcript and captions
add('P1', 'transcript-captions', 'transcript', `
  <path d="M5 4h14v16H5z"/>
  <path d="M8 8h8M8 12h8M8 16h5"/>
  <path d="M16 16h1" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'transcript-captions', 'captions', `
  <rect x="3.5" y="5" width="17" height="14" rx="2"/>
  <path d="M10 10H8a2 2 0 0 0 0 4h2M16 10h-2a2 2 0 0 0 0 4h2" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'transcript-captions', 'speaker-filter', `
  <circle cx="8" cy="8" r="3"/>
  <path d="M3.5 18c.5-3.5 2-5 4.5-5s4 1.5 4.5 5"/>
  <path d="M14 7h7l-2.5 3v5l-2 1v-6z" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'transcript-captions', 'confidence-filter', `
  <path d="M4 5h16l-6 7v6l-4 2v-8z"/>
  <path d="M16 8l1.25 1.25L20 6.5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'transcript-captions', 'corrected', `
  <path d="M4 5h11l5 5v9H4zM15 5v5h5"/>
  <path d="M7.5 14l2 2 4-4" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'transcript-captions', 'compare-script', `
  <path d="M4 5h7v14H4zM13 5h7v14h-7z"/>
  <path d="M7 9h1M7 12h1M16 9h1M16 12h1"/>
  <path d="M10 16h4" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'transcript-captions', 'caption-alignment', `
  <rect x="3.5" y="5" width="17" height="14" rx="2"/>
  <path d="M7 14h10M9 11h6M10 17h4"/>
  <path d="M12 8v11" stroke="var(--chai-icon-accent, currentColor)" opacity=".75"/>
`);
add('P1', 'transcript-captions', 'caption-position', `
  <rect x="3.5" y="4" width="17" height="16" rx="2"/>
  <rect x="7" y="14" width="10" height="3" rx="1"/>
  <path d="M12 7v5M10 10l2 2 2-2" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'transcript-captions', 'safe-area', `
  <rect x="3.5" y="4" width="17" height="16" rx="2"/>
  <rect x="7" y="7" width="10" height="10" rx="1" stroke-dasharray="2.25 2.25"/>
  <path d="M9 14h6" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P1', 'transcript-captions', 'word-highlight', `
  <path d="M4 7h16M4 12h16M4 17h16" opacity=".55"/>
  <rect x="8" y="9.5" width="8" height="5" rx="1" fill="var(--chai-icon-accent, currentColor)" fill-opacity=".2" stroke="var(--chai-icon-accent, currentColor)"/>
`);

// P2 — Review and capture
add('P2', 'review-capture', 'review-bundle', `
  <path d="M4 7h16v12H4zM7 4h10v3"/>
  <path d="M8 11h8M8 15h5"/>
  <circle cx="17" cy="15" r="1.25" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P2', 'review-capture', 'feedback-request', `
  <path d="M4 5h16v12H9l-4 3v-3H4z"/>
  <path d="M8 9h8M8 13h5"/>
  <circle cx="17" cy="13" r="1" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P2', 'review-capture', 'review-issue', `
  <path d="M4 5h16v12H9l-4 3v-3H4z"/>
  <path d="M12 8v4" stroke="var(--chai-icon-accent, currentColor)"/>
  <circle cx="12" cy="14.5" r="1" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P2', 'review-capture', 'annotation', `
  <path d="M5 16.5V20h3.5L19 9.5 14.5 5z"/>
  <path d="M12.5 7l4.5 4.5M5 20l5-1"/>
  <path d="M4 4h6" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'review-capture', 'visibility', `
  <path d="M3.5 12s3-6 8.5-6 8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z"/>
  <circle cx="12" cy="12" r="3"/>
  <circle cx="12" cy="12" r="1" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P2', 'review-capture', 'capture-isolated', `
  <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5V8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/>
  <rect x="8" y="8" width="8" height="8" rx="1.5"/>
  <path d="M12 6v12" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'review-capture', 'capture-before-effects', `
  <rect x="3.5" y="5" width="17" height="14" rx="2"/>
  <path d="M12 5v14M6.5 9h3M6.5 13h2"/>
  <path d="M15 9l1 2 2 .5-1.5 1.5.5 2-2-1-2 1 .5-2L11 11.5l2-.5z" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'review-capture', 'capture-alpha', `
  <rect x="3.5" y="5" width="17" height="14" rx="2"/>
  <path d="M4 10h16M4 15h16M9 5v14M15 5v14" opacity=".35"/>
  <path d="M8 16l4-8 4 8M9.5 13h5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'review-capture', 'capture-ab', `
  <rect x="3.5" y="5" width="17" height="14" rx="2"/>
  <path d="M12 5v14"/>
  <path d="M6.5 15l2-6 2 6M7.25 13h2.5M15 9h2a1.5 1.5 0 0 1 0 3h-2zm0 3h2.25a1.5 1.5 0 0 1 0 3H15z" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'review-capture', 'contact-sheet', `
  <rect x="3.5" y="4" width="17" height="16" rx="2"/>
  <path d="M8 4v16M16 4v16M3.5 9.5h17M3.5 15h17"/>
  <circle cx="12" cy="12.25" r="1.5" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);

// P2 — Delivery and QA
add('P2', 'delivery-qa', 'delivery-profile', `
  <path d="M5 4h10l4 4v12H5zM15 4v4h4"/>
  <path d="M8 12h8M8 16h5"/>
  <circle cx="16" cy="16" r="1.25" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P2', 'delivery-qa', 'render-range', `
  <path d="M4 7h16v10H4z"/>
  <path d="M8 4v16M16 4v16" stroke="var(--chai-icon-accent, currentColor)"/>
  <path d="M10 12h4"/>
`);
add('P2', 'delivery-qa', 'render-frame', `
  <rect x="4" y="4" width="16" height="16" rx="2"/>
  <path d="M8 8h8v8H8z"/>
  <path d="M12 6v12" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'delivery-qa', 'render-timeline', `
  <path d="M3.5 6h17M3.5 11h8M3.5 16h10"/>
  <path d="M15 11l5 3.5-5 3.5z"/>
  <path d="M12 4v14" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'delivery-qa', 'named-version', `
  <path d="M4 5h10l6 6-9 9-7-7z"/>
  <circle cx="9" cy="10" r="1.25"/>
  <path d="M12 10v6M9.5 13h5" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'delivery-qa', 'render-queue', `
  <path d="M4 6h10v4H4zM4 14h10v4H4z"/>
  <path d="M18 6v9M15 12l3 3 3-3" stroke="var(--chai-icon-accent, currentColor)"/>
  <path d="M16 19h4"/>
`);
add('P2', 'delivery-qa', 'receipt', `
  <path d="M6 4h12v17l-3-2-3 2-3-2-3 2z"/>
  <path d="M9 8h6M9 12h6M9 16h3"/>
  <circle cx="15" cy="16" r="1" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
add('P2', 'delivery-qa', 'preflight', `
  <path d="M4 5h12v14H4z"/>
  <path d="M7 9h6M7 13h4"/>
  <circle cx="17" cy="16" r="3.5"/>
  <path d="M15.5 16l1 1 2-2" stroke="var(--chai-icon-accent, currentColor)"/>
`);
reuse('P2', 'delivery-qa', 'qa-scan');
add('P2', 'delivery-qa', 'approve', `
  <circle cx="12" cy="12" r="8.5"/>
  <path d="M7.75 12l2.75 2.75 5.75-6" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'delivery-qa', 'deliver-output', `
  <path d="M4 7h10v12H4z"/>
  <path d="M9 12h11M16 8l4 4-4 4" stroke="var(--chai-icon-accent, currentColor)"/>
`);

// P2 — System truth
add('P2', 'system-truth', 'status-ready', `
  <circle cx="12" cy="12" r="8.5"/>
  <path d="M7.75 12l2.75 2.75 5.75-6" stroke="var(--chai-icon-accent, currentColor)"/>
  <circle cx="12" cy="12" r="1" fill="var(--chai-icon-accent, currentColor)" stroke="none" opacity=".25"/>
`, 'success');
add('P2', 'system-truth', 'status-working', `
  <circle cx="12" cy="12" r="8" opacity=".3"/>
  <path d="M12 4a8 8 0 0 1 8 8" stroke="var(--chai-icon-accent, currentColor)"/>
  <path d="M18 9l2 3 2-3" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'system-truth', 'status-info', `
  <circle cx="12" cy="12" r="8.5"/>
  <path d="M12 11v5" stroke="var(--chai-icon-accent, currentColor)"/>
  <circle cx="12" cy="8" r="1" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);
reuse('P2', 'system-truth', 'status-warning', 'amber');
add('P2', 'system-truth', 'status-danger', `
  <circle cx="12" cy="12" r="8.5"/>
  <path d="M9 9l6 6M15 9l-6 6" stroke="var(--chai-icon-accent, currentColor)"/>
`, 'danger');
add('P2', 'system-truth', 'status-offline', `
  <circle cx="12" cy="12" r="8.5"/>
  <path d="M8 12h8M4 4l16 16" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'system-truth', 'status-read-only', `
  <path d="M4 5h11l5 5v9H4zM15 5v5h5"/>
  <rect x="9" y="13" width="7" height="6" rx="1.25"/>
  <path d="M11 13v-1.25a1.5 1.5 0 0 1 3 0V13" stroke="var(--chai-icon-accent, currentColor)"/>
`);
add('P2', 'system-truth', 'status-conflict', `
  <path d="M12 3.5v17M12 7H7a3 3 0 0 0-3 3v2M12 17h5a3 3 0 0 0 3-3v-2"/>
  <path d="M4 9l-2 3 2 3M20 9l2 3-2 3" stroke="var(--chai-icon-accent, currentColor)"/>
  <circle cx="12" cy="12" r="1.25" fill="var(--chai-icon-accent, currentColor)" stroke="none"/>
`);

const inventory = [...icons.values()];
if (inventory.length !== 123) {
  throw new Error(`Expected 123 icons, received ${inventory.length}`);
}

fs.mkdirSync(outputRoot, { recursive: true });
for (const item of inventory) {
  const target = path.join(outputRoot, `${item.name}.svg`);
  if (item.body === null) {
    fs.copyFileSync(path.join(proofRoot, `${item.name}.svg`), target);
  } else {
    fs.writeFileSync(target, svg(item.body));
  }
}

const manifest = {
  name: 'chai-studio-icon-system',
  version: '1.0.0-candidate',
  status: 'isolated-full-set-candidate',
  integrated: false,
  grid: 24,
  strokeWidth: 1.75,
  liveSizes: [14, 16, 20, 24],
  total: inventory.length,
  phases: Object.fromEntries(['P0', 'P1', 'P2'].map((phase) => [phase, inventory.filter((item) => item.phase === phase).length])),
  icons: inventory.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'body')))
};
fs.writeFileSync(path.join(packageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Generated ${inventory.length} Chai Studio SVG icons.`);
