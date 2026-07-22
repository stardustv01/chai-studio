# Chai Studio — Engine Adapter Contract Draft

**Status:** Draft v0.1; freeze only after Milestone 0

```ts
interface EngineAdapter {
  id: string;
  version: string;
  inspectCapabilities(): Promise<CapabilityReport>;
  validateSource(source: EngineSource): Promise<ValidationReport>;
  loadPreview(context: PreviewContext): Promise<PreviewHandle>;
  preload(range: FrameRange): Promise<void>;
  presentFrame(request: PresentFrameRequest): Promise<PresentedFrame>;
  beginSynchronizedPlayback(session: PlaybackSession): Promise<void>;
  haltSynchronizedPlayback(sessionId: string): Promise<PlaybackState>;
  reportPlaybackState(sessionId: string): Promise<PlaybackState>;
  renderStill(request: StillRenderRequest): Promise<RenderArtifact>;
  renderRange(request: RangeRenderRequest): Promise<RenderArtifact>;
  collectDependencies(source: EngineSource): Promise<DependencySet>;
  dispose(): Promise<void>;
}
```

## Contract rules

- The adapter never owns authoritative project time.
- Frame requests carry integer master frame, rational mapping, revision, environment, and cancellation identity.
- A presented frame reports readiness, actual sampled frame, warnings, approximation state, and dependencies.
- Native playback is an optimization under a scheduler-owned session and must report drift.
- Final artifacts record engine, adapter, browser/runtime, color, alpha, environment, trust policy, and dependency identity.
- Cancellation cannot publish a valid artifact.
- Trusted and imported-untrusted work use separated workers and caches.

## Capability statuses

`native`, `unified`, `bake_required`, `fallback_available`, `unsupported`, `experimental`.

Each capability records preview behavior, render behavior, owner, fallback, restrictions, and a passing fixture.

## Adapter-specific minimums

### Remotion

Composition discovery, props/metadata validation, Player lifecycle, exact still/range render, dependency collection, diagnostics, safe inspector descriptor, and finishing-compositor compatibility.

### HyperFrames

HTML metadata inspection, lint/inspect integration, isolated preview, master seek, exact still/range render, adapter/dependency discovery, native variable descriptor, nondeterminism reporting, and trust-policy enforcement.

### Shared media

Raw video/image/solid/caption layers, rational source sampling, proxies, common transforms, deterministic transitions, alpha, fallbacks, and native-audio suppression.

## Required conformance fixtures

Repeated seek, frame-step, long playback drift, exact still, range boundaries, alpha, missing source/font, cancellation, dependency change, environment change, untrusted policy violation, and upgrade compatibility.
