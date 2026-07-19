import type {
  RemotionAdapterDiagnostic,
  RemotionBrowserLogRecord,
  RemotionDiagnosticCategory,
  RemotionDiagnosticSeverity,
  RemotionSourceStackFrame,
} from "./contracts.js";

export const remotionDiagnostic = (input: {
  readonly category: RemotionDiagnosticCategory;
  readonly code: string;
  readonly severity: RemotionDiagnosticSeverity;
  readonly stage: string;
  readonly message: string;
  readonly repairHint: string;
  readonly sourcePath?: string | null;
  readonly compositionId?: string | null;
  readonly frame?: string | null;
  readonly stack?: readonly RemotionSourceStackFrame[];
}): RemotionAdapterDiagnostic => ({
  ...input,
  sourcePath: input.sourcePath ?? null,
  compositionId: input.compositionId ?? null,
  frame: input.frame ?? null,
  stack: input.stack ?? [],
});

export const parseRemotionSourceStack = (
  stack: string | null | undefined,
): readonly RemotionSourceStackFrame[] => {
  if (stack === null || stack === undefined) return [];
  return stack.split("\n").flatMap((line): readonly RemotionSourceStackFrame[] => {
    const match = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    const sourcePath = match?.[2];
    if (sourcePath === undefined) return [];
    return [
      {
        functionName: match?.[1]?.trim() ?? null,
        sourcePath: sanitizeSourceUrl(sourcePath),
        line: match?.[3] === undefined ? null : Number(match[3]),
        column: match?.[4] === undefined ? null : Number(match[4]),
      },
    ];
  });
};

export const browserLogToDiagnostic = (log: RemotionBrowserLogRecord): RemotionAdapterDiagnostic =>
  remotionDiagnostic({
    category: "browser",
    code: `remotion.browser.${log.level}`,
    severity: log.level === "error" ? "error" : log.level === "warning" ? "warning" : "info",
    stage: "browser-runtime",
    message: log.text,
    repairHint:
      log.level === "error"
        ? "Open the mapped source and correct the browser error."
        : "Inspect the browser log.",
    sourcePath: log.sourceUrl,
    compositionId: log.compositionId,
    frame: log.frame,
    stack: log.stack,
  });

const sanitizeSourceUrl = (value: string): string =>
  value.replace(/^webpack:\/\//, "").replace(/[?#].*$/, "");
