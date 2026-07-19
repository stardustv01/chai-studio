# Frozen contract 01 — Audio transport v1

The master scheduler owns frame, session, play rate, loop range, seeks, and presentation. The shared audio graph is a follower. Master-to-sample mapping uses exact rational arithmetic, floor at inclusive starts, and ceiling at exclusive ends. At 30000/1001 and 48 kHz, 300 frames end at sample 480480.

A start or seek barrier performs: mute/suspend program output; halt engine transports; invalidate the prior session; prepare exact native frames and the shared graph at the mapped sample; wait for ready or declared degradation; present video atomically; then schedule shared audio against the same session. Stale-session readiness cannot present.

Transport policy:

- Space toggles +1× play/pause. K pauses.
- L cycles +1×, +2×, +4×; J cycles −1×, −2×, −4×. Reversing direction starts at ±1×.
- Program audio is audible only at +1× in v1. Non-unit and reverse shuttle mute program audio and expose that state; they never fall back to engine audio.
- Scrubbing uses bounded shared-graph grains when implemented; until P16, scrub is silent and visibly so. Scrubbing never starts uncontrolled native audio.
- Final non-unit speed uses the exact clip mapping. Audio is muted unless an explicitly supported deterministic stretch policy is selected and enters dependency identity.
- Engine-native audio is always suppressed in the program mix; explicit isolated source inspection is separate.

Drift is measured against scheduler frame/sample authority. More than half a master frame or its sample equivalent requires a barrier hard resync. Smaller corrections may adjust follower scheduling but never change authoritative time. Reports include expected/observed frame and sample, base/output latency, barrier duration, correction, and session ID.

Evidence: `spikes/milestone-0/tests/audio-transport.test.mjs`, `evidence/web-audio-result.json`, `evidence/mixed-finish-result.json`.
