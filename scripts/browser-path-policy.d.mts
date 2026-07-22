export interface PlaywrightCacheRootOptions {
  readonly configuredPath?: string;
  readonly home?: string;
}

export function playwrightCacheRoots(options?: PlaywrightCacheRootOptions): string[];
export function pathIsWithinAnyRoot(candidate: string, roots: readonly string[]): Promise<boolean>;
