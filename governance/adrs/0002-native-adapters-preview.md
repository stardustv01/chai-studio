# ADR 0002 — Native adapters and preview truth

**Status:** Accepted

Remotion and HyperFrames stay native behind product-owned adapters. Interactive preview may layer prepared native frames with shared media, but it must show an approximation warning. Fidelity mode consumes native capture/final-compositor truth and must be visually distinct. One scheduler maps the displayed master frame to every layer.

Evidence: `fixtures/preview/proxy-manifest.json`, `evidence/interactive-preview-result.json`, `evidence/interactive-preview-native-proxies.png`, `evidence/hyperframes-snapshot-result.json`, and `evidence/remotion-still-result.json`.

Rejected: rewriting either engine into a lowest-common-denominator renderer and presenting proxy composition as final truth. P02 measured 2.80 ms p95 across 100 preloaded switches over 60 native frames per engine; P09 repeats this against production adapter processes.
