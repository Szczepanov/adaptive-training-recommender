# Body-composition and fueling observations analysis — 2026-09-14

## Status and scope

This is a point-in-time analysis of how longitudinal body mass, home tape measurements and
subjective hunger could fit the recommender as it exists on `main` at
`568472691a89e0c2f159a7bd2a9b060642772808`.

It is **analysis, not an accepted architecture decision**. The proposed decision is recorded in
[ADR-0039](../adr/0039-longitudinal-body-composition-and-fueling-observations.md), and the
executable sequence is in the
[implementation plan](../plans/body-composition-and-fueling-observations.md).

The product question is not merely “where do we save measurements?” It is whether the application
can collect repeatable body measurements and appetite context with enough provenance and
measurement integrity to make longitudinal review useful **without prematurely turning the data
into training-decision authority, a body-fat estimator, or a RED-S / energy-availability
screen**.

---

## Executive summary

A deeper repository audit changes one important framing from the first draft: the codebase already
has a production `metric_observations` service, but that service is intentionally **not** a generic
numeric-observation store. `MetricObservationRevision` requires a formal testing protocol,
`AssessmentAttempt`, comparison-series identity and revision chain. Routine morning body mass and
weekly tape measurements do not fit that lifecycle without broadening Testing semantics.

The repository therefore has four adjacent but intentionally different concepts:

1. `DailyRecoverySnapshot` can contain provider-origin `weightKg` and `bodyFatPct`.
2. ADR-0027 owns server-managed, provider/source-aware health observations and forbids silent
   cross-source fusion.
3. `MetricObservationRevision` / `MeasurementProtocol` own formal testing evidence.
4. `DailySubjectiveCheckin` owns date-scoped athlete-reported subjective context.

The recommended v1 architecture is still a dedicated, user-owned anthropometry domain, but its
boundary needs to be explicit so it does not become a second generic observation framework:

- manual body mass and tape sessions live in `anthropometry_entries` only;
- provider body mass stays in the existing provider/recovery path;
- formal performance testing stays in `metric_observations`;
- hunger is an optional check-in observation with explicit timing context;
- Data composes source-specific retrospective series without persisting a fused “truth”;
- v1 has **zero recommendation authority**.

The review also identified four contracts that were under-specified in the first draft and are now
made explicit in ADR-0039:

- multiple manual body-mass sessions on one local date must reduce to one deterministic daily point
  before 7-day coverage/math;
- hunger needs a self-describing 0–100 field and timing context, and non-pre-breakfast values must
  not silently enter the default morning trend;
- the non-waist tape landmarks are app-defined repeatable home landmarks, not claimed clinical or
  universal anthropometric standards;
- current-record `revision` is stale-write/correction protection, not an implicit immutable audit
  log of every erroneous prior value.

---

# 1. Current repository state

## 1.1 Provider body mass already exists

`app/src/engine/models.ts` `DailyRecoverySnapshot.raw` already contains:

```ts
weightKg?: number | null;
bodyFatPct?: number | null;
```

and snapshot metadata can include `metricDates.weight`.

A body-composition feature must therefore not introduce an unqualified `currentWeight` scalar that
silently replaces provider evidence. Manual and provider measurements can coexist, but they need
source identity and separate longitudinal series.

`bodyFatPct` is also provider telemetry. Nothing in the current recommendation engine establishes
it as criterion body composition or a training-authoritative value.

## 1.2 ADR-0027 owns server-managed multisource physiological provenance

ADR-0027 establishes directly relevant invariants:

- provider/origin and transport are separate provenance dimensions;
- multiple observations of the same physiological concept can coexist;
- source-specific longitudinal baselines are the default;
- raw values from different devices are not averaged into a synthetic measurement;
- unavailable source data remains missing rather than becoming neutral evidence.

Its durable day-bundle path is:

```text
users/{userId}/health_observation_days/{YYYY-MM-DD}_{provider}_{transport}
```

`firestore.rules` deliberately prevents direct client writes there. A manual React form should not
weaken that ingestion boundary simply to avoid defining an athlete-authored record.

## 1.3 `metric_observations` is real infrastructure, but it is formal testing infrastructure

`app/src/services/metricObservationService.ts` already provides transactional creation and
correction of revisioned metric observations at:

```text
users/{userId}/metric_observations/{observationKey}
users/{userId}/metric_observations/{observationKey}/revisions/{revision}
```

That makes reuse tempting. The model contract matters more than the storage shape, however.
`app/src/observations/models.ts` requires a `MetricObservationRevision` to carry, among other
things:

- a `metricId` and scalar value/unit;
- a `protocolRef`;
- `comparisonSeriesKey` and canonicalization version;
- an `assessmentAttemptId`;
- validity state;
- formal revision/supersession semantics.

`MeasurementProtocol.intent` is `testing`, and `AssessmentAttempt` owns a scheduled/in-progress /
completed/abandoned testing lifecycle.

A morning scale reading is not a test attempt. Neither is a routine weekly circumference session.
Reusing the persistence while ignoring the surrounding model would create a misleading half-reuse;
broadening the model would change the Testing architecture for a feature that does not need it.

**Conclusion:** a focused anthropometry domain is justified, but it should borrow explicit metric
identity, protocol revisioning and deterministic correction semantics rather than duplicate the
formal testing system wholesale.

## 1.4 The daily check-in has the right missing-data posture but needs persistence hardening

`DailySubjectiveCheckin` currently stores nullable subjective dimensions and explicitly separates
those dimensions from the engine-facing `SubjectiveInput`.

ADR-0020 also establishes the anti-anchoring rule: retrospective subjective context should not be
shown before today's initial answer is submitted.

Hunger fits the check-in as optional collection context, but the implementation must account for
how `checkinService.upsertCheckin()` writes with Firestore merge semantics. Existing code already
contains explicit deletion logic for nested fields because omitted values can otherwise leave stale
stored state behind. Hunger needs the same deliberate clear behavior.

The current Firestore rules also do not know a hunger field. Adding it only to TypeScript
validation would leave the persistence boundary weaker than the application model. V1 therefore
needs rule-level bounds for 0–100 and the timing enum, plus emulator tests.

## 1.5 Data is the natural retrospective surface

The canonical navigation already contains the **Data** screen, and `DataView` owns detailed
retrospective telemetry. Creating another top-level navigation destination would add hierarchy for
a workflow that is naturally part of Data.

The clean v1 split is:

- **Check-in:** one optional hunger observation;
- **Data:** manual body-measurement entry and retrospective body-mass / circumference / hunger
  review.

---

# 2. Evidence review

These sources constrain product claims. They do not themselves decide repository architecture.

## 2.1 Repeatability depends on the measurement protocol

Waist circumference can be highly reproducible while the absolute value still differs materially
by anatomical site and measurement conditions. Relevant evidence includes:

- Mason & Katzmarzyk, measurement-site variability, PMID 19343017:
  https://pubmed.ncbi.nlm.nih.gov/19343017/
- Agarwal et al., effects of site/posture/respiratory phase/meal timing, PMID 19165166:
  https://pubmed.ncbi.nlm.nih.gov/19165166/
- Wang et al., reliability across four waist sites, PMID 12540397:
  https://pubmed.ncbi.nlm.nih.gov/12540397/
- anthropometry standardization/reliability work showing the role of trained technique and
  technical error, PMID 18524317:
  https://pubmed.ncbi.nlm.nih.gov/18524317/

**Implication:** metric identity must include the landmark and protocol revision. `waist` and
`stomach` are too ambiguous for longitudinal data.

The evidence is strongest for the general principle of protocol consistency and for waist. It does
not validate every proposed home landmark as a clinical standard. Chest nipple-line, mid-thigh,
maximum forearm and similar sites should therefore be described as **app-defined repeatable home
landmarks**, not as universally standardized anthropometry.

Duplicate readings are useful for catching measurement sloppiness. A discrepancy prompt can be a
versioned product-quality heuristic, provided the UI does not present it as a biological cutoff.

## 2.2 Digital hunger VAS is defensible as low-burden subjective observation

Digital visual-analogue appetite scales have been evaluated against paper VAS and in free-living
smartphone collection:

- PMID 36678176: https://pubmed.ncbi.nlm.nih.gov/36678176/
- PMID 34503591: https://pubmed.ncbi.nlm.nih.gov/34503591/

A 0–100 “How hungry do you feel right now?” observation is therefore reasonable **if the
measurement context is retained**. Appetite varies with timing and feeding state, so recording a
number while discarding whether it was pre-breakfast would undermine longitudinal comparability.

**Implication:** use a self-describing `hungerVas0To100` plus a bounded timing context. Keep
`morning_pre_breakfast` as the preferred comparison series; retain `other` values without silently
mixing them into that trend.

## 2.3 Hunger and body-mass change are not energy-availability diagnoses

The IOC RED-S consensus describes low energy availability as a complex exposure affecting male and
female athletes and does not reduce diagnosis to one symptom or weight trend:

https://pubmed.ncbi.nlm.nih.gov/37752011/

The 2026 UCI Sports Nutrition Project review specifically discusses the tension between cyclist
physique goals, very high expenditure and problematic low energy availability, while also noting
the challenge of accurate field assessment:

https://pubmed.ncbi.nlm.nih.gov/41911915/

**Implication:** v1 can report “morning hunger has been higher than your recent recorded pattern”
but cannot infer “you are under-fueled”, calculate energy availability from incomplete inputs, or
diagnose RED-S.

## 2.4 Circumference and consumer body-fat outputs need conservative semantics

Body-composition methods have different validity/error characteristics:

- systematic review, PMID 36369621:
  https://pubmed.ncbi.nlm.nih.gov/36369621/

A circumference trend is an anthropometric observation; it is not direct muscle/fat compartment
measurement. A provider smart-scale body-fat percentage is also not automatically equivalent to a
criterion method.

**Implication:** no custom tape body-fat equation, no “muscle gained/lost” label from limb
circumference alone, and no promotion of provider body-fat percentage to a primary authority.

---

# 3. Measurement vocabulary

The requested concepts can be represented with explicit home-protocol identities:

| User concept | V1 identity | Suggested cadence | Semantics |
|---|---|---:|---|
| Weight | `body_mass_kg` | daily if useful | one source-specific daily point feeds trends |
| Hunger | `hungerVas0To100` + timing | daily | subjective appetite context, not fueling diagnosis |
| Waist | `waist_minimum_cm` | weekly | named minimum-waist landmark |
| Stomach | `abdomen_umbilicus_cm` | weekly | unambiguous navel-level landmark |
| Hips | `hips_max_cm` | weekly | protocol-defined maximum circumference |
| Chest | `chest_nipple_line_cm` | weekly/fortnightly | app-defined home landmark; respiratory state fixed |
| Biceps | `upper_arm_relaxed_mid_cm` | weekly/fortnightly | relaxed upper-arm circumference |
| Forearm | `forearm_max_cm` | fortnightly | app-defined maximum circumference |
| Thigh | `thigh_mid_cm` + laterality | weekly/fortnightly | side is part of series identity |
| Calf | `calf_max_cm` + laterality | weekly/fortnightly | side is part of series identity |

Laterality should be available for limb measurements, but v1 should not require bilateral
measurement and must not infer corrective training from circumference asymmetry.

---

# 4. Candidate architectures

## Option A — everything on `DailySubjectiveCheckin`

This minimizes collection count but makes a daily safety/readiness record own slow-changing weekly
anthropometry and complicates completion/migration semantics.

**Reject.** Keep only hunger near the daily check-in.

## Option B — direct client writes to `health_observation_days`

This produces one canonical-looking layer by breaking an intentional security/ingestion boundary.

**Reject.** Server-managed provider normalization stays server-managed.

## Option C — force routine home measurements through formal `MetricObservationRevision`

This reuses excellent revision/protocol machinery but lies about workflow semantics by requiring
routine tracking to behave as Testing/`AssessmentAttempt` evidence.

**Reject for v1.** Reuse the design principles, not the testing lifecycle.

## Option D — focused athlete-authored anthropometry domain + composition

Add a small owner-writable `anthropometry_entries` collection, keep provider body mass in its
existing path, keep testing observations unchanged, and compose separate retrospective series in
Data. Hunger stays an optional check-in observation.

**Recommend.** This is the smallest model that preserves each existing domain boundary.

---

# 5. Persistence and trend details that must be explicit

## 5.1 Manual session identity and correction

A manual entry represents one actual measurement session, not one date. Multiple sessions can
therefore exist on a local date. The entry needs collision-safe identity, protocol/context,
readings, deterministic summaries and a monotonic current-record revision.

That revision protects against stale updates. It should not be described as an immutable audit
archive unless an actual revision-history store exists.

No free-text notes are needed in v1. This reduces sensitive-data sprawl and makes Firestore rules
more tractable.

## 5.2 Multiple same-day weights must not overweight a day

The initial design counted “4 of 7 days” for weekly body-mass coverage while also allowing
multiple measurement sessions per date. Without an explicit reduction rule, two or three entries
on one morning could accidentally count as extra observations or affect the weekly mean more than
another day.

The daily reduction should therefore be deterministic before trend math:

1. use valid manual body-mass entries from the selected date/source;
2. prefer `morning_post_void_pre_intake` with no prior training;
3. choose the earliest observation within the preferred set;
4. otherwise choose the earliest valid same-day observation and label non-preferred context;
5. use stable identity only as a final timestamp tie-break.

Coverage is then the number of **distinct local dates** with one derived point.

## 5.3 Source selection must not silently change the meaning of a trend

Manual and provider body mass are separate observations. The UI can offer an automatic initial
source choice when the athlete has not selected one, but it must be deterministic and labelled.
Once the athlete explicitly selects a source, missing coverage should produce a gap/insufficient
state rather than an automatic source switch.

No averaging or gap-filling across sources belongs in v1.

## 5.4 Hunger needs timing-aware trend identity

A check-in may happen after breakfast or later in the day. Treating every “hunger right now” score
as one interchangeable morning series would create false precision.

The preferred series should therefore be `morning_pre_breakfast`. Other timing values are still
valid raw observations, but they remain separate and do not increase preferred-series coverage.

The implementation must also explicitly delete/clear both value and timing through merge writes so
a cleared answer cannot leave stale Firestore data behind.

## 5.5 Transparent summary math

V1 should keep calculations obvious and testable:

- selected-source body mass: one point per distinct local date;
- 7-day arithmetic mean only when at least 4/7 dates are present;
- week-over-week delta only when both adjacent windows meet coverage;
- absolute and percentage body-mass change with coverage shown;
- latest-vs-previous valid circumference in the same metric/laterality/protocol series;
- 7-day and 28-day arithmetic hunger means for the same timing context with recorded-day counts;
- no interpolation, carry-forward or neutral padding.

The `4/7` rule and circumference repeatability tolerance are product-quality heuristics, not
physiological claims.

---

# 6. UX implications

## Daily check-in

Add an optional observation:

> **Hunger right now** — 0 “Not hungry at all” to 100 “Extremely hungry”

and record whether it is `morning_pre_breakfast` or `other`.

Behavior:

- optional and excluded from `dataQuality.isComplete`;
- no pre-filled neutral value;
- previous hunger history hidden before today's initial submission;
- clearing removes both value and timing;
- recommendation output is invariant to the field.

## Data

Add a **Body composition & fueling** section rather than a new top-level screen:

1. Body mass — source, latest value/context, 7-day mean, week-over-week change, coverage.
2. Waist & abdomen — latest and prior delta.
3. Hunger — context-specific retrospective trend and coverage.
4. Other circumferences — expandable series.
5. `Log measurements` — protocol-aware entry/correction flow.

A later W/kg display can be useful only if the repository has one explicit canonical cycling-power
value. It should show both input provenances and remain context-only.

---

# 7. Safety, privacy and failure semantics

V1 must not claim:

- “You have RED-S”;
- “You are in low energy availability”;
- “You lost muscle” from a tape delta;
- “Your body fat is X%” from a custom tape equation;
- “Hunger 80 means reduce training”.

Appropriate copy remains observational.

Anthropometry and appetite are sensitive wellness data. Implementation should:

- stay under `users/{uid}/...` ownership;
- avoid raw values in analytics, console logs and error reports;
- avoid copying raw history into recommendation audits;
- avoid free text by default;
- provide correction and deletion of manual entries;
- use bounded history queries;
- document retention/account deletion before completion.

Missing or failed reads remain missing:

```text
source unavailable / no entry
→ show gap or unavailable state
→ do not carry forward the last value
→ do not manufacture a complete trend
→ recommendation path remains unchanged
```

Migration is additive: existing users have no manual entries, existing check-ins have no hunger
fields, provider history stays where it is, and no synthetic backfill is required.

---

# 8. Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| inconsistent landmarks | technique can look like physiology | named metric IDs, protocol revision, repeated readings |
| overclaiming “standardized” tape sites | evidence does not validate every home landmark clinically | call them app-defined repeatable home landmarks |
| same-day duplicate weight | can overweight one date in weekly math | deterministic daily reduction before coverage/math |
| source splicing | device discontinuity can look like body-mass change | explicit source series and sticky explicit selection |
| hunger timing drift | post-meal and pre-breakfast ratings are not equivalent | persist timing; default trend is pre-breakfast only |
| stale merged check-in fields | clearing a value can leave old Firestore data | explicit delete semantics + parser/rule tests |
| check-in burden | extra daily questions can reduce adherence | one optional hunger item only |
| false precision | tape/smart-scale outputs invite over-interpretation | conservative copy; no tape body-fat model |
| medical overreach | weight/hunger can be mistaken for RED-S evidence | observation-only v1 and explicit non-goals |
| engine coupling too early | noisy data could alter training | structural no-import/no-authority tests |
| privacy sprawl | body data is sensitive | user scoping, no telemetry values/free text, delete flow |

---

# 9. Recommendation

Proceed with Option D and the revised ADR-0039.

The implementation should deliver an observation-first vertical slice:

1. focused athlete-owned measurement contracts/persistence/security;
2. protocol-aware manual measurement entry;
3. optional timing-aware hunger collection with anti-anchoring behavior;
4. source-specific, one-point-per-date body-mass trends and coverage;
5. neutral retrospective Data display with provenance and quality visibility;
6. privacy/retention/rollback documentation;
7. real longitudinal evidence collection;
8. only then, if useful, a separate analysis/ADR for any fueling advisory or recommendation
   authority.

The governing boundary is unchanged: **measurement, interpretation and training authority are
three separate decisions**.
