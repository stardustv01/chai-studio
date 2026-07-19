import { describe, expect, it } from "vitest";
import { studioSessionBootstrapScript } from "../../apps/studio-web/session-bootstrap.js";

const token = "local-session-token-abcdefghijklmnopqrstuvwxyz";

describe("Studio browser session bootstrap", () => {
  it("defines an immutable pre-React session without URL or log transport", () => {
    const script = studioSessionBootstrapScript({
      token,
      serverOrigin: "http://127.0.0.1:4317",
    });
    expect(script).toContain('Object.defineProperty(window,"__CHAI_STUDIO_SESSION__"');
    expect(script).toContain("configurable:false");
    expect(script).toContain("writable:false");
    expect(script).toContain(token);
    expect(script).not.toContain("?token=");
    expect(script).not.toContain("console");
  });

  it("rejects malformed tokens and non-loopback origins", () => {
    expect(() =>
      studioSessionBootstrapScript({ token: "short", serverOrigin: "http://127.0.0.1:4317" }),
    ).toThrow(/token/u);
    expect(() => studioSessionBootstrapScript({ token, serverOrigin: "https://evil.example" })).toThrow(
      /loopback/u,
    );
  });
});
