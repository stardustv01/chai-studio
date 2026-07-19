# ADR 0008 — Initial Apple M4 budgets

**Status:** Accepted for P02

On Apple M4 with 16 GB memory, the initial native-still p95 budget is 5 seconds per engine. Five measured samples passed: HyperFrames 3,385 ms p95 and Remotion 597 ms p95 after a 795 ms setup. Observed draft throughput was about 20.9 fps for the 640×360 HyperFrames fixture and 17.6 fps for the 300-frame mixed finish. Maximum RSS was about 219 MB and 427 MB respectively, with zero swaps.

Evidence: `evidence/native-still-benchmark.json`, `evidence/benchmark-report.json`, and `evidence/resource-benchmark.json`.

These are support claims only for this M4/16 GB fixture class. P26 expands cold/warm, project-size, GPU-heavy, long-timeline, memory, and degradation classes. Scheduler-core microbenchmarks are not presented as live browser-proxy latency.
