import { describe, expect, it } from "vitest";
import {
  ChaiError,
  createCorrelationId,
  createLogger,
  err,
  ok,
} from "../../packages/diagnostics/src/index.js";
import type { SerializedChaiError } from "../../packages/diagnostics/src/index.js";

describe("cross-process diagnostics", () => {
  it("preserves cause, stage, entity, and repair context through JSON", () => {
    const original = new ChaiError({
      category: "render",
      code: "render.input.missing",
      correlationId: createCorrelationId(),
      stage: "dependency-resolution",
      message: "A required input is missing.",
      entityId: "clip-17",
      repairHint: "Relink the source asset.",
      cause: new Error("File missing at /Users/navin/private.mov"),
    });
    const restored = ChaiError.fromJSON(JSON.parse(JSON.stringify(original)) as SerializedChaiError);
    expect(restored.stage).toBe("dependency-resolution");
    expect(restored.entityId).toBe("clip-17");
    expect(restored.repairHint).toBe("Relink the source asset.");
    expect(String(restored.cause)).toContain("$HOME/private.mov");
  });

  it("creates explicit result branches and redacted structured records", () => {
    expect(ok(7)).toEqual({ ok: true, value: 7 });
    const failure = new ChaiError({
      category: "internal",
      code: "x",
      correlationId: "c",
      stage: "test",
      message: "x",
    });
    expect(err(failure)).toEqual({ ok: false, error: failure });
    const records: unknown[] = [];
    const logger = createLogger(
      (record) => records.push(record),
      () => new Date("2026-07-15T00:00:00Z"),
    );
    logger.write("error", "security", "denied", "c", { token: "hello", path: "/Users/navin/file" });
    expect(JSON.stringify(records)).not.toContain("hello");
    expect(JSON.stringify(records)).not.toContain("/Users/navin");
  });
});
