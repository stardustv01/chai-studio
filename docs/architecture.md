# Architecture and package ownership

The apps are assembly boundaries. Product authority remains in packages, with dependencies flowing inward toward stable contracts.

| Workspace         | Owns                                             | May depend on                                         |
| ----------------- | ------------------------------------------------ | ----------------------------------------------------- |
| `diagnostics`     | errors, results, correlation, logging, redaction | platform only                                         |
| `schema`          | source schemas and generated validators          | diagnostics                                           |
| `timeline`        | project-time authority and edit model            | schema, diagnostics                                   |
| `media`           | assets, metadata, proxies                        | schema, diagnostics                                   |
| `audio`           | authoritative program graph                      | timeline, schema, diagnostics                         |
| `engine-adapters` | native Remotion/HyperFrames boundaries           | timeline, schema, diagnostics                         |
| `qa`              | QA/approval/delivery lifecycle                   | schema, diagnostics                                   |
| `preview`         | synchronized interactive/fidelity sessions       | timeline, audio, adapters, media, diagnostics         |
| `render`          | DAG and replaceable final compositor boundary    | timeline, audio, adapters, media, schema, diagnostics |
| `bridge`          | Codex/local command/context bridge               | render, QA, timeline, schema, diagnostics             |
| `ui-components`   | presentational components                        | React only                                            |
| `studio-server`   | local API and process assembly                   | declared service packages                             |
| `studio-web`      | local browser shell                              | UI-facing packages                                    |

`pnpm lint:boundaries` rejects missing declarations, cross-package private imports, escaping relative imports, missing TypeScript references, unknown internal packages, and dependency cycles. TypeScript project references define build order; package exports define public runtime access.
