import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAcceptanceGate } from "./run-acceptance-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await runAcceptanceGate({
  root,
  phase: "P25",
  taskRange: "P25.01-P25.15",
  contractName: "professional-expansion-contract",
  contractScript: "scripts/validate-p25-professional-contract.mjs",
  extraChecks: [
    [
      "focused-professional-fixtures",
      [
        [
          "./node_modules/.bin/vitest",
          [
            "run",
            "tests/unit/professional-timeline.test.ts",
            "tests/unit/audio-professional.test.ts",
            "tests/property/professional-edit.property.test.ts",
            "tests/integration/professional-reopen-parity.test.ts",
          ],
        ],
      ],
    ],
  ],
  implementationFiles: [
    "package.json",
    "packages/schema/src/project-documents.ts",
    "packages/schema/src/source/project-documents.schema.json",
    "packages/schema/src/generated/project-document-schemas.ts",
    "packages/timeline/src/model.ts",
    "packages/timeline/src/professional.ts",
    "packages/timeline/src/source-edit.ts",
    "packages/timeline/src/commands.ts",
    "packages/timeline/src/document-adapter.ts",
    "packages/timeline/src/diff.ts",
    "packages/timeline/src/index.ts",
    "packages/timeline/src/browser.ts",
    "packages/audio/src/commands.ts",
    "packages/audio/src/meter-history.ts",
    "apps/studio-web/src/App.tsx",
    "apps/studio-web/src/types.ts",
    "apps/studio-web/src/workspace-content.tsx",
    "apps/studio-web/src/professional-edit-bar.tsx",
    "apps/studio-web/src/source-inspection-monitor.tsx",
    "apps/studio-web/src/keyframe-editor.tsx",
    "apps/studio-web/src/audio-mixer-panel.tsx",
    "apps/studio-web/src/bridge-editor-panel.tsx",
    "apps/studio-web/src/shortcuts.ts",
    "apps/studio-web/src/styles.css",
    "docs/PROFESSIONAL_EDITING.md",
    "scripts/validate-p25-professional-contract.mjs",
    "scripts/run-p25-gate.mjs",
    "tests/unit/professional-timeline.test.ts",
    "tests/unit/audio-professional.test.ts",
    "tests/property/professional-edit.property.test.ts",
    "tests/integration/professional-reopen-parity.test.ts",
    "tests/e2e/professional-editing.spec.ts",
    "tests/e2e/studio-visual.spec.ts",
    "tests/e2e/studio-visual.spec.ts-snapshots/p25-professional-timeline-darwin.png",
    "tests/e2e/studio-visual.spec.ts-snapshots/p25-professional-source-monitor-darwin.png",
    "tests/e2e/studio-visual.spec.ts-snapshots/p25-advanced-bridge-editor-darwin.png",
  ],
});
