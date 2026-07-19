# Frozen contract 03 — QA, approval, and delivery lifecycle v1

One `qa-core` service owns all transitions for UI, local API, CLI, workers, receipt import, and internal calls.

Valid transitions are:

```text
rendered_unchecked -> qa_failed | qa_warning | qa_passed
qa_warning -> approved  (only with scoped accepted exceptions)
qa_passed -> approved
approved -> delivered
```

`qa_failed` can return only through invalidation/new output identity. Output bytes, revision, profile, strict environment, dependencies, audio/caption artifacts, applicable rule versions, or exception expiry invalidate downstream state to `rendered_unchecked`. Rendering or encoding creates only `rendered_unchecked`; it can never imply approval or delivery.

Every transition records immutable output/revision identity, actor, timestamp, rule-set versions, machine results, human checks, evidence hashes, scoped exceptions and expiry, and prior/new state. Delivery requires an immutable approved output and complete matching receipt; revealing or copying an unchecked file is not delivery.

Evidence: `src/qa-lifecycle.mjs`, `tests/cross-cutting-contracts.test.mjs`, `evidence/render-receipt.json`.
