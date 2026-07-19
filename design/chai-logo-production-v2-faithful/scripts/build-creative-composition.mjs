import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const layers = JSON.parse(await fs.readFile(path.join(root, "work", "layers.json"), "utf8"));
const gsapSource = await fs.readFile(path.join(root, "node_modules", "gsap", "dist", "gsap.min.js"), "utf8");

const prefixIds = (markup, prefix) => markup.replaceAll(/id="([^"]+)"/g, `id="${prefix}-$1"`);
const creativeLayers = Object.fromEntries(
  Object.entries(layers).map(([name, markup]) => [name, prefixIds(markup, "creative")]),
);

const composition = (gsapPath) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chai Studio — Precision Awakens Warmth</title>
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #070a12; }
      body { display: grid; place-items: center; }
      #chai-logo-creative-root {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
      .clip { position: absolute; inset: 0; }
      .creative-midnight-field {
        position: absolute;
        inset: 0;
        background: radial-gradient(circle at 50% 38%, #10182a 0%, #070a12 48%, #05070c 100%);
      }
      #creative-warm-bloom {
        position: absolute;
        inset: -18%;
        opacity: 0;
        background: radial-gradient(circle at 39% 51%, rgba(242, 179, 63, 0.22) 0%, rgba(242, 179, 63, 0.08) 14%, rgba(242, 179, 63, 0) 38%);
        will-change: transform, opacity;
      }
      .creative-mark-stage { position: absolute; inset: 0; display: grid; place-items: center; }
      .creative-mark-stage svg { width: 1100px; height: 660px; overflow: visible; }
      .creative-traced-layer { shape-rendering: geometricPrecision; }
      .creative-signal-route {
        fill: none;
        stroke: #19d9ea;
        stroke-width: 2.2;
        stroke-linecap: round;
        opacity: 0;
      }
      .creative-signal-dot { fill: #19d9ea; opacity: 0; }
      .creative-vertical-dot { fill: #19d9ea; opacity: 0; }
      #creative-cyan-pulse { fill: #19d9ea; opacity: 0; }
      #creative-vertical-pulse { fill: #19d9ea; opacity: 0; }
      @media (prefers-reduced-motion: reduce) {
        #creative-timeline-left-mask-rect,
        #creative-timeline-right-mask-rect,
        #creative-first-mask-rect,
        #creative-rest-mask-rect,
        #creative-amber-mask-rect,
        #creative-cyan-top-mask-rect,
        #creative-cyan-bottom-mask-rect { transform: scale(1); }
        #creative-cyan-layer,
        #creative-english-layer { opacity: 1; }
        .creative-signal-route,
        .creative-signal-dot,
        .creative-vertical-dot,
        #creative-cyan-pulse,
        #creative-vertical-pulse,
        #creative-warm-bloom { opacity: 0; }
      }
    </style>
  </head>
  <body>
    <div
      id="chai-logo-creative-root"
      data-composition-id="chai-logo-precision-warmth"
      data-start="0"
      data-duration="2.4"
      data-fps="60"
      data-width="1920"
      data-height="1080"
    >
      <div id="creative-midnight-clip" class="clip" data-start="0" data-duration="2.41" data-track-index="0">
        <div class="creative-midnight-field"></div>
        <div id="creative-warm-bloom" data-layout-ignore></div>
      </div>
      <div id="creative-mark-clip" class="clip" data-start="0" data-duration="2.41" data-track-index="1">
        <div class="creative-mark-stage">
          <svg viewBox="0 0 600 360" role="img" aria-labelledby="creative-mark-title creative-mark-desc">
            <title id="creative-mark-title">Chai Studio approved Warm Timeline logo</title>
            <desc id="creative-mark-desc">Precision travels through the timeline and awakens warmth in the approved custom Chai Studio artwork</desc>
            <defs>
              <mask id="creative-timeline-reveal-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
                <rect id="creative-timeline-left-mask-rect" width="413" height="90" fill="white" />
                <rect id="creative-timeline-right-mask-rect" x="413" width="187" height="90" fill="white" />
              </mask>
              <mask id="creative-first-reveal-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect id="creative-first-mask-rect" y="62" width="315" height="208" fill="white" /></mask>
              <mask id="creative-rest-reveal-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect id="creative-rest-mask-rect" x="295" y="62" width="305" height="208" fill="white" /></mask>
              <mask id="creative-amber-reveal-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect id="creative-amber-mask-rect" x="105" y="130" width="170" height="120" fill="white" /></mask>
              <mask id="creative-cyan-reveal-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">
                <rect id="creative-cyan-top-mask-rect" x="404" y="12" width="18" height="127.5" fill="white" />
                <rect id="creative-cyan-bottom-mask-rect" x="404" y="139.5" width="18" height="126.5" fill="white" />
              </mask>
              <filter id="creative-pulse-soften" x="-200%" y="-200%" width="400%" height="400%">
                <feGaussianBlur stdDeviation="8" />
              </filter>
            </defs>

            <circle id="creative-cyan-pulse" cx="413" cy="52" r="17" filter="url(#creative-pulse-soften)" data-layout-ignore />
            <circle id="creative-vertical-pulse" cx="413" cy="139.5" r="13" filter="url(#creative-pulse-soften)" data-layout-ignore />
            <g class="creative-traced-layer" mask="url(#creative-timeline-reveal-mask)">${creativeLayers.timeline}</g>
            <path id="creative-signal-left-route" class="creative-signal-route" d="M 25 52 H 413" data-layout-ignore />
            <path id="creative-signal-right-route" class="creative-signal-route" d="M 572 52 H 413" data-layout-ignore />
            <circle id="creative-signal-left-dot" class="creative-signal-dot" cx="25" cy="52" r="4.2" data-layout-ignore />
            <circle id="creative-signal-right-dot" class="creative-signal-dot" cx="572" cy="52" r="4.2" data-layout-ignore />
            <g class="creative-traced-layer" mask="url(#creative-first-reveal-mask)">${creativeLayers.first}</g>
            <g class="creative-traced-layer" mask="url(#creative-rest-reveal-mask)">${creativeLayers.rest}</g>
            <g class="creative-traced-layer" mask="url(#creative-amber-reveal-mask)">${creativeLayers.amber}</g>
            <g class="creative-traced-layer" mask="url(#creative-cyan-reveal-mask)">${creativeLayers.cyan}</g>
            <circle id="creative-vertical-top-dot" class="creative-vertical-dot" cx="413" cy="19" r="4.2" data-layout-ignore />
            <circle id="creative-vertical-bottom-dot" class="creative-vertical-dot" cx="413" cy="260" r="4.2" data-layout-ignore />
            <g class="creative-traced-layer">${creativeLayers.english}</g>
          </svg>
        </div>
      </div>
    </div>
    <script src="${gsapPath}"></script>
    <script>
      (() => {
        const compositionId = "chai-logo-precision-warmth";
        const tl = gsap.timeline({ paused: true });
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        if (!reduce) {
          const leftRoute = document.getElementById("creative-signal-left-route");
          const rightRoute = document.getElementById("creative-signal-right-route");
          const leftRouteLength = leftRoute.getTotalLength();
          const rightRouteLength = rightRoute.getTotalLength();
          leftRoute.style.strokeDasharray = String(leftRouteLength);
          leftRoute.style.strokeDashoffset = String(leftRouteLength);
          rightRoute.style.strokeDasharray = String(rightRouteLength);
          rightRoute.style.strokeDashoffset = String(rightRouteLength);

          tl.addLabel("converge", 0.12);
          tl.fromTo(
            "#creative-timeline-left-mask-rect",
            { scaleX: 0, svgOrigin: "25 52" },
            { scaleX: 1, svgOrigin: "25 52", duration: 0.42, ease: "power2.inOut" },
            "converge",
          );
          tl.fromTo(
            "#creative-timeline-right-mask-rect",
            { scaleX: 0, svgOrigin: "572 52" },
            { scaleX: 1, svgOrigin: "572 52", duration: 0.42, ease: "power2.inOut" },
            "converge",
          );
          tl.fromTo(
            leftRoute,
            { strokeDashoffset: leftRouteLength, autoAlpha: 0 },
            { strokeDashoffset: 0, autoAlpha: 1, duration: 0.42, ease: "none" },
            0.12,
          );
          tl.fromTo(
            rightRoute,
            { strokeDashoffset: rightRouteLength, autoAlpha: 0 },
            { strokeDashoffset: 0, autoAlpha: 1, duration: 0.42, ease: "none" },
            0.12,
          );
          tl.fromTo(
            "#creative-signal-left-dot",
            { x: 0, scale: 0.65, autoAlpha: 0, svgOrigin: "25 52" },
            { x: 388, scale: 1, autoAlpha: 1, svgOrigin: "25 52", duration: 0.42, ease: "power2.inOut" },
            0.12,
          );
          tl.fromTo(
            "#creative-signal-right-dot",
            { x: 0, scale: 0.65, autoAlpha: 0, svgOrigin: "572 52" },
            { x: -159, scale: 1, autoAlpha: 1, svgOrigin: "572 52", duration: 0.42, ease: "power2.inOut" },
            0.12,
          );

          tl.addLabel("horizontalLock", 0.54);
          tl.fromTo(
            "#creative-cyan-pulse",
            { scale: 0.3, autoAlpha: 0, svgOrigin: "413 52" },
            { scale: 1.28, autoAlpha: 0.34, svgOrigin: "413 52", duration: 0.20, ease: "power3.out" },
            "horizontalLock",
          );
          tl.to("#creative-cyan-pulse", { scale: 1.75, autoAlpha: 0, svgOrigin: "413 52", duration: 0.28, ease: "sine.out" }, 0.74);
          tl.to(".creative-signal-dot", { scale: 0.15, autoAlpha: 0, duration: 0.16, ease: "power2.in" }, "horizontalLock");
          tl.to(".creative-signal-route", { autoAlpha: 0, duration: 0.20, ease: "power1.in" }, 0.58);

          tl.addLabel("awaken", 0.56);
          tl.fromTo(
            "#creative-first-mask-rect",
            { scaleY: 0, svgOrigin: "158 62" },
            { scaleY: 1, svgOrigin: "158 62", duration: 0.34, ease: "power4.out" },
            "awaken",
          );

          tl.fromTo(
            "#creative-warm-bloom",
            { scale: 0.86, autoAlpha: 0 },
            { scale: 1.02, autoAlpha: 0.24, duration: 0.44, ease: "power2.out" },
            0.58,
          );
          tl.to("#creative-warm-bloom", { scale: 1.08, autoAlpha: 0, duration: 0.34, ease: "sine.inOut" }, 1.03);
          tl.fromTo(
            "#creative-amber-mask-rect",
            { scaleX: 0, svgOrigin: "112 190" },
            { scaleX: 1, svgOrigin: "112 190", duration: 0.32, ease: "power2.out" },
            0.64,
          );
          tl.fromTo(
            "#creative-rest-mask-rect",
            { scaleY: 0, svgOrigin: "448 62" },
            { scaleY: 1, svgOrigin: "448 62", duration: 0.36, ease: "power3.out" },
            0.62,
          );

          tl.addLabel("verticalConverge", 1.00);
          tl.fromTo(
            "#creative-cyan-top-mask-rect",
            { scaleY: 0, svgOrigin: "413 19" },
            { scaleY: 1, svgOrigin: "413 19", duration: 0.32, ease: "power2.inOut" },
            "verticalConverge",
          );
          tl.fromTo(
            "#creative-cyan-bottom-mask-rect",
            { scaleY: 0, svgOrigin: "413 260" },
            { scaleY: 1, svgOrigin: "413 260", duration: 0.32, ease: "power2.inOut" },
            "verticalConverge",
          );
          tl.fromTo(
            "#creative-vertical-top-dot",
            { y: 0, scale: 0.65, autoAlpha: 0, svgOrigin: "413 19" },
            { y: 120.5, scale: 1, autoAlpha: 1, svgOrigin: "413 19", duration: 0.32, ease: "power2.inOut" },
            "verticalConverge",
          );
          tl.fromTo(
            "#creative-vertical-bottom-dot",
            { y: 0, scale: 0.65, autoAlpha: 0, svgOrigin: "413 260" },
            { y: -120.5, scale: 1, autoAlpha: 1, svgOrigin: "413 260", duration: 0.32, ease: "power2.inOut" },
            "verticalConverge",
          );

          tl.addLabel("verticalLock", 1.32);
          tl.to(".creative-vertical-dot", { scale: 0.15, autoAlpha: 0, duration: 0.14, ease: "power2.in" }, "verticalLock");
          tl.fromTo(
            "#creative-vertical-pulse",
            { scale: 0.3, autoAlpha: 0, svgOrigin: "413 139.5" },
            { scale: 1.24, autoAlpha: 0.30, svgOrigin: "413 139.5", duration: 0.18, ease: "power3.out" },
            "verticalLock",
          );
          tl.to("#creative-vertical-pulse", { scale: 1.7, autoAlpha: 0, svgOrigin: "413 139.5", duration: 0.24, ease: "sine.out" }, 1.50);
          tl.fromTo(
            "#creative-english-layer",
            { y: 8, scaleX: 0.985, autoAlpha: 0, svgOrigin: "300 310" },
            { y: 0, scaleX: 1, autoAlpha: 1, svgOrigin: "300 310", duration: 0.30, ease: "sine.out" },
            1.42,
          );
        }

        window.__timelines = window.__timelines || {};
        window.__timelines[compositionId] = tl;
        tl.seek(0);
      })();
    </script>
  </body>
</html>`;

const motion = {
  duration: 2.4,
  assertions: [
    { kind: "appearsBy", selector: "#creative-signal-left-dot", bySec: 0.36 },
    { kind: "appearsBy", selector: "#creative-signal-right-dot", bySec: 0.36 },
    { kind: "appearsBy", selector: "#creative-vertical-top-dot", bySec: 1.20 },
    { kind: "appearsBy", selector: "#creative-vertical-bottom-dot", bySec: 1.20 },
    { kind: "appearsBy", selector: "#creative-cyan-layer", bySec: 1.32 },
    { kind: "appearsBy", selector: "#creative-english-layer", bySec: 1.72 },
    { kind: "before", a: "#creative-signal-left-dot", b: "#creative-english-layer" },
    { kind: "before", a: "#creative-signal-right-dot", b: "#creative-english-layer" },
    { kind: "before", a: "#creative-first-symbol-layer", b: "#creative-vertical-top-dot" },
    { kind: "before", a: "#creative-rest-symbol-layer", b: "#creative-vertical-top-dot" },
    { kind: "before", a: "#creative-vertical-top-dot", b: "#creative-english-layer" },
    { kind: "before", a: "#creative-vertical-bottom-dot", b: "#creative-english-layer" },
    { kind: "staysInFrame", selector: "#creative-mark-clip" },
    { kind: "keepsMoving", withinSelector: "#creative-mark-clip", maxStaticSec: 1.45 },
  ],
};

await fs.mkdir(path.join(root, "compositions"), { recursive: true });
await fs.mkdir(path.join(root, "creative-variant"), { recursive: true });
await fs.writeFile(
  path.join(root, "compositions", "creative-reveal.html"),
  composition("node_modules/gsap/dist/gsap.min.js"),
  "utf8",
);
await fs.writeFile(
  path.join(root, "compositions", "creative-reveal.motion.json"),
  JSON.stringify(motion, null, 2) + "\n",
  "utf8",
);
await fs.writeFile(
  path.join(root, "creative-variant", "index.html"),
  composition("gsap.min.js"),
  "utf8",
);
await fs.writeFile(path.join(root, "creative-variant", "gsap.min.js"), gsapSource, "utf8");
await fs.writeFile(
  path.join(root, "creative-variant", "index.motion.json"),
  JSON.stringify(motion, null, 2) + "\n",
  "utf8",
);
