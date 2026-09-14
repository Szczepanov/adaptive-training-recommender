# Body-composition and fueling observations analysis — 2026-09-14

## Status and scope

This is a point-in-time analysis of how longitudinal body mass, tape anthropometry, and
subjective hunger could fit the recommender as it exists on `main` at
`568472691a89e0c2f159a7bd2a9b060642772808`.

It is **analysis, not an accepted architecture decision**. The proposed decision is recorded
separately in [ADR-0039](../adr/0039-longitudinal-body-composition-and-fueling-observations.md),
and the executable work sequence is in the
[implementation plan](../plans/body-composition-and-fueling-observations.md).

The motivating use case is deliberately broader than a measurements diary. An athlete may want
to track body mass, waist/abdomen, hips, chest, upper arm, forearm, thigh and calf while also
recording hunger, then interpret those trends alongside training load and performance. The
product question is whether the app can collect those observations with enough measurement
integrity and provenance to become useful context later **without prematurely turning them into
training-decision authority or a medical/RED-S diagnostic**.

---

## Executive summary

The repository already has most of the architectural pieces needed, but they currently belong to
three different concepts:

1. `DailyRecoverySnapshot` can already contain Garmin-origin `weightKg` and `bodyFatPct`, with a
   `metricDates.weight` provenance date.
2. ADR-0027 already defines source-aware health observations, source-specific baselines and the
   rule that raw measurements from different providers must not be silently averaged or spliced.
3. `DailySubjectiveCheckin` already collects optional/nullable subjective observations and
   ADR-0020 already defines the measurement-integrity rule that retrospective baselines should
   not anchor today's answer before submission.

What does **not** exist is a first-class user-authored longitudinal anthropometry record, a
standardized home measurement protocol, an optional hunger observation, or a Data-view trend
surface that composes these facts without conflating their provenance.

The highest-value design is therefore:

- keep provider body mass on its existing provider/recovery path;
- add a dedicated user-owned `anthropometry_entries` record for manual body mass and tape
  measurements rather than writing client data into server-owned `health_observation_days`;
- add an optional morning hunger VAS to the daily check-in, but do not make it required for check-in
  completion and do not map it into readiness/strain;
- render source-specific, coverage-aware trends inside the existing **Data** surface;
- make v1 observation/reporting only, with **zero recommendation authority**;
- explicitly prohibit tape-derived body-fat claims, raw cross-source weight averaging, and RED-S
  diagnosis from these signals.

That boundary is consistent with the repository's evidence-first pattern: measure first, validate
real longitudinal usefulness, and require a later explicit decision before any new signal can
change a recommendation.

---

# 1. Current repository state

## 1.1 Weight already exists, but only as provider/recovery telemetry

`app/src/engine/models.ts` `DailyRecoverySnapshot.raw` already carries:

```ts
weightKg?: number | null;
bodyFatPct?: number | null;
```

and the snapshot metadata can record `metricDates.weight`.

This is important because a new body-composition feature must not create a second unqualified
`currentWeight` truth. Garmin/smart-scale weight is already represented as provider-origin
recovery telemetry. A manual scale entry should coexist with that observation, not overwrite it
or be arithmetically averaged with it.

`bodyFatPct` should also remain a provider-reported observation. Nothing in the existing model
establishes it as an engine-authoritative body-composition estimate.

## 1.2 ADR-0027 already owns multisource physiological provenance

ADR-0027 (`source-aware-multisource-health-observations`) establishes several directly relevant
invariants:

- provider/origin and transport are separate provenance dimensions;
- multiple observations of the same physiological concept can coexist;
- longitudinal baselines are source-specific by default;
- raw values from different devices are not averaged into a synthetic measurement;
- source failure yields missing evidence rather than a fabricated neutral value.

The durable server-managed representation is
`users/{userId}/health_observation_days/{YYYY-MM-DD}_{provider}_{transport}`.

`app/firestore.rules` deliberately makes those documents owner-readable but **not client
writable**. That is a useful boundary, not an obstacle to work around. A manual tape form in the
React client should not acquire write authority over the server ingestion collection merely to
avoid defining a user-authored record.

## 1.3 The formal performance-observation model is not a routine wellness log

`app/src/observations/models.ts` and `manualAdapter.ts` provide a strong protocol-locked
measurement system for performance testing:

- `MetricDefinition`;
- `MeasurementProtocol` with `intent: 'testing'`;
- `AssessmentAttempt`;
- revisioned `MetricObservationRevision`;
- comparison-series identity and validity.

The manual adapter explicitly exists to prove the formal testing observation/protocol model.
Routine morning weight and weekly tape measurements are not test attempts and should not be
forced into `AssessmentAttempt` semantics just because both involve a number and a protocol.

The useful idea to reuse is **versioned measurement semantics**, not the testing persistence
model itself.

## 1.4 The daily check-in already has the right missing-data posture

`DailySubjectiveCheckin` currently stores readiness, sleep quality, fatigue, soreness, mental
stress and motivation as nullable 1–10 observations. `DailyCheckin.tsx` deliberately starts a
new day with those fields null instead of fabricating neutral values.

ADR-0020 adds another relevant invariant: historical subjective baselines may be shown
retrospectively, but must not be shown before today's response is submitted because that can
anchor the answer (`D-SUBJANCHOR`).

An optional morning hunger observation fits this pattern well **as data collection**, but it does
not automatically belong in `SubjectiveDimensionKey` or the readiness score. Hunger has a
different construct and a different evidence question from fatigue/readiness.

## 1.5 The existing Data screen is the natural trend surface

The canonical navigation already has `Screen = 'data'`, rendered as **Data**. `DataView.tsx`
already acts as the detailed retrospective telemetry surface.

Adding another top-level navigation destination for body measurements would increase navigation
complexity without creating a new workflow category. The natural v1 split is:

- **Check-in:** one lightweight optional hunger observation;
- **Data:** manual anthropometry entry plus retrospective body-mass/circumference/hunger trends.

---

# 2. What the scientific evidence supports — and what it does not

This section is an external evidence check performed for the design. These references constrain
product claims; they do not establish repository architecture.

## 2.1 Standardization matters more than collecting many sites

Waist circumference is reproducible when protocol is controlled, but the absolute value changes
with anatomical site and measurement conditions. That means a trend is interpretable only when
the athlete repeatedly measures the same construct.

Useful sources:

- Mason & Katzmarzyk, *Variability in waist circumference measurements according to anatomic
  measurement site*, PMID 19343017:
  https://pubmed.ncbi.nlm.nih.gov/19343017/
- Agarwal et al., *Effects of measurement protocol on waist circumference*, PMID 19165166:
  https://pubmed.ncbi.nlm.nih.gov/19165166/
- Wang et al., reliability of four waist-circumference sites, PMID 12540397:
  https://pubmed.ncbi.nlm.nih.gov/12540397/
- recent field-survey anthropometry reliability work using standardized training and technical
  error/reliability assessment, PMID 38745053:
  https://pubmed.ncbi.nlm.nih.gov/38745053/

**Product implication:** metric identity must include the landmark. `waist` and `stomach` are
not sufficiently precise schema names. A home protocol should distinguish, for example,
`waist_minimum_cm` from `abdomen_umbilicus_cm`.

Duplicate readings are useful for detecting measurement sloppiness. A v1 discrepancy prompt can
be a transparent **measurement-quality heuristic**, but it must not be presented as a biological
threshold.

## 2.2 Digital hunger VAS is a reasonable low-burden observation

Digital visual-analogue scales have been validated as practical substitutes for paper VAS
appetite ratings, including free-living smartphone collection:

- PMID 36678176: https://pubmed.ncbi.nlm.nih.gov/36678176/
- PMID 34503591: https://pubmed.ncbi.nlm.nih.gov/34503591/

A simple 0–100 question such as “How hungry do you feel right now?” therefore has a defensible
measurement basis if timing/context are kept reasonably consistent.

**Product implication:** use an optional 0–100 morning VAS, ideally before breakfast. Store the
context; do not pretend that a one-point difference is a universal physiological unit.

## 2.3 Hunger is not a direct energy-availability or RED-S measurement

The 2023 IOC RED-S consensus applies to male and female athletes and emphasizes the complexity of
low energy availability (LEA), including the distinction between adaptable exposure and
problematic prolonged/severe exposure:

https://pubmed.ncbi.nlm.nih.gov/37752011/

The 2026 UCI Sports Nutrition Project review specifically addresses the tension between cyclists'
high expenditure, body-composition goals and risk of problematic low energy availability:

https://pubmed.ncbi.nlm.nih.gov/41911915/

Those sources do **not** justify deriving energy availability from hunger plus body mass, nor do
they justify diagnosing RED-S from an app trend.

**Product implication:** hunger may later contribute to a “review fueling” advisory only as one
part of a multi-signal evidence model. V1 should say what was observed (“hunger has been higher
than your recent pattern”), not what disease/state the athlete has.

## 2.4 Consumer body-fat percentage and circumference deltas need conservative semantics

Field body-composition methods differ in validity and error characteristics. A circumference is a
useful longitudinal anthropometric observation, but a smaller thigh does not uniquely identify
loss of muscle and a smart-scale body-fat percentage is not interchangeable with a criterion
method.

A useful methods overview is:

- *Validity of field and laboratory methods for body composition assessment: a systematic
  review*, PMID 36369621: https://pubmed.ncbi.nlm.nih.gov/36369621/

**Product implication:** preserve raw observations and provenance. Do not synthesize a home-made
body-fat percentage from tape measurements in v1, and do not label arm/thigh changes as confirmed
lean-mass loss.

---

# 3. Measurement set and semantics

The user request names waist, forearm, chest, thighs, calves, biceps, hips, stomach, weight and
hunger. The product should preserve the intent while replacing ambiguous labels with stable
measurement identities.

| User concept | V1 metric identity | Suggested cadence | Rationale |
|---|---|---:|---|
| Weight | `body_mass_kg` | daily if useful | noisy day-to-day; trend is more useful than one reading |
| Hunger | `hunger_vas_0_100` | daily | cheap subjective fueling context |
| Waist | `waist_minimum_cm` | weekly | stable landmark distinct from navel |
| Stomach | `abdomen_umbilicus_cm` | weekly | removes ambiguous “stomach” semantics |
| Hips | `hips_max_cm` | weekly | standardized maximum circumference |
| Chest | `chest_nipple_line_cm` | weekly/fortnightly | accessible repeatable home landmark; protocol owns respiratory state |
| Biceps | `upper_arm_relaxed_mid_cm` | weekly/fortnightly | “biceps” is replaced with relaxed upper-arm circumference |
| Forearm | `forearm_max_cm` | fortnightly | optional supporting measure |
| Thigh | `thigh_mid_cm` + laterality | weekly/fortnightly | fixed landmark; side is part of series identity |
| Calf | `calf_max_cm` + laterality | weekly/fortnightly | fixed maximum; side is part of series identity |

The schema should support laterality for limb measurements but v1 should not require bilateral
measurements and should not infer a corrective training need from circumference asymmetry.

---

# 4. Candidate architectures

## Option A — add every measurement to `DailySubjectiveCheckin`

This minimizes collection count but mixes signals with very different cadence and semantics.
Weekly tape data would make a daily safety/readiness record grow into a general body-composition
document, while check-in completion and historical parser behavior become harder to reason about.

**Reject.** Hunger may be a daily optional check-in field; slow anthropometry should not live
there.

## Option B — let the client write manual records into `health_observation_days`

This would produce one canonical-looking observation layer, but it breaks the current security
ownership boundary. `health_observation_days` is deliberately server-managed and contains
provider/transport-normalized ingestion facts.

**Reject.** Do not weaken a server-owned collection merely to avoid a manual source record.

## Option C — reuse `MeasurementProtocol` / `AssessmentAttempt`

This gives protocol revisioning and validation immediately, but it lies about workflow semantics:
a morning scale reading is not a performance test attempt, and weekly waist measurement should
not appear in Testing or require a test lifecycle.

**Reject.** Reuse the principle of versioned protocol semantics, not the testing domain model.

## Option D — dedicated user-authored anthropometry + existing provider telemetry + composition

Add a small user-owned `anthropometry_entries` collection for manual body mass and circumference
facts. Keep provider body mass in the existing recovery/source-aware path. Compose source-specific
series in a read model for Data display. Add hunger as an optional check-in observation, retaining
ADR-0020's anti-anchoring rule.

**Recommend.** It preserves ownership boundaries, makes the manual workflow understandable, and
leaves room for a later evidence-backed fusion/advisory layer without making v1 authoritative.

---

# 5. Proposed data and trend behavior

## 5.1 Manual anthropometry record

A v1 record should be revisioned and user-scoped, approximately:

```ts
interface AnthropometryEntry {
  userId: string;
  date: string; // Warsaw-local YYYY-MM-DD
  observedAt: string;
  protocolRef: { id: 'home_anthropometry'; revision: 1 };
  context: {
    timing: 'morning_post_void_pre_intake' | 'other';
    trainingBeforeMeasurement: boolean;
  };
  measurements: AnthropometryMeasurement[];
  schemaVersion: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
```

Each circumference measurement should retain the entered repeats rather than only the final
summary value. A discrepancy warning/third-reading prompt is measurement-quality UX, not a
physiological decision rule.

No free-text field is required in v1. That reduces sensitive-data sprawl and makes security-rule
validation simpler.

## 5.2 Body mass remains source-specific

A manual `body_mass_kg` and a Garmin/smart-scale `weightKg` on the same date are two observations.
The Data UI should identify their sources. V1 should never calculate their arithmetic average.

For a trend, select one explicit series at a time. Defaulting may prefer the source with the most
consistent recent coverage, but the selection rule must be deterministic and visible rather than
silently splicing providers to fill gaps.

## 5.3 Transparent trend math

For the first release, prefer simple auditable summaries over a sophisticated body-composition
model:

- daily raw body-mass points;
- source-specific 7-day mean with coverage shown;
- week-over-week delta from adjacent 7-day windows when both windows have adequate observations;
- percentage change relative to the previous window;
- latest-vs-prior valid circumference delta;
- 7-day and 28-day hunger summaries shown retrospectively.

A practical v1 display-quality rule is to require at least 4 observations in each 7-day body-mass
window before labelling a weekly change. That is a **product coverage heuristic**, not a sports
science threshold, and belongs in versioned trend policy/tests rather than an evidence claim.

## 5.4 No engine authority in v1

Nothing in this capability should be mapped into:

- `SubjectiveInput` readiness scoring;
- `metricStrain`;
- fatigue costing;
- candidate eligibility;
- `POLICY_VERSION`;
- recommendation audit decision inputs.

This protects the current recommendation path and creates a real-athlete evidence period before
any activation decision.

---

# 6. UX implications

## Daily check-in

Add one optional row:

> **Hunger right now** — 0 “Not hungry at all” to 100 “Extremely hungry”

Important behavior:

- optional; not part of `dataQuality.isComplete`;
- no neutral default;
- do not display recent hunger history before today's first submission;
- after submission, retrospective context may be shown elsewhere in Data;
- unavailable/missing hunger stays missing.

## Data

Add a **Body composition & fueling** section rather than another top-level screen. Suggested
hierarchy:

1. Body mass: latest source/value, 7-day mean, week-over-week change, coverage.
2. Waist/abdomen: latest values and change.
3. Hunger: recent retrospective trend.
4. Expandable hips/chest/upper-arm/forearm/thigh/calf series.
5. `Log measurements` action with the versioned protocol guidance.

A cycling-specific contextual output such as W/kg can be valuable later, but it should use an
explicit performance value plus a source-specific body-mass trend and remain context-only. It
must not reward lowering body mass without regard to performance/recovery.

---

# 7. Safety, privacy and failure semantics

## 7.1 Non-diagnostic language

V1 must not claim:

- “You have RED-S”;
- “You are in low energy availability”;
- “You lost muscle” from a circumference change;
- “Your body fat is X%” from a custom tape equation;
- “Hunger 80 means reduce training”.

Appropriate v1 language is observational: “body mass is changing faster than your recent
pattern”, “waist decreased”, “hunger has been higher recently”, “measurement coverage is
insufficient”.

## 7.2 Data minimization

Anthropometry and appetite are sensitive wellness data. The implementation should:

- remain under `users/{uid}/...`;
- avoid analytics/logging of raw values;
- avoid duplicating raw history into recommendation audits;
- avoid free-text by default;
- provide user-visible correction/deletion of manual entries;
- document retention and account-deletion behavior before implementation is called complete.

## 7.3 Missing and failed reads

Missing measurement data is not neutral data. Failure behavior should be:

```text
source unavailable / no entry
→ show gap or unavailable state
→ do not carry forward the last value as today's measurement
→ do not manufacture a trend if coverage is insufficient
→ recommendation path is unaffected
```

## 7.4 Migration

The capability can be additive:

- existing users have zero `anthropometry_entries` and continue unchanged;
- existing check-ins without hunger remain valid;
- no historical circumference backfill is required;
- provider weight history remains where it is today;
- no recommendation policy migration is required while the feature is observation-only.

---

# 8. Main risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| inconsistent landmarks | apparent change can be technique rather than physiology | versioned metric IDs + protocol guidance + repeat readings |
| source splicing | scale/provider discontinuity can look like weight change | source-specific series; no silent averaging/fill |
| check-in burden | adding too many daily questions reduces adherence | only hunger is daily; anthropometry is separate/weekly |
| false precision | tape/smart-scale outputs can be over-interpreted | raw observations + conservative labels; no tape body-fat model |
| medical overreach | hunger/weight loss can be mistaken for RED-S diagnosis | v1 observational only; explicit non-goals |
| engine coupling too early | noisy data could alter training with no validation | architecture test / no engine imports; later explicit activation decision |
| privacy sprawl | measurements are sensitive wellness data | user scoping, no telemetry values, no free text, delete/correct flow |
| schema drift | ambiguous `waist`/`stomach` semantics make trends unusable | protocol/metric revisioning and landmark-specific IDs |

---

# 9. Recommendation

Proceed with the separate ADR and implementation plan using Option D.

The implementation should deliver an observation-first vertical slice before considering any
coach authority:

1. user-owned standardized anthropometry persistence;
2. optional hunger collection with anti-anchoring behavior;
3. source-specific body-mass composition and retrospective trends in Data;
4. coverage/provenance/quality visibility;
5. real usage and longitudinal evidence collection;
6. only then, if useful, a separate analysis/ADR for any fueling advisory or recommendation
   integration.

The most important boundary is not the exact list of circumferences. It is that **measurement,
interpretation and training authority remain three separate steps**.