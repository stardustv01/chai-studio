export type StudioDataSource = "server" | "ui-fixture" | "unauthenticated";

declare const __CHAI_STUDIO_UI_FIXTURE_MODE__: boolean;

export const studioUiFixtureModeEnabled = (): boolean =>
  typeof __CHAI_STUDIO_UI_FIXTURE_MODE__ !== "undefined" && __CHAI_STUDIO_UI_FIXTURE_MODE__;

export const resolveStudioDataSource = (input: {
  readonly hasAuthenticatedSession: boolean;
  readonly uiFixtureMode: boolean;
}): StudioDataSource => {
  if (input.hasAuthenticatedSession) return "server";
  return input.uiFixtureMode ? "ui-fixture" : "unauthenticated";
};
