# Contributing to Chai Studio

## Contribution license

Chai Studio is licensed under Apache License 2.0. Unless you explicitly mark a submission as
`Not a Contribution`, any contribution intentionally submitted for inclusion is provided under the
same Apache-2.0 terms, as described by Section 5 of [LICENSE](LICENSE). Only submit material you have
the right to license. Third-party code, media, fonts, models, and generated assets must retain their
original terms and must be accompanied by source, version, license, notice, and rights evidence.

Implementation follows the audited 379-task graph in the parent planning workspace. Start only when every declared dependency is accepted. Preserve the frozen P02 contracts and accepted ADRs; changing one requires replacement change control rather than an implicit interpretation.

## Local validation

Use Node from `.node-version` and pnpm from `packageManager`.

```sh
corepack prepare pnpm@11.11.0 --activate
pnpm install --frozen-lockfile
pnpm commit:validate
pnpm build
pnpm test:e2e
```

Run `pnpm hooks:install` after the project becomes a repository. The hook invokes the same `commit:validate` entry point used in CI. Before release, run `pnpm release:validate`.

## Change rules

- Import another workspace package only through its public `@chai-studio/*` export and declare it in both `package.json` and TypeScript references.
- Never import another package's private source path.
- Run `pnpm schema:generate` only when the source schema changes, then review the generated diff.
- Run `pnpm fixture:update` only when an intentional golden change has been visually reviewed.
- Include task ID, contract/ADR traceability, environment, automated evidence, manual evidence, and residual risk in the pull request template.
- Do not infer QA, approval, or delivery from a successful render or build.
- Do not copy third-party code into Chai Studio or relicense it as Apache-2.0. Add dependencies
  through their original package source and update the generated license inventory.
