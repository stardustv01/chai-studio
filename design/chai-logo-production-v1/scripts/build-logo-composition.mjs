import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const mastersDir = path.join(root, "masters");
const compositionsDir = path.join(root, "compositions");

function readOutline(filename) {
  const source = fs.readFileSync(path.join(mastersDir, filename), "utf8");
  const paths = [...source.matchAll(/<g id="glyph-0-(\d+)">\s*<path d="([^"]+)"\/>/g)].map(
    (match) => ({ index: Number(match[1]), d: match[2] }),
  );
  const uses = [...source.matchAll(/<use xlink:href="#glyph-0-(\d+)" x="([^"]+)" y="([^"]+)"\/>/g)].map(
    (match) => ({
      index: Number(match[1]),
      x: Number(match[2]),
      y: Number(match[3]),
    }),
  );

  if (!paths.length || !uses.length) {
    throw new Error(`Could not parse outline geometry from ${filename}`);
  }

  const pathIndexes = new Set(paths.map(({ index }) => index));
  return {
    paths,
    uses: uses.filter(({ index }) => pathIndexes.has(index)),
  };
}

function glyphDefs(prefix, outline) {
  return outline.paths
    .map(({ index, d }) => `        <path id="${prefix}-glyph-${index}" d="${d}"/>`)
    .join("\n");
}

function glyphUse(prefix, use) {
  return `<use href="#${prefix}-glyph-${use.index}" transform="translate(${use.x} ${use.y})"/>`;
}

const devanagari = readOutline("chai-outline-regular-source.svg");
const english = readOutline("english-outline-source.svg");
const devanagariFirst = glyphUse("devanagari", devanagari.uses[0]);
const devanagariRest = devanagari.uses
  .slice(1)
  .map((use) => glyphUse("devanagari", use))
  .join("\n            ");
const englishUses = english.uses
  .map((use) => glyphUse("english", use))
  .join("\n              ");

function compositionHtml(gsapPath) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Chai Studio — Warm Timeline logo reveal</title>
    <script src="${gsapPath}"></script>
    <style>
      :root {
        --ink: #070a12;
        --ivory: #f5efe2;
        --amber: #f2b33f;
        --cyan: #19d9ea;
      }

      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      html,
      body {
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: transparent;
      }

      #stage {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }

      #logo-reveal-clip {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }

      .midnight-field {
        position: absolute;
        inset: 0;
        background: var(--ink);
      }

      .scene-content {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        padding: 120px 160px;
      }

      .lockup-svg {
        display: block;
        width: 900px;
        height: auto;
        max-width: calc(100% - 320px);
        overflow: visible;
      }

      #timeline-trace,
      #amber-pulse {
        stroke-dasharray: 1;
        stroke-dashoffset: 0;
      }

      #timeline-hold {
        position: absolute;
        width: 0;
        height: 0;
        opacity: 0;
      }
    </style>
  </head>
  <body>
    <main
      id="stage"
      data-composition-id="chai-logo-reveal"
      data-start="0"
      data-duration="2.4"
      data-fps="60"
      data-width="1920"
      data-height="1080"
    >
      <section
        id="logo-reveal-clip"
        class="clip"
        data-start="0"
        data-duration="2.4"
        data-track-index="1"
      >
        <div class="midnight-field" aria-hidden="true"></div>
        <div class="scene-content">
          <svg
            class="lockup-svg"
            viewBox="-24 88 810 570"
            role="img"
            aria-labelledby="logo-title logo-description"
            shape-rendering="geometricPrecision"
          >
            <title id="logo-title">Chai Studio</title>
            <desc id="logo-description">Authentic Devanagari Chai wordmark with a precise timeline, restrained playhead, and one warm inner gesture.</desc>
            <defs>
${glyphDefs("devanagari", devanagari)}
${glyphDefs("english", english)}
              <mask id="devanagari-first-mask" maskUnits="userSpaceOnUse" x="-40" y="80" width="390" height="480">
                <rect
                  id="devanagari-first-mask-rect"
                  x="-40"
                  y="80"
                  width="390"
                  height="480"
                  fill="white"
                />
              </mask>
              <mask id="devanagari-rest-mask" maskUnits="userSpaceOnUse" x="300" y="80" width="500" height="480">
                <rect
                  id="devanagari-rest-mask-rect"
                  x="300"
                  y="80"
                  width="500"
                  height="480"
                  fill="white"
                />
              </mask>
            </defs>

            <path
              id="timeline-trace"
              d="M0 158.4605 H761.863281"
              pathLength="1"
              fill="none"
              stroke="var(--ivory)"
              stroke-width="36.351562"
              stroke-linecap="butt"
            />

            <g
              id="devanagari-first"
              fill="var(--ivory)"
              mask="url(#devanagari-first-mask)"
            >
              ${devanagariFirst}
            </g>

            <g
              id="devanagari-rest"
              fill="var(--ivory)"
              mask="url(#devanagari-rest-mask)"
            >
              ${devanagariRest}
            </g>

            <g id="timeline-ticks" fill="var(--ink)" aria-hidden="true">
              <rect x="204" y="137" width="7" height="43" rx="3.5" />
              <rect x="390" y="137" width="7" height="43" rx="3.5" />
              <rect x="609" y="137" width="7" height="43" rx="3.5" />
            </g>

            <g id="playhead" fill="var(--cyan)" stroke="var(--cyan)" aria-hidden="true">
              <path
                d="M470 104 V458.75"
                fill="none"
                stroke-width="5"
                stroke-linecap="round"
              />
              <circle cx="470" cy="104" r="5" stroke="none" />
            </g>

            <path
              id="amber-pulse"
              d="M84 382 C128 410 166 393 196 365 C215 347 235 341 258 347"
              pathLength="1"
              fill="none"
              stroke="var(--amber)"
              stroke-width="18"
              stroke-linecap="round"
              stroke-linejoin="round"
            />

            <g id="english-companion" fill="var(--ivory)">
              <g transform="translate(147 494) scale(.47)">
                ${englishUses}
              </g>
            </g>
          </svg>
        </div>
        <div id="timeline-hold" aria-hidden="true"></div>
      </section>
    </main>

    <script>
      window.__timelines = window.__timelines || {};

      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const tl = gsap.timeline({ paused: true });

      if (!reduceMotion) {
        tl.fromTo(
          "#timeline-trace",
          { strokeDashoffset: 1, autoAlpha: 1 },
          { strokeDashoffset: 0, autoAlpha: 1, duration: 0.18, ease: "power2.out" },
          0,
        );

        tl.fromTo(
          "#timeline-ticks",
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 0.07, ease: "power1.out" },
          0.11,
        );

        tl.fromTo(
          "#playhead",
          { y: -44, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.18, ease: "power3.out" },
          0.18,
        );

        tl.fromTo(
          "#devanagari-first-mask-rect",
          { scaleX: 0, transformOrigin: "left center", transformBox: "fill-box" },
          {
            scaleX: 1,
            transformOrigin: "left center",
            transformBox: "fill-box",
            duration: 0.28,
            ease: "power2.out",
          },
          0.18,
        );

        tl.fromTo(
          "#devanagari-rest-mask-rect",
          { scaleX: 0, transformOrigin: "left center", transformBox: "fill-box" },
          {
            scaleX: 1,
            transformOrigin: "left center",
            transformBox: "fill-box",
            duration: 0.22,
            ease: "power2.out",
          },
          0.3,
        );

        tl.fromTo(
          "#amber-pulse",
          { strokeDashoffset: 1, autoAlpha: 0 },
          {
            strokeDashoffset: 0,
            autoAlpha: 1,
            duration: 0.32,
            ease: "power2.out",
          },
          0.3,
        );

        tl.fromTo(
          "#english-companion",
          { y: 8, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.16, ease: "power2.out" },
          0.46,
        );

      }

      tl.fromTo(
        "#timeline-hold",
        { autoAlpha: 0 },
        { autoAlpha: 0, duration: 2.4, ease: "none" },
        0,
      );

      window.__timelines["chai-logo-reveal"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

fs.mkdirSync(compositionsDir, { recursive: true });
fs.writeFileSync(
  path.join(compositionsDir, "index.html"),
  compositionHtml("node_modules/gsap/dist/gsap.min.js"),
);
fs.writeFileSync(
  path.join(root, "index.html"),
  compositionHtml("node_modules/gsap/dist/gsap.min.js"),
);

console.log("Built the standalone Chai logo reveal at index.html and compositions/index.html");
