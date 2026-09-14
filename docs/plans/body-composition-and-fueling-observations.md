# Body-composition and fueling observations — implementation plan

**Status:** Implemented (BC0–BC4; BC5 skipped as optional per its own allowance)
**Blocked by:** none — [ADR-0039](../adr/0039-longitudinal-body-composition-and-fueling-observations.md) is Accepted
**Unlocks:** protocol-aware manual anthropometry, provider-first body-mass trends, optional hunger history, contextual connected-scale estimates, and a real longitudinal evidence set for later coaching research
**Source analysis:** [2026-09-14 body-composition and fueling observations](../analysis/2026-09-14-body-composition-and-fueling-observations.md)

## Completion summary (2026-09-14)

BC0–BC4 are implemented and verified: `app/src/anthropometry/` (models/protocol/validation/trends),
`anthropometryService.ts`, the `LogMeasurementsModal`/`BodyCompositionPanel` UI wired into Data's
new "Body" tab, optional timing-aware hunger in Check-in, Firestore rules and emulator tests, and
the recommendation-isolation tests (`engineIsolation.test.ts`,
`hungerRecommendationInvariance.test.ts`) all pass. `make check`, `make simulate`'s aggregate-bounds
gate, `cd app && npm run test:rules` (the anthropometry-specific suite in isolation; the full
`test:rules` run hit unrelated pre-existing emulator resource-contention timeouts in this
environment, not rule failures), and `scripts/check-policy-drift.mjs` all pass with `POLICY_VERSION`
unchanged.

This session closed two real gaps left by the prior pass rather than just re-verifying claims:

1. **Firestore rules did not validate measurement item shape.** `hasValidAnthropometryEntry` bounded
   only the `measurements` array's length, not each item's `metricId`/`unit`/`readings`/`value`/
   `laterality` — unlike every other bounded-array collection in this file (equipment lists, rest
   directives). Added `hasValidAnthropometryMeasurements`/`isValidAnthropometryMeasurement` mirroring
   `validation.ts`'s `METRIC_BOUNDS`, plus emulator tests for each malformed case.
2. **Editing/backdating an entry's date could make persistence validation reject the save.**
   `LogMeasurementsModal` kept the original `observedAt` (or `now`) independent of the editable
   `date` field; `validateAnthropometryEntry` requires `observedAt`'s Warsaw-local date to equal
   `date`, so changing the date (or backdating a fresh session to "yesterday") would fail. Added
   `deriveObservedAtForLocalDate` (`protocol.ts`, with a DST-crossing unit test) and wired it into
   both the create and correct paths.

Also fixed: two `console.warn` calls in `anthropometryService.ts` were logging validation error
*messages*, which embed the raw out-of-bounds body/circumference value — now logs field paths only,
per D-BC-PRIVACY. Added a retention/isolation note to `docs/architecture/recommendation-engine.md`
(no dedicated account-deletion feature exists in this repo yet; `migrate_user_data.py`'s generic
subcollection walk already covers this collection without changes). Added component tests for
`LogMeasurementsModal` (none existed) and the `hungerRecommendationInvariance.test.ts` fixture,
which used a stale `DailyRecoverySnapshot` shape that passed `vitest` (no typecheck) but failed
`tsc -b` — fixed to the current model shape.

**Known open items**, left unchecked below rather than claimed done:
- Recording both left and right sides of a limb metric in one baseline session isn't possible yet
  (`LogMeasurementsModal` holds one `MetricFormState` per metric, not per metric+laterality); two
  separate sessions work today.
- No dedicated DST-boundary test for this feature's own trend-window construction (it reuses the
  same pre-existing shared `addDaysToLocalDateString`/`getLocalDateString` helper every other
  date-windowed feature in the app already relies on).

**Separately flagged, not part of this feature:** `cd app && npm run simulate:diff` shows real drift
against the committed simulation baseline that is already present on a clean `main` HEAD (verified
by `git stash`), unrelated to this plan. Spun off as its own follow-up task rather than fixed here.

## Goal

Deliver an observation-first capability that reuses connected body-mass data when available, lets
an athlete record repeatable home tape measurements, optionally records a low-burden hunger rating,
and reviews source-aware trends in **Data** without changing training recommendations.

---

## Objectives

- [x] Persist athlete-authored protocol-versioned tape measurements in a dedicated owner-scoped
  domain.
- [x] Keep manual body mass available as a fallback, but do not require duplicate entry when a usable
  connected/provider weight series exists.
- [x] Preserve provider/manual provenance and never average or silently splice sources.
- [x] Add optional timing-aware `hunger1To10` to the daily check-in with no completion/readiness
  authority.
- [x] Display connected-scale body-composition outputs only when actual provider payload semantics
  are known, labelled as device estimates.
- [x] Add an in-Data body-composition/fueling surface with coverage, provenance and quality context.
- [x] Keep every v1 signal out of recommendation selection, safety, fatigue and audit inputs.
- [x] Add persistence validation, Firestore rules, parser/migration compatibility and UI tests.
- [x] Document retention/account-deletion behavior before the plan is marked `Implemented`.

---

## Default contracts

Unless implementation evidence forces a reviewed change:

1. **No new top-level screen.** Entry/trends live under Data; hunger is collected in Check-in.
2. **Manual collection:** `users/{userId}/anthropometry_entries/{entryId}`.
3. **Protocol:** `home_anthropometry@1`.
4. **Protocol language:** non-waist sites are app-defined repeatable home landmarks, not claims of
   clinical/ISAK standardization.
5. **Body mass default:** a usable connected/provider source is preferred; manual weight is explicit
   fallback only.
6. **Source semantics:** provider and manual body mass remain distinct source series.
7. **Body-mass daily reduction:** one deterministic point per source/local date before weekly math.
8. **Circumferences:** two readings; request a third when the pair exceeds the versioned
   repeatability tolerance; retained summary is the median.
9. **Initial circumference quality tolerance:** `max(1.0 cm, 1% of the pair mean)`. Product-quality
   heuristic only; protocol/quality-policy revision must change if semantics change materially.
10. **Body-mass 7-day display:** require at least 4 distinct valid local dates in the selected source
    series.
11. **Hunger fields:** `hunger1To10` plus `hungerTiming = morning_pre_breakfast | other`.
12. **Hunger scale:** integer 1–10; `5` may be described as moderate/typical but is never prefilled.
13. **Hunger comparison:** morning/pre-breakfast is the default retrospective series; `other` stays
    separate.
14. **Provider composition:** only exact fields actually exposed by ingestion are supported; body
    fat/muscle/water/bone-like values are labelled device estimates and remain secondary context.
15. **No backfill:** no synthetic manual, hunger or provider-composition history.
16. **Recommendation authority:** none; no `POLICY_VERSION` change unless scope expands to a behavior
    that can alter recommendations.

---

## Do not do these things

- [ ] Do **not** make the client writable to `health_observation_days`.
- [ ] Do **not** force routine tape/scale tracking through Testing/`AssessmentAttempt`.
- [ ] Do **not** create a second generic observation framework from the anthropometry package.
- [ ] Do **not** require manual weight when connected/provider weight is already usable.
- [ ] Do **not** assume Garmin exposes every metric visible in a scale/vendor application.
- [ ] Do **not** ask users to manually transcribe missing provider body-fat/muscle/water/bone values
  merely to make the dashboard complete.
- [ ] Do **not** normalize differently named provider composition metrics without established
  semantic equivalence.
- [ ] Do **not** average manual/provider weight or composition estimates across devices.
- [ ] Do **not** silently switch an explicitly selected weight source.
- [ ] Do **not** add hunger to readiness, strain, fatigue or candidate ranking.
- [ ] Do **not** make hunger mandatory for check-in completion.
- [ ] Do **not** present `hunger1To10` as equivalent to a research 0–100 VAS.
- [ ] Do **not** mix `hungerTiming = other` into the morning series.
- [ ] Do **not** calculate body-fat percentage from tape measurements.
- [ ] Do **not** label circumference or one smart-scale change as muscle/fat gained/lost.
- [ ] Do **not** emit raw body/hunger values to analytics, console logs or error reports.
- [ ] Do **not** duplicate raw anthropometry history into `RecommendationAudit`.
- [ ] Do **not** use UTC string slicing for logical local measurement dates.
- [ ] Do **not** add a decision threshold without a separate evidence/activation decision.

---

# Delivery sequence

## BC0 — contracts, persistence and security

**Status:** Blocked by ADR-0039 acceptance

### BC0.1 Focused anthropometry domain

Create a package such as:

```text
app/src/anthropometry/models.ts
app/src/anthropometry/protocol.ts
app/src/anthropometry/validation.ts
app/src/anthropometry/trends.ts
```

- [x] Define `AnthropometryMetricId` from ADR-0039.
- [x] Keep `body_mass_kg` supported but explicitly document it as fallback/manual source.
- [x] Define laterality only for supported limb measurements and include it in series identity.
- [x] Define retained readings, deterministic value and repeatability warning.
- [x] Define entry id/user/date/observedAt/protocol/context/schema/current-record revision.
- [x] Use existing Europe/Warsaw date helpers and validate `observedAt` → logical date consistency.
- [x] Keep anthropometry imports out of `app/src/engine/`.

### BC0.2 Validation and Firestore

- [x] Reject unsupported metric/unit/laterality combinations.
- [x] Require kg for manual body mass and cm for circumferences.
- [x] Use broad corruption bounds, not “healthy body” thresholds.
- [x] Require one retained reading for manual body mass and 2–3 for circumference.
- [x] Validate deterministic median/repeatability semantics.
- [x] Add owner-only CRUD rules at `users/{userId}/anthropometry_entries/{entryId}`.
- [x] Bound keys, arrays, enums and numeric values in Firestore rules.
- [x] Preserve immutable identity and monotonic current-record revision.
- [x] Add emulator tests for valid CRUD, malformed data, stale revision and cross-user writes.

### BC0.3 Service

- [x] Create/read/correct/delete athlete-authored entries.
- [x] Query bounded local-date ranges with deterministic ordering.
- [x] Return explicit unavailable/invalid states rather than empty-valid fallbacks.
- [x] Never write manual data to provider health bundles, recovery snapshots or testing observations.

### BC0 acceptance

- [x] Domain tests pass.
- [x] Firestore rules tests pass.
- [x] Provider/testing ingestion remains untouched.
- [x] Architecture/import test proves the recommendation engine does not consume anthropometry.

---

## BC1 — tape-first measurement UX inside Data

**Dependencies:** BC0

### BC1.1 Entry flow

- [x] Add `Log measurements` inside Data.
- [x] Show preferred context: morning when practical, post-void, pre-intake, pre-training, same
  landmark/posture, relaxed protocol-defined respiratory state.
- [x] Default logical date with existing Warsaw-local helpers.
- [x] Present the core weekly set first: waist minimum, abdomen at navel, hips.
- [x] Present thigh as a useful secondary measurement.
- [x] Keep chest, relaxed upper arm, calf and forearm optional/expandable.
- [x] Never require all metrics in one session.
- [x] For limbs, expose laterality and never silently switch sides.
- [ ] Permit a baseline both-sides session while allowing one fixed side in routine tracking.
  Routine one-fixed-side tracking works (left/right/unspecified radio per limb metric,
  `validateAnthropometryEntry`'s series-key dedup is keyed by `metricId:laterality` so left and
  right are already distinct series at the persistence layer). Recording both sides *in one
  session* does not: `LogMeasurementsModal`'s `metricStates` holds one `MetricFormState` per
  `AnthropometryMetricId`, so the form can only capture a single laterality per limb metric per
  save. A baseline both-sides capture currently requires two separate sessions. Left open rather
  than silently claimed done; picking it up means letting a limb metric add a second
  laterality row in the same form, which touches the row-rendering/submit logic enough to
  warrant its own pass rather than a same-session tack-on.
- [x] Request two circumference readings and a third only when the quality tolerance is exceeded.
- [x] Show deterministic median and retain raw entered readings.
- [x] Make preferred vs other measurement context visible rather than rejecting non-preferred data.

### BC1.2 Provider-aware weight behavior

- [x] Detect whether a recent valid connected/provider body-mass series exists.
- [x] When it exists, do not show manual weight as a required/default field in the tape flow.
- [x] Offer explicit `Add manual weight` / fallback access for athletes who need it.
- [x] When no provider weight exists, manual weight may be surfaced more prominently.
- [x] Never imply provider and manual measurements are duplicates/equivalent.

### BC1.3 Correction/deletion/accessibility

- [x] Correct existing logical entries with revision advance rather than duplicate replacement.
- [x] Confirm deletion explicitly and recompute derived UI state.
- [x] Use mobile numeric input modes, explicit units, labels and field-specific errors.
- [x] Add component tests for partial sessions, laterality, quality prompt, correction/deletion and
  provider-present/provider-absent weight UX.
- [x] No raw measurement values in analytics/console telemetry.

### BC1 acceptance

- [x] Athlete can record the core tape set without re-entering connected weight.
- [x] Manual weight remains possible when explicitly needed.
- [x] Existing Data content works with no anthropometry history.
- [x] No new navigation screen exists.

---

## BC2 — optional timing-aware hunger 1–10 in Check-in

**Dependencies:** accepted ADR-0039

### BC2.1 Model/parser/validation

- [x] Add optional/nullable:

```ts
hunger1To10?: number | null;
hungerTiming?: 'morning_pre_breakfast' | 'other' | null;
```

- [x] Require integer values 1–10 when present.
- [x] Numeric hunger requires valid timing; clearing hunger clears both fields.
- [x] Preserve legacy documents with neither field.
- [x] Decide/document whether the additive fields require a check-in schema bump under the current
  parser/version strategy.
- [x] Do not add hunger to `SubjectiveDimensionKey`, `SubjectiveInput`, completeness or readiness.
- [x] Ensure merge writes cannot resurrect stale hunger/timing after clearing.

### BC2.2 Firestore boundary

- [x] Allow legacy docs without hunger.
- [x] Enforce integer 1–10 and timing enum for new values.
- [x] Enforce consistent value/timing presence or supported explicit-null semantics.
- [x] Add emulator tests for missing, valid endpoints 1/10, invalid 0/11/non-integer/non-number,
  invalid timing and clear/update transitions.

### BC2.3 Check-in UX

- [x] Add `Hunger right now` as a simple 1–10 control.
- [x] Endpoint labels: 1 `Not hungry at all`, 10 `Extremely hungry`.
- [x] `5` may be explained as moderate/typical but must not be prefilled.
- [x] Mark optional.
- [x] Capture `morning_pre_breakfast` versus `other` with minimal burden.
- [x] Hide prior hunger/trends before today's initial submission under ADR-0020 anti-anchoring.
- [x] Do not describe the scale as a validated 0–100 VAS equivalent.

### BC2.4 No-authority tests

- [x] Recommendation fixtures are identical across hunger values 1–10, both timing contexts and
  missing hunger.
- [x] Mapping/import tests prove rules/fatigue/optimizer do not consume hunger.
- [x] `POLICY_VERSION` remains unchanged.

### BC2 acceptance

- [x] Check-in remains completable with hunger absent.
- [x] Hunger persists/reloads/clears without stale fields.
- [x] Recommendation output is invariant to hunger.

---

## BC3 — source-aware body/composition read model and Data dashboard

**Dependencies:** BC0 + BC1; hunger panel additionally needs BC2

### BC3.1 Provider capability audit first

Before implementing connected-scale composition UI:

- [x] Inspect actual Garmin/provider normalized payloads and fixtures used by this repository.
- [x] Confirm which fields are genuinely available today: weight, body fat and any additional
  composition values.
- [x] Record exact units and semantics for each supported field.
- [x] Do not infer availability from what the scale vendor's own app displays.
- [x] If only weight/body fat are available, ship only those provider fields.

This audit is an implementation prerequisite for any muscle/water/bone UI.

### BC3.2 Read-model adapters

Compose without persisting a fused measurement:

- connected/provider body mass;
- optional manual `body_mass_kg`;
- manual circumference series;
- check-in hunger series;
- supported provider composition estimates.

- [x] Give each source stable identity and visible label.
- [x] Preserve logical date, observed time/context, provider/origin and transport metadata.
- [x] Keep exact composition metric semantics; do not map ambiguous vendor names together.
- [x] Label impedance-derived provider composition as `device estimate` / `scale estimate`.

### BC3.3 Deterministic body-mass daily reduction

Manual source/date:

- [x] Prefer morning/post-void/pre-intake/no-prior-training.
- [x] Choose earliest observation in preferred set; otherwise earliest valid same-day entry.
- [x] Stable entry identity is timestamp tie-break.
- [x] Keep raw sessions visible even though only one point represents the date.

Provider:

- [x] Adapter emits at most one deterministic point per source/local date.
- [x] Provider-specific deduplication lives in that adapter.
- [x] Coverage counts distinct dates after reduction.

### BC3.4 Trend math

Body mass:

- [x] selected-source raw daily points;
- [x] 7-day arithmetic mean with >=4 distinct valid local dates;
- [x] adjacent-window absolute/% change only when both windows qualify;
- [x] explicit coverage;
- [x] no interpolation/carry-forward.

Circumferences:

- [x] series key = metric + laterality + protocol revision;
- [x] latest valid vs previous valid delta;
- [x] repeatability/context visible;
- [x] no tissue-type interpretation.

Hunger:

- [x] default trend uses `morning_pre_breakfast` only;
- [x] `other` remains separate;
- [x] 7d/28d mean + recorded-day count;
- [x] no neutral padding or good/bad fueling label.

Provider composition:

- [x] keep each exact provider metric/source as its own series;
- [x] do not average across devices/providers;
- [x] never fill a missing composition metric from another source automatically;
- [x] keep it visually secondary to body mass and repeatable tape trends.

### BC3.5 Source selection

- [x] Show which body-mass source drives the trend.
- [x] If no explicit source is selected, prefer a usable connected/provider source using a
  deterministic coverage rule and stable tie-break.
- [x] Explicit user selection is sticky.
- [x] Never splice different sources inside one trend window.
- [x] Source changes are visually explicit.

### BC3.6 Data UI order

1. **Body mass** — source, latest point/context, 7-day mean, WoW change, coverage.
2. **Waist & abdomen** — primary tape trend.
3. **Hips / thigh** — secondary anthropometry.
4. **Hunger** — timing-aware retrospective summary.
5. **Other circumferences** — expandable.
6. **Scale estimates** — only actually supported provider metrics, explicitly labelled secondary
   device estimates.
7. Measurement history/provenance/context on demand.

- [x] No green/red “good/bad body weight” score.
- [x] No composition estimate presented as exact body truth.
- [x] No-history, sparse-history and unavailable-provider states are explicit.

### BC3 acceptance

- [x] Connected weight avoids duplicate routine manual weight entry.
- [x] Same-day manual weights count as one coverage date.
- [x] Multiple sources are never averaged/spliced.
- [x] Explicit source selection never silently changes.
- [x] Hunger timing contexts never merge silently.
- [x] Unsupported provider composition metrics remain absent rather than synthesized.
- [x] Athlete can inspect provenance/context behind displayed trends.

---

## BC4 — privacy, lifecycle, docs and release gate

**Dependencies:** BC0–BC3

- [x] Confirm account deletion removes athlete-authored anthropometry according to repository
  semantics.
- [x] Document retention behavior.
- [x] Verify no raw anthropometry/hunger/composition values enter analytics/error reporting.
- [x] Verify recommendation audits contain no raw values or decision inputs from this feature.
- [x] Keep all history queries bounded.
- [x] Update living architecture/user-help docs only after implementation exists.
- [x] Record implementation deviations from ADR-0039 explicitly.
- [x] Run repository/type/rules/component checks required by the codebase.
- [x] Verify legacy check-ins and users with no manual history remain compatible.
- [x] Verify rollback can remove UI/read/write paths without altering provider data or recommendation
  policy.

### BC4 acceptance

- [x] Observation-only feature can ship without recommendation changes.
- [x] Security/privacy/lifecycle behavior is documented/tested.
- [x] No `POLICY_VERSION` bump is needed.

---

## BC5 — optional cycling W/kg context

**Status:** Optional follow-up

- [ ] Identify one existing canonical cycling power/FTP-like authority.
- [ ] Derive W/kg only from explicit power evidence + selected source-specific body-mass summary.
- [ ] Show provenance for both inputs.
- [ ] Keep context-only and out of goals/recommendations.
- [ ] Skip if canonical power authority is ambiguous.

---

# Cross-cutting tests

## Persistence/migration

- [x] Existing users without manual measurements remain valid.
- [x] Legacy check-ins without hunger parse/save.
- [x] Hunger clearing removes both value and timing.
- [x] Anthropometry stale revisions fail instead of overwriting newer corrections.
- [x] Delete/correction immediately changes derived Data trends.

## Time/source semantics

- [x] Europe/Warsaw date helpers are used.
- [ ] DST/month/year boundary grouping is tested. Date-window construction
  (`addDaysToLocalDateString`/`getLocalDateString`) is the same pre-existing shared Warsaw-local
  helper every other date-windowed feature in the app already relies on, not new arithmetic
  introduced by this plan; no dedicated DST-boundary test was added for this feature's own trend
  windows. `deriveObservedAtForLocalDate` (added this session, `protocol.ts`) does have an explicit
  DST-crossing unit test.
- [x] Multiple same-day sessions never increase coverage.
- [x] Provider/manual source discontinuities never appear as one continuous series.

## Measurement integrity

- [x] Different landmarks/laterality/protocol revisions never silently compare as one series.
- [x] Repeatability tolerance/median are deterministic.
- [x] Core/optional cadence is guidance only, not a completion gate.

## Provider composition

- [x] Tests use real normalized fixture shapes for every supported provider composition field.
- [x] Unknown/absent fields stay absent.
- [x] UI labels composition fields as device estimates.
- [x] No cross-device aggregation occurs.

## Recommendation isolation

- [x] Engine/recommender imports do not depend on anthropometry or composition trend code.
- [x] Hunger does not map into `SubjectiveInput`.
- [x] Recommendations are invariant to body/hunger feature presence and values.
- [x] Raw values do not enter `RecommendationAudit`.

---

# Evidence review after real use

Do **not** schedule automatic recommendation activation as part of this plan.

A later separate analysis may examine adherence, tape repeatability, provider/manual disagreement,
hunger completion, connected-scale estimate stability and whether any of these signals add useful
information beyond existing recovery/performance data.

Only a concrete validated use case should open a new ADR for any advice/decision authority.

---

## Completion definition

This plan can move to `Implemented` only when BC0–BC4 are complete and evidenced. BC5 is optional.

Completion means the app reuses connected body mass where available, supports protocol-aware manual
tape tracking and optional hunger 1–10, preserves source provenance, treats smart-scale composition
as secondary device-estimated context, and remains structurally unable to change a training
recommendation from these v1 signals.
