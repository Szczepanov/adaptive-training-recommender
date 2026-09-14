# ADR-0039: Longitudinal Body-Composition and Fueling Observations

* **Status:** Proposed
* **Date:** 2026-09-14
* **Deciders:** Repository owner
* **Source analysis:** [Body-composition and fueling observations analysis](../analysis/2026-09-14-body-composition-and-fueling-observations.md)
* **Implementation plan:** [Body-composition and fueling observations](../plans/body-composition-and-fueling-observations.md)

## Context

The application can already observe Garmin-origin body mass in `DailyRecoverySnapshot`, and
ADR-0027 already defines a source-aware, server-managed health-observation layer. The athlete can
also report daily subjective readiness, sleep, fatigue, soreness, stress and motivation.

What is missing is a coherent way to collect and review longitudinal body-composition/fueling
context that is not available from the wearable path:

- manual body mass when a provider value is absent or the athlete wants an explicit scale entry;
- standardized tape measurements such as waist, abdomen, hips, chest, upper arm, forearm, thigh
  and calf;
- a low-burden hunger/appetite observation;
- trends that can be reviewed alongside performance without silently becoming training-decision
  inputs.

This capability is useful for athletes who are deliberately changing body mass while training.
It also creates a risk of false precision and medical overreach. A lower body mass is not always a
better outcome, a circumference change does not identify tissue type, hunger is not a direct
measure of energy availability, and consumer body-fat estimates are not interchangeable with a
criterion body-composition method.

The architecture therefore needs to separate three things explicitly:

```text
measurement
    ↓
retrospective interpretation
    ↓
possible future training authority
```

V1 decides the first two and explicitly withholds the third.

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

The external evidence supports standardized repeated anthropometry and low-burden digital appetite
ratings, but it does not justify a new diagnostic or recommendation rule.

Relevant evidence reviewed for the proposal:

- waist values depend materially on anatomical measurement site even when repeatability is good:
  https://pubmed.ncbi.nlm.nih.gov/19343017/
- waist measurement protocol factors such as site and conditions affect the resulting value:
  https://pubmed.ncbi.nlm.nih.gov/19165166/
- multiple waist sites can be measured reliably but are not numerically interchangeable:
  https://pubmed.ncbi.nlm.nih.gov/12540397/
- digital appetite/hunger VAS collection is feasible and consistent with traditional VAS methods:
  https://pubmed.ncbi.nlm.nih.gov/36678176/
- smartphone appetite measurement has been evaluated in free-living conditions:
  https://pubmed.ncbi.nlm.nih.gov/34503591/
- the IOC RED-S consensus describes low energy availability as a complex exposure affecting male
  and female athletes and does not reduce diagnosis to hunger or body-mass change:
  https://pubmed.ncbi.nlm.nih.gov/37752011/
- the UCI Sports Nutrition Project highlights the body-composition/energy-availability tension in
  cyclists and the need to consider health and performance together:
  https://pubmed.ncbi.nlm.nih.gov/41911915/
- field/laboratory body-composition methods have different validity/error characteristics:
  https://pubmed.ncbi.nlm.nih.gov/36369621/

Accordingly, the v1 trend rules in this ADR are **product measurement/reporting semantics**, not
physiological diagnostic thresholds. Any future decision-affecting rule requires its own evidence
lineage under ADR-0033.

---

## Options considered

### Option A — put all measurements on `DailySubjectiveCheckin`

This gives one familiar document but makes a daily safety/readiness record own weekly/fortnightly
anthropometry and complicates completion/migration semantics.

**Rejected.** Only the truly daily subjective hunger observation belongs near the daily check-in.

### Option B — make the React client write to `health_observation_days`

This would make manual values look like provider observations, but the collection is deliberately
server-managed under ADR-0027 and `firestore.rules` denies client writes.

**Rejected.** Do not weaken the server ingestion boundary for convenience.

### Option C — reuse the performance `MeasurementProtocol` / `AssessmentAttempt` system

That model has useful versioning concepts, but it is explicitly a formal testing workflow. A
weekly waist measurement is not a performance-test attempt.

**Rejected.** Reuse the principle of protocol revisioning, not the testing lifecycle.

### Option D — dedicated user-authored anthropometry plus composed source-specific display

Persist manual anthropometry in a separate owner-writable collection. Keep provider body mass in
its existing path. Compose source-specific series for display without persisting a fused
measurement. Add hunger as an optional check-in observation.

**Adopt.**

---

## Decision

### D-BC-SCOPE — the capability is longitudinal observation, not diagnosis

V1 records and displays:

- body mass;
- morning hunger/appetite VAS;
- standardized circumferences;
- simple source-specific trends and measurement coverage.

It does **not** diagnose energy availability, RED-S, loss of lean mass, or a medical condition.
It does not prescribe a calorie deficit and does not autonomously alter training.

### D-BC-METRICS — metric identity includes the landmark

The v1 manual anthropometry vocabulary is:

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

Limb measurements additionally carry `laterality = left | right | unspecified` as part of the
series identity. The UI may remember the athlete's previous side as a convenience, but may not
silently compare a left-side observation with a right-side observation.

User-facing labels use precise wording. In particular:

- “stomach” becomes **abdomen at navel**;
- “biceps” becomes **relaxed upper arm**.

A future protocol revision may refine a landmark. Historical observations retain their original
protocol/metric identity and are not silently reclassified.

### D-BC-PERSIST — manual anthropometry is a user-owned record

Manual body measurements persist at:

```text
users/{userId}/anthropometry_entries/{entryId}
```

V1 uses one logical entry per measurement session. `entryId` must be collision-safe and stable for
correction; it must not assume that only one measurement session can ever exist on a local date.

The record shape is conceptually:

```ts
interface AnthropometryEntry {
  userId: string;
  entryId: string;
  date: string; // Europe/Warsaw local date
  observedAt: string;
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

The implementation may refine naming/normalization while preserving these semantics.

The document is owner-readable/writable under ADR-0002. Security rules must bound field names,
units, collection sizes and reasonable numeric ranges. Updates must preserve `userId`, `entryId`,
`createdAt`, and monotonic schema/revision semantics.

### D-BC-PROTOCOL — home measurements are protocol-versioned

`home_anthropometry@1` is an app-owned measurement protocol, not a formal `AssessmentAttempt`.

The UI teaches and stores whether the preferred context was followed:

- morning when practical;
- after toilet/voiding;
- before food/drink;
- before training;
- same landmark and posture each time;
- ordinary relaxed breathing / protocol-defined respiratory state for trunk measurements;
- tape horizontal and snug without compressing tissue.

For circumferences, v1 requests **two readings** and stores both. If the readings differ by more
than the versioned measurement-quality tolerance, the UI requests a third reading and sets a
repeatability warning when the final set remains inconsistent.

The initial discrepancy tolerance is a **product measurement-quality heuristic**, not a
physiological threshold. The implementation plan owns the exact UI tolerance and tests; changing
it later does not create training authority but must be versioned if it changes which values are
accepted/summarized.

`value` is a deterministic summary of the retained readings. V1 should use the median so the
third-reading path is robust to one obvious outlier.

### D-BC-WEIGHT — provider and manual body mass remain separate observations

A provider body-mass value and a manual `body_mass_kg` value on the same date are not duplicates
merely because they have the same unit.

V1 follows ADR-0027's source discipline:

- Garmin/provider weight remains on the existing recovery/source-aware path;
- manual weight remains on the manual anthropometry path;
- raw values are never averaged across sources;
- trend calculation uses one explicit source series at a time;
- source switching must be visible to the athlete and starts a separate comparison series unless
  future equivalence evidence justifies continuity.

The UI may offer an explicit source selector and may choose a deterministic display default based
on recent coverage. It may not silently splice sources to fill missing dates.

### D-BC-HUNGER — hunger is optional subjective context, not readiness authority

Add an optional `hunger` observation to `DailySubjectiveCheckin` with a **0–100 VAS**:

```text
0   = Not hungry at all
100 = Extremely hungry
```

The intended context is morning/pre-breakfast when practical.

Hunger has the following v1 semantics:

- nullable/missing is valid;
- it does not affect `dataQuality.isComplete`;
- it is not added to the existing `SubjectiveDimensionKey` readiness dimensions;
- it is not mapped into `SubjectiveInput`, `metricStrain`, fatigue or candidate ranking;
- it has no neutral default;
- previous hunger values/trends are not shown before today's initial submission, preserving
  ADR-0020 `D-SUBJANCHOR`;
- retrospective trends may be shown after submission and in Data.

A future decision to use hunger in training or fueling advice requires a separate activation
analysis and decision.

### D-BC-TRENDS — v1 summaries are simple, coverage-aware and auditable

V1 trend display uses transparent derivations rather than a proprietary body-composition score.

For body mass:

- show raw points for the selected source series;
- calculate a 7-day arithmetic mean when at least **4 of 7** local dates have a valid observation;
- calculate week-over-week change only when both adjacent 7-day windows satisfy that coverage;
- show absolute and percentage change;
- always show the coverage count used by the summary.

The `4 of 7` rule is a **display-quality heuristic**, not a physiology threshold. It is versioned
in the trend implementation and can be changed without claiming biological meaning.

For circumferences:

- default to latest valid value versus the previous valid observation from the same metric,
  laterality and protocol revision;
- do not interpolate missing weeks;
- do not infer tissue type from the direction of change.

For hunger:

- retrospective 7-day and 28-day summaries may be displayed with recorded-day counts;
- sparse history is labelled insufficient rather than padded with neutral values;
- favourable/adverse interpretation is informational only in v1.

### D-BC-NOFAT — no synthetic body-fat or lean-mass inference from tape data

V1 must not calculate a custom body-fat percentage from circumference measurements.

Provider `bodyFatPct` may be displayed as a provider observation with explicit provenance, but it
is not treated as equivalent to a criterion body-composition assessment and does not become the
primary body-composition trend authority.

Likewise, a change in arm/thigh/calf circumference must not be labelled “muscle gained/lost”
without independent evidence.

### D-BC-NOEA — no energy-availability or RED-S diagnosis

The application must not derive a numeric energy-availability estimate from body mass, hunger or
training load unless it has the required intake/expenditure/fat-free-mass inputs and a separately
accepted evidence model.

V1 must not emit diagnostic statements such as:

```text
You have RED-S.
You are in low energy availability.
Hunger 80 means you are under-fueled.
```

Allowed language is observational, for example:

```text
Your 7-day body-mass average is changing faster than the previous week.
Morning hunger has been higher than your recent recorded pattern.
Measurement coverage is insufficient for a weekly trend.
```

### D-BC-DATA — Data owns retrospective display; navigation does not grow

V1 is surfaced inside the existing **Data** screen.

It provides:

- `Log measurements`;
- body-mass source/value/coverage/trend;
- waist and abdomen trend prominence;
- hunger retrospective trend;
- expandable secondary circumference history.

No new top-level `Screen`/navigation item is introduced for v1.

### D-BC-WKG — cycling W/kg is context-only if added

A later v1.x Data enhancement may combine an explicit cycling power/FTP-like performance value
with the selected source-specific 7-day body-mass mean to display W/kg.

That derived number is **context-only**. It must retain both source references and must not create
an incentive rule that rewards lower mass independent of absolute performance, recovery or health.

### D-BC-AUTH — v1 has zero recommendation authority

The initial capability must be structurally isolated from the recommendation decision path.

No body-composition or hunger trend may affect:

- readiness mode;
- safety envelopes;
- fatigue state;
- weekly objectives/coverage;
- session eligibility/ranking;
- dose adjustment;
- `RecommendationAudit` decision inputs.

Because v1 cannot alter a recommendation, implementing it does **not** by itself require a
`POLICY_VERSION` bump.

If a future change can alter a recommendation, it requires:

1. a separate accepted activation decision/ADR;
2. prospective evidence that the signal adds value beyond existing recovery/performance context;
3. ADR-0033 claim/coverage/alignment-test ownership for every decision-authority threshold;
4. a `POLICY_VERSION` bump;
5. simulation/replay/regression evidence showing bounded behavior.

### D-BC-FAIL — missingness stays missing and failures degrade locally

A missing anthropometry entry, missing hunger response, or unavailable provider body-mass read
must not invalidate the day's training recommendation.

Failure semantics are:

```text
measurement/source unavailable
→ preserve missing/unavailable state
→ omit the affected trend when coverage is insufficient
→ do not carry the last value forward as today's observation
→ do not fabricate a neutral value
→ leave the recommendation path unchanged
```

### D-BC-PRIVACY — minimize and isolate sensitive body data

Anthropometry and appetite values are sensitive wellness data.

V1 therefore requires:

- strict `users/{userId}/...` ownership;
- no raw measurement values in application analytics, console telemetry or error reports;
- no duplication of raw history into recommendation audits;
- no free-text notes in the core anthropometry record;
- explicit edit/correction and delete operations for manual entries;
- documented retention and account-deletion behavior before the implementation plan is marked
  `Implemented`;
- bounded query windows for trend display rather than unbounded collection reads.

### D-BC-MIGRATE — migration is additive and fail-open to absence

V1 introduces no required backfill.

- Existing users have no `anthropometry_entries` and remain valid.
- Existing `DailySubjectiveCheckin` documents without `hunger` remain valid.
- Provider body-mass history is not copied into manual records.
- No synthetic historical hunger/circumference values are generated.
- Calendar dates use the existing Warsaw-local helpers under ADR-0003.

If `DailySubjectiveCheckin` schema version changes for hunger, parsers and rules must remain
backward compatible with supported historical versions.

---

## Consequences

### Positive

- Gives the athlete one coherent place to track the measurements that matter during deliberate
  body-mass change.
- Preserves provider/manual provenance instead of inventing a fused “truth”.
- Keeps the daily check-in lightweight: only hunger is daily; tape data lives elsewhere.
- Standardizes landmarks so longitudinal change has interpretable semantics.
- Creates an evidence corpus for later fueling/body-composition coaching without prematurely
  changing training decisions.
- Fits the existing Data surface and avoids another top-level navigation destination.

### Negative

- Adds a new user-owned collection and Firestore-rule/test surface.
- Requires a composition read model because relevant data live in separate provider/manual/check-in
  records.
- Protocol-versioned anthropometry adds UX complexity compared with a simple list of number inputs.
- Users may still over-interpret trends; product copy must stay conservative.

### Neutral

- Provider `weightKg`/`bodyFatPct` behavior does not change.
- `health_observation_days` remains server-managed.
- Performance-testing `MetricObservationRevision`/`AssessmentAttempt` remain unchanged.
- `POLICY_VERSION` and recommendation output remain unchanged until a separate future activation
  decision.

---

## Explicit non-goals

This ADR does not approve:

- calorie/macro logging;
- automatic calorie targets;
- food photo recognition;
- inferred energy availability;
- RED-S diagnosis/screening;
- tape-derived body-fat equations;
- DEXA/BIA equivalence claims;
- automatic training reduction based on hunger or weight loss;
- mandatory bilateral limb measurements;
- circumference-asymmetry corrective training;
- new top-level navigation;
- cross-provider raw body-mass averaging;
- historical synthetic backfill.

Those may be evaluated independently if a real product need and evidence base emerge.

---

## Acceptance / activation boundary

Accepting this ADR approves the **observation and retrospective-reporting architecture** only.

A subsequent implementation may ship when it satisfies the linked plan's persistence, security,
measurement-integrity, UX and rollback requirements while remaining recommendation-neutral.

Any transition from “observe/report” to “coach/decide” is a new architectural/evidence decision,
not an implementation detail of ADR-0039.