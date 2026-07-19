import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startStudioServer } from "../../apps/studio-server/src/index.js";

describe("local server browser boundary", () => {
  it("emits containment headers and rejects approved-origin mutation without anti-CSRF proof", async () => {
    const runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), "chai-security-boundary-"));
    const started = await startStudioServer({ preferredPort: 0, runtimeDirectory });
    try {
      const origin = started.report.origins[0];
      if (origin === undefined) throw new Error("Server origin missing.");
      const health = await fetch(`${origin}/api/health`);
      expect(health.status).toBe(200);
      expect(health.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(health.headers.get("permissions-policy")).toContain("camera=()");
      expect(health.headers.get("cross-origin-opener-policy")).toBe("same-origin");

      const denied = await fetch(`${origin}/api/v1/projects/close`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${started.sessionToken}`,
          origin,
          "content-type": "application/json",
        },
      });
      expect(denied.status).toBe(403);
      expect(await denied.text()).toContain("server.csrf-token-invalid");

      const allowed = await fetch(`${origin}/api/v1/projects/close`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${started.sessionToken}`,
          "x-chai-csrf-token": started.sessionToken,
          origin,
          "content-type": "application/json",
        },
      });
      expect(allowed.status).toBe(200);
    } finally {
      await started.close();
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  });
});
