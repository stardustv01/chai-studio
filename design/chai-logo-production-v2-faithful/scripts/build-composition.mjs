import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const layers = JSON.parse(await fs.readFile(path.join(root, "work", "layers.json"), "utf8"));

const composition = (gsapPath) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chai Studio — faithful Warm Timeline reveal</title>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #070a12; }
      body { display: grid; place-items: center; }
      #chai-logo-faithful-root {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
      .clip { position: absolute; inset: 0; }
      .midnight-field {
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 50% 38%, #10182a 0%, #070a12 48%, #05070c 100%);
      }
      .mark-stage { position: absolute; inset: 0; display: grid; place-items: center; }
      .mark-stage svg { width: 1100px; height: 660px; overflow: visible; }
      .traced-layer { shape-rendering: geometricPrecision; }
      @media (prefers-reduced-motion: reduce) {
        #timeline-mask-rect, #first-mask-rect, #rest-mask-rect, #amber-mask-rect { transform: scaleX(1); }
        #cyan-layer, #english-layer { opacity: 1; }
      }
    </style>
  </head>
  <body>
    <div
      id="chai-logo-faithful-root"
      data-composition-id="chai-logo-faithful-reveal"
      data-start="0"
      data-duration="2.4"
      data-fps="60"
      data-width="1920"
      data-height="1080"
    >
      <div id="midnight-field" class="clip" data-start="0" data-duration="2.41" data-track-index="0">
        <div class="midnight-field"></div>
      </div>
      <div id="faithful-mark-clip" class="clip" data-start="0" data-duration="2.41" data-track-index="1">
        <div class="mark-stage">
          <svg viewBox="0 0 600 360" role="img" aria-labelledby="mark-title mark-desc">
            <title id="mark-title">Chai Studio approved Warm Timeline logo</title>
            <desc id="mark-desc">A faithful vector reconstruction of the approved custom Chai Studio artwork</desc>
            <defs>
              <mask id="timeline-reveal-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect id="timeline-mask-rect" width="600" height="90" fill="white" /></mask>
              <mask id="first-reveal-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect id="first-mask-rect" y="62" width="315" height="208" fill="white" /></mask>
              <mask id="rest-reveal-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect id="rest-mask-rect" x="295" y="62" width="305" height="208" fill="white" /></mask>
              <mask id="amber-reveal-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect id="amber-mask-rect" y="130" width="325" height="120" fill="white" /></mask>
            </defs>
            <g class="traced-layer" mask="url(#timeline-reveal-mask)">${layers.timeline}</g>
            <g class="traced-layer" mask="url(#first-reveal-mask)">${layers.first}</g>
            <g class="traced-layer" mask="url(#rest-reveal-mask)">${layers.rest}</g>
            <g class="traced-layer" mask="url(#amber-reveal-mask)">${layers.amber}</g>
            <g class="traced-layer">${layers.cyan}</g>
            <g class="traced-layer">${layers.english}</g>
          </svg>
        </div>
      </div>
    </div>
    <script src="${gsapPath}"></script>
    <script>
      (() => {
        const compositionId = "chai-logo-faithful-reveal";
        const tl = gsap.timeline({ paused: true });
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (!reduce) {
          tl.fromTo("#timeline-mask-rect", { scaleX: 0, svgOrigin: "0 45" }, { scaleX: 1, svgOrigin: "0 45", duration: 0.22, ease: "power2.out" }, 0);
          tl.fromTo("#first-mask-rect", { scaleX: 0, svgOrigin: "0 166" }, { scaleX: 1, svgOrigin: "0 166", duration: 0.18, ease: "power2.out" }, 0.18);
          tl.fromTo("#cyan-layer", { y: -34, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.18, ease: "power2.out" }, 0.18);
          tl.fromTo("#amber-mask-rect", { scaleX: 0, svgOrigin: "0 190" }, { scaleX: 1, svgOrigin: "0 190", duration: 0.18, ease: "power2.out" }, 0.18);
          tl.fromTo("#rest-mask-rect", { scaleX: 0, svgOrigin: "295 166" }, { scaleX: 1, svgOrigin: "295 166", duration: 0.20, ease: "power2.out" }, 0.36);
          tl.fromTo("#english-layer", { y: 7, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.16, ease: "power2.out" }, 0.46);
        }

        window.__timelines = window.__timelines || {};
        window.__timelines[compositionId] = tl;
        tl.seek(0);
      })();
    </script>
  </body>
</html>`;

await fs.mkdir(path.join(root, "compositions"), { recursive: true });
await fs.writeFile(path.join(root, "index.html"), composition("./node_modules/gsap/dist/gsap.min.js"), "utf8");
await fs.writeFile(
  path.join(root, "compositions", "index.html"),
  composition("node_modules/gsap/dist/gsap.min.js"),
  "utf8",
);

const motion = {
  duration: 2.4,
  assertions: [
    { kind: "appearsBy", selector: "#cyan-layer", bySec: 0.36 },
    { kind: "appearsBy", selector: "#english-layer", bySec: 0.62 },
    { kind: "before", a: "#cyan-layer", b: "#english-layer" },
    { kind: "staysInFrame", selector: "#faithful-mark-clip" },
    { kind: "keepsMoving", withinSelector: "#faithful-mark-clip", maxStaticSec: 1.85 },
  ],
};
await fs.writeFile(path.join(root, "index.motion.json"), JSON.stringify(motion, null, 2) + "\n", "utf8");
await fs.writeFile(
  path.join(root, "compositions", "index.motion.json"),
  JSON.stringify(motion, null, 2) + "\n",
  "utf8",
);
