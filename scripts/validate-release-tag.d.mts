export declare const assertReleaseTag: (input: {
  readonly packageManifest: Readonly<Record<string, unknown>>;
  readonly refType?: string;
  readonly refName?: string;
}) => string;
