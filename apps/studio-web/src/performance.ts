import type { PerformanceMetricName } from "@chai-studio/diagnostics/performance";

export type BrowserPerformanceMetricName = PerformanceMetricName | "long-task" | "react-commit";

export interface PerformanceSample {
  readonly id: number;
  readonly name: BrowserPerformanceMetricName;
  readonly durationMs: number;
  readonly observedAt: number;
  readonly detail: Readonly<Record<string, number | string>>;
}

export class LocalPerformanceMonitor {
  readonly #samples: PerformanceSample[] = [];
  readonly #limit: number;
  #observer: PerformanceObserver | null = null;
  #nextSampleId = 1;

  constructor(limit = 100) {
    this.#limit = limit;
  }

  start(): void {
    if (typeof PerformanceObserver === "undefined" || this.#observer !== null) return;
    this.#observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 50) this.record("long-task", entry.duration, { entryType: entry.entryType });
      }
    });
    try {
      this.#observer.observe({ entryTypes: ["longtask", "measure"] });
    } catch {
      this.#observer.disconnect();
      this.#observer = null;
    }
  }

  stop(): void {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  measure<T>(
    name: BrowserPerformanceMetricName,
    operation: () => T,
    detail: Readonly<Record<string, number | string>> = {},
  ): T {
    const startedAt = performance.now();
    try {
      return operation();
    } finally {
      this.record(name, performance.now() - startedAt, detail);
    }
  }

  async measureAsync<T>(
    name: BrowserPerformanceMetricName,
    operation: () => Promise<T>,
    detail: Readonly<Record<string, number | string>> = {},
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      this.record(name, performance.now() - startedAt, detail);
    }
  }

  record(
    name: BrowserPerformanceMetricName,
    durationMs: number,
    detail: Readonly<Record<string, number | string>> = {},
  ): void {
    this.#samples.push({
      id: this.#nextSampleId,
      name,
      durationMs,
      detail,
      observedAt: Date.now(),
    });
    this.#nextSampleId += 1;
    if (this.#samples.length > this.#limit) this.#samples.splice(0, this.#samples.length - this.#limit);
  }

  snapshot(): readonly PerformanceSample[] {
    return [...this.#samples];
  }
}
