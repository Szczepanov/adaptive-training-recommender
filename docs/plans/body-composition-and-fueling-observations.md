# Body-composition and fueling observations — implementation plan

**Status:** Draft
**Blocked by:** acceptance of [ADR-0039](../adr/0039-longitudinal-body-composition-and-fueling-observations.md) for implementation work
**Unlocks:** protocol-aware manual anthropometry, optional hunger history, source-aware body-mass trends, and a real longitudinal evidence set for a later fueling/body-composition coaching decision
**Source analysis:** [2026-09-14 body-composition and fueling observations](../analysis/2026-09-14-body-composition-and-fueling-observations.md)

## Goal

Deliver a small observation-first capability that lets an athlete record repeatable home body
measurements and hunger context, review source-aware trends in **Data**, and preserve provenance
without changing any training recommendation.

The implementation must make manual measurement useful without turning imperfect home
anthropometry into a body-fat estimator, an energy-availability / RED-S screen, or an automatic
training-control signal.

---

## Objectives

- [ ] Persist athlete-authored, protocol-versioned body mass and circumference sessions in a
  dedicated owner-scoped domain.
- [ ] Preserve existing provider body mass rather than replacing, averaging or silently splicing
  it with manual values.
- [ ] Add optional timing-aware 0–100 hunger VAS context to the daily check-in with no completion or
  readiness authority.
- [ ] Add an in-Data body-composition/fueling surface with source-specific trend math, provenance,
  context and coverage visibility.
- [ ] Make measurement quality explicit through named landmarks, repeat readings, context and
  correction/deletion.
- [ ] Keep every v1 signal out of recommendation selection, safety, fatigue and audit inputs.
- [ ] Add persistence validation, Firestore rules, parsers, migration compatibility and UI tests.
- [ ] Document retention/account-deletion behavior before this plan can be marked `Implemented`.
- [ ] Collect real longitudinal observations before any future coaching-authority decision.

---

## Default contracts

Unless implementation evidence forces a reviewed change:

1. **No new top-level screen.** Entry/trends live under Data; hunger is collected in Check-in.
2. **Manual collection:** `users/{userId}/anthropometry_entries/{entryId}`.
3. **Protocol:** `home_anthropometry@1`.
4. **Protocol language:** the named non-waist sites are app-defined repeatable home landmarks, not
   claims of clinical/ISAK standardization.
5. **Body mass:** manual and provider observations remain distinct source series.
6. **Body-mass readings:** one retained reading per manual session; one deterministic derived point
   per source/local date before weekly trend math.
7. **Circumferences:** request two readings; when the pair exceeds the versioned repeatability
   tolerance, request a third; retained summary is the median.
8. **Initial circumference quality tolerance:** `max(1.0 cm, 1% of the pair mean)`. This is a
   product measurement-quality heuristic, not a physiological rule. If changed in a way that
   changes accepted/summarized values, bump the protocol/quality-policy revision.
9. **Body-mass 7-day display:** require at least 4 distinct valid local dates in the selected source
   series before displaying a weekly mean/change label.
10. **Hunger fields:** `hungerVas0To100` plus `hungerTiming = morning_pre_breakfast | other`.
11. **Hunger comparison series:** morning/pre-breakfast is the default retrospective series;
    `other` remains visible but is not silently mixed into it.
12. **No backfill:** existing users start with empty manual anthropometry history and no synthetic
    hunger history.
13. **Recommendation authority:** none. No `POLICY_VERSION` change unless scope expands to behavior
    that can alter a recommendation.

Items 8–9 are transparent product/display heuristics. They must not be presented as sports-science
or health thresholds.

---

## Do not do these things

- [ ] Do **not** make the client writable to `health_observation_days`.
- [ ] Do **not** force routine tape/scale tracking through `AssessmentAttempt` or Testing.
- [ ] Do **not** create a second generic observation framework from the anthropometry package.
- [ ] Do **not** add hunger to readiness, strain, fatigue or candidate ranking.
- [ ] Do **not** make hunger mandatory for check-in completion.
- [ ] Do **not** use `Date.toISOString().split('T')[0]` for logical measurement dates.
- [ ] Do **not** count two measurements on one date as two coverage days.
- [ ] Do **not** average manual and provider weight.
- [ ] Do **not** silently change a user-selected weight source when coverage becomes sparse.
- [ ] Do **not** mix `hungerTiming = other` into a pre-breakfast appetite trend.
- [ ] Do **not** calculate body-fat percentage from tape measurements.
- [ ] Do **not** label circumference loss as muscle loss.
- [ ] Do **not** diagnose low energy availability or RED-S.
- [ ] Do **not** emit raw body/hunger values to analytics, console logs or error reports.
- [ ] Do **not** duplicate raw anthropometry history into `RecommendationAudit`.
- [ ] Do **not** add a top-level navigation item in v1.
- [ ] Do **not** add a decision threshold without ADR-0033 lineage/alignment ownership and a
  policy-version bump.

---

# Delivery sequence

Prefer small reviewable PRs. Every PR must leave the application in a valid state and be
independently revertible.

## BC0 — domain contracts, validation, persistence and security

**Status:** Blocked by ADR-0039 acceptance
**Dependencies:** none after ADR acceptance
**Unlocks:** BC1 and BC3

### BC0.1 Define the focused domain

Create a package such as:

```text
app/src/anthropometry/models.ts
app/src/anthropometry/protocol.ts
app/src/anthropometry/validation.ts
app/src/anthropometry/trends.ts        # may land with BC3 instead
```

Tasks:

- [ ] Define the ADR-0039 `AnthropometryMetricId` vocabulary.
- [ ] Define laterality only for supported limb measurements and include it in series identity.
- [ ] Define `AnthropometryMeasurement` with unit, retained readings, deterministic `value` and
  repeatability warning.
- [ ] Define `AnthropometryEntry` with `entryId`, user/date/observedAt/protocol/context,
  current-record revision and schema metadata.
- [ ] Document in code that `revision` is stale-write/correction protection, not immutable history.
- [ ] Define `HOME_ANTHROPOMETRY_PROTOCOL` revision 1 and a named/versioned quality policy.
- [ ] Use the existing Warsaw-local date helpers and validate that `observedAt` resolves to the
  entry's logical local `date`.

### BC0.2 Validation

- [ ] Reject unsupported metric IDs and units.
- [ ] Require kg for `body_mass_kg` and cm for circumference metrics.
- [ ] Use broad finite corruption/safety bounds, not narrow “healthy” ranges.
- [ ] Require exactly one retained reading for body mass and 2–3 for circumference.
- [ ] Require laterality only where the metric supports it.
- [ ] Require `value` to equal the deterministic median/summary of retained readings.
- [ ] Derive/validate `repeatabilityWarning` from the versioned quality policy; do not trust an
  arbitrary client boolean.
- [ ] Validate `schemaVersion === 1`, protocol id/revision, timestamps and monotonic revision.
- [ ] Add edge/malformed tests, including NaN/infinite values and invalid metric/unit pairings.

### BC0.3 Firestore service

Add `app/src/services/anthropometryService.ts` or an equivalent domain-owned service.

- [ ] Create entries with collision-safe IDs.
- [ ] Read one entry.
- [ ] Query a bounded local-date range with deterministic ordering.
- [ ] Correct an entry with optimistic/monotonic revision semantics while preserving
  `userId`, `entryId` and `createdAt`.
- [ ] Delete an athlete-authored entry explicitly.
- [ ] Return `DataState`-style invalid/unavailable states rather than collapsing read failures into
  an empty valid history.
- [ ] Never write manual records into `daily_recovery_snapshots`, `health_observation_days`, or
  `metric_observations`.

### BC0.4 Firestore rules

Add rules for `users/{userId}/anthropometry_entries/{entryId}`.

- [ ] Owner-only read/create/update/delete.
- [ ] Require document `userId` / `entryId` to match path identity.
- [ ] Bound top-level keys, nested keys, list sizes, string lengths, enum values and reading counts.
- [ ] Enforce broad numeric corruption bounds that mirror application validation.
- [ ] Preserve immutable identity fields and require revision advancement on update.
- [ ] Reject cross-user writes and malformed nested data.
- [ ] Add Firebase emulator tests for valid create/correct/delete, stale revision, malformed data and
  cross-user attempts.

### BC0 acceptance

- [ ] Domain unit tests pass.
- [ ] `npm run test:rules` passes.
- [ ] Existing provider/testing ingestion paths are untouched.
- [ ] An architecture/import test proves `app/src/engine/` does not consume the anthropometry
  package/service.

---

## BC1 — protocol-aware measurement UX inside Data

**Status:** Blocked by BC0
**Dependencies:** BC0
**Unlocks:** real manual history and BC3 trend UX

### BC1.1 Entry flow

Mount a focused component from `DataView`.

- [ ] Add `Log measurements`.
- [ ] Show preferred context before entry: morning when practical, post-void, pre-intake,
  pre-training, same landmark/posture and relaxed protocol-defined respiratory state.
- [ ] Default logical date with the existing Warsaw-local helper.
- [ ] Allow body mass plus any subset of circumferences; never require all metrics in one session.
- [ ] Use precise labels such as `abdomen at navel` and `relaxed upper arm`.
- [ ] For limbs, expose laterality and remember the most recent side only as an explicit
  convenience; never silently switch side.
- [ ] Request two circumference readings and apply the named repeatability check.
- [ ] Request a third only when the first pair exceeds the v1 tolerance.
- [ ] Display the deterministic median while retaining entered readings.
- [ ] Make preferred versus other measurement context visible instead of rejecting real-world
  non-preferred entries.

### BC1.2 Correction/deletion

- [ ] Open prior manual sessions from history.
- [ ] Correct the existing logical entry and increment its current-record revision rather than
  creating a duplicate merely to replace a mistake.
- [ ] Confirm deletion explicitly.
- [ ] Invalidate/recompute derived UI trends after correction/deletion.

### BC1.3 UX/accessibility tests

- [ ] Keyboard-accessible controls and labels.
- [ ] Appropriate mobile numeric input modes.
- [ ] Explicit unit labels.
- [ ] Field-specific errors that preserve safe entered values.
- [ ] Component tests for partial sessions, laterality, quality prompt, correction and deletion.
- [ ] No raw values in analytics/console telemetry.

### BC1 acceptance

- [ ] Athlete can record a protocol-aware manual session without leaving Data.
- [ ] Existing Data content renders correctly with no anthropometry history.
- [ ] No new `Screen` value or top-level navigation group exists.

---

## BC2 — optional timing-aware hunger in Check-in

**Status:** Blocked by ADR-0039 acceptance; independent of BC0/BC1
**Dependencies:** accepted ADR-0039
**Unlocks:** appetite history for BC3

### BC2.1 Model/parser/validation

- [ ] Add optional/nullable `hungerVas0To100` and
  `hungerTiming: morning_pre_breakfast | other` to `DailySubjectiveCheckin`.
- [ ] New-write invariant: numeric hunger requires valid timing; clearing hunger clears both.
- [ ] Preserve legacy documents with neither field.
- [ ] Decide/document whether the additive fields require a check-in schema bump under the current
  parser/version strategy.
- [ ] Update application validation to require finite values in 0–100.
- [ ] Update persistence/parser code so explicit clearing cannot leave stale merged values.
- [ ] Do not add hunger to `SubjectiveDimensionKey`, `SubjectiveInput`, check-in completeness or
  readiness composition.

### BC2.2 Firestore persistence boundary

The current daily-check-in rules do not validate these new fields. Do not rely on TypeScript alone.

- [ ] Update `firestore.rules` to allow legacy docs with no hunger fields.
- [ ] For new hunger values, enforce 0–100 and the timing enum.
- [ ] Enforce consistent value/timing presence or supported explicit-null semantics.
- [ ] Ensure update/clear behavior cannot retain a stale timing or value.
- [ ] Add emulator tests for missing, valid endpoints (0/100), invalid negative/>100/non-number,
  invalid timing and clear/update transitions.

### BC2.3 Check-in UX

- [ ] Add `Hunger right now` as a 0–100 VAS/slider with endpoint labels.
- [ ] Mark it optional and do not pre-fill a neutral value.
- [ ] Capture preferred `morning_pre_breakfast` versus `other` timing without adding heavy burden.
- [ ] Do not show previous hunger/trends before today's initial submission (`D-SUBJANCHOR`).
- [ ] Preserve existing `initialSubmittedAt` / wearable-reveal editing semantics.

### BC2.4 Structural no-authority tests

- [ ] Recommendation fixtures are bit-identical when the only input difference is hunger/timing.
- [ ] Add an architecture/import or focused mapping test proving rules/fatigue/optimizer do not
  consume hunger.
- [ ] `POLICY_VERSION` remains unchanged.

### BC2 acceptance

- [ ] Check-in remains completable with hunger absent.
- [ ] Hunger value/timing persist, reload, clear and correct without stale-field resurrection.
- [ ] Recommendation output is unchanged for hunger values 0 through 100 and both timing contexts.

---

## BC3 — source-aware trend composition and Data dashboard

**Status:** Blocked by BC0 + BC1; complete hunger panel additionally requires BC2
**Dependencies:** BC0, BC1, BC2 for full dashboard
**Unlocks:** usable retrospective monitoring and future evidence review

### BC3.1 Read-model source adapters

Compose, but do not persist as one fused measurement:

- manual `body_mass_kg` sessions;
- existing provider/recovery body-mass observations;
- manual circumference series;
- check-in hunger series.

- [ ] Give each body-mass source stable identity and visible label.
- [ ] Preserve logical date, observed time/context and source metadata.
- [ ] If v1 reads provider weight only from `DailyRecoverySnapshot`, document that as a provider
  compatibility projection rather than pretending it is a manual record.
- [ ] Keep composition API source-aware so ADR-0027-style provider evolution does not require a UI
  rewrite.

### BC3.2 Deterministic daily body-mass reduction

Implement a pure function **before** weekly trend calculation.

For each selected source/local date:

- [ ] Manual: prefer `morning_post_void_pre_intake && !trainingBeforeMeasurement`.
- [ ] Manual: choose earliest `observedAt` in the preferred set; otherwise earliest valid same-day
  entry and mark non-preferred context.
- [ ] Use stable entry identity as timestamp tie-break.
- [ ] Keep all raw sessions visible in history even though only one point represents the date.
- [ ] Provider adapter emits at most one deterministic point per source/local date; any provider
  deduplication belongs in that adapter.
- [ ] Coverage counts distinct dates after reduction, never raw record count.

### BC3.3 Pure trend math

Body mass:

- [ ] raw selected-source daily points;
- [ ] 7-day arithmetic mean only with >=4 distinct valid local dates;
- [ ] adjacent-window week-over-week absolute and percentage change only when both windows qualify;
- [ ] explicit `recordedDays/7` coverage;
- [ ] no interpolation/carry-forward.

Circumference:

- [ ] series key includes metric + laterality + protocol revision;
- [ ] latest valid versus previous valid delta;
- [ ] no interpolation;
- [ ] retain repeatability/context indicators rather than silently hiding warned measurements.

Hunger:

- [ ] default trend uses `morning_pre_breakfast` only;
- [ ] `other` remains a separate/raw context and does not increase preferred-series coverage;
- [ ] 7-day and 28-day arithmetic means with recorded-day counts;
- [ ] insufficient-history state instead of neutral padding;
- [ ] no good/bad fueling or diagnostic label.

### BC3.4 Source selection

- [ ] Show which body-mass source drives the trend.
- [ ] Allow explicit selection when multiple sources exist.
- [ ] With no explicit selection, an initial default may use recent coverage plus a stable tie-break.
- [ ] An explicit user selection is sticky; do not silently auto-switch it because coverage changes.
- [ ] Never splice different sources inside one trend window.
- [ ] Source changes are visually explicit and are not rendered as continuous measurement
  equivalence.

### BC3.5 Data UI

Suggested order:

1. **Body mass** — source, latest point/context, 7-day mean, WoW change, coverage.
2. **Waist & abdomen** — latest + prior delta.
3. **Hunger** — timing-aware 7d/28d summary + coverage.
4. **Other circumferences** — expandable cards/series.
5. Measurement history with protocol/context/repeatability/source details on demand.

- [ ] Neutral observational copy only.
- [ ] No green/red “good/bad body weight” score.
- [ ] Do not foreground provider `bodyFatPct`; if shown, label source and contextual status.
- [ ] No-history, sparse-history, unavailable-provider and mixed-source states are intentional UI
  states rather than empty fallbacks.

### BC3 acceptance

- [ ] Two same-day manual weights count as one coverage date and one daily trend point.
- [ ] Two simultaneous sources never get averaged/spliced.
- [ ] Sparse weeks never get labelled complete.
- [ ] Explicit source selection never auto-switches silently.
- [ ] Hunger timing contexts never merge silently.
- [ ] Athlete can inspect provenance/context behind every displayed trend.

---

## BC4 — privacy, lifecycle, docs and release gate

**Status:** Blocked by BC0–BC3
**Dependencies:** BC0, BC1, BC2, BC3
**Unlocks:** production rollout of the observation-only capability

### BC4.1 Privacy/lifecycle

- [ ] Confirm account deletion removes `anthropometry_entries` according to repository deletion
  semantics; add implementation if the current deletion path does not cover it.
- [ ] Document retention behavior for athlete-authored measurements.
- [ ] Verify analytics/error reporting contains no raw anthropometry/hunger values.
- [ ] Verify recommendation audits do not contain raw values or derived trend payloads.
- [ ] Keep history queries bounded.

### BC4.2 Documentation

- [ ] Move plan status through the normal lifecycle only when implementation evidence supports it.
- [ ] Update the docs ADR/index/navigation references required by repository conventions.
- [ ] Document the home protocol, source semantics, trend coverage and non-diagnostic boundary in
  user-facing help where applicable.
- [ ] Record any implementation deviations from ADR-0039 explicitly rather than silently changing
  the contract.

### BC4.3 Release evidence

- [ ] `npm run check` passes.
- [ ] `npm run test:rules` passes.
- [ ] Relevant visual/component tests pass on desktop and mobile.
- [ ] Architecture/no-authority tests pass.
- [ ] Legacy check-ins and users with no anthropometry history remain compatible.
- [ ] Rollback can remove the UI/read path without touching provider data or recommendation policy.

### BC4 acceptance

- [ ] Observation-only feature can ship without recommendation changes.
- [ ] Security/privacy/lifecycle behavior is documented and tested.
- [ ] No `POLICY_VERSION` bump is necessary because output is recommendation-invariant.

---

## BC5 — optional cycling W/kg context

**Status:** Optional follow-up, not required for BC4
**Dependencies:** BC3 and a clearly identified canonical cycling power/FTP-like authority

- [ ] Identify the existing canonical power value rather than adding another FTP field.
- [ ] Derive W/kg only from explicit power evidence plus the selected source-specific body-mass
  summary.
- [ ] Show provenance for both inputs.
- [ ] Keep the derived value context-only and out of goals/recommendations.
- [ ] Skip BC5 if canonical power authority is ambiguous; do not guess.

---

# Cross-cutting tests

## Persistence and migration

- [ ] Existing users with no manual measurements remain valid.
- [ ] Legacy check-ins without hunger fields parse and save.
- [ ] Explicit hunger clearing removes both value and timing.
- [ ] Anthropometry stale revisions fail rather than silently overwriting a newer correction.
- [ ] Delete/correction immediately changes derived Data trends.

## Time semantics

- [ ] Logical dates use Europe/Warsaw helpers.
- [ ] DST boundary tests prove local-date grouping is stable.
- [ ] `observedAt`/logical-date consistency is validated.
- [ ] Distinct-date coverage is correct across month/year boundaries.

## Measurement integrity

- [ ] Different landmarks never compare as one series.
- [ ] Different laterality never compares as one series.
- [ ] Different protocol revisions never silently compare as one series.
- [ ] Repeatability tolerance and median summary are deterministic.
- [ ] Multiple same-day manual sessions never increase weekly coverage count.

## Recommendation isolation

- [ ] Engine/recommender imports do not depend on anthropometry trend code.
- [ ] Hunger does not map into `SubjectiveInput`.
- [ ] Recommendation outputs are invariant to anthropometry/hunger presence and values.
- [ ] Raw values do not enter `RecommendationAudit`.

---

# Evidence/decision review after real use

Do **not** schedule automatic recommendation activation as part of this plan.

After a meaningful real-world observation period, a separate analysis may ask:

- Are measurements adhered to under the intended protocol?
- How often do repeatability warnings occur?
- Does manual/provider source disagreement create user confusion?
- Is morning pre-breakfast hunger completion high enough to support a stable trend?
- Do body-mass/waist/hunger trends add information beyond existing recovery/performance data?
- Can any candidate advisory be validated prospectively without encouraging unnecessary weight
  loss or overreacting to noisy measurements?

Only if a concrete decision-affecting use case survives that review should a new ADR define claim
lineage, thresholds, `POLICY_VERSION`, simulation/replay evidence and bounded activation.

---

# Validation for this documentation PR

Because PR #568 remains documentation-only, the repository-level validation target is:

```bash
uv run pre-commit run --all-files
```

The current PR must also end every new Markdown file with a newline and contain no trailing
whitespace so repository hygiene hooks pass.

---

## Completion definition

This plan can move to `Implemented` only when BC0–BC4 are complete and evidenced. BC5 is optional.

Implementation completion means the app can collect and review protocol-aware manual body
measurements and timing-aware hunger context with explicit provenance, coverage and privacy while
remaining structurally incapable of changing a training recommendation from those v1 signals.
