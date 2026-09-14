# ADR-0039: Longitudinal Body-Composition and Fueling Observations

* **Status:** Accepted
* **Date:** 2026-09-14
* **Deciders:** Repository owner
* **Source analysis:** [Body-composition and fueling observations analysis](../analysis/2026-09-14-body-composition-and-fueling-observations.md)
* **Implementation plan:** [Body-composition and fueling observations](../plans/body-composition-and-fueling-observations.md)

## Context

The application already has several adjacent but intentionally distinct domains:

- provider-origin recovery telemetry can include `weightKg` / `bodyFatPct`;
- ADR-0027 owns server-managed, source-aware health observations;
- `MetricObservationRevision` / `AssessmentAttempt` own formal testing evidence;
- `DailySubjectiveCheckin` owns date-scoped athlete-reported context.

A connected bathroom scale may already send weight and BIA-derived estimates through a vendor app
into Garmin Connect. If the application already receives that weight, asking the athlete to enter it
again creates burden and a competing copy of the same measurement event.

What is missing is a coherent way to collect repeatable home tape measurements, reuse provider body
mass, optionally record appetite context, and display provider body-composition estimates without
promoting noisy observations to recommendation authority.

V1 separates:

```text
measurement → retrospective interpretation → possible future training authority
```

This ADR approves measurement and retrospective interpretation only.

## Evidence boundary

The evidence reviewed supports protocol-controlled anthropometry and low-burden digital appetite
measurement, while requiring conservative treatment of consumer BIA estimates:

- waist/site dependence: https://pubmed.ncbi.nlm.nih.gov/19343017/
- posture/respiration/timing effects: https://pubmed.ncbi.nlm.nih.gov/19165166/
- waist-site reproducibility/non-interchangeability: https://pubmed.ncbi.nlm.nih.gov/12540397/
- digital appetite VAS: https://pubmed.ncbi.nlm.nih.gov/36678176/
- free-living smartphone appetite measurement: https://pubmed.ncbi.nlm.nih.gov/34503591/
- IOC RED-S consensus: https://pubmed.ncbi.nlm.nih.gov/37752011/
- 2026 UCI cycling nutrition/body-composition review: https://pubmed.ncbi.nlm.nih.gov/41911915/
- BIA vs four-compartment systematic review: https://pubmed.ncbi.nlm.nih.gov/41718193/
- BIA vs DXA in athletes: https://pubmed.ncbi.nlm.nih.gov/36853902/
- inter-device BIA variation: https://pubmed.ncbi.nlm.nih.gov/39047869/

Non-waist sites below are **app-defined repeatable home landmarks**, not clinical/ISAK-equivalence
claims. Coverage, repeatability and cadence rules are product-quality semantics, not physiological
thresholds.

The cited appetite research commonly uses VAS instruments. V1 deliberately chooses a simpler 1–10
product rating for low-burden within-person tracking and must not claim numeric equivalence to a
validated 0–100 VAS.

## Decision

### D-BC-SCOPE — observation, not diagnosis

V1 may record/display:

- provider body mass already available through existing ingestion;
- manual body mass only as an explicit fallback/separate measurement;
- protocol-locked home circumference measurements;
- optional hunger context;
- provider body-composition estimates only when an actual provider payload exposes an unambiguous
  metric with known unit and provenance.

V1 does not diagnose energy availability, RED-S, tissue loss/gain, adiposity, hydration status or
any medical condition. It does not prescribe calorie targets or autonomously alter training.

### D-BC-METRICS — explicit landmark and laterality identity

Manual metric vocabulary:

```text
body_mass_kg                 # fallback/manual source
waist_minimum_cm
abdomen_umbilicus_cm
hips_max_cm
chest_nipple_line_cm
upper_arm_relaxed_mid_cm
forearm_max_cm
thigh_mid_cm
calf_max_cm
```

Limb series additionally carry `laterality = left | right | unspecified`. Left/right observations
are never silently merged. User-facing labels use **abdomen at navel** instead of “stomach” and
**relaxed upper arm** instead of “biceps”. Historical data retains its original protocol identity.

### D-BC-CADENCE — prioritize practical routine measurements

Suggested guidance, not completion requirements:

- core weekly: waist minimum, abdomen at navel, hips;
- useful weekly/fortnightly: fixed-site thigh;
- optional weekly/fortnightly: chest, relaxed upper arm;
- optional fortnightly: forearm, calf.

A baseline may record both limb sides. Ongoing tracking may use one fixed side or both, but the UI
must preserve laterality and never silently switch series.

### D-BC-PERSIST — manual measurements are user-owned

Manual sessions persist at:

```text
users/{userId}/anthropometry_entries/{entryId}
```

One entry represents one measurement session; multiple sessions may exist on the same local date.
Conceptual fields include user/entry identity, Europe/Warsaw logical date, `observedAt`, protocol
reference, measurement context, metric/laterality/unit, retained readings, deterministic summary,
repeatability warning, schema version, current-record revision and created/updated timestamps.

`revision` protects the current mutable record from stale corrections; v1 does not imply an
immutable revision archive. Firestore rules must enforce owner isolation, bounded keys/arrays/enums,
broad corruption bounds and immutable identity fields.

### D-BC-PROTOCOL — home measurement is protocol-versioned

`home_anthropometry@1` teaches/records the preferred context:

- morning when practical;
- after toilet/voiding;
- before food/drink;
- before training;
- same landmark/posture each time;
- relaxed protocol-defined respiratory state for trunk measurements;
- horizontal snug tape without compressing tissue.

Circumferences request two readings; when the pair exceeds a versioned quality tolerance the UI
requests a third. The retained value is the deterministic median. The tolerance is a measurement-
quality heuristic, not a physiological threshold. Manual body mass, when used, stores one reading.

### D-BC-WEIGHT — provider-first body mass with manual fallback

When a usable provider body-mass series exists, it is the default body-mass source and the athlete
should not be asked to re-enter the same weight manually.

Manual `body_mass_kg` remains available for athletes without connected weight or for an explicitly
separate observation.

Provider and manual values remain separate sources: no averaging, no silent splicing and no silent
source switch after explicit user selection. A missing selected source produces insufficient/
unavailable state rather than substitution from another source.

### D-BC-DAILY — one deterministic body-mass point per source/local date

Coverage counts distinct local dates. For manual weight on one date:

1. prefer valid `morning_post_void_pre_intake && !trainingBeforeMeasurement` entries;
2. choose earliest `observedAt` in that preferred set;
3. otherwise choose earliest valid same-day entry and mark non-preferred context;
4. use stable identity only as a final timestamp tie-break.

Provider adapters likewise emit at most one deterministic point per provider/source/local date and
own any provider-specific deduplication policy.

### D-BC-PROVIDER-COMPOSITION — smart-scale composition stays device-estimated telemetry

A connected scale may expose body fat, muscle, water, bone or related values through a provider.
These are not treated as directly measured tissue compartments.

V1 must:

- support only fields actually present in the provider payload;
- preserve exact metric semantics, unit, provider/origin and transport provenance;
- label BIA-derived values as **device/scale estimates**;
- never invent a Xiaomi/vendor metric Garmin does not expose;
- never request manual transcription solely to complete provider composition history;
- never normalize differently named metrics without established semantic equivalence;
- never average composition estimates across devices/providers;
- keep all such values outside recommendation authority.

Existing provider `bodyFatPct` may be shown contextually with provenance, but remains secondary to
measured body mass and repeatable circumference trends.

### D-BC-HUNGER — optional 1–10 context, not readiness authority

Add optional check-in fields:

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

`5` is explanatory copy only and is never prefilled. Values are integer 1–10. A numeric value
requires timing; clearing hunger clears both fields. Legacy check-ins without either field remain
valid.

Hunger is not added to `SubjectiveDimensionKey` or `SubjectiveInput` and is not consumed by
readiness, strain, fatigue, eligibility or ranking. Missing is valid. Prior hunger history remains
hidden before today's initial response under ADR-0020 anti-anchoring. The default retrospective
series uses `morning_pre_breakfast`; `other` remains separate.

### D-BC-TRENDS — transparent, coverage-aware summaries

Body mass:

- one deterministic point per selected source/local date;
- 7-day arithmetic mean only with at least 4 of 7 distinct valid dates;
- adjacent-window absolute/% change only when both windows qualify;
- explicit coverage;
- no interpolation or carry-forward.

Circumferences compare only within the same metric + laterality + protocol revision. Latest-vs-
previous change may be displayed with quality/context visibility; direction never implies tissue
type.

Hunger uses timing-specific 7-day/28-day arithmetic summaries with recorded-day counts. Sparse
history remains insufficient rather than being padded with a neutral value. Copy may report higher/
lower than the recorded pattern but not good/bad fueling status.

### D-BC-NOFAT / D-BC-NOEA — no synthetic physiology

V1 must not:

- calculate body-fat percentage from tape measurements;
- label circumference or scale-estimate changes as muscle/fat gained/lost;
- derive numeric energy availability from incomplete inputs;
- diagnose RED-S or low energy availability;
- use hunger as proof of under-fueling.

### D-BC-DATA — Data owns retrospective display

V1 stays inside the existing **Data** screen:

- provider/manual body mass with explicit source;
- waist/abdomen prominence;
- hips/thigh as useful secondary measurements;
- optional timing-aware hunger trend;
- expandable other circumference history;
- provider composition estimates when actually available, clearly secondary/device-estimated;
- `Log measurements` focused on tape, with manual-weight fallback when needed.

No new top-level navigation destination is introduced.

### D-BC-WKG — optional future context only

A later v1.x enhancement may combine one canonical cycling power value with the selected source-
specific body-mass summary. It must retain both provenances and remain context-only. If canonical
power authority is ambiguous, skip the feature rather than inventing another FTP field.

### D-BC-AUTH — zero recommendation authority in v1

No body-composition, body-mass, circumference or hunger observation may affect readiness/safety,
fatigue, objectives, session eligibility/ranking, dose adjustment or recommendation-audit decision
inputs. Observation-only implementation does not require a `POLICY_VERSION` bump.

Any future decision authority requires a separate accepted activation decision/ADR, prospective
evidence, ADR-0033 claim/alignment ownership, a policy-version bump and replay/simulation evidence.

### D-BC-FAIL — missingness stays missing

```text
measurement/source unavailable
→ preserve missing/unavailable state
→ omit affected trend when coverage is insufficient
→ no carry-forward, neutral fabrication or cross-source substitution
→ recommendation path unchanged
```

### D-BC-PRIVACY — minimize sensitive-data spread

V1 requires strict `users/{userId}/...` ownership, bounded reads, no raw body/hunger values in
analytics/console/error telemetry, no raw-history duplication into recommendation audits, no free-
text body notes by default, explicit correction/deletion, and documented retention/account deletion
before implementation is complete.

### D-BC-MIGRATE — additive migration

Existing users without anthropometry remain valid. Existing check-ins without hunger remain valid.
Provider body-mass/composition history is not copied into manual records. No synthetic historical
hunger/circumference/composition values are created. Logical dates use existing Europe/Warsaw date
helpers. Any check-in schema bump remains backward compatible with supported historical versions.

## Consequences

Positive consequences include avoiding duplicate manual weight entry, preserving provenance,
keeping connected-scale estimates useful but secondary, keeping hunger low-burden and creating a
real evidence corpus without changing recommendations.

Costs include one owner-writable collection, Firestore rules/tests, source-aware composition logic,
and protocol-aware tape UX.

Existing provider ingestion, `health_observation_days`, Testing contracts and recommendation policy
remain unchanged merely by accepting this ADR.

## Explicit non-goals

This ADR does not approve calorie/macro logging, automatic calorie targets, food-photo recognition,
inferred energy availability, RED-S screening/diagnosis, tape-derived body-fat equations,
DEXA/BIA-equivalence claims, automatic training reduction from hunger/weight, mandatory bilateral
measurement, asymmetry correction, new top-level navigation, cross-provider averaging, synthetic
backfill, or reconstruction of provider metrics the provider does not actually expose.

## Acceptance / activation boundary

Accepting this ADR approves **observation and retrospective reporting only**. Implementation may
ship when the linked plan's persistence, security, measurement-integrity, UX, privacy and rollback
requirements are satisfied while remaining recommendation-neutral.

Any transition from “observe/report” to “coach/decide” is a new architecture/evidence decision.
