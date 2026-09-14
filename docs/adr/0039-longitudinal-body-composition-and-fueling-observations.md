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

What is missing is a coherent way to collect and review longitudinal manual body measurements and
low-burden appetite context without pretending that they are formal performance tests, provider
records, or recommendation inputs.

V1 therefore separates three steps explicitly:

```text
measurement
    ↓
retrospective interpretation
    ↓
possible future training authority
```

This ADR approves the first two only. It does not approve the third.

The capability must also avoid false precision. Lower body mass is not inherently better,
circumference change does not identify tissue type, hunger is not a direct measure of energy
availability, and consumer body-fat estimates are not interchangeable with criterion methods.

This ADR complements:

- ADR-0002 — user-scoped Firestore isolation;
- ADR-0003 — Warsaw-local calendar semantics;
- ADR-0010 — decision provenance and policy-version semantics;
- ADR-0020 — subjective baselines and anti-anchoring;
- ADR-0024 — metric-specific baseline estimators;
- ADR-0027 — source-aware multisource health observations;
- ADR-0033 — sports-knowledge/evidence lineage.

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
- the IOC RED-S consensus treats low energy availability as a complex exposure and does not reduce
  diagnosis to hunger or body-mass change:
  https://pubmed.ncbi.nlm.nih.gov/37752011/
- the 2026 UCI Sports Nutrition Project highlights the body-composition / energy-availability
  tension in cyclists and the difficulty of field assessment:
  https://pubmed.ncbi.nlm.nih.gov/41911915/
- field and laboratory body-composition methods have different validity/error characteristics:
  https://pubmed.ncbi.nlm.nih.gov/36369621/

The named non-waist landmarks below are **app-defined repeatable home landmarks**. This evidence
does not establish every listed site as a clinical, ISAK-certified, or universally standardized
anthropometric protocol. V1 uses protocol locking for longitudinal consistency, not diagnostic
comparability with another method or practitioner.

The v1 coverage and repeatability rules are product measurement/reporting semantics, not
physiological thresholds. Any future decision-affecting rule requires its own evidence lineage
under ADR-0033.

---

## Options considered

### Option A — put all measurements on `DailySubjectiveCheckin`

This gives one familiar document but makes a daily safety/readiness record own weekly or
fortnightly anthropometry and complicates completion, parser and migration semantics.

**Rejected.** Only the genuinely daily hunger observation belongs near the daily check-in.

### Option B — make the React client write to `health_observation_days`

This would make manual values look like provider observations, but ADR-0027 deliberately keeps
that collection server-managed and `firestore.rules` denies client writes.

**Rejected.** Do not weaken the provider-ingestion boundary for convenience.

### Option C — reuse `MetricObservationRevision` / `AssessmentAttempt`

The existing performance-observation store accepts manual values, but it is not a generic scalar
store. Its logical identity requires a formal testing `MeasurementProtocol`, an
`AssessmentAttempt`, comparison-series identity and a revision chain. A morning scale reading or
weekly tape session is not a performance-test attempt.

Broadening those contracts to make routine wellness tracking fit would blur the existing Testing
architecture and create migration/replay implications beyond this feature.

**Rejected for v1.** Reuse the principles of explicit metric identity, protocol revisioning and
correction semantics, not the formal testing lifecycle or persistence model.

### Option D — dedicated user-authored anthropometry plus composed source-specific display

Persist manual body measurements in a small owner-writable collection. Keep provider body mass in
its existing provider/recovery ingestion path. Compose source-specific series for display without
persisting a fused measurement. Add hunger as optional check-in context.

**Adopt.**

---

## Decision

### D-BC-SCOPE — longitudinal observation, not diagnosis

V1 records and displays:

- manual body mass;
- provider body mass when already available through the existing provider path;
- morning hunger/appetite VAS context;
- protocol-locked home circumference measurements;
- simple source-specific trends and measurement coverage.

It does **not** diagnose energy availability, RED-S, loss of lean mass, adiposity, or any medical
condition. It does not prescribe a calorie deficit and does not autonomously alter training.

### D-BC-METRICS — metric identity includes the landmark and side

The v1 manual measurement vocabulary is:

```text
body_mass_kg
waist_minimum_cm
abdomen_umbilicus_cm
hips_max_cm
chest_nipple_line_cm
upper_arm_relaxed_mid_cm
forearm_max_cm
thigh_mid_cm
calf_max_cm
```

These IDs define the app's home protocol. They are not claims that every site is a universally
accepted clinical standard.

Limb measurements additionally carry `laterality = left | right | unspecified` as part of series
identity. The UI may remember a prior side as a convenience, but may not silently compare left and
right measurements as one series.

User-facing labels use precise wording. In particular:

- “stomach” becomes **abdomen at navel**;
- “biceps” becomes **relaxed upper arm**.

A future protocol revision may refine a landmark. Historical observations retain their original
metric/protocol identity and are never silently reclassified.

### D-BC-PERSIST — manual measurements are a user-owned domain

Manual body-measurement sessions persist at:

```text
users/{userId}/anthropometry_entries/{entryId}
```

V1 uses one logical entry per measurement session. `entryId` must be collision-safe and stable for
correction; more than one session may exist on the same local date.

The conceptual shape is:

```ts
interface AnthropometryEntry {
  userId: string;
  entryId: string;
  date: string; // Europe/Warsaw local date
  observedAt: string; // instant; its Warsaw-local date must equal `date`
  protocolRef: {
    id: 'home_anthropometry';
    revision: 1;
  };
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

`revision` is the monotonic revision of the **current mutable manual record**, used for stale-write
protection/correction semantics. V1 does not promise an immutable archive of every erroneous prior
value. If immutable anthropometry revision history becomes a requirement, that is a separate
persistence decision rather than an implication of this integer field.

The document is owner-readable/writable under ADR-0002. Security rules must bound field names,
units, array sizes and broad corruption/safety ranges. Bounds are storage-integrity controls, not
“healthy body” thresholds. Updates preserve `userId`, `entryId`, `createdAt`, schema identity and
monotonic revision semantics.

### D-BC-PROTOCOL — home measurement is protocol-versioned

`home_anthropometry@1` is an app-owned home-measurement protocol, not a formal
`AssessmentAttempt`.

The UI teaches and records whether the preferred context was followed:

- morning when practical;
- after toilet/voiding;
- before food/drink;
- before training;
- same landmark and posture each time;
- protocol-defined relaxed respiratory state for trunk measurements;
- tape horizontal and snug without compressing tissue.

V1 stores one reading for body mass. For circumferences it requests two readings. If the first pair
exceeds the versioned repeatability tolerance, the UI requests a third reading. `value` is a
deterministic median of retained readings. A repeatability warning is derived deterministically
from the retained readings and versioned quality policy.

The discrepancy tolerance is a **measurement-quality heuristic**, not a physiological threshold.
Changing it later must change the quality-policy/protocol revision when it would change accepted
or summarized values.

### D-BC-WEIGHT — provider and manual body mass remain separate series

A provider body-mass value and manual `body_mass_kg` value on the same date are not duplicates
merely because they share units or happen to match.

V1 preserves source discipline:

- provider weight remains in the existing provider/recovery ingestion path; if/when it is exposed
  through ADR-0027 health observations, ADR-0027 provenance rules continue to apply;
- manual weight remains in the anthropometry path;
- raw values are never averaged across sources;
- trend calculation uses one explicit source series at a time;
- source switching is visible and never implies measurement equivalence.

If the athlete explicitly selects a source, v1 must not silently auto-switch away from it because
coverage changes. If no source has been selected, the UI may choose a deterministic initial
default from recent coverage and a stable tie-break, but must label the chosen source.

### D-BC-DAILY — one deterministic body-mass point per local date

Coverage is defined in **distinct local dates**, not number of records. Multiple manual entries on
one date must never give that day extra weight in a 7-day summary.

For a selected manual source/date, the derived daily body-mass point is chosen as follows:

1. consider valid entries containing `body_mass_kg` for that local date;
2. prefer entries with `timing = morning_post_void_pre_intake` and
   `trainingBeforeMeasurement = false`;
3. within the preferred set choose the earliest `observedAt`;
4. if no preferred-context entry exists, choose the earliest valid entry for the date and label the
   point as non-preferred context;
5. use stable identity as the final tie-break if timestamps are equal.

All raw sessions remain visible. A mistaken first entry should be corrected rather than “fixed” by
adding a duplicate session and relying on selection order.

Provider projections must likewise expose at most one deterministic point per source/local date to
the trend function; if a provider can produce multiple same-day records, its adapter owns the
deduplication policy rather than the generic trend function averaging them.

### D-BC-HUNGER — hunger is optional context, not readiness authority

Add two optional fields to `DailySubjectiveCheckin`:

```ts
hungerVas0To100?: number | null;
hungerTiming?: 'morning_pre_breakfast' | 'other' | null;
```

The question is a 0–100 VAS:

```text
0   = Not hungry at all
100 = Extremely hungry
```

New writes obey an invariant: a numeric hunger value requires a timing context; clearing hunger
clears both fields. Legacy check-ins with neither field remain valid.

The preferred observation is `morning_pre_breakfast`. `other` values remain valid raw context but
must not be silently merged into the default pre-breakfast trend because appetite depends on
measurement timing.

Hunger has the following v1 semantics:

- missing is valid and does not affect `dataQuality.isComplete`;
- it is not added to `SubjectiveDimensionKey`;
- it is not mapped into `SubjectiveInput`, `metricStrain`, fatigue, eligibility or candidate
  ranking;
- it has no neutral default;
- parser, service and Firestore-rule validation bound the value to 0–100 and validate the timing
  enum;
- clearing a previously stored value must not resurrect stale value/context through merge writes;
- previous hunger values/trends are not shown before today's initial submission, preserving
  ADR-0020 `D-SUBJANCHOR`;
- retrospective trends may be shown after submission and in Data.

A future decision to use hunger in training or fueling advice requires a separate activation
analysis and decision.

### D-BC-TRENDS — summaries are simple, coverage-aware and auditable

V1 uses transparent derivations rather than a proprietary body-composition/fueling score.

For body mass:

- show raw points for the selected source series;
- reduce to one deterministic point per local date before summary math;
- calculate a 7-day arithmetic mean only when at least **4 of 7 distinct local dates** have a valid
  daily point;
- calculate week-over-week change only when both adjacent 7-day windows satisfy that coverage;
- show absolute and percentage change plus `recordedDays/7` coverage;
- never interpolate or carry forward missing dates.

The `4 of 7` rule is a **display-quality heuristic**, not a physiology threshold. It is versioned
in trend implementation/tests.

For circumferences:

- series identity includes metric, laterality and protocol revision;
- default to latest valid value versus the previous valid observation in the same series;
- do not interpolate missing weeks;
- retain repeatability-quality visibility;
- do not infer tissue type from direction of change.

For hunger:

- the default retrospective trend uses only `morning_pre_breakfast` observations;
- `other` observations remain visible separately and do not increase preferred-series coverage;
- 7-day and 28-day arithmetic means may be displayed with recorded-day counts;
- sparse history is labelled insufficient rather than padded with neutral values;
- copy may say **higher/lower than the recent recorded pattern** but must not label a value as
  inherently favourable/adverse or adequately/poorly fueled.

### D-BC-NOFAT — no synthetic body-fat or lean-mass inference

V1 must not calculate a custom body-fat percentage from circumference measurements.

Provider `bodyFatPct` may be displayed as a provider observation with explicit provenance, but it
is not treated as equivalent to a criterion body-composition assessment and is not promoted to a
primary body-composition authority.

A change in arm, thigh or calf circumference must not be labelled “muscle gained/lost” without
independent evidence.

### D-BC-NOEA — no energy-availability or RED-S diagnosis

The application must not derive numeric energy availability from body mass, hunger or training
load unless required intake, expenditure and fat-free-mass inputs exist and a separately accepted
evidence model authorizes that calculation.

V1 must not emit statements such as:

```text
You have RED-S.
You are in low energy availability.
Hunger 80 means you are under-fueled.
```

Allowed language is observational, for example:

```text
Your 7-day body-mass average changed from the previous complete window.
Morning pre-breakfast hunger has been higher than your recent recorded pattern.
Measurement coverage is insufficient for a weekly trend.
```

### D-BC-DATA — Data owns retrospective display; navigation does not grow

V1 is surfaced inside the existing **Data** screen. It provides:

- `Log measurements`;
- body-mass source/value/coverage/trend;
- waist and abdomen trend prominence;
- hunger retrospective trend;
- expandable secondary circumference history.

No new top-level `Screen`/navigation item is introduced.

### D-BC-WKG — cycling W/kg is context-only if added

A later v1.x Data enhancement may combine an explicit canonical cycling power/FTP-like value with
the selected source-specific 7-day body-mass mean to display W/kg.

That derived number is **context-only**. It retains both source references and does not create an
incentive rule that rewards lower mass independent of absolute performance, recovery or health.
If the canonical power authority is ambiguous, this enhancement is skipped rather than inventing a
second FTP field.

### D-BC-AUTH — v1 has zero recommendation authority

No body-composition or hunger trend may affect:

- readiness mode or safety envelopes;
- fatigue state;
- weekly objectives/coverage;
- session eligibility/ranking;
- dose adjustment;
- recommendation audit decision inputs.

Because v1 cannot alter a recommendation, implementing it does **not** by itself require a
`POLICY_VERSION` bump.

Any future decision-authority activation requires:

1. a separate accepted activation decision/ADR;
2. prospective evidence that the signal adds value beyond existing recovery/performance context;
3. ADR-0033 claim/coverage/alignment-test ownership for every decision threshold;
4. a `POLICY_VERSION` bump;
5. simulation/replay/regression evidence showing bounded behavior.

### D-BC-FAIL — missingness stays missing and failures degrade locally

A missing anthropometry entry, missing hunger response, or unavailable provider body-mass read
must not invalidate the day's training recommendation.

```text
measurement/source unavailable
→ preserve missing/unavailable state
→ omit the affected trend when coverage is insufficient
→ do not carry the last value forward as today's observation
→ do not fabricate a neutral value
→ leave the recommendation path unchanged
```

### D-BC-PRIVACY — minimize and isolate sensitive body data

Anthropometry and appetite values are sensitive wellness data. V1 requires:

- strict `users/{userId}/...` ownership;
- no raw values in application analytics, console telemetry or error reports;
- no duplication of raw history into recommendation audits;
- no free-text notes in the core anthropometry record;
- explicit correction and delete operations for manual entries;
- documented retention and account-deletion behavior before implementation is marked complete;
- bounded history queries rather than unbounded collection reads.

### D-BC-MIGRATE — migration is additive and fail-open to absence

V1 introduces no required historical backfill.

- Existing users have no `anthropometry_entries` and remain valid.
- Existing `DailySubjectiveCheckin` documents without hunger fields remain valid.
- Provider body-mass history is not copied into manual records.
- No synthetic historical hunger/circumference values are generated.
- Calendar dates use the existing Warsaw-local helpers under ADR-0003.

If `DailySubjectiveCheckin` schema version changes, parsers and rules remain backward compatible
with supported historical versions.

---

## Consequences

### Positive

- Gives the athlete one coherent place to track relevant manual measurements.
- Preserves provider/manual provenance instead of inventing a fused “truth”.
- Keeps the daily check-in lightweight: only optional hunger context is daily.
- Gives repeated home measurements stable protocol and landmark identity without overstating their
  clinical standardization.
- Creates an evidence corpus for later coaching research without changing current recommendations.
- Fits the existing Data surface and avoids another top-level navigation destination.

### Negative

- Adds a new owner-writable collection and Firestore-rule/test surface.
- Requires a composition read model because provider, manual and check-in records remain separate.
- Protocol-versioned home measurement is more complex than an unqualified list of number inputs.
- Users can still over-interpret trends, so product copy must remain conservative.

### Neutral

- Provider `weightKg` / `bodyFatPct` behavior does not change.
- `health_observation_days` remains server-managed.
- Performance `MetricObservationRevision` / `AssessmentAttempt` contracts remain unchanged.
- `POLICY_VERSION` and recommendation output remain unchanged until a separate activation decision.

---

## Explicit non-goals

This ADR does not approve:

- calorie/macro logging or automatic calorie targets;
- food-photo recognition;
- inferred energy availability or RED-S diagnosis/screening;
- tape-derived body-fat equations;
- DEXA/BIA equivalence claims;
- automatic training reduction based on hunger or body-mass change;
- mandatory bilateral limb measurements;
- circumference-asymmetry corrective training;
- new top-level navigation;
- cross-provider raw body-mass averaging;
- synthetic historical backfill.

Those may be evaluated independently if a real product need and evidence base emerge.

---

## Acceptance / activation boundary

Accepting this ADR approves the **observation and retrospective-reporting architecture** only.

A subsequent implementation may ship when it satisfies the linked plan's persistence, security,
measurement-integrity, UX, privacy and rollback requirements while remaining
recommendation-neutral.

Any transition from “observe/report” to “coach/decide” is a new architectural/evidence decision,
not an implementation detail of ADR-0039.
