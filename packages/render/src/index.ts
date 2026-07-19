import type { EngineAdapterOwnership } from "@chai-studio/engine-adapters";

export * from "./contracts.js";
export * from "./artifact-store.js";
export * from "./bridge-scene.js";
export * from "./dag.js";
export * from "./delivery.js";
export * from "./execution.js";
export * from "./encode.js";
export * from "./identity.js";
export * from "./nodes.js";
export * from "./planning.js";
export * from "./progress.js";
export * from "./remotion-compositor.js";
export * from "./recovery.js";
export * from "./scheduler.js";

export interface RenderOwnership {
  readonly engines: EngineAdapterOwnership["engines"];
  readonly owns: "replaceable-final-compositor-boundary";
}

export const renderPackageBoundary: RenderOwnership = {
  engines: ["remotion", "hyperframes"],
  owns: "replaceable-final-compositor-boundary",
};
