# Chai Studio — QA, Approval, and Delivery State Contract Draft

**Status:** Draft; freeze at P02.18

## States

```text
rendered_unchecked
  -> qa_failed
  -> qa_warning
  -> qa_passed
qa_warning | qa_passed
  -> approved
approved
  -> delivered
```

`qa_failed` may return to `rendered_unchecked` only through a new or invalidated output candidate. `qa_warning` requires resolved warnings or scoped accepted exceptions before approval.

## Authority

One QA lifecycle service enforces transitions for API, CLI, UI, workers, receipt import, and direct internal calls. Render completion may create `rendered_unchecked`; it cannot create `approved` or `delivered`.

## Evidence

Each transition records output/revision identity, actor, timestamp, applicable rule-set version, results, human checks, exceptions, and evidence hashes.

## Invalidation

Changes to output bytes, project revision, delivery profile, dependencies, strict environment, audio/caption artifacts, relevant QA rules, or an expired exception invalidate affected downstream states.

## Delivery gate

Delivery requires immutable approved output identity and a complete receipt. Copying or revealing an unchecked file is not a lifecycle transition.
