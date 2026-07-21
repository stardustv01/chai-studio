import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AudioMixerPanel } from "../../apps/studio-web/src/audio-mixer-panel.js";
import { BridgeEditorPanel } from "../../apps/studio-web/src/bridge-editor-panel.js";
import { ProfessionalEditBar } from "../../apps/studio-web/src/professional-edit-bar.js";
import { defaultStudioSnapshot } from "../../apps/studio-web/src/types.js";

describe("web UI truthfulness", () => {
  it("renders authoritative audio state without invented signal measurements", () => {
    const markup = renderToStaticMarkup(
      createElement(AudioMixerPanel, {
        currentFrame: defaultStudioSnapshot.preview.masterFrame,
        graph: defaultStudioSnapshot.audioGraph,
        onCommand: vi.fn(),
      }),
    );

    expect(markup).toContain("Signal meters unavailable");
    expect(markup).toContain("Ducking analysis unavailable");
    expect(markup).toContain("Normalization unavailable");
    expect(markup).toContain("voiceover_take03.wav");
    expect(markup).toContain("Preview LUFS unavailable");
    expect(markup).toContain("True peak measured after render");
  });

  it("blocks experimental bridge persistence until rendered boundary QA exists", () => {
    const markup = renderToStaticMarkup(
      createElement(BridgeEditorPanel, { timeline: defaultStudioSnapshot.timeline, onCommand: vi.fn() }),
    );

    expect(markup).toContain("Rendered QA required");
    expect(markup).toContain("boundary QA");
    expect(markup).toContain("disabled");
  });

  it("renders professional edit controls from the authoritative timeline selection", () => {
    const markup = renderToStaticMarkup(
      createElement(ProfessionalEditBar, {
        currentFrame: defaultStudioSnapshot.preview.masterFrame,
        timeline: defaultStudioSnapshot.timeline,
        onCommand: vi.fn(),
        onFeedback: vi.fn(),
      }),
    );

    expect(markup).toContain("Professional edit controls");
    expect(markup).toContain("Roll −1");
    expect(markup).toContain("Slip +1");
    expect(markup).toContain("Compound");
  });

  it("renders truthful empty selections and unavailable bridge/audio states", () => {
    const timeline = {
      ...defaultStudioSnapshot.timeline,
      selection: { selectedIds: [], primaryId: null, anchorId: null },
      trackIds: [],
    };
    const audioGraph = {
      ...defaultStudioSnapshot.audioGraph,
      clips: [],
      crossfades: [],
      duckingRules: [],
    };

    const editMarkup = renderToStaticMarkup(
      createElement(ProfessionalEditBar, {
        currentFrame: defaultStudioSnapshot.preview.masterFrame,
        timeline,
        onCommand: vi.fn(),
        onFeedback: vi.fn(),
      }),
    );
    const bridgeMarkup = renderToStaticMarkup(
      createElement(BridgeEditorPanel, { timeline, onCommand: vi.fn() }),
    );
    const audioMarkup = renderToStaticMarkup(
      createElement(AudioMixerPanel, {
        currentFrame: defaultStudioSnapshot.preview.masterFrame,
        graph: audioGraph,
        onCommand: vi.fn(),
      }),
    );

    expect(editMarkup).toContain("Select a clip");
    expect(bridgeMarkup).toContain("No adjacent pair");
    expect(audioMarkup).toContain("Crossfade unavailable");
    expect(audioMarkup).toContain("Duck 0 dB");
  });

  it("disables meaningless still-image playback controls with a repair instruction", () => {
    const selectedId = defaultStudioSnapshot.timeline.selection.primaryId;
    expect(selectedId).not.toBeNull();
    if (selectedId === null) return;
    const selected = defaultStudioSnapshot.timeline.clips[selectedId];
    expect(selected).toBeDefined();
    if (selected === undefined) return;
    const timeline = {
      ...defaultStudioSnapshot.timeline,
      clips: {
        ...defaultStudioSnapshot.timeline.clips,
        [selectedId]: {
          ...selected,
          metadata: { ...selected.metadata, assetKind: "image" },
          sourceRange: { start: 0n, end: 150n },
          availableSourceRange: { start: 0n, end: 150n },
        },
      },
    };

    const markup = renderToStaticMarkup(
      createElement(ProfessionalEditBar, {
        currentFrame: defaultStudioSnapshot.preview.masterFrame,
        timeline,
        onCommand: vi.fn(),
        onFeedback: vi.fn(),
      }),
    );

    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(5);
    expect(markup).toContain("Still clips already hold one source frame");
    expect(markup).toContain("Still clips have no reusable source handles to slip");
  });

  it("disables slip in each direction when a video clip has no corresponding source handle", () => {
    const selectedId = defaultStudioSnapshot.timeline.selection.primaryId;
    expect(selectedId).not.toBeNull();
    if (selectedId === null) return;
    const selected = defaultStudioSnapshot.timeline.clips[selectedId];
    expect(selected).toBeDefined();
    if (selected === undefined) return;
    const timeline = {
      ...defaultStudioSnapshot.timeline,
      clips: {
        ...defaultStudioSnapshot.timeline.clips,
        [selectedId]: {
          ...selected,
          sourceRange: { start: 0n, end: 150n },
          availableSourceRange: { start: 0n, end: 150n },
        },
      },
    };

    const markup = renderToStaticMarkup(
      createElement(ProfessionalEditBar, {
        currentFrame: defaultStudioSnapshot.preview.masterFrame,
        timeline,
        onCommand: vi.fn(),
        onFeedback: vi.fn(),
      }),
    );

    expect(markup).toContain("No earlier source frames are available for Slip −1");
    expect(markup).toContain("No later source frames are available for Slip +1");
  });
});
