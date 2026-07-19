import { qaHash } from "./contracts.js";

export type ReviewChecklistCategory =
  | "boundary"
  | "phrase-anchor"
  | "transition-midpoint"
  | "caption"
  | "alpha"
  | "shader"
  | "continuity"
  | "color"
  | "first-frame"
  | "last-frame";

export interface ReviewChecklistItem {
  readonly id: string;
  readonly category: ReviewChecklistCategory;
  readonly frame: string;
  readonly entityIds: readonly string[];
  readonly instruction: string;
  readonly required: true;
  readonly status: "pending" | "passed" | "failed";
  readonly reviewerId: string | null;
  readonly evidenceHashes: readonly string[];
  readonly reviewedAt: string | null;
}

export interface ReviewChecklist {
  readonly schemaVersion: "1.0.0";
  readonly id: string;
  readonly outputId: string;
  readonly revisionId: string;
  readonly items: readonly ReviewChecklistItem[];
  readonly complete: boolean;
  readonly identityHash: string;
}

export const createReviewChecklist = (input: {
  readonly id: string;
  readonly outputId: string;
  readonly revisionId: string;
  readonly checkpoints: readonly Omit<
    ReviewChecklistItem,
    "id" | "required" | "status" | "reviewerId" | "evidenceHashes" | "reviewedAt"
  >[];
}): ReviewChecklist => {
  const items = input.checkpoints.map((checkpoint, index) => ({
    ...checkpoint,
    id: `review-check-${String(index + 1).padStart(4, "0")}-${qaHash(checkpoint).slice(0, 12)}`,
    required: true as const,
    status: "pending" as const,
    reviewerId: null,
    evidenceHashes: [],
    reviewedAt: null,
  }));
  const base = {
    schemaVersion: "1.0.0" as const,
    id: input.id,
    outputId: input.outputId,
    revisionId: input.revisionId,
    items,
    complete: false,
  };
  return { ...base, identityHash: qaHash(base) };
};

export const recordReviewChecklistItem = (
  checklist: ReviewChecklist,
  input: {
    readonly itemId: string;
    readonly status: "passed" | "failed";
    readonly reviewerId: string;
    readonly evidenceHashes: readonly string[];
    readonly reviewedAt: string;
  },
): ReviewChecklist => {
  if (input.evidenceHashes.length === 0 || input.evidenceHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)))
    throw new Error("Checklist review requires valid evidence hashes.");
  const items = checklist.items.map((item) =>
    item.id === input.itemId
      ? {
          ...item,
          status: input.status,
          reviewerId: input.reviewerId,
          evidenceHashes: input.evidenceHashes,
          reviewedAt: input.reviewedAt,
        }
      : item,
  );
  if (!items.some((item) => item.id === input.itemId))
    throw new Error(`Unknown review checklist item: ${input.itemId}.`);
  const base = { ...checklist, items, complete: items.every((item) => item.status === "passed") };
  const { identityHash: _identityHash, ...withoutIdentity } = base;
  void _identityHash;
  return { ...withoutIdentity, identityHash: qaHash(withoutIdentity) };
};
