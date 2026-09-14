# ADR-0039: Longitudinal Body-Composition and Fueling Observations

* **Status:** Proposed
* **Date:** 2026-09-14
* **Deciders:** Repository owner
* **Source analysis:** [Body-composition and fueling observations analysis](../analysis/2026-09-14-body-composition-and-fueling-observations.md)
* **Implementation plan:** [Body-composition and fueling observations](../plans/body-composition-and-fueling-observations.md)

## Context

The application already has several nearby concepts, but none is a generic home-measurement log:

- `DailyRecoverySnapshot.raw.weightKg` / `bodyFatPct` are provider-origin recovery telemetry;
- ADR-0027 owns server-managed, source-aware health observations in `health_observation_days`;
- `MetricObservationRevision` is deliberately tied to a formal `MeasurementProtocol`,
  `AssessmentAttempt`, comparison-series identity and testing workflow;
- `DailySubjectiveCheckin` owns the athlete's date-scoped subjective check-in.

A real deployment pattern also matters: an athlete may already weigh on a connected bathroom scale,
with the scale/vendor application forwarding data into Garmin Connect and the application ingesting
that provider data. Requiring a second manual weight entry would create unnecessary burden and a
second competing copy of the same measurement event.

What is missing is a coherent way to collect and review:

1. repeatable athlete-authored tape measurements;
2. existing provider body mass without duplicating it manually;
3. optional appetite context;
4. provider-reported body-composition estimates without pretending they are criterion measures.

V1 separates three steps explicitly:

```text
measurement
    ↓
retrospective interpretation
    ↓
possible future training authority
```

This ADR approves the first two only. It does not approve the third.

Lower body mass is not inherently better, circumference change does not identify tissue type,
hunger is not a direct measure of energy availability, and consumer BIA outputs such as body-fat,
muscle, water or bone estimates are not interchangeable with criterion body-composition methods.

This ADR complements ADR-0002, ADR-0003, ADR-0010, ADR-0020, ADR-0024, ADR-0027 and ADR-0033.

---

## Evidence boundary

External evidence supports repeatable protocol-controlled anthropometry and low-burden digital
appetite ratings, but it does not justify a diagnostic or recommendation rule here.

Relevant evidence reviewed for this proposal:

- waist values depend materially on anatomical measurement site even when repeatability is high:
  https://pubmed.ncbi.nlm.nih.gov/19343017/
- site, posture, respiratory phase and meal timing can alter waist measurements:
  https://pubmed.ncbi.nlm.nih.gov/19165166/
- different waist sites can be reliable while remaining numerically non-interchangeable:
  https://pubmed.ncbi.nlm.nih.gov/12540397/
- digital appetite/hunger VAS collection is feasible and comparable with traditional VAS methods:
  https://pubmed.ncbi.nlm.nih.gov/36678176/
- smartphone appetite measurement has been evaluated in free-living conditions:
  https://pubmed.ncbi.nlm.nih.gov/34503591/
- the IOC RED-S consensus does not reduce low energy availability to hunger or body-mass change:
  https://pubmed.ncbi.nlm.nih.gov/37752011/
- the 2026 UCI Sports Nutrition Project highlights body-composition / energy-availability tension
  in cyclists and the difficulty of field assessment:
  https://pubmed.ncbi.nlm.nih.gov/41911915/
- a 2026 systematic review found BIA body-fat and fat-free-mass estimates generally non-equivalent
  to a four-compartment model at the individual level:
  https://pubmed.ncbi.nlm.nih.gov/41718193/
- an athlete systematic review/meta-analysis found material disagreement between BIA and DXA for
  fat-free mass:
  https://pubmed.ncbi.nlm.nih.gov/36853902/
- BIA devices can differ materially in raw impedance and resulting body-composition estimates:
  https://pubmed.ncbi.nlm.nih.gov/39047869/

The named non-waist tape landmarks below are **app-defined repeatable home landmarks**. V1 uses
protocol locking for longitudinal consistency, not clinical/ISAK equivalence.

The research above commonly uses VAS-style appetite instruments. V1 deliberately chooses a simpler
1–10 product rating because the purpose is low-burden within-person longitudinal context, not
laboratory comparability. The application must not claim that the 1–10 rating is numerically
interchangeable with a validated 0–100 VAS.

Coverage, repeatability and cadence rules are product measurement/reporting semantics, not
physiological thresholds. Any future decision-affecting rule requires separate ADR-0033 lineage.

---

## Options considered

### Option A — put all measurements on `DailySubjectiveCheckin`

**Rejected.** Weekly/fortnightly anthropometry does not belong in a daily safety/readiness record.
Only the genuinely daily optional hunger observation belongs near the check-in.

### Option B — make the React client write to `health_observation_days`

**Rejected.** ADR-0027 deliberately keeps that collection server-managed. Do not weaken the
provider-ingestion boundary for convenience.

### Option C — reuse `MetricObservationRevision` / `AssessmentAttempt`

**Rejected for v1.** Morning scale/tape tracking is not a performance testing attempt. Reuse the
principles of metric identity, protocol revisioning and correction semantics, not the Testing
lifecycle.

### Option D — focused athlete-authored anthropometry plus composed provider display

Persist manual home measurements in a small owner-writable domain. Keep provider body mass and any
provider body-composition estimates in their existing provider path. Compose source-specific
series for display without persisting a fused measurement. Add hunger as optional check-in context.

**Adopt.**

---

## Decision

### D-BC-SCOPE — longitudinal observation, not diagnosis

V1 may record/display:

- provider body mass already available through the existing ingestion path;
- manual body mass only as an explicit fallback when provider weight is unavailable or the athlete
  intentionally records a separate measurement;
- protocol-locked home circumference measurements;
- optional morning hunger context;
- provider body-composition estimates only when the provider actually exposes an unambiguous metric
  with source/provenance.

It does **not** diagnose energy availability, RED-S, loss of lean mass, adiposity, hydration status
or any medical condition. It does not prescribe a calorie deficit and does not autonomously alter
training.

### D-BC-METRICS — manual metric identity includes landmark and side

The v1 manual measurement vocabulary is:

```text
body_mass_kg                 # optional fallback, not the default when provider weight is present
waist_minimum_cm
abdomen_umbilicus_cm
hips_max_cm
chest_nipple_line_cm
upper_arm_relaxed_mid_cm
forearm_max_cm
thigh_mid_cm
calf_max_cm
```

Limb measurements additionally carry `laterality = left | right | unspecified` as part of series
identity. Left and right measurements are never silently merged.

User-facing labels use precise wording:

- “stomach” → **abdomen at navel**;
- “biceps” → **relaxed upper arm**.

Historical observations retain their original metric/protocol identity if a future protocol
revision refines a landmark.

### D-BC-CADENCE — prioritize useful measurements rather than requiring everything

The product must not imply that every supported circumference should be measured every week.
Suggested home tracking defaults are:

- **core weekly:** waist minimum, abdomen at navel, hips;
- **useful weekly/fortnightly:** fixed-site thigh;
- **optional weekly/fortnightly:** chest and relaxed upper arm;
- **optional fortnightly:** forearm and calf.

A baseline session may record both sides for limb measurements. Ongoing tracking may use one fixed
side or both, but the UI must preserve laterality and never silently switch series.

Cadence is guidance, not a completion requirement.

### D-BC-PERSIST — manual measurements are a user-owned domain

Manual sessions persist at:

```text
users/{userId}/anthropometry_entries/{entryId}
```

One logical entry represents one measurement session. Multiple sessions may exist on the same
local date.

Conceptual shape:

```ts
interface AnthropometryEntry {
  userId: string;
  entryId: string;
  date: string; // Europe/Warsaw local date
  observedAt: string;
  protocolRef: { id: 'home_anthropometry'; revision: 1 };
  context: {
    timing: 'morning_post_void_pre_intake' | 'other';
    trainingBeforeMeasurement: boolean;
  };
  measurements: Array<{
    metricId: AnthropometryMetricId;
    laterality?: 'left' | 'right' | 'unspecified';
    unit: 'kg' | 'cm';
    readings: number[];
    value: number;
    repeatabilityWarning: boolean;
  }>;
  schemaVersion: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
```

`revision` protects the current mutable manual record against stale writes/corrections. V1 does not
promise immutable history of every erroneous prior value.

The document is owner-readable/writable under ADR-0002. Security rules must bound keys, units,
array sizes and broad corruption/safety ranges. Updates preserve identity and monotonic revision.

### D-BC-PROTOCOL — home measurement is protocol-versioned

`home_anthropometry@1` teaches/records the preferred context:

- morning when practical;
- after toilet/voiding;
- before food/drink;
- before training;
- same landmark/posture each time;
- relaxed protocol-defined respiratory state for trunk measurements;
- tape horizontal and snug without compressing tissue.

Circumferences request two readings. If the pair exceeds the versioned repeatability tolerance, the
UI requests a third. `value` is the deterministic median of retained readings. The tolerance is a
measurement-quality heuristic, not a physiological threshold.

Manual body mass, when used, stores one reading per session.

### D-BC-WEIGHT — provider-first body mass, explicit manual fallback

When a usable provider body-mass series already exists, that series is the default body-mass source
and the athlete should not be asked to re-enter the same weight manually.

Manual `body_mass_kg` remains available because not every athlete has connected-provider weight and
because explicit correction/fallback workflows may be useful.

Source discipline is strict:

- provider and manual weight remain separate observations;
- raw values are never averaged across sources;
- trend calculation uses one explicit source at a time;
- the selected source is visible;
- explicit user source selection is sticky;
- the app never assumes a manual value duplicates a provider value merely because date/value match.

If provider coverage disappears, show insufficient/unavailable state rather than silently splicing
manual values into the same trend.

### D-BC-DAILY — one deterministic body-mass point per source/local date

Coverage counts **distinct local dates**, not records.

For manual weight on a selected date:

1. consider valid entries containing `body_mass_kg`;
2. prefer `morning_post_void_pre_intake && !trainingBeforeMeasurement`;
3. choose earliest `observedAt` within the preferred set;
4. otherwise choose earliest valid same-day entry and label non-preferred context;
5. use stable identity only as a timestamp tie-break.

Provider adapters likewise expose at most one deterministic point per provider/source/local date.
Provider-specific deduplication belongs in the adapter.

### D-BC-PROVIDER-COMPOSITION — smart-scale composition stays device-estimated telemetry

A connected scale may expose body fat, muscle, water, bone or related values through a provider.
Those values are not directly measured tissue compartments simply because they appear in Garmin or
another provider.

V1 rules:

- only ingest/display fields actually present in the provider payload;
- preserve exact metric semantics, units, provider/origin and transport provenance;
- label BIA-derived values as **device/scale estimates** in user-facing copy;
- do not invent a value for a Xiaomi/vendor metric that Garmin does not expose;
- do not manually copy missing composition values merely to make the dashboard complete;
- do not normalize differently named vendor metrics into one series until semantic equivalence is
  explicitly established;
- do not average composition estimates across devices/providers;
- do not promote body-fat, muscle, water or bone estimates to recommendation authority.

`bodyFatPct` already present in provider telemetry may therefore be displayed contextually with
provenance, but it remains secondary to measured body mass + repeatable circumference trends for
v1 longitudinal review.

### D-BC-HUNGER — optional 1–10 context, not readiness authority

Add two optional fields to `DailySubjectiveCheckin`:

```ts
hunger1To10?: number | null;
hungerTiming?: 'morning_pre_breakfast' | 'other' | null;
```

Scale:

```text
1  = Not hungry at all
5  = Moderate / typical hunger
10 = Extremely hungry
```

`5` is explanatory copy only; it is **not** a prefilled neutral value.

New writes obey an invariant: a numeric hunger rating requires a timing context; clearing hunger
clears both fields. Legacy check-ins with neither field remain valid.

Preferred observation is `morning_pre_breakfast`. `other` values remain valid raw context but are
not silently merged into the morning trend.

Hunger semantics:

- integer 1–10 only;
- missing is valid and does not affect check-in completeness;
- not added to `SubjectiveDimensionKey`;
- not mapped into `SubjectiveInput`, `metricStrain`, fatigue, eligibility or ranking;
- no default value;
- parser, service and Firestore rules validate range/timing and clear semantics;
- previous hunger values/trends remain hidden before today's initial response under ADR-0020
  anti-anchoring;
- retrospective trends may be shown after submission and in Data.

The 1–10 rating is a product tracking scale. V1 must not claim numeric equivalence to research VAS
instruments.

### D-BC-TRENDS — summaries are transparent, coverage-aware and source-specific

Body mass:

- show raw points for the selected source;
- reduce to one deterministic point per source/local date;
- 7-day arithmetic mean only with at least **4 of 7 distinct dates**;
- week-over-week absolute/% change only when both adjacent windows qualify;
- show coverage;
- never interpolate/carry forward.

Circumferences:

- series identity includes metric + laterality + protocol revision;
- latest valid value versus previous valid same-series observation;
- no interpolation;
- repeatability/context remain inspectable;
- never infer tissue type from direction of change.

Hunger:

- default trend uses `morning_pre_breakfast` only;
- `other` stays separate;
- 7-day and 28-day arithmetic means may be shown with recorded-day counts;
- sparse history is insufficient rather than neutral-filled;
- copy may say higher/lower than the recent recorded pattern but not good/bad or adequately/poorly
  fueled.

### D-BC-NOFAT — no synthetic body-fat or lean-mass inference

V1 does not calculate body-fat percentage from tape measurements and does not label arm/thigh/calf
change as muscle gained/lost.

Provider BIA composition may be shown only as device-estimated context with provenance. It is not a
criterion assessment and is not the primary authority for body-composition change.

### D-BC-NOEA — no energy-availability or RED-S diagnosis

The application does not derive numeric energy availability from body mass, hunger or training load
without required intake/expenditure/fat-free-mass inputs and a separately accepted evidence model.

V1 must not emit statements such as:

```text
You have RED-S.
You are in low energy availability.
Hunger 9 means you are under-fueled.
Your smart scale says you lost 1 kg of muscle, so reduce training.
```

Allowed language remains observational.

### D-BC-DATA — Data owns retrospective display

V1 stays inside the existing **Data** screen:

- body mass from the selected provider/manual source;
- waist/abdomen prominence;
- optional hunger trend;
- expandable secondary circumference history;
- contextual device-estimated body-composition metrics when available;
- `Log measurements` for tape measurements and explicit manual-weight fallback.

No new top-level navigation item is introduced.

### D-BC-WKG — cycling W/kg is context-only if added

A later v1.x enhancement may combine one canonical cycling power value with the selected
source-specific body-mass mean. It must retain both provenances and remain context-only.

### D-BC-AUTH — v1 has zero recommendation authority

No body-composition, body-mass, circumference or hunger trend may affect readiness/safety, fatigue,
weekly objectives, session eligibility/ranking, dose adjustment or recommendation-audit decision
inputs.

No `POLICY_VERSION` bump is required for observation-only implementation.

Any future decision-authority activation requires a separate accepted decision/ADR, prospective
evidence, ADR-0033 claim/alignment ownership, a policy-version bump and replay/simulation evidence.

### D-BC-FAIL — missingness stays missing and failures degrade locally

```text
measurement/source unavailable
→ preserve missing/unavailable state
→ omit affected trend when coverage is insufficient
→ no carry-forward / neutral fabrication / cross-source substitution
→ recommendation path unchanged
```

### D-BC-PRIVACY — minimize and isolate sensitive body data

V1 requires strict `users/{userId}/...` ownership, bounded reads, no raw body/hunger values in
analytics/console/error telemetry, no raw-history duplication into recommendation audits, no
free-text body notes by default, explicit correction/deletion, and documented retention/account
removal behavior.

### D-BC-MIGRATE — additive migration

- existing users with no `anthropometry_entries` remain valid;
- existing check-ins without hunger remain valid;
- provider body-mass/composition history is not copied into manual records;
- no synthetic historical hunger/circumference/composition values are generated;
- dates use existing Europe/Warsaw helpers;
- any check-in schema bump remains backward compatible with supported historical versions.

---

## Consequences

### Positive

- avoids duplicate manual weight entry when connected-scale data already exists;
- preserves provider/manual provenance rather than inventing fused truth;
- treats BIA body-composition numbers conservatively without discarding potentially useful context;
- keeps daily burden to one optional 1–10 hunger rating;
- prioritizes a practical tape workflow instead of requiring every circumference every week;
- creates an evidence corpus for later coaching research without changing recommendations.

### Negative

- adds one owner-writable collection and Firestore-rule/test surface;
- requires a composition read model across provider/manual/check-in records;
- provider composition semantics can vary and therefore need careful adapter-level typing;
- protocol-versioned home measurement is more complex than unqualified number inputs.

### Neutral

- existing provider `weightKg` / `bodyFatPct` ingestion does not change merely by accepting this ADR;
- `health_observation_days` remains server-managed;
- Testing contracts remain unchanged;
- recommendation output/policy version remain unchanged.

---

## Explicit non-goals

This ADR does not approve calorie/macro logging, automatic calorie targets, food-photo recognition,
inferred energy availability, RED-S diagnosis/screening, tape-derived body-fat equations,
DEXA/BIA-equivalence claims, automatic training reduction from hunger/weight, mandatory bilateral
measurement, asymmetry correction, new top-level navigation, cross-provider averaging, synthetic
backfill, or reconstructing provider composition metrics that the provider does not actually expose.

---

## Acceptance / activation boundary

Accepting this ADR approves **observation and retrospective reporting only**.

A subsequent implementation may ship when it satisfies the linked plan's persistence, security,
measurement-integrity, UX, privacy and rollback requirements while remaining recommendation-neutral.

Any transition from “observe/report” to “coach/decide” is a new architecture/evidence decision.