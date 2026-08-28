# Physiological identity passport & measurement-trust architecture

This document describes the implemented PI0–PI9 (partial) slice from
[`docs/plans/physiological-identity-passport-and-measurement-trust.md`](../plans/physiological-identity-passport-and-measurement-trust.md)
and [ADR-0028](../adr/0028-physiological-identity-attribution-and-measurement-trust.md).

## Runtime boundary

Everything described here is **shadow/engine-layer only**. No production recommendation path
calls it. `recommendationService.ts` does not import `multisourceFusion.ts`,
`multisourceBaselines.ts`, or any `identity*.ts` module; Garmin Direct remains the sole
production recovery/baseline authority exactly as it was before this plan started. The consumers
today are:

- unit tests (the primary consumer — every module below is fully covered in isolation);
- [`app/src/engine/simulation/multisourceComparison.ts`](../../app/src/engine/simulation/multisourceComparison.ts),
  the MS16 simulation/replay harness (`npm run simulate:scenarios` / `simulate:diff`);
- [`app/src/engine/identityReplay.ts`](../../app/src/engine/identityReplay.ts) and its CLI
  (`npm run evidence:identity-replay`), the PI8 historical-evidence harness;
- [`IdentityReviewCard`](../../app/src/components/IdentityReviewCard.tsx), rendered on the "data"
  screen so a real athlete can label a suspicious night — this **does** run in production, but it
  only writes review events; it does not gate anything a recommendation reads.

Because nothing downstream of the gate is active, "reverting to Garmin-only" (the PI10 runbook
item) requires no action today — it is the current and only production behaviour. The runbook
below exists for the future moment fusion is wired into `recommendationService.ts`.

## Pipeline

```text
provider / Google Health
        ↓
source-aware immutable observation bundles              (ADR-0027, observations/models.ts)
        ↓
technical quality + provenance lineage                    identityLineage.ts, identityFeatures.ts
        ↓
night/session pairing                                      identityFeatures.ts (selectBestSessionPairing)
        ↓
Physiological Identity Passport assessment                 identityPassport.ts, identityAttribution.ts
        ↓
automatic immutable assessment                              identityPersistence.ts (health_identity_assessments)
        ↓
append-only review events (optional)                        IdentityReviewCard.tsx, identityReviewUi.ts
        ↓
effective identity + observation eligibility                identityModels.ts (deriveEffectiveIdentityDecision)
   ┌──────────────┴───────────────┐
   ↓                              ↓
trusted USER                      UNCERTAIN / NOT_USER
   ↓                              ↓
identityEligibility.ts            preserve + audit + IdentityReviewCard badge
   ↓                              ↓
multisourceBaselines.ts           Garmin fallback (already the only production path)
   ↓
multisourceFusion.ts (opt-in identity gate, PI9)
   ↓
(not yet wired to any recommendation path)
```

## Contracts

`app/src/observations/identityModels.ts` is the single canonical schema (see its own doc
comment): `IdentityStatus` (`USER | NOT_USER | UNCERTAIN`), the immutable
`AutomaticIdentityAssessment`, the append-only `IdentityReviewEvent`, and the derived
`EffectiveIdentityDecision`. `deriveEffectiveIdentityDecision()` is the only function that turns
an assessment plus its review-event chain into an effective status/eligibility — it never mutates
either input, and a malformed/orphaned/cyclic review chain fails closed to the automatic status
(see `identityModels.test.ts`).

`identityScore` is an evidence/ranking score, never a calibrated probability, until labelled
validation proves calibration (P-PI-11) — nothing in this codebase renders it as a percentage.

## Pairing, lineage and features (PI2)

`identityFeatures.ts` computes Garmin↔shared-source session-interval overlap
(`computeIntervalOverlapMetrics`), rejects (abstains on) unparsable or non-positive-duration
intervals with `SESSION_INTERVAL_INVALID` rather than dividing by zero, and selects the
best-overlapping session pair deterministically when multiple candidates exist
(`MULTIPLE_PAIRING_CANDIDATES` otherwise). `identityLineage.ts` separately confirms the anchor and
shared-source bundle refs are lineage-independent (`EVIDENCE_LINEAGE_DEPENDENT` otherwise) so a
mirrored/re-exported copy of the same upstream sensor reading can never vote twice.
`computePhysiologicalRelationFeatures` derives RHR/respiration/log-HRV residuals; a missing
feature is never zero-filled or backfilled from a population mean.

## Passport (PI3)

`identityPassport.ts` fits a provider-neutral, source-aware, lineage-aware robust-statistics
profile (median + scaled MAD, IQR, sample count, with explicit per-feature minimum-scale floors —
`DEFAULT_IDENTITY_FEATURE_SCALE_FLOORS`) of a shared source's own physiology
(`sourceProfiles`) and its paired relationship to the anchor (`crossSourceProfiles`).
`bootstrapPassportFromHistory()` implements the plan's 7-step historical bootstrap: it never
labels an excluded night `NOT_USER` — exclusion from the fitted "central core" is only a
descriptive `nightConcordance` diagnostic. `leaveOneNightOutReplay()` and
`chronologicalExpandingWindowReplay()` are the out-of-sample evaluation primitives (P-PI-16): a
night is always scored only against a passport fitted without that night.

## Ternary evaluator (PI4)

`identityAttribution.ts`'s `evaluateIdentityEvidence()` composes available, technically valid,
provenance-independent features into a bounded evidence score and a `USER | UNCERTAIN` automatic
status. Automatic `NOT_USER` is structurally absent from the return type in v1 (P-PI-8) — a single
physiological anomaly, or even every relation feature disagreeing, can only abstain to
`UNCERTAIN`; only a manual review event can ever set an effective `NOT_USER`.

## Pre-baseline eligibility gate (PI5)

`identityEligibility.ts`'s `selectEligibleHealthObservationBundles()` is the fail-closed boundary:
a bundle from a provider/transport configured as identity-required is admitted only when exactly
one effective-identity projection matches its exact revision/hash and grants the requested
eligibility flag. `multisourceBaselines.ts`'s `computeSourceMetricBaseline()` calls this
internally and unconditionally — there is no code path that reaches baseline accumulation without
it. The equivalent Python boundary is `src/garmin_sync/identity_eligibility.py`, used by
`run_multisource_audit()`; `src/garmin_sync/presence_filter.py` (the Python analogue of
`coPresenceValidator.ts`) is unused outside its own test.

**This gate has no cache to invalidate.** `computeSourceMetricBaseline()` recomputes eligibility
from whatever `EffectiveIdentityDecision` projections it is handed on every call — a review
correction is reflected on the very next call with no separate reconciliation step (see the
regression test in `identityEligibility.test.ts`, "reflects a PI7 review correction on the next
call with no separate invalidation step"). If a future change introduces a materialized/cached
baseline document, that cache must add its own invalidation path; this note stops being true the
day that lands.

## Persistence and replay provenance (PI6)

```text
users/{uid}/physiological_identity_passports/current
users/{uid}/physiological_identity_passport_versions/{version}
users/{uid}/health_identity_assessments/{assessmentId}
users/{uid}/health_identity_review_events/{eventId}
```

`identityPersistence.ts` validates every document shape on read (including the passport's robust
estimators and the review event's schema/label/occupancy-attestation vocabulary) and only ever
appends review events inside a transaction that re-validates the assessment and any superseded
event still exist — it never mutates an automatic assessment or a prior review event.
`app/firestore.rules` restricts a user's own review-event writes to their own assessment and the
allowed enum values; automatic assessments and passport documents are server-written only.

## Suspicious-night review UI (PI7)

`IdentityReviewCard` (mounted on the Detailed Data screen, next to `HealthAnomalyShadowPanel`)
surfaces the most recent night whose automatic evaluator abstained for a reason the athlete can
actually confirm or deny — `identityReviewUi.ts`'s `needsSuspiciousNightReview()` deliberately
excludes nights that are `UNCERTAIN` only because the passport is immature or pairing was
ambiguous, where there is nothing concrete to ask about. Copy is selected by the leading reason
code (`ANCHOR_MISSING` / `ANCHOR_QUALITY_INSUFFICIENT` / default discordant-evidence wording);
reason codes are also shown in user language behind a native `<details>` disclosure. All four
review choices (`Only me`, `Shared / mixed`, `Not me`, `Unsure`) write an append-only review event
— "do not force a label" means the *label* recorded for `Unsure` stays `UNCERTAIN`/`UNKNOWN`, not
that nothing is written; a durable event is what stops the same night from re-prompting on every
later visit.

The card also treats query-scope changes (`userId`, date, lookback) as a hard UI boundary: it
invalidates the active assessment ref before fetching the next range, so a review write that was
already in flight for the old night cannot update the local label/event-id state of the newly
selected night. If the athlete changes their answer while the same card is still open, the next
submission supersedes the prior review event rather than editing it. On a later visit, an already
manually-reviewed night is intentionally not re-prompted; this PR does **not** add a separate
review-history editor for cross-session corrections. The persistence model supports superseding
review events, but exposing an explicit historical-correction surface is separate UI work rather
than silently re-opening old prompts.

## Historical out-of-sample replay (PI8)

`identityReplay.ts`'s `runIdentityReplay()` composes PI2 pairing/lineage/features, PI3's
out-of-sample passport fitting, and PI4's evaluator into paired-night coverage, reason-code
distribution, lineage/anchor-quality abstention counts, single-vs-multi-feature disagreement, a
before/after robust-baseline comparison, and a coverage-only threshold sensitivity sweep (there
are no real negative labels yet, so no false-acceptance/precision claim is made). Run it via:

```text
npm run evidence:identity-replay -- \
  --input path/to/replay.json \
  --json-out artifacts/identity-replay-reports/latest/report.json \
  --markdown-out artifacts/identity-replay-reports/latest/report.md
```

Input shape is `{ "nights": IdentityReplayNightInput[], "config": IdentityReplayConfig }` — see
`identityReplay.ts` for the exact contracts. The exporter must emit **exactly one canonical row per
`sourceNightKey`**. Duplicate logical-night rows are rejected before replay because PI3's replay
primitives and the report maps use `sourceNightKey` as the night identity; accepting duplicates
would let chronological replay train on the same logical night and would collapse result/passport
lookups, violating P-PI-16. Because the CLI loads JSON rather than typed TypeScript values,
`runIdentityReplay()` also validates the replay method, `minTrainingNights`, and candidate
`minUserScore` sweep bounds at runtime instead of silently interpreting malformed evidence input.

**No exporter exists yet** to turn the real 60-day Garmin+Eight Sleep history into that input
shape; the harness has only been exercised against synthetic fixtures. Producing the actual
historical evidence report — the input the PI9 activation decision needs — remains open work.

## Replaying one night's identity decision

There is no dedicated CLI for this yet — the mechanism exists as library functions an admin tool
could call:

```ts
const projection = await identityPersistenceService.getEffectiveProjection(userId, assessmentId);
// projection.assessment  -- the immutable automatic assessment (all evidence bundle refs,
//                           passport/policy/feature-schema versions, reason codes, score)
// projection.decision    -- the current effective status/eligibility, derived fresh from
//                           projection.assessment plus every review event for that assessment
```

`identityPersistenceService.getReviewEvents()` returns the full append-only chain in
`recordedAt` order if the review history itself (not just the current effective decision) is
needed. Because `deriveEffectiveIdentityDecision()` is pure and takes the assessment/review-events
as explicit arguments, replaying a historical decision with the exact policy/passport/feature
versions that produced it only requires re-running it against those same inputs — there is no
hidden global state to reconstruct. Building an actual `replay-identity-decision` CLI (mirroring
`replay:recommendation`) is deferred pending real usage to replay.

## Operational passport rebuild/versioning

There is also no operational rebuild CLI yet. `identityPassport.ts`'s `bootstrapPassportFromHistory()`
and `nextPassportVersion()` are the library functions such a CLI would call — today they are
exercised only by unit tests and by `identityReplay.ts`'s evidence harness, not by anything that
writes a new `physiological_identity_passport_versions/{version}` document in production. Building
that operational tool is deferred alongside the PI9 activation decision it would exist to serve.

## Fusion migration (PI9, partial)

`multisourceFusion.ts`'s `evaluateMultisourceFusion()` accepts optional
`effectiveIdentityProjections`/`identityPolicy` params. When supplied, they are authoritative for
shared-source bundle eligibility via `selectEligibleHealthObservationBundles()`, superseding
(not merging with) `coPresenceValidator.ts`'s legacy scalar heuristic — see
`result.identityGateApplied` and the "PI9 identity gate" test group in
`multisourceFusion.test.ts`. This is additive: existing callers that do not pass identity evidence
keep today's legacy-heuristic behaviour unchanged. The MS16 simulation harness has not been
migrated to construct real identity projections yet, so it still exercises the legacy fallback.

## Runbook: reverting to Garmin-only

Nothing currently needs reverting — no recommendation path consumes Eight Sleep/fusion output.
If a future change wires `multisourceFusion.ts`/`multisourceBaselines.ts` into
`recommendationService.ts`, reverting means:

1. Stop passing `effectiveIdentityProjections` (or set the feature's activation flag to `off`) so
   `evaluateMultisourceFusion()` returns `policy: 'off'` / empty `fusedMetrics`.
2. Confirm `computeSourceMetricBaseline()` callers for `eight_sleep`/shared sources are removed or
   short-circuited — Garmin-provider baselines are never identity-gated (only providers listed in
   `identityPolicy.identityRequiredSources` are), so no change is needed there.
3. No raw data needs deleting (P-PI-5): Eight Sleep observation bundles remain stored and
   displayable, only their `recovery`/`baselineLearning`/`passportLearning` eligibility changes.

## Privacy posture

The passport is derived from health physiology and used to confirm whether measurements belong to
a person — treat it as sensitive by design (ADR-0028's Privacy posture section). Today's
concrete state: all passport/assessment/review documents live under the existing
user-scoped `users/{uid}/...` Firestore tree (ADR-0002) with owner-only reads and server-only
writes for anything except a user's own review-event submissions (PI6's Firestore rules). No
identity feature residual, score, or lineage identifier is emitted into any analytics/logging
surface — there is currently no analytics pipeline in this app at all, so PI10's telemetry counter
list (`identity_assessment_total`, `identity_review_total`, etc.) remains a forward-looking design
rather than emitted counters; wiring it up is deferred alongside production activation, since
counters describing usage of a code path nothing calls in production would have nothing to count.
Retention/export/deletion of these documents follows the same account-deletion path as every other
`users/{uid}/...` document; no separate retention policy exists yet and should be revisited before
activation, per ADR-0028.

## Still not enabled

- No recommendation path reads fusion or shared-source baseline output.
- Automatic `NOT_USER` is not implemented (v1 structurally cannot emit it).
- The MS16 simulation harness has not migrated off the legacy co-presence heuristic.
- The real historical replay has been run (PI8): 68.3% `leaveOneOut` automatic USER coverage
  on 41 real paired nights, see
  [the evidence doc](../analysis/2026-08-28-identity-passport-replay-evidence.md).
- Prospective suspicious-night labels have not begun accumulating (no real usage yet).
- There is no review-history editor for reopening an already-reviewed night across sessions; the
  append-only persistence contract supports supersession, but this PR exposes correction only while
  the current card remains open.
- Telemetry counters are designed but not emitted (no analytics pipeline, no active call path).
- There is no operational passport-rebuild CLI and no `replay-identity-decision` CLI yet — both
  exist only as library functions today.
- The PI9 production-activation decision has not been made.
