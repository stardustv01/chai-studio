import { describe, expect, test } from "vitest";
import { resolveStudioDataSource } from "../../apps/studio-web/src/runtime-mode.js";

describe("Studio web runtime boundary", () => {
  test("an authenticated session always uses server authority", () => {
    expect(resolveStudioDataSource({ hasAuthenticatedSession: true, uiFixtureMode: false })).toBe("server");
    expect(resolveStudioDataSource({ hasAuthenticatedSession: true, uiFixtureMode: true })).toBe("server");
  });

  test("the contract fixture requires an explicit build flag", () => {
    expect(resolveStudioDataSource({ hasAuthenticatedSession: false, uiFixtureMode: true })).toBe(
      "ui-fixture",
    );
  });

  test("a production page without a token fails closed", () => {
    expect(resolveStudioDataSource({ hasAuthenticatedSession: false, uiFixtureMode: false })).toBe(
      "unauthenticated",
    );
  });
});
