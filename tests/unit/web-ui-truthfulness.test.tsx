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
});
