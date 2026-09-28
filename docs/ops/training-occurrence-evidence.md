# Training occurrence shadow evidence

This workflow compares the legacy broad `CompletedExposure` history with a counterfactual
derived from canonical performed occurrences, for issue #646 (TO4/TO5). It is diagnostic: it
never writes Firestore, never persists a recommendation, never changes a feature flag, and its
output is never fed back into planning. Legacy `CompletedTrainingEvent -> CompletedExposure`
remains the broad fatigue/dose/objective authority; FIT identity remains diagnostic.

## Pipeline

Steps 1 and 2 read and write only under the git-ignored `app/artifacts/training-occurrence/`
directory (anchored to the repository, not the working directory) and refuse any other output
path, following symlinks before checking. Step 3 writes wherever it is told because its output
is allow-listed aggregates; keep it in the same directory until the aggregate has been reviewed. Only step 3's aggregate report is
eligible for review, and only a separately written analysis belongs in `docs/analysis/`.

0. **Pre-occurrence historical activity backfill (Python, idempotent data migration, issue #870).**
   Historical activities created prior to occurrence ingestion lack canonical occurrence documents.
   To eliminate the historical coverage gap without changing live recommendation authority:

   ```bash
   # Dry-run audit (default, zero writes):
   uv run python -m garmin_sync backfill-training-occurrences --user-id <uid> --start-date 2026-06-30 --end-date 2026-09-27 --dry-run

   # Apply transactions with create-only semantics:
   uv run python -m garmin_sync backfill-training-occurrences --user-id <uid> --start-date 2026-06-30 --end-date 2026-09-27 --apply
   ```

   The backfill:
   - Scans `users/{uid}/activities` in the specified window (up to 366 days).
   - Treats `users/{uid}/performedOccurrenceSourceLinks` as the per-source cutover boundary: activities already linked to an occurrence (including manual unlinks, keep_separates, and merges) are never overwritten or re-linked.
   - Applies individual Firestore transactions per unlinked activity with create-only semantics to create `performedTrainingOccurrences` and `performedOccurrenceSourceLinks`.
   - Normalizes Garmin modality to the canonical reconciliation vocabulary (`cycling`, `running`, `strength`, `field`, `mobility`, `cross_training`); unknown types leave modality unset.
   - Fails closed before writing when preflight finds any malformed/dangling/mismatched source claim or duplicate active source ownership, then runs an independent post-write audit over both activity-to-link resolution and active occurrence source ownership.

1. **Export (Python, needs explicit user authorization).** From the repository root:

   ```bash
   uv run python -m garmin_sync export-training-occurrence-evidence --user-id <uid> --start-date 2026-06-01 --end-date 2026-09-26 --with-fit
   ```

   `export_training_occurrence_records` (`src/garmin_sync/training_occurrence_export.py`) reads
   only `users/{uid}/performedTrainingOccurrences`, the referenced `session_executions`, their
   `entries` and immutable `execution_prescriptions`, `activities` and `daily_recommendations`
   for the window (at most 366 days). It never lists `users`. The output `raw/records.json` is
   **raw personal data**. With
   `--with-fit`, `collect_fit_identity_evidence` re-downloads each Garmin original, decodes it
   twice in memory with the production decoder, drops the bytes, and writes
   `raw/fit-evidence.json`: an aggregate plus private per-file rows (salted alias, date,
   outcome, fingerprint kind and fingerprint). A rate limit stops downloads; the rest is
   counted as not examined, never as unavailable. With explicit `--user-id <uid>` plus
   `--with-fit`, the CLI requires an active server-side `garminConnections/{uid}` record and
   restores the exact `tokenObject` committed for that user through `load_settings_for_user`.
   It never falls back to the operator's legacy single-user Garmin token for an explicitly
   selected user. Legacy/manual runs that omit `--user-id` keep the existing `APP_USER_ID`
   single-user token behavior.
2. **Prepare (TypeScript, offline).** From `app/`:

   ```bash
   npm run evidence:training-occurrence:prepare -- --records artifacts/training-occurrence/raw/records.json --fit-evidence artifacts/training-occurrence/raw/fit-evidence.json
   ```

   `prepareTo4Evidence` (`src/training-occurrence/to4EvidencePreparation.ts`) parses every
   document with the production parsers, rejects and counts records owned by another user,
   builds the live side with `buildTrainingHistorySnapshot` (manual-training policy off, as in
   production) and the canonical side with `canonicalBroadHistory.ts`, pairs them by shared
   Garmin activity or owning recommendation into opaque `occ-NNNN` aliases, derives identity
   metrics and strata, and evaluates the hard gates it can evaluate. It then runs
   `runHistoryCounterfactualSeries` for every date from window start + 7 days through the
   window end, twice, and records whether both runs were identical. It writes the sanitized
   `prepared-input.json` plus two **private** files: `private-review-sheet.json` (aliases with
   their source keys, for labelling) and `private-recommendation-series.json` (per-date
   projections).
3. **Report (offline).** `npm run evidence:training-occurrence -- artifacts/training-occurrence/prepared-input.json artifacts/training-occurrence/report.json`
   validates the allow-listed prepared input and renders the aggregate report.

To record reviewed match labels, write `{ "recordsSha256": "<from the review sheet>", "labels":
{ "occ-0007": "correct_merge" } }` (values `correct_merge`, `false_positive_merge`,
`correct_separate`, `false_negative_split`) under the artifact directory and rerun step 2 with
`--labels <path>`. Aliases are deterministic only for one exact export, so labels carrying a
different `recordsSha256`, or naming an alias outside the review sheet, are refused. The
false-positive gate evaluates only when every multi-source (automatically merged) group is
labelled; any `false_positive_merge` fails it.

Hard gates with a zero denominator are `not_evaluated`, never a vacuous pass. The prep step
re-checks every derived row against its own hydrated sources (`DerivationAudit`). Missing detail
passes only when no derived row lacks the sources its authority requires; this re-implements the
derivation preconditions, so it is a regression guard rather than independent data-quality
evidence. Structured authority passes only when catalog rows keep the execution's workout,
template, modality and category, and non-catalog rows preserve the immutable prescription's
title and modality with valid nonnegative cost and stimulus profiles.

### Canonical derivation rules

`deriveCanonicalBroadExposure` evaluates every source reference and reuses live semantics:

- **Garmin-only occurrence:** the production `reconcileCompletedTrainingEvents` +
  `completedEventToExposure` path for that one activity, dated by the canonical local date.
- **Completed catalog execution (with or without a linked Garmin activity):** the live
  "followed exact template" semantics: template cost scaled by delivered dose, template
  stimulus, exact template/workout identity and `completedStructuredWorkout` evidence. When a
  Garmin activity is linked it remains the measured duration and Training Effect authority, as
  in the live merge; structured identity and modality are never replaced by Garmin's. A
  workout shared by several templates resolves only through the recommendation that owns the
  execution. As in the live Firestore path, `recoveryHours` is not set.
- **Completed manual or external-plan execution:** requires its exported immutable
  `execution_prescription`, an exact source-identity match to the completed execution, and at
  least one performed entry owned by that execution and linked to a prescribed work step. The
  prescription title and modality stay authoritative. Authored duration ranges use the same
  midpoint reference semantics as catalog ranges. Logged completion is computed per required
  prescribed step, capped at each step's target; rotating block rounds are honored, while
  optional or excess work cannot compensate for missing required work. Existing modality
  profiles are then scaled by completed duration and that independent completion ratio. Session
  RPE selects the diagnostic fallback intensity when Garmin is absent. A linked Garmin activity
  contributes measured duration and Training Effect stimulus while keeping the structured
  identity. Malformed prescription metadata fails closed. This remains offline evidence only;
  its RPE bands and generic non-catalog profiles need reviewed real-history evidence before any
  activation.
- **Unknown, never guessed:** more than one structured or provider source, a non-Garmin
  provider, a missing or non-completed execution, missing non-catalog prescription/entry
  evidence, a `legacy_strength` execution, an ambiguous template, a missing provider record, or
  no performed date. Each is counted by reason in `canonicalDerivation.unknownByReason`.

Planned `SessionOccurrence` documents are never read. Merged occurrences are excluded.

### Recommendation counterfactual boundary

`historyRecommendationCounterfactual.ts` calls the production `evaluateTrainingWithIntent`
twice per date through an in-memory `TrainingHistoryProvider` with fixed metadata, so no
Firestore read, persistence or wall-clock input enters the decision. The non-history input is a
fixed reference day from a simulation scenario (default `evergreen_balanced_four_sessions`),
hashed into `recommendationSeries.nonHistoryInputsHash`. This isolates the engine's sensitivity
to the history swap; it is **not** a replay of the athlete's real readiness, check-in, plan or
preferences for each date, which production assembles in the UI composition layer. Because
history is injected, the production canonical `performedTrainingFacts` read (the live narrow
recency/spacing/coverage cutover) and mechanical check-in reads are skipped on both passes; the
comparison is symmetric but does not exercise those cutovers. Every changed projection field is
`unresolved` until a reviewer classifies it.

## Prepared-input contract

Step 2 writes this file; it can also be prepared by hand for synthetic fixtures. Keep prepared inputs and generated reports under the ignored `app/artifacts/training-occurrence/`
directory. Never place raw FIT payloads, user IDs, activity IDs, names, notes, credentials, or
unredacted health data in a committed fixture or report. A real-data input is user-scoped and
contains only the bounded facts needed for the replay. Omit canonical exposure fields that
cannot be derived; list those row keys in `unknownCanonicalOccurrenceKeys` so they are counted
as unknown instead of being filled from telemetry or a planned occurrence.

The version-1 JSON input has this shape:

```json
{
  "schemaVersion": 1,
  "metadata": {
    "sourceCommit": "<commit>",
    "occurrenceSchemaVersion": 1,
    "matcherVersion": "matcher-v1",
    "reconciliationPolicyVersion": "policy-v1",
    "coveragePolicyVersion": "<policy version>",
    "fitFingerprintVersion": "fit-workout-v2"
  },
  "corpus": {
    "realHistory": "prepared", "realHistoryOccurrenceCount": 1,
    "originalFit": "prepared", "originalFitCount": 1, "strata": {}
  },
  "liveExposures": [],
  "canonicalExposures": [],
  "unknownCanonicalOccurrenceKeys": [],
  "canonicalDerivation": { "derived": 0, "unknownByReason": {} },
  "recommendationSeries": { "status": "compared", "evaluatedDates": 0 },
  "recommendationReplay": {
    "live": { "nonHistoryInputs": {}, "decisionProjection": {} },
    "canonical": { "nonHistoryInputs": {}, "decisionProjection": {} },
    "classifications": {}
  },
  "identityEvidence": {},
  "fitEvidence": {},
  "hardGates": {},
  "deferredBlockers": {},
  "decisions": {}
}
```

For a prepared real-history corpus, `corpus.realHistoryOccurrenceCount` is the number of rows
represented on each side; it must equal both exposure-array lengths and every row must pair
one-to-one by opaque occurrence alias before broad-history readiness can be considered. Duplicate,
live-only, or canonical-only aliases make readiness invalid even when aggregate counts happen to
match. `corpus.originalFitCount` is the full requested FIT corpus, including any files left
unexamined after a rate limit. The runner requires the accounting identities
`activitiesExamined + notExaminedRateLimited = originalFitCount`,
`originalFitAvailable + originalFitUnavailable + downloadFailure = activitiesExamined`,
`decodeSuccess + decodeFailure = originalFitAvailable`, and
`semanticDefinitionFingerprintCount + observedIndexFallbackFingerprintCount + noWorkoutEvidenceCount = decodeSuccess`.
Malformed + unsupported counts must also equal decode failures. A rate-limited remainder is
reported honestly and blocks a `READY_FOR_SEPARATE_ACTIVATION_*` FIT decision instead of silently
shrinking the denominator. `fitEvidence.reviewedLabelCount` cannot exceed the available FIT count.

`liveExposures` and `canonicalExposures` use the engine `CompletedExposure` shape. Give every
paired physical workout the same opaque `occurrenceKey` alias on both sides. Do not use raw
activity, execution, or occurrence IDs as aliases. The report retains local per-occurrence
deltas as well as aggregates so date/load swaps cannot disappear in an equal total, but it
emits only stable row ordinals rather than occurrence keys. Missing or duplicate keys are
reported as unpaired/ambiguous.

Recommendation output fields use the projection names `verdict`, `mode`, `selectedTemplate`,
`prescription`, `dose`, `variant`, `coverage`, `sequence`, `fatigue`, and `guardrails`. Supply
each side's structured non-history input and the actual engine decision projection from its
same deterministic decision path (`recommendationReplay`, one date), or the aggregate
`recommendationSeries` that step 2 writes. The runner canonicalizes and hashes both non-history input
objects; if the hashes differ, it reports `inputs_mismatch` and does not compare decisions.
Any output field that differs without an explicit classification is reported as `unresolved`.

The report boundary is deliberately allow-listed. Hard-gate keys are phrased as positive invariants
(e.g. `noCrossUserEvidenceLeakage`), so a `pass` value cannot be misread as confirming a violation.
Unknown top-level, metadata, corpus, decision, hard-gate, FIT-evidence, identity-evidence, or decision-projection fields are rejected instead of
being copied through. Free-form names/notes/rationales therefore do not enter the generated report;
review narrative belongs in the committed aggregate analysis. Corpus stratum names are limited to
the pre-registered #646 strata. The runner also validates numeric exposure inputs before comparing
them.

The runner refuses any `READY_*` broad-history/FIT decision unless its required real-corpus,
labelled-sample, replay, one-to-one occurrence pairing, and hard-gate evidence is present. It
**cannot** declare the independent ADR-0034 Stage-3 Activities read-model cutover ready; that
surface requires its own reviewed evidence path.

## Report runner boundary

The runner sorts aggregate dimensions and JSON keys so identical prepared inputs produce
identical substantive output. It requires source, occurrence, matcher, coverage and FIT
fingerprint versions in the metadata. Delivered-dose aggregates report planned/completed minutes
and the **mean per-occurrence completion ratio**; completion ratios are never summed across
sessions. `canonicalDerivation.derived` must equal the canonical row count, and unknown reasons
and recommendation-series fields are allow-listed like every other reportable section.

A broad-history `READY_*` decision additionally requires either a compared single replay or a
recommendation series with evaluated dates, zero unresolved dates and identical repeat runs.

The older runtime `computeHistoryShadowDiffForUser` service remains the lightweight
count/evidence diagnostic unless a caller explicitly supplies semantic canonical exposure rows;
the complete TO4 cost/dose/stimulus and recommendation-output evidence path is the offline
pipeline above. This PR does not wire broad canonical history into a live recommendation read.
