# Body-composition and fueling observations — implementation plan

**Status:** Draft
**Blocked by:** acceptance of [ADR-0039](../adr/0039-longitudinal-body-composition-and-fueling-observations.md) for implementation work
**Unlocks:** protocol-aware manual anthropometry, provider-first body-mass trends, optional hunger history, contextual connected-scale estimates, and a real longitudinal evidence set for later coaching research
**Source analysis:** [2026-09-14 body-composition and fueling observations](../analysis/2026-09-14-body-composition-and-fueling-observations.md)

## Goal

Deliver an observation-first capability that reuses connected body-mass data when available, lets
an athlete record repeatable home tape measurements, optionally records a low-burden hunger rating,
and reviews source-aware trends in **Data** without changing training recommendations.

---

## Objectives

- [ ] Persist athlete-authored protocol-versioned tape measurements in a dedicated owner-scoped
  domain.
- [ ] Keep manual body mass available as a fallback, but do not require duplicate entry when a usable
  connected/provider weight series exists.
- [ ] Preserve provider/manual provenance and never average or silently splice sources.
- [ ] Add optional timing-aware `hunger1To10` to the daily check-in with no completion/readiness
  authority.
- [ ] Display connected-scale body-composition outputs only when actual provider payload semantics
  are known, labelled as device estimates.
- [ ] Add an in-Data body-composition/fueling surface with coverage, provenance and quality context.
- [ ] Keep every v1 signal out of recommendation selection, safety, fatigue and audit inputs.
- [ ] Add persistence validation, Firestore rules, parser/migration compatibility and UI tests.
- [ ] Document retention/account-deletion behavior before the plan is marked `Implemented`.

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

- [ ] Define `AnthropometryMetricId` from ADR-0039.
- [ ] Keep `body_mass_kg` supported but explicitly document it as fallback/manual source.
- [ ] Define laterality only for supported limb measurements and include it in series identity.
- [ ] Define retained readings, deterministic value and repeatability warning.
- [ ] Define entry id/user/date/observedAt/protocol/context/schema/current-record revision.
- [ ] Use existing Europe/Warsaw date helpers and validate `observedAt` → logical date consistency.
- [ ] Keep anthropometry imports out of `app/src/engine/`.

### BC0.2 Validation and Firestore

- [ ] Reject unsupported metric/unit/laterality combinations.
- [ ] Require kg for manual body mass and cm for circumferences.
- [ ] Use broad corruption bounds, not “healthy body” thresholds.
- [ ] Require one retained reading for manual body mass and 2–3 for circumference.
- [ ] Validate deterministic median/repeatability semantics.
- [ ] Add owner-only CRUD rules at `users/{userId}/anthropometry_entries/{entryId}`.
- [ ] Bound keys, arrays, enums and numeric values in Firestore rules.
- [ ] Preserve immutable identity and monotonic current-record revision.
- [ ] Add emulator tests for valid CRUD, malformed data, stale revision and cross-user writes.

### BC0.3 Service

- [ ] Create/read/correct/delete athlete-authored entries.
- [ ] Query bounded local-date ranges with deterministic ordering.
- [ ] Return explicit unavailable/invalid states rather than empty-valid fallbacks.
- [ ] Never write manual data to provider health bundles, recovery snapshots or testing observations.

### BC0 acceptance

- [ ] Domain tests pass.
- [ ] Firestore rules tests pass.
- [ ] Provider/testing ingestion remains untouched.
- [ ] Architecture/import test proves the recommendation engine does not consume anthropometry.

---

## BC1 — tape-first measurement UX inside Data

**Dependencies:** BC0

### BC1.1 Entry flow

- [ ] Add `Log measurements` inside Data.
- [ ] Show preferred context: morning when practical, post-void, pre-intake, pre-training, same
  landmark/posture, relaxed protocol-defined respiratory state.
- [ ] Default logical date with existing Warsaw-local helpers.
- [ ] Present the core weekly set first: waist minimum, abdomen at navel, hips.
- [ ] Present thigh as a useful secondary measurement.
- [ ] Keep chest, relaxed upper arm, calf and forearm optional/expandable.
- [ ] Never require all metrics in one session.
- [ ] For limbs, expose laterality and never silently switch sides.
- [ ] Permit a baseline both-sides session while allowing one fixed side in routine tracking.
- [ ] Request two circumference readings and a third only when the quality tolerance is exceeded.
- [ ] Show deterministic median and retain raw entered readings.
- [ ] Make preferred vs other measurement context visible rather than rejecting non-preferred data.

### BC1.2 Provider-aware weight behavior

- [ ] Detect whether a recent valid connected/provider body-mass series exists.
- [ ] When it exists, do not show manual weight as a required/default field in the tape flow.
- [ ] Offer explicit `Add manual weight` / fallback access for athletes who need it.
- [ ] When no provider weight exists, manual weight may be surfaced more prominently.
- [ ] Never imply provider and manual measurements are duplicates/equivalent.

### BC1.3 Correction/deletion/accessibility

- [ ] Correct existing logical entries with revision advance rather than duplicate replacement.
- [ ] Confirm deletion explicitly and recompute derived UI state.
- [ ] Use mobile numeric input modes, explicit units, labels and field-specific errors.
- [ ] Add component tests for partial sessions, laterality, quality prompt, correction/deletion and
  provider-present/provider-absent weight UX.
- [ ] No raw measurement values in analytics/console telemetry.

### BC1 acceptance

- [ ] Athlete can record the core tape set without re-entering connected weight.
- [ ] Manual weight remains possible when explicitly needed.
- [ ] Existing Data content works with no anthropometry history.
- [ ] No new navigation screen exists.

---

## BC2 — optional timing-aware hunger 1–10 in Check-in

**Dependencies:** accepted ADR-0039

### BC2.1 Model/parser/validation

- [ ] Add optional/nullable:

```ts
hunger1To10?: number | null;
hungerTiming?: 'morning_pre_breakfast' | 'other' | null;
```

- [ ] Require integer values 1–10 when present.
- [ ] Numeric hunger requires valid timing; clearing hunger clears both fields.
- [ ] Preserve legacy documents with neither field.
- [ ] Decide/document whether the additive fields require a check-in schema bump under the current
  parser/version strategy.
- [ ] Do not add hunger to `SubjectiveDimensionKey`, `SubjectiveInput`, completeness or readiness.
- [ ] Ensure merge writes cannot resurrect stale hunger/timing after clearing.

### BC2.2 Firestore boundary

- [ ] Allow legacy docs without hunger.
- [ ] Enforce integer 1–10 and timing enum for new values.
- [ ] Enforce consistent value/timing presence or supported explicit-null semantics.
- [ ] Add emulator tests for missing, valid endpoints 1/10, invalid 0/11/non-integer/non-number,
  invalid timing and clear/update transitions.

### BC2.3 Check-in UX

- [ ] Add `Hunger right now` as a simple 1–10 control.
- [ ] Endpoint labels: 1 `Not hungry at all`, 10 `Extremely hungry`.
- [ ] `5` may be explained as moderate/typical but must not be prefilled.
- [ ] Mark optional.
- [ ] Capture `morning_pre_breakfast` versus `other` with minimal burden.
- [ ] Hide prior hunger/trends before today's initial submission under ADR-0020 anti-anchoring.
- [ ] Do not describe the scale as a validated 0–100 VAS equivalent.

### BC2.4 No-authority tests

- [ ] Recommendation fixtures are identical across hunger values 1–10, both timing contexts and
  missing hunger.
- [ ] Mapping/import tests prove rules/fatigue/optimizer do not consume hunger.
- [ ] `POLICY_VERSION` remains unchanged.

### BC2 acceptance

- [ ] Check-in remains completable with hunger absent.
- [ ] Hunger persists/reloads/clears without stale fields.
- [ ] Recommendation output is invariant to hunger.

---

## BC3 — source-aware body/composition read model and Data dashboard

**Dependencies:** BC0 + BC1; hunger panel additionally needs BC2

### BC3.1 Provider capability audit first

Before implementing connected-scale composition UI:

- [ ] Inspect actual Garmin/provider normalized payloads and fixtures used by this repository.
- [ ] Confirm which fields are genuinely available today: weight, body fat and any additional
  composition values.
- [ ] Record exact units and semantics for each supported field.
- [ ] Do not infer availability from what the scale vendor's own app displays.
- [ ] If only weight/body fat are available, ship only those provider fields.

This audit is an implementation prerequisite for any muscle/water/bone UI.

### BC3.2 Read-model adapters

Compose without persisting a fused measurement:

- connected/provider body mass;
- optional manual `body_mass_kg`;
- manual circumference series;
- check-in hunger series;
- supported provider composition estimates.

- [ ] Give each source stable identity and visible label.
- [ ] Preserve logical date, observed time/context, provider/origin and transport metadata.
- [ ] Keep exact composition metric semantics; do not map ambiguous vendor names together.
- [ ] Label impedance-derived provider composition as `device estimate` / `scale estimate`.

### BC3.3 Deterministic body-mass daily reduction

Manual source/date:

- [ ] Prefer morning/post-void/pre-intake/no-prior-training.
- [ ] Choose earliest observation in preferred set; otherwise earliest valid same-day entry.
- [ ] Stable entry identity is timestamp tie-break.
- [ ] Keep raw sessions visible even though only one point represents the date.

Provider:

- [ ] Adapter emits at most one deterministic point per source/local date.
- [ ] Provider-specific deduplication lives in that adapter.
- [ ] Coverage counts distinct dates after reduction.

### BC3.4 Trend math

Body mass:

- [ ] selected-source raw daily points;
- [ ] 7-day arithmetic mean with >=4 distinct valid local dates;
- [ ] adjacent-window absolute/% change only when both windows qualify;
- [ ] explicit coverage;
- [ ] no interpolation/carry-forward.

Circumferences:

- [ ] series key = metric + laterality + protocol revision;
- [ ] latest valid vs previous valid delta;
- [ ] repeatability/context visible;
- [ ] no tissue-type interpretation.

Hunger:

- [ ] default trend uses `morning_pre_breakfast` only;
- [ ] `other` remains separate;
- [ ] 7d/28d mean + recorded-day count;
- [ ] no neutral padding or good/bad fueling label.

Provider composition:

- [ ] keep each exact provider metric/source as its own series;
- [ ] do not average across devices/providers;
- [ ] never fill a missing composition metric from another source automatically;
- [ ] keep it visually secondary to body mass and repeatable tape trends.

### BC3.5 Source selection

- [ ] Show which body-mass source drives the trend.
- [ ] If no explicit source is selected, prefer a usable connected/provider source using a
  deterministic coverage rule and stable tie-break.
- [ ] Explicit user selection is sticky.
- [ ] Never splice different sources inside one trend window.
- [ ] Source changes are visually explicit.

### BC3.6 Data UI order

1. **Body mass** — source, latest point/context, 7-day mean, WoW change, coverage.
2. **Waist & abdomen** — primary tape trend.
3. **Hips / thigh** — secondary anthropometry.
4. **Hunger** — timing-aware retrospective summary.
5. **Other circumferences** — expandable.
6. **Scale estimates** — only actually supported provider metrics, explicitly labelled secondary
   device estimates.
7. Measurement history/provenance/context on demand.

- [ ] No green/red “good/bad body weight” score.
- [ ] No composition estimate presented as exact body truth.
- [ ] No-history, sparse-history and unavailable-provider states are explicit.

### BC3 acceptance

- [ ] Connected weight avoids duplicate routine manual weight entry.
- [ ] Same-day manual weights count as one coverage date.
- [ ] Multiple sources are never averaged/spliced.
- [ ] Explicit source selection never silently changes.
- [ ] Hunger timing contexts never merge silently.
- [ ] Unsupported provider composition metrics remain absent rather than synthesized.
- [ ] Athlete can inspect provenance/context behind displayed trends.

---

## BC4 — privacy, lifecycle, docs and release gate

**Dependencies:** BC0–BC3

- [ ] Confirm account deletion removes athlete-authored anthropometry according to repository
  semantics.
- [ ] Document retention behavior.
- [ ] Verify no raw anthropometry/hunger/composition values enter analytics/error reporting.
- [ ] Verify recommendation audits contain no raw values or decision inputs from this feature.
- [ ] Keep all history queries bounded.
- [ ] Update living architecture/user-help docs only after implementation exists.
- [ ] Record implementation deviations from ADR-0039 explicitly.
- [ ] Run repository/type/rules/component checks required by the codebase.
- [ ] Verify legacy check-ins and users with no manual history remain compatible.
- [ ] Verify rollback can remove UI/read/write paths without altering provider data or recommendation
  policy.

### BC4 acceptance

- [ ] Observation-only feature can ship without recommendation changes.
- [ ] Security/privacy/lifecycle behavior is documented/tested.
- [ ] No `POLICY_VERSION` bump is needed.

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

- [ ] Existing users without manual measurements remain valid.
- [ ] Legacy check-ins without hunger parse/save.
- [ ] Hunger clearing removes both value and timing.
- [ ] Anthropometry stale revisions fail instead of overwriting newer corrections.
- [ ] Delete/correction immediately changes derived Data trends.

## Time/source semantics

- [ ] Europe/Warsaw date helpers are used.
- [ ] DST/month/year boundary grouping is tested.
- [ ] Multiple same-day sessions never increase coverage.
- [ ] Provider/manual source discontinuities never appear as one continuous series.

## Measurement integrity

- [ ] Different landmarks/laterality/protocol revisions never silently compare as one series.
- [ ] Repeatability tolerance/median are deterministic.
- [ ] Core/optional cadence is guidance only, not a completion gate.

## Provider composition

- [ ] Tests use real normalized fixture shapes for every supported provider composition field.
- [ ] Unknown/absent fields stay absent.
- [ ] UI labels composition fields as device estimates.
- [ ] No cross-device aggregation occurs.

## Recommendation isolation

- [ ] Engine/recommender imports do not depend on anthropometry or composition trend code.
- [ ] Hunger does not map into `SubjectiveInput`.
- [ ] Recommendations are invariant to body/hunger feature presence and values.
- [ ] Raw values do not enter `RecommendationAudit`.

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
