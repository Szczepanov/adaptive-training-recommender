# H5c PR #517 — review hardening and remaining audit boundary

**Date:** 2026-09-09  
**PR:** #517  
**Governing decision:** [ADR-0037](../adr/0037-block-intent-and-controlled-progression.md)

This note records the deeper post-implementation review of H5c. It narrows several claims in the original implementation handoff and makes the remaining boundary explicit rather than treating “real evidence assembly” as equivalent to a fully frozen/replayable review record.

## Findings fixed in PR #517

### 1. Prescription provenance must be real, not reconstructed from performed duration

`progressionReview.ts` deliberately requires a pinned prescription comparison before an exposure can count as `matched_current_target`. The initial H5c assembler inferred that match from exact coverage plus performed duration and copied the block source revision into the evidence. That could make a completed 90-minute exposure look as if it had been prescribed at the current 90-minute target even when no immutable prescription established that fact.

`progressionReviewInputService.ts` now fails closed. A `matched_current_target` exposure requires:

- exact role-relevant coverage;
- a canonical structured execution;
- an immutable, hash-validated `ExecutionPrescription`;
- execution and prescription source identities that agree;
- a prescription source bound to the block/source revision under review;
- an exact prescribed `duration_min` equal to the current contract value; and
- delivered duration within the existing bookkeeping tolerance.

Missing immutable prescription evidence remains `partial`/`unknown`; it is not upgraded from modality, coverage, or performed duration alone.

### 2. Confirmation is an authority boundary, not a trusted UI write

The first implementation rechecked the block revision but otherwise trusted the caller-provided `ProposedProgressionChange`. The confirmation transaction now independently verifies:

- exact objective/session/step target binding;
- variable and unit;
- `previousValue == currentValue`;
- finite numbers and a correct derived delta;
- exactly one bounded advance step or the configured bounded reduction;
- that the review date is valid and the block is actually due;
- that the resulting `IntentBlock` still validates before it is staged.

A caller therefore cannot turn the confirmation API into a generic arbitrary dose-update endpoint.

### 3. Progression revisions preserve frozen source provenance

A progression confirmation changes the progression contract; it must not silently re-author unrelated replay inputs. The initial implementation re-read the athlete's live `TrainingIntentProfile` and rewrote the new revision with the manual source schema/null source reference.

Confirmation now inherits the source revision's pinned `TrainingIntentProfile`, `sourceSchemaVersion`, and `sourceRef`, then hashes the resulting replay payload. The accepted progression revision therefore differs only in the explicitly authored progression/review fields.

### 4. Review cadence advances from the evidence-as-of date

The accepted revision now advances `nextReviewDate` from the review's `asOfDate` rather than leaving the old due date in place (or advancing from an already-stale due date). The review UI also excludes blocks outside their active date range.

### 5. Confirmation rechecks current restrictive injury settings for increases

ADR-0037 D-AUTHORITY requires current constraints to be rechecked at confirmation. The transaction now reads the current `trainingSettings/profile` before any writes. A newly active `limit`/`exclude` injury restriction blocks an increase and asks for a fresh review. A bounded reduction remains confirmable because it tightens rather than relaxes dose.

This is a targeted constraint recheck, not a claim that every future-session capacity dimension has been frozen at confirmation. Ordinary recommendation/runtime safety gates remain authoritative when selection is later wired.

### 6. Idempotent UI feedback uses immutable activation identity

On an idempotent replay, the current block header may already be newer than the revision created by the original activation. The review UI now reports `activationRevisionId`, not the possibly-newer current header revision.

## Important remaining audit boundary

ADR-0037 D-REPLAY asks H5 to retain the evidence lineage behind a confirmed proposal: canonical performed-fact revisions/ids, response/tissue snapshots, evidence-as-of time, action/reasons, and other bindings needed to explain/replay what was reviewed.

PR #517 does **not yet persist an immutable progression-review evidence snapshot**. The activation document records deterministic proposal/experiment identity and before/after settings, but it does not freeze the complete `ProgressionReviewInput`/result provenance. Likewise, `deriveProposalId` is a logical confirmation id (`source revision + review date + variable + proposed value`), not an evidence hash. A same-day review rerun after newly synced/edited evidence can derive the same proposal id if the proposed value is unchanged.

Therefore the precise status after PR #517 is:

- real review evidence is assembled and evaluated fail-closed;
- confirmation is transactionally bounded, idempotent, revision-gated, and rechecks current restrictive injury settings;
- accepted `IntentBlock` revisions and activation before/after values are durable;
- **full immutable review/evidence replay is still a separate required delivery before H5c should be called “fully audited” against D-REPLAY.**

A follow-up should introduce a write-once review snapshot (or equivalent content-addressed record) that freezes at least the source block revision/hash, review `asOfDate`, canonical fact revision and occurrence ids, linked prescription identities, response/tissue evidence, active restriction snapshot, evaluation bindings/results when present, review action/reasons/audit, and a semantic hash referenced by the activation.

## Manual authoring limitation

`ProgressionBlockEditor` creates a manual self-sourced `IntentBlock`; it does not create or bind future executable session prescriptions to that block. With the corrected pinned-prescription gate, a manually-authored progression block can be reviewed, but its exposures will not qualify as `matched_current_target` unless a compatible immutable prescription/source binding actually exists.

That is intentional fail-closed behavior. The UI/docs must not imply that merely authoring a manual block is sufficient to accumulate qualifying progression evidence. A later authoring/selection integration should create the missing block-to-prescription lineage rather than weakening the review gate.

## Still out of scope

PR #517 still does not wire an accepted `IntentBlock` revision into recommendation selection. No ordinary recommendation path reads the progression claim/activation. Recommendation-time policy activation remains a separate, policy-reviewed H5 delivery.
