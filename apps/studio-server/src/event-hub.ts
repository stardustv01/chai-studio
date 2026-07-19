export interface StudioEvent {
  readonly schemaVersion: "1.0.0";
  readonly sequence: string;
  readonly id: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly correlationId: string | null;
  readonly projectId: string | null;
  readonly revisionId: string | null;
  readonly payload: unknown;
}

export interface StudioEventInput {
  readonly type: string;
  readonly correlationId?: string | null;
  readonly projectId?: string | null;
  readonly revisionId?: string | null;
  readonly payload: unknown;
}

export class EventReplayGapError extends Error {
  readonly requestedAfter: string;
  readonly earliestAvailable: string;

  constructor(requestedAfter: string, earliestAvailable: string) {
    super(`Event replay gap: requested after ${requestedAfter}, earliest available is ${earliestAvailable}.`);
    this.name = "EventReplayGapError";
    this.requestedAfter = requestedAfter;
    this.earliestAvailable = earliestAvailable;
  }
}

export class StudioEventHub {
  readonly #capacity: number;
  readonly #now: () => Date;
  readonly #events: StudioEvent[] = [];
  readonly #listeners = new Set<(event: StudioEvent) => void>();
  #nextSequence = 1n;

  constructor(input: { readonly capacity?: number; readonly now?: () => Date } = {}) {
    this.#capacity = input.capacity ?? 10_000;
    this.#now = input.now ?? (() => new Date());
    if (!Number.isSafeInteger(this.#capacity) || this.#capacity < 10 || this.#capacity > 100_000) {
      throw new Error("Studio event capacity is outside bounded safe limits.");
    }
  }

  publish(input: StudioEventInput): StudioEvent {
    if (!/^[a-z][a-z0-9.-]{2,127}$/.test(input.type)) throw new Error("Studio event type is invalid.");
    const sequence = this.#nextSequence;
    this.#nextSequence += 1n;
    const event: StudioEvent = {
      schemaVersion: "1.0.0",
      sequence: sequence.toString(10),
      id: `event-${sequence.toString(10).padStart(12, "0")}`,
      type: input.type,
      occurredAt: this.#now().toISOString(),
      correlationId: input.correlationId ?? null,
      projectId: input.projectId ?? null,
      revisionId: input.revisionId ?? null,
      payload: structuredClone(input.payload),
    };
    this.#events.push(event);
    if (this.#events.length > this.#capacity) this.#events.splice(0, this.#events.length - this.#capacity);
    for (const listener of this.#listeners) listener(structuredClone(event));
    return structuredClone(event);
  }

  replay(afterSequence: string): readonly StudioEvent[] {
    const after = parseSequence(afterSequence);
    const earliest = this.#events[0];
    if (earliest !== undefined && after < BigInt(earliest.sequence) - 1n) {
      throw new EventReplayGapError(afterSequence, earliest.sequence);
    }
    return this.#events
      .filter((event) => BigInt(event.sequence) > after)
      .map((event) => structuredClone(event));
  }

  subscribe(listener: (event: StudioEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  latestSequence(): string {
    return (this.#nextSequence - 1n).toString(10);
  }
}

export const formatStudioServerSentEvent = (event: StudioEvent): string =>
  `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

const parseSequence = (value: string): bigint => {
  if (!/^(?:0|[1-9][0-9]{0,30})$/.test(value)) throw new Error("Studio event sequence is invalid.");
  return BigInt(value);
};
