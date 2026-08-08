# ADR-0010: Decision Provenance, Audit Records & Replay

* **Status:** Accepted
* **Date:** 2026-08-08 (recorded retroactively; implemented 2026-08-07)
* **Deciders:** Core Engineering Team

> **Retroactive record.** The implementation landed across four merges from
> `codex/decision-provenance-safety` without an ADR. This document describes what was
> built and why, so the reasoning is not lost. It does not propose a change. Identified
> as finding F10 in
> [the 2026-08-08 review](../analysis/2026-08-08-architecture-review.md).

---

## Context and Problem Statement

[ADR-0009](./0009-training-intent-history.md) made training intent derived rather than
persisted: objectives, dose, fatigue and phase are all recomputed on every evaluation
from adherence history. That is the right call for correctness — no derived state can go
stale — but it creates an accountability gap.

If nothing about a decision is persisted beyond the chosen template, then three questions
have no answer from data:

1. *Why did the engine recommend this, on this day?* The inputs were recomputed and
   discarded.
2. *Was this decision made under the policy we think it was?* The engine changes; the
   record does not say which version produced a given day.
3. *Was the history it reasoned over complete?* A Firestore read that failed and a
   Firestore read that legitimately returned nothing are indistinguishable once both
   become an empty array — and they mean opposite things. Treating a failed read as "no
   training this week" would inflate perceived freshness and prescribe load the athlete
   has not recovered from.

Question 3 is a safety question, not an observability one.

---

## Decision Outcome

### 1. Reads distinguish four states, and only one is usable

`DataState<T>` ([`dataState.ts`](../../app/src/engine/dataState.ts)) replaces
nullable reads across the persistence boundary:

| State | Meaning |
|---|---|
| `AVAILABLE` | Valid data, with a `revision` identifying exactly what was read |
| `MISSING` | The document genuinely does not exist |
| `INVALID` | The document exists but failed schema validation, with `DataIssue[]` |
| `UNAVAILABLE` | The read failed, with the attempted `operation` and whether it is retryable |

**Only `AVAILABLE` may be used as engine input.** `INVALID` and `UNAVAILABLE` block
normal planning rather than degrading to a neutral default:
`buildTrainingHistorySnapshot` throws `TrainingHistorySourceError` for a non-available
required source, and `Home.tsx` surfaces a retry rather than a recommendation.

This is deliberately un-graceful. A dashboard that shows nothing is recoverable; a
dashboard that shows a confident hard session derived from silently-empty history is not.

### 2. History is read once, as an immutable revision

`TrainingHistorySnapshot` bounds a single reconstruction — `throughDateExclusive`,
`windowDays`, the reconciled `CompletedTrainingEvent[]`, the derived `CompletedExposure[]`,
per-source `DataStateSummary`, and a `revision` string:

```text
history-v1:{throughDateExclusive}:{windowDays}:{activityRevision}:{recommendationRevision}
```

One dashboard refresh evaluates today, tomorrow's three scenario branches, and the
seven-day forecast. All of them consume the *same* snapshot, so no two horizons can
disagree about what the athlete has done.

### 3. Every persisted recommendation carries a compact audit

`RecommendationAudit` ([`models.ts`](../../app/src/engine/models.ts)) is attached at the
composition boundary and stored on the schema-version-3 `daily_recommendations` document:
`policyVersion`, `evaluatedAt`, `decisionContextRevision`, `safetyStatus`, history counts
and source statuses, the resolved envelope, and the ranked `candidateScores`.

It records **normalized decision facts only**. Raw wearable payloads, raw readiness
values and free-text check-in notes are deliberately excluded — the audit is evidence
about a decision, not a second copy of the athlete's health data.

### 4. `POLICY_VERSION` identifies the deciding logic

[`policy.ts`](../../app/src/engine/policy.ts) exports a single string, incremented
whenever a change can alter a persisted decision. Without it, a replay cannot distinguish
"this decision was wrong" from "this decision was made under different rules".

### 5. Replay verifies internal reproducibility

`replayRecommendationAudit` ([`replay.ts`](../../app/src/engine/replay.ts)) checks a v3
record against its own audit: policy version availability, `safetyStatus`, revision
format, history-count coherence, and — the substantive one — that the persisted template
is present among the audited candidates **and** was the highest-utility one.

### 6. Security rules require the audit on schema-version-3 writes

`firestore.rules` validates the audit's full shape **for `schemaVersion == 3` writes**, bounds
`candidateScores` to 64 entries, and constrains every enum. It does **not** prevent an
existing v3 record from being rewritten as v1 and losing the audit — downgrade protection
is a known gap, recorded below. Wearable-derived collections
(`daily_recovery_snapshots`, `activities`) are `allow write: if false` — the browser may
read them but can never forge a wearable fact.

---

## Code References

* [`app/src/engine/dataState.ts`](../../app/src/engine/dataState.ts)
* [`app/src/engine/trainingHistorySnapshot.ts`](../../app/src/engine/trainingHistorySnapshot.ts)
* [`app/src/engine/provenance.ts`](../../app/src/engine/provenance.ts)
* [`app/src/engine/replay.ts`](../../app/src/engine/replay.ts)
* [`app/src/engine/policy.ts`](../../app/src/engine/policy.ts)
* [`app/firestore.rules`](../../app/firestore.rules)
* [`app/scripts/replay-recommendation-audit.mjs`](../../app/scripts/replay-recommendation-audit.mjs)

---

## Consequences

### Positive

* "Why did the engine recommend this?" is answerable from a persisted record.
* A failed or corrupt read can never be mistaken for an easy training week.
* All decision horizons in one refresh share a single, identified history revision.
* Policy changes are attributable to specific persisted decisions.

### Negative

* A single corrupt document blocks planning for the whole window. This is intentional,
  but it makes parser strictness a availability concern — a validator that is wrong in
  the strict direction takes the dashboard down.
* The audit is only as meaningful as `POLICY_VERSION` discipline. A frozen version string
  silently degrades `replayRecommendationAudit`'s `policyMatchesCurrent` check to a
  constant — see F10; Phase 0 adds a CI guard.
* The audit's usefulness depends on the fields it summarises being real. At time of
  writing `envelope.safetyRestrictedModalityCount` is always `0` because its input is
  never populated (F1) — the audit faithfully records a check that does not run.

---

## Known Gaps at Time of Recording

Recorded so the ADR is not read as a clean bill of health. Both are addressed by
[`docs/plans/phase-1-live-defects.md`](../plans/phase-1-live-defects.md):

1. **The immutability the rules comment describes is not enforced.** `allow update` pins
   only `createdAt`, and `schemaVersion in [1, 2, 3]` permits a v3 record to be rewritten
   as v1, dropping the audit entirely — the audit requirement is conditional on the
   version the writer chooses (F6).
2. **`safetyRestrictedModalityCount` is structurally always zero** (F1).
