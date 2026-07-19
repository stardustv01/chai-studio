import type { PreviewLayerAdapter, PreviewLayerLifecycleState } from "./preview-contract.js";

export interface PreviewLayerLifecycleSnapshot {
  readonly adapterId: string;
  readonly layerId: string;
  readonly state: PreviewLayerLifecycleState;
  readonly error: string | null;
  readonly stateVersion: number;
}

export class PreviewLayerLifecycle {
  readonly #adapter: PreviewLayerAdapter;
  #state: PreviewLayerLifecycleState = "unloaded";
  #error: string | null = null;
  #stateVersion = 1;

  constructor(adapter: PreviewLayerAdapter) {
    this.#adapter = adapter;
  }

  snapshot(): PreviewLayerLifecycleSnapshot {
    return {
      adapterId: this.#adapter.adapterId,
      layerId: this.#adapter.layerId,
      state: this.#state,
      error: this.#error,
      stateVersion: this.#stateVersion,
    };
  }

  transition(next: PreviewLayerLifecycleState, error: string | null = null): PreviewLayerLifecycleSnapshot {
    const allowed = lifecycleTransitions[this.#state];
    if (!allowed.has(next)) {
      throw new Error(
        `Preview layer ${this.#adapter.layerId} cannot transition from ${this.#state} to ${next}.`,
      );
    }
    this.#state = next;
    this.#error = next === "error" ? (error ?? "Layer failed without a diagnostic.") : null;
    this.#stateVersion += 1;
    return this.snapshot();
  }
}

const lifecycleTransitions: Readonly<
  Record<PreviewLayerLifecycleState, ReadonlySet<PreviewLayerLifecycleState>>
> = {
  unloaded: new Set(["preloading", "disposed"]),
  preloading: new Set(["ready", "error", "disposed"]),
  ready: new Set(["preloading", "presenting", "suspended", "error", "disposed"]),
  presenting: new Set(["ready", "suspended", "error", "disposed"]),
  suspended: new Set(["preloading", "ready", "presenting", "error", "disposed"]),
  error: new Set(["preloading", "suspended", "disposed"]),
  disposed: new Set(),
};
