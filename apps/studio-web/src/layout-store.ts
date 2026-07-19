import type { WorkspaceId } from "./types.js";

export interface WorkspaceLayout {
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly lowerHeight: number;
  readonly leftCollapsed: boolean;
  readonly rightCollapsed: boolean;
  readonly lowerCollapsed: boolean;
}

export const fullLayoutViewport = { width: 1180, height: 720 } as const;
// Version 2 intentionally drops the review-build layouts that could persist a
// zero-height lower panel before resize normalization was enforced.
export const layoutStorageVersion = 2 as const;

export const defaultLayouts: Readonly<Record<WorkspaceId, WorkspaceLayout>> = {
  edit: createLayout(244, 300, 286),
  inspect: createLayout(230, 340, 190),
  media: createLayout(220, 320, 280),
  animation: createLayout(190, 350, 340),
  deliver: createLayout(245, 330, 0, false, false, true),
};

export const normalizeLayout = (
  candidate: Partial<WorkspaceLayout>,
  fallback: WorkspaceLayout,
  viewportWidth: number = fullLayoutViewport.width,
  viewportHeight: number = fullLayoutViewport.height,
): WorkspaceLayout => {
  const maxSide = Math.max(220, Math.floor(viewportWidth * 0.34));
  const maxLower = Math.max(180, Math.floor(viewportHeight * 0.48));
  return {
    leftWidth: bounded(candidate.leftWidth, 180, maxSide, fallback.leftWidth),
    rightWidth: bounded(candidate.rightWidth, 240, maxSide, fallback.rightWidth),
    lowerHeight: bounded(candidate.lowerHeight, 160, maxLower, fallback.lowerHeight),
    leftCollapsed: boolean(candidate.leftCollapsed, fallback.leftCollapsed),
    rightCollapsed: boolean(candidate.rightCollapsed, fallback.rightCollapsed),
    lowerCollapsed: boolean(candidate.lowerCollapsed, fallback.lowerCollapsed),
  };
};

export const loadWorkspaceLayout = (
  workspace: WorkspaceId,
  storage: Pick<Storage, "getItem"> = window.localStorage,
): WorkspaceLayout => {
  const fallback = defaultLayouts[workspace];
  try {
    const stored = storage.getItem(storageKey(workspace));
    if (stored === null) return fallback;
    const parsed = JSON.parse(stored) as {
      readonly version?: number;
      readonly layout?: Partial<WorkspaceLayout>;
    };
    if (parsed.version !== layoutStorageVersion || parsed.layout === undefined) return fallback;
    const viewportWidth = typeof window === "undefined" ? fullLayoutViewport.width : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? fullLayoutViewport.height : window.innerHeight;
    return normalizeLayout(parsed.layout, fallback, viewportWidth, viewportHeight);
  } catch {
    return fallback;
  }
};

export const saveWorkspaceLayout = (
  workspace: WorkspaceId,
  value: WorkspaceLayout,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void => {
  try {
    storage.setItem(
      storageKey(workspace),
      JSON.stringify({ version: layoutStorageVersion, workspace, layout: value }),
    );
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. Layout
    // interaction must remain usable even when persistence cannot be written.
  }
};

function createLayout(
  leftWidth: number,
  rightWidth: number,
  lowerHeight: number,
  leftCollapsed = false,
  rightCollapsed = false,
  lowerCollapsed = false,
): WorkspaceLayout {
  return { leftWidth, rightWidth, lowerHeight, leftCollapsed, rightCollapsed, lowerCollapsed };
}

const bounded = (value: number | undefined, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

const boolean = (value: boolean | undefined, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const storageKey = (workspace: WorkspaceId): string =>
  `chai-studio.workspace-layout.v${String(layoutStorageVersion)}.${workspace}`;
