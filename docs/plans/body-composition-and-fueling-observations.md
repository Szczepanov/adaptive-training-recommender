# Body-composition and fueling observations — implementation plan

**Status:** Draft  
**Blocked by:** acceptance of [ADR-0039](../adr/0039-longitudinal-body-composition-and-fueling-observations.md) for implementation work  
**Unlocks:** standardized manual anthropometry, optional hunger history, source-aware body-mass trends, and a real longitudinal evidence set for a later fueling/body-composition coaching decision  
**Source analysis:** [2026-09-14 body-composition and fueling observations](../analysis/2026-09-14-body-composition-and-fueling-observations.md)

## Goal

Deliver a small, coherent observation-first capability that lets an athlete record standardized
body measurements and hunger, review body-mass/circumference/appetite trends in **Data**, and
preserve source/measurement provenance without changing any training recommendation.

The implementation must make manual measurement useful **without** turning imperfect home
anthropometry into a body-fat estimator, a RED-S screen, or an automatic training-control signal.

---

## Objectives

- [ ] Persist user-authored, protocol-versioned body mass and circumference measurements under a
  dedicated owner-scoped collection.
- [ ] Preserve existing Garmin/provider weight rather than replacing or averaging it.
- [ ] Add an optional 0–100 morning hunger observation to the daily check-in with no completion or
  readiness authority.
- [ ] Add an in-Data body-composition/fueling surface with source-specific trend math, provenance
  and coverage visibility.
- [ ] Make measurement quality explicit: fixed landmarks, repeat readings, protocol context and
  correction/deletion.
- [ ] Keep every v1 signal out of recommendation selection, safety, fatigue and audit inputs.
- [ ] Add security, parser, migration and UI tests before shipping.
- [ ] Document retention/account-deletion behavior before this plan can be marked `Implemented`.
- [ ] Collect enough real longitudinal data to support a later evidence review; do not pre-approve
  recommendation authority in this plan.

---

## Default assumptions

Unless implementation evidence forces a change, use these defaults:

1. **No new top-level screen.** Entry/trends live under `Data`; hunger is collected in `Check-in`.
2. **Manual collection:** `users/{userId}/anthropometry_entries/{entryId}`.
3. **Protocol:** `home_anthropometry@1`.
4. **Body mass:** a manual entry and provider weight remain distinct sources.
5. **Circumferences:** two readings are requested; a large mismatch prompts a third; the retained
   summary is the median of entered readings.
6. **Repeatability tolerance:** implement as a named/versioned UI quality constant, initially
   `max(1.0 cm, 1% of the pair mean)` for circumference entries. This is a product heuristic only,
   not a physiological rule. If usability testing shows the prompt is too sensitive/insensitive,
   change the protocol/quality-policy revision rather than silently changing historical meaning.
7. **Body-mass 7-day display:** require at least 4 valid days in the selected source series before
   displaying a weekly mean/change label.
8. **Hunger:** 0–100 VAS, optional, intended pre-breakfast, no neutral default.
9. **No backfill:** existing users start with empty manual anthropometry history.
10. **Recommendation authority:** none. No `POLICY_VERSION` change unless implementation scope
    expands to decision-affecting behavior.

The numeric values in items 6–7 are transparent product/display heuristics. They must not be
registered or presented as sports-science thresholds unless a later decision gives them that
role.

---

## Do not do these things

- [ ] Do **not** make the client writable to `health_observation_days`.
- [ ] Do **not** reuse `AssessmentAttempt` for routine weekly tape measurements.
- [ ] Do **not** add hunger to the current readiness/fatigue formula.
- [ ] Do **not** make hunger mandatory for check-in completion.
- [ ] Do **not** use `Date.toISOString().split('T')[0]` for measurement dates.
- [ ] Do **not** average manual and Garmin/provider weight.
- [ ] Do **not** silently switch weight sources inside one trend line.
- [ ] Do **not** calculate body-fat percentage from tape measurements.
- [ ] Do **not** label circumference loss as muscle loss.
- [ ] Do **not** diagnose low energy availability or RED-S.
- [ ] Do **not** emit raw body/hunger values to analytics/error logging.
- [ ] Do **not** duplicate raw anthropometry history into `RecommendationAudit`.
- [ ] Do **not** add a top-level navigation item in v1.
- [ ] Do **not** create a recommendation policy constant without ADR-0033 claim/coverage/alignment
  ownership and a policy-version bump.

---

# Delivery sequence

The preferred implementation is a sequence of reviewable PRs. Each PR must leave the application
in a valid state and should be independently revertible.

## BC0 — contracts, validation and persistence

**Status:** Blocked by ADR-0039 acceptance  
**Dependencies:** none after ADR acceptance  
**Unlocks:** BC1 and BC3

### BC0.1 Define the domain contracts

Create a focused package such as `app/src/anthropometry/` rather than expanding
`engine/models.ts` with a non-engine domain.

Suggested files:

```text
app/src/anthropometry/models.ts
app/src/anthropometry/protocol.ts
app/src/anthropometry/validation.ts
app/src/anthropometry/trends.ts        # may start in BC3 if preferred
```

Tasks:

- [ ] Define `AnthropometryMetricId` with the ADR-0039 landmark-specific metric IDs.
- [ ] Define `AnthropometryLaterality` and make it part of limb-series identity.
- [ ] Define `AnthropometryMeasurement` with `readings`, deterministic `value`, unit and
  `repeatabilityWarning`.
- [ ] Define `AnthropometryEntry` with user/date/protocol/context/revision/schema metadata.
- [ ] Define `HOME_ANTHROPOMETRY_PROTOCOL` revision 1 with user-facing instructions and the named
  repeatability-quality policy.
- [ ] Keep dates Warsaw-local using `getLocalDateString()` / existing date validation.
- [ ] Keep `observedAt` as an instant/timestamp distinct from logical local date.

### BC0.2 Validation

- [ ] Reject unsupported metric IDs/units.
- [ ] Require kg for `body_mass_kg` and cm for circumference metrics.
- [ ] Enforce finite, positive, bounded values using broad corruption/safety bounds rather than
  narrow “healthy” ranges.
- [ ] Bound readings per metric (v1: 1 for body mass, 2–3 for circumference).
- [ ] Require laterality only where supported; never compare different laterality as one series.
- [ ] Require `value` to equal the deterministic summary of stored readings so clients cannot
  persist an unrelated display value.
- [ ] Validate `schemaVersion === 1`, `revision >= 1`, protocol id/revision and timestamps.
- [ ] Add tests for malformed/legacy/edge inputs and measurement-summary determinism.

### BC0.3 Firestore service

Add `app/src/services/anthropometryService.ts` (or an equivalent domain-owned persistence service).

- [ ] Create entry with generated collision-safe `entryId`.
- [ ] Read one entry.
- [ ] Query a bounded date range ordered deterministically.
- [ ] Correct/update an entry with monotonic revision and immutable ownership/id/createdAt.
- [ ] Delete an athlete-authored entry explicitly.
- [ ] Return `DataState`-style unavailable/invalid states where this improves consistency; do not
  collapse permission/network errors into an empty valid history.
- [ ] Never write manual records into `daily_recovery_snapshots` or
  `health_observation_days`.

### BC0.4 Firestore security rules

Add rules for `users/{userId}/anthropometry_entries/{entryId}`.

- [ ] Owner-only read/create/update/delete.
- [ ] `userId` and `entryId` match the authenticated path/document identity.
- [ ] Bound top-level keys and nested collection/list sizes.
- [ ] Bound string lengths, units, protocol values, numeric values and reading counts.
- [ ] Preserve immutable fields on update and require schema/revision monotonicity.
- [ ] Reject attempts to write another user's id.
- [ ] Add Firebase emulator rule tests for valid create/correct/delete and malformed/cross-user
  writes.

### BC0 acceptance

- [ ] Domain tests pass.
- [ ] `npm run test:rules` passes.
- [ ] Existing provider ingestion paths are untouched.
- [ ] A code-search/architecture test proves `app/src/engine/` does not import from the new
  anthropometry package/service.

---

## BC1 — standardized anthropometry entry UX inside Data

**Status:** Blocked by BC0  
**Dependencies:** BC0  
**Unlocks:** real manual measurement history and BC3 trend UX

### BC1.1 Entry form

Create a focused component under `app/src/components/` or a `body-composition/` subdirectory and
mount it from `DataView`.

- [ ] Add a `Log measurements` action.
- [ ] Show the protocol context before entry: preferred timing, no prior training, fixed landmark,
  tape/posture guidance.
- [ ] Default the logical date with `getLocalDateString()`.
- [ ] Allow body mass plus any subset of circumference metrics; do not require all nine at once.
- [ ] Replace ambiguous user labels with ADR-0039 terminology (`abdomen at navel`, `relaxed upper
  arm`).
- [ ] For limb measurements, expose laterality and default to the most recent choice for that
  metric when available; never silently change side.
- [ ] Request two circumference readings and apply the named repeatability check.
- [ ] Request a third reading only when the v1 quality tolerance is exceeded.
- [ ] Display the median summary while retaining raw entered readings.
- [ ] Make the difference between “preferred protocol followed” and “other context” visible rather
  than rejecting useful real-world entries.

### BC1.2 Correction and deletion

- [ ] Allow a user to open a prior manual session.
- [ ] Correct via revisioned update rather than editing ownership/time provenance invisibly.
- [ ] Delete only after an explicit confirmation.
- [ ] Ensure an entry disappearing from history invalidates/recomputes derived UI trends rather
  than leaving cached summaries.

### BC1.3 UX/accessibility tests

- [ ] Keyboard-accessible form controls.
- [ ] Numeric mobile input modes.
- [ ] Unit labels are explicit.
- [ ] Error messages identify the field and preserve entered values where safe.
- [ ] Component tests cover partial measurement sessions, laterality, repeatability prompt,
  correction and deletion.
- [ ] No values are written to console/analytics as part of event tracking.

### BC1 acceptance

- [ ] Athlete can record a protocol-aware weekly measurement session without leaving Data.
- [ ] Existing Data sections still render with no anthropometry history.
- [ ] No new `Screen` value or navigation group is introduced.

---

## BC2 — optional hunger observation in the daily check-in

**Status:** Blocked by ADR-0039 acceptance; independent of BC0/BC1  
**Dependencies:** accepted ADR-0039  
**Unlocks:** appetite trend history for BC3

### BC2.1 Schema/model/parser

- [ ] Add nullable/optional `hunger` (0–100) to `DailySubjectiveCheckin`.
- [ ] Preserve existing check-in schema compatibility; decide whether the additive field requires a
  schema bump based on current parser/rules version strategy and document the choice in code.
- [ ] Update validation/parser/service merge semantics so clearing hunger does not resurrect a stale
  value.
- [ ] Do not add hunger to `SubjectiveDimensionKey` or `SubjectiveInput`.
- [ ] Do not add hunger to `isCompletedSubjectiveCheckin` requirements.
- [ ] Add parsing tests proving legacy check-ins without hunger remain valid.

### BC2.2 Check-in UX

- [ ] Add `Hunger right now` as a 0–100 VAS/slider with endpoint labels.
- [ ] Make it visually optional.
- [ ] Do not pre-fill a neutral score.
- [ ] Record the initial response before any retrospective hunger context is displayed.
- [ ] Do not show previous hunger/trend values in the pre-submit check-in flow, preserving
  ADR-0020 `D-SUBJANCHOR`.
- [ ] If the user edits the check-in later, preserve the existing first-submission/wearable-reveal
  semantics rather than pretending the edited value was the original one.

### BC2.3 Structural no-authority tests

- [ ] Existing recommendation fixtures remain bit-identical when the only input difference is
  hunger.
- [ ] Add an architecture/import test proving readiness/fatigue/rules do not consume hunger.
- [ ] `POLICY_VERSION` remains unchanged because this PR cannot alter recommendations.

### BC2 acceptance

- [ ] Daily check-in can be completed with hunger missing.
- [ ] Hunger values persist/reload/correct correctly.
- [ ] Recommendation output is unchanged for all hunger values 0–100.

---

## BC3 — source-aware trend composition and Data dashboard

**Status:** Blocked by BC0 + BC1; hunger panels additionally require BC2  
**Dependencies:** BC0, BC1, BC2 for the complete dashboard  
**Unlocks:** usable retrospective monitoring and the future evidence review

### BC3.1 Body-mass source adapter

Create a pure/read-model boundary that can receive:

- manual `body_mass_kg` entries;
- existing provider/recovery weight observations.

It must produce **separate source series**, not one merged scalar stream.

- [ ] Define a stable source identity for manual and provider values.
- [ ] Preserve logical date, observed time and source metadata.
- [ ] Deduplicate only true duplicate records from the same source/identity; never deduplicate solely
  because values match.
- [ ] Do not make the React client write a provider-compatible observation document.
- [ ] If the implementation reads only `DailyRecoverySnapshot` rather than raw
  `health_observation_days` for Garmin v1, document that compatibility projection explicitly and
  keep the composition API provider-neutral enough to migrate later.

### BC3.2 Trend math

Implement pure functions with deterministic tests.

Body mass:

- [ ] raw selected-source points;
- [ ] 7-day mean only with >=4 valid local dates;
- [ ] adjacent-window week-over-week absolute change;
- [ ] adjacent-window percentage change;
- [ ] explicit `recordedDays/7` coverage;
- [ ] no interpolation/carry-forward.

Circumference:

- [ ] series key includes metric + laterality + protocol revision;
- [ ] latest valid vs previous valid delta;
- [ ] no interpolation;
- [ ] entries with repeatability warnings remain visible and identified rather than silently
  dropped unless the user marks/corrects them invalid in a future revision.

Hunger:

- [ ] 7-day and 28-day retrospective summary;
- [ ] recorded-day counts;
- [ ] insufficient-coverage state instead of neutral padding;
- [ ] no diagnostic label.

### BC3.3 Source selection

- [ ] Show which body-mass source currently drives the displayed trend.
- [ ] Allow explicit source selection when more than one source exists.
- [ ] If a default source is automatically selected, use a deterministic policy based on recent
  coverage and stable tie-break ordering.
- [ ] Never splice sources within a trend window.
- [ ] When selected source changes, visually mark the source change rather than rendering it as
  continuous measurement equivalence.

### BC3.4 Data UI

Suggested order:

1. **Body mass** — latest, 7-day mean, WoW change, coverage, source.
2. **Waist & abdomen** — latest + previous delta.
3. **Hunger** — 7d/28d retrospective summary + coverage.
4. **Other circumferences** — expandable cards/series.
5. Measurement-history table with protocol/repeatability/source details on demand.

- [ ] Use neutral observational copy.
- [ ] Do not make a green/red “good/bad” body-weight score in v1.
- [ ] Do not foreground provider `bodyFatPct`; if displayed, label source and treat as contextual.
- [ ] Ensure no-history, sparse-history, unavailable-provider and mixed-source states are all
  deliberate UI states.

### BC3.5 Optional cycling W/kg context

This can be split into a separate PR if the canonical FTP/performance authority is not obvious.

- [ ] Identify the current canonical power/FTP-like value rather than adding a second FTP field.
- [ ] Derive W/kg only from explicit power evidence + selected source-specific body-mass summary.
- [ ] Show both provenance inputs.
- [ ] Keep context-only and out of goals/recommendations.
- [ ] Skip this item rather than guessing the power authority.

### BC3 acceptance

- [ ] Two simultaneous weight sources do not get averaged.
- [ ] Sparse weeks do not get labelled as complete weekly trends.
- [ ] Source changes are visible.
- [ ] A user can understand what changed without the UI claiming why it changed biologically.

---

## BC4 — privacy, lifecycle, documentation and release hardening

**Status:** Blocked by BC1–BC3  
**Dependencies:** BC1, BC2, BC3  
**Unlocks:** production release of the observation/reporting capability

### BC4.1 Privacy/lifecycle

- [ ] Verify the repository's current account-deletion/user-data deletion path and add
  `anthropometry_entries` to it if necessary.
- [ ] Document retention: manual entries remain until the athlete deletes them or account/user-data
  deletion removes them; do not invent a silent short TTL for longitudinal measurements.
- [ ] Verify error reporting/logging cannot include raw measurements or hunger values.
- [ ] Verify analytics events contain only action metadata (for example `measurement_saved`) and
  never the value, if analytics are used at all.
- [ ] Ensure export/context features include body data only through an explicit user-invoked export
  path and with clear units/source/coverage; do not automatically enlarge recommendation audits.

### BC4.2 Documentation

Once implementation lands, update living docs to describe what exists **then**, not before:

- [ ] `docs/architecture/` appropriate current-state page or add a focused body-observation section
  to the relevant health/data architecture page.
- [ ] `docs/README.md` ADR/analysis/plan indexes.
- [ ] `docs/plans/README.md` status board.
- [ ] root `README.md` Technical Features only after the capability actually exists.
- [ ] any data-model/privacy docs affected by the new collection.

### BC4.3 Verification

Run and report actual results:

```bash
make check
cd app && npm run test:rules
```

Because the implementation changes frontend models, Firestore rules and UI, the code PRs also need
normal CI gates rather than the docs-only fast path.

- [ ] TypeScript typecheck clean.
- [ ] ESLint clean.
- [ ] Vitest clean.
- [ ] Firestore emulator rule suite clean.
- [ ] Knowledge/workout validators unchanged/clean.
- [ ] No policy-drift failure; if the checker reports a decision-path change, stop and investigate
  rather than bypassing it.
- [ ] Visual/mobile smoke review of Data and Check-in.

### BC4 acceptance

- [ ] Privacy/lifecycle behavior is documented and tested where practical.
- [ ] Architecture docs describe the implemented state.
- [ ] Status board reflects what actually shipped.
- [ ] Observation/reporting release can be rolled back without affecting recommendations.

---

## BC5 — prospective evidence review; no automatic implementation

**Status:** Blocked by real usage  
**Dependencies:** BC4 plus sufficient longitudinal history  
**Usage trigger:** enough real measurements to evaluate whether body-mass/hunger/circumference
trends add useful context beyond existing performance/recovery signals  
**Unlocks:** possibly a separate future fueling-advisory ADR

This is intentionally an **evidence task**, not a promised feature phase.

- [ ] Review completion/coverage rates: daily weight, weekly anthropometry, hunger.
- [ ] Quantify measurement repeatability warnings and correction frequency.
- [ ] Check source discontinuities and whether manual/provider weight are equivalent enough for any
  future presentation simplification; do not assume equivalence.
- [ ] Compare body-mass trend with waist/abdomen and available performance trends.
- [ ] Examine whether hunger adds information beyond fatigue/sleep/stress/load rather than simply
  correlating with them.
- [ ] Record false-positive examples where weight/hunger changed transiently but performance and
  recovery stayed normal.
- [ ] Record cases where multiple signals deteriorated together.
- [ ] Decide whether the correct next step is:
  - keep the capability informational only;
  - add a non-training “review fueling” advisory;
  - investigate a coach-facing body-composition goal loop;
  - or stop because the signal quality/adherence is insufficient.

Any advisory or recommendation authority requires a **new analysis + ADR**, with ADR-0033
knowledge ownership and `POLICY_VERSION` semantics if training decisions can change.

---

# Data-contract checklist

Before BC0 is merged, reviewers should be able to answer all of these from code/tests:

- [ ] What is the stable document identity?
- [ ] Which local date owns an entry?
- [ ] Which instant records when it was actually measured?
- [ ] Which protocol revision defines the landmark?
- [ ] Which side was measured for limb circumferences?
- [ ] What raw repeats produced the stored summary?
- [ ] Was repeatability questionable?
- [ ] Who can read/write/correct/delete the record?
- [ ] What happens when a write/read fails?
- [ ] How does an old user with no record behave?
- [ ] How is a provider weight kept distinct from a manual weight?
- [ ] Can any of this data change a recommendation? The v1 answer must be **no**.

---

# Rollout and rollback

## Rollout

1. Ship persistence/rules/tests first.
2. Ship manual entry UX.
3. Ship optional hunger collection with no authority.
4. Ship retrospective trends.
5. Observe real data quality/adherence before any coaching interpretation.

A feature flag is optional for BC1/BC3 if the UI can remain hidden safely, but the underlying data
contract must not depend on a process-local flag for correctness.

## Rollback

Because v1 has no engine authority, rollback is deliberately cheap:

- remove/hide the entry/trend UI;
- stop new manual writes;
- leave existing owner-scoped records intact unless the athlete deletes them;
- provider recovery ingestion continues unchanged;
- hunger can remain an ignored backward-compatible field if rolling back UI is safer than a schema
  deletion;
- recommendations remain unaffected throughout.

Do not perform destructive bulk deletion as part of a product rollback.

---

# Definition of done

This plan is `Implemented` only when all of the following are true:

- [ ] ADR-0039 is accepted (or superseded by an accepted replacement).
- [ ] Manual anthropometry persistence + validation + owner-only Firestore rules are live.
- [ ] Standardized measurement UX is available in Data.
- [ ] Hunger is optional, nullable, anti-anchored and recommendation-neutral.
- [ ] Body-mass trends are source-specific and coverage-aware.
- [ ] Circumference trends preserve landmark/protocol/laterality identity.
- [ ] No tape-derived body-fat/lean-mass/RED-S claims exist.
- [ ] Correction and deletion work for manual records.
- [ ] Account/user-data deletion and retention behavior are verified/documented.
- [ ] Raw values are absent from analytics/error telemetry and recommendation audits.
- [ ] All applicable unit/component/rules tests and `make check` pass.
- [ ] Living architecture/index/status docs have been updated to the implemented state.
- [ ] No body-composition/hunger signal can alter a recommendation without a later explicit
  activation decision.