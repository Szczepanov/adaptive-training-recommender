# Strength recommendation occurrence-credit gap — 2026-09-02

**Status:** analysis / production reproduction
**Related architecture:** ADR-0016 (adaptation credit and weekly coverage), ADR-0023 (version-neutral session execution), ADR-0034 (canonical performed-training occurrence)
**Related PRs:** #321 structured strength execution/logging; #324 canonical multi-source performed-training-occurrence reconciliation

## Executive summary

A real 77-minute strength session performed on 2026-09-01 is visible in Activities as Garmin `strength_training`, and the athlete also recorded sets/reps/RPE/rest in the app. On 2026-09-02 the recommender nevertheless proposes **Reduced Full-body Strength Maintenance** and cites **Weekly Stimulus Target (Full-body Strength)**.

The failure is not that Garmin strength is completely ignored. The current live recommendation history path in `app/src/engine/completedTraining.ts` recognizes a Garmin `strength_training` activity as generic `Strength` and assigns generic inferred strength cost/stimulus. The failure is that this path still reconstructs completed training from two legacy inputs only:

1. raw Garmin activities; and
2. answered `DailyRecommendation.adherence` records.

It does **not** consume `SessionExecution`, legacy app strength logs normalized through `legacyStrengthAdapter.ts`, or the ADR-0034 `PerformedTrainingOccurrence` projection. Consequently, data can be present in the app's History/Activities UI while remaining unavailable to the recommender's weekly-coverage and recency reasoning.

There are therefore two distinct product questions that are currently conflated:

- **Role fulfillment:** did the athlete perform a session with enough semantic identity to satisfy the exact `primary_strength` weekly role?
- **Recent exposure / spacing:** did meaningful strength training occur recently, irrespective of whether its exact catalog identity is known?

The existing exact-role rule is intentional and should be preserved. `EVERGREEN_SESSION_COVERAGE.primary_strength` is fulfilled only by `strength_full_body_maintenance_01` or `strength_bodyweight_full_body_01`; arbitrary generic strength must not silently replace it. But a high-confidence strength occurrence yesterday must still influence spacing and recommendation selection. Otherwise the engine can schedule a duplicate full-body strength exposure simply because exact role credit is unresolved.

The recommended fix is therefore **not** “map every Garmin strength activity to `primary_strength`.” It is to cut recommendation history over to the canonical occurrence model and derive two separate facts from each occurrence:

1. `recent_strength_exposure` (broad, occurrence-level, provenance-aware); and
2. exact weekly-role credit (narrow, semantic-identity-driven).

When app detail exists, app semantics should be authoritative; Garmin should enrich the same occurrence with sensor/timing data. When only sparse Garmin strength exists, the engine should recognize recent strength exposure without fabricating full-body-role completion or strength volume from weak Garmin set metadata.

---

## Production reproduction

### Athlete-observed behavior

**Performed:** 2026-09-01 strength workout, started/logged in the app and also recorded on a Garmin watch.

**Observed on 2026-09-02:** recommender proposes `Reduced Full-body Strength Maintenance` with reasons including:

1. Stable Overnight HRV Signal
2. Weekly Stimulus Target (Full-body Strength)
3. Sleep Architecture

**History:** the session is visible as `strength training`.

### Garmin export supplied for the incident

Relevant fields:

| Field | Value |
|---|---|
| activityId | `24197884873` |
| date | `2026-09-01` |
| type | `strength_training` |
| durationMin | `77` |
| averageHr | `85` |
| trainingEffectAerobic | `0.2` |
| trainingEffectAnaerobic | `0` |
| activityTrainingLoad | `2.90245` |
| intensityTag | `easy` |
| trainingEffectLabel | `UNKNOWN` |
| exerciseSets | 15 active set records |
| syncRunId | `2026-09-02-a86dfbff` |
| syncedAt | `2026-09-02T06:30:20.797802+00:00` |

The Garmin set payload is sparse:

- only two set rows include an `exerciseCategory` (`SQUAT`, `DEADLIFT`);
- only one set row includes a concrete `exerciseName` (`BARBELL_DEADLIFT`);
- many rows have no exercise identity;
- several rows have missing repetition counts;
- recorded durations include repeated 120-second values and very long values (for example ~504 s, ~684 s and ~1567 s), which are not safe to interpret as active lifting time per set.

The athlete also reports that the app itself contains the richer set/repetition/RPE/rest log, entered before #321's structured-strength changes were merged.

### What this evidence safely tells us

The Garmin record provides **strong evidence that a strength exposure occurred** on 2026-09-01 and that it occupied approximately 77 minutes of elapsed activity time.

It does **not** provide sufficiently reliable set-level semantics to infer exact full-body role, exercise volume, hard-set count, tonnage, or a precise strength stimulus dose. Garmin's low aerobic training effect / training load also must not be interpreted as “almost no strength stimulus”; those metrics are not a substitute for resistance-training volume/intensity semantics.

The richer app-side log is the preferred source for exercises, sets, reps, load, RPE/rest, and any recoverable prescription identity.

---

## Expected behavior

For this incident, the system should reach one of two safe outcomes depending on what can be recovered from the app record.

### If the app record can be linked to the prescribed/full-body session

- App log + Garmin activity reconcile to **one** `PerformedTrainingOccurrence`.
- The occurrence receives exact `primary_strength` weekly-role credit **once**.
- A `recent_strength_exposure` fact is also emitted.
- The 2026-09-02 recommender should not propose another full-body strength session merely because it believes the weekly strength role is missing.
- Garmin HR/timing/device information enriches the occurrence; it does not duplicate load or adaptation credit.

### If exact app workout identity cannot be recovered

- App log + Garmin activity still reconcile to **one** occurrence when matching evidence is sufficient.
- The occurrence is recognized as recent strength training.
- No fabricated exact `primary_strength` completion is granted merely from `type=strength_training`.
- The next-day recommender applies strength-spacing/recovery logic and should strongly down-rank or suppress another full-body strength exposure unless there is an explicit policy reason to override that spacing.
- Weekly role can remain technically unfulfilled/uncertain, but that uncertainty must not be converted into a harmful “do full-body strength again today” default.

---

## Current architecture trace

### 1. Structured execution and legacy strength detail exist outside the live recommender history path

`app/src/services/sessionExecutionService.ts` persists and reads normalized `SessionExecution` plus entries.

`app/src/sessions/legacyStrengthAdapter.ts` already provides a permanent pure read adapter:

`adaptStrengthSessionToNormalizedExecution(session)`

It converts ADR-0021 `StrengthSession` v1 records into a version-neutral execution + entries representation, preserving:

- date/start/completion timestamps;
- state;
- session RPE;
- notes;
- exercise references/free text;
- per-set reps;
- weight;
- warm-up status;
- gauge/RPE-like set metadata where present.

This is exactly the kind of data needed to avoid relying on sparse Garmin exercise sets.

However, the adapter deliberately does not invent missing provenance. Its generated session source is generic `legacy_strength`; therefore it cannot, by itself, prove that an arbitrary legacy session was the exact catalog workout `strength_full_body_maintenance_01`.

### 2. ADR-0034 already establishes the canonical physical-workout identity

`app/src/training-occurrence/models.ts` defines `PerformedTrainingOccurrence` as the provider-neutral projection/linkage record for **one physical workout actually performed**.

A canonical occurrence can link:

- one structured execution source; and
- zero or more provider activities.

`projectionBuilder.ts` explicitly gives structured execution precedence for identity/semantic summary when present.

`activitiesReadModelService.ts` already hydrates canonical occurrences for Activities:

- structured execution + definition + entries provide structured semantics;
- Garmin provides provider telemetry;
- Garmin exercise sets are explicitly marked diagnostic-only when a structured source exists.

This is the correct architectural direction for the recommendation system too.

### 3. The live recommendation history path still performs a second reconciliation

`app/src/engine/completedTraining.ts` contains `reconcileCompletedTrainingEvents(...)`.

Its own comment accurately describes the current contract:

> Reconciles Garmin activities with answered adherence records into one real-world training event per session.

Matching is still heuristic:

- same recommendation/activity local date;
- same inferred modality;
- event has not already consumed adherence;
- duration difference <= `ADHERENCE_DURATION_TOLERANCE_MIN`, currently 20 minutes;
- closest duration wins.

That function does not receive canonical occurrences or `SessionExecution` records. Therefore a session started/logged in the app through the newer execution model can be absent from recommendation history even while it is visible through another read model.

### 4. Generic Garmin strength and exact weekly coverage are deliberately different

`modalityFromActivityType()` maps Garmin types containing `strength`, `weight`, or `lift` to `Strength`, so this incident's Garmin activity is not “unknown.” It receives a generic strength cost/stimulus profile.

But `app/src/workouts/event-plan.ts` defines evergreen `primary_strength` as an **exact workout-role mapping**:

- `strength_full_body_maintenance_01`
- `strength_bodyweight_full_body_01`

The notes explicitly state that this is an exact full-body resistance exposure. `compact_strength` is also explicitly forbidden from silently replacing the required full-body role.

This exactness is a good invariant. The defect is that generic recent strength exposure currently has no separate authority in recommendation spacing/selection.

---

## Root-cause chain

1. The athlete performs one physical strength session.
2. App-side strength detail is stored in a session/legacy strength model.
3. Garmin later syncs a `strength_training` activity for the same physical workout.
4. ADR-0034 can represent these as one canonical occurrence, and Activities is moving to that read model.
5. Recommendation history still reads raw Garmin + answered `DailyRecommendation.adherence` instead of the occurrence projection.
6. If the app session is not represented as the expected adherence record, recommendation history sees only a generic Garmin Strength event.
7. Generic Garmin Strength cannot satisfy the exact `primary_strength` coverage role.
8. The weekly-role planner concludes that full-body strength coverage is missing.
9. No independent canonical “strength happened yesterday” spacing fact blocks or down-ranks a next-day full-body prescription.
10. Healthy HRV/sleep then make the otherwise-eligible strength candidate look attractive, producing the observed recommendation.

This is a **read-model authority split**, not merely a Garmin set-parsing defect.

---

## Failure matrix

| Performed evidence | Current risk | Required behavior |
|---|---|---|
| DailyRecommendation adherence + matching Garmin | Legacy path can merge; closest to intended behavior | One occurrence; one dose/credit |
| Structured `SessionExecution` + matching Garmin | Activities/canonical layer can know both; live recommendation history may not | Recommender reads canonical occurrence |
| Legacy app strength log + matching Garmin | Rich app semantics can exist but be invisible to live recommendation history | Normalize legacy log, reconcile once, consume canonical facts |
| Garmin-only sparse strength | Generic Strength recognized, exact role unresolved | Recent-strength spacing yes; exact `primary_strength` no |
| Structured strength after #321 + Garmin | New execution detail exists; #321 explicitly did not change recommendation stimulus credit | Canonical occurrence becomes recommendation authority |
| Two real same-day strength sessions | Duration/date heuristic can be fragile | Preserve two occurrences unless source linkage actually supports merge |
| Late Garmin sync after recommendation calculation | Recommendation can remain stale | Invalidate/recompute affected daily facts/recommendation |

---

## Why “just trust Garmin sets” is the wrong fix

The incident payload itself demonstrates why.

The 15 Garmin rows do not reliably encode 15 conventional working sets. Exercise identity is mostly missing and elapsed durations are inconsistent with a normal per-set active-duration interpretation. If we translated these fields directly into hard-set count, exercise-region coverage, or volume, the engine could create false certainty.

Recommended evidence policy:

| Fact | Preferred source | Garmin-only fallback |
|---|---|---|
| physical strength occurrence happened | canonical occurrence with any trustworthy source | `type=strength_training` is sufficient |
| exact prescribed workout identity | structured/app prescription link | no fabrication |
| exercises / sets / reps / load | structured/app entries | diagnostic only unless separately validated |
| session RPE / rest log | structured/app | absent unless explicitly available |
| elapsed timing / HR / device telemetry | Garmin/provider | authoritative/enriching where valid |
| exact weekly `primary_strength` role | known workout identity or explicit semantic classifier with audited confidence | no blanket generic-strength mapping |
| recent strength spacing | canonical occurrence modality + completion state | yes |

---

## Proposed domain facts

The recommendation engine should stop forcing one boolean to answer both “coverage” and “recent load.”

### A. Broad exposure fact

Conceptual shape:

```ts
interface RecentStrengthExposureFact {
  performedOccurrenceId: string;
  localDate: string;
  endedAt?: string;
  confidence: 'exact' | 'high' | 'inferred';
  provenance: Array<'structured_execution' | 'legacy_strength' | 'garmin'>;
  completed: boolean;
}
```

This fact answers **when strength last happened**. A Garmin-only `strength_training` occurrence can legitimately produce it.

### B. Exact role-credit fact

Conceptual shape:

```ts
interface WeeklyRoleCreditFact {
  performedOccurrenceId: string;
  coverageKey: PlanCoverageKey;
  workoutId?: string;
  credit: 'exact' | 'semantic_confident' | 'none';
  reason: string;
  provenance: string[];
}
```

Initial rollout should remain conservative: exact known workout identity earns exact role credit; generic Garmin modality does not.

A later semantic classifier could grant role credit from sufficiently complete app-side exercise detail, but only under an explicit policy/ADR with tests and provenance. That is not necessary to fix next-day duplicate scheduling.

---

## Legacy strength records from before #321

The incident is particularly important because it crossed a migration boundary: the session was logged before today's structured-strength merge.

The repository already has `adaptStrengthSessionToNormalizedExecution()`. The implementation should reuse it rather than create a third strength-session representation.

However, the adapter's generic `legacy_strength` source means migration logic must distinguish:

1. **what definitely happened** — the detailed strength execution; from
2. **which catalog/prescribed identity it represented** — recover only when a durable link such as `sourceRecommendationDate`, recommendation/workout metadata, occurrence linkage, or another explicit mapping is available.

If exact identity is absent, preserve uncertainty. The session still protects spacing.

---

## Late-arrival and staleness risk

The supplied Garmin activity was synced at `2026-09-02T06:30:20Z`, after the performed local date of 2026-09-01. Depending on when the morning recommendation was materialized, this may be a second independent failure mode:

- recommendation snapshot calculated before Garmin sync;
- canonical occurrence is later created/enriched;
- recommendation cache/facts are not invalidated;
- UI keeps showing a now-stale recommendation.

The cutover therefore needs an explicit invalidation contract. Any completed-occurrence creation, source attachment, merge, unlink, material semantic edit, or relevant late provider sync within the active lookback/current-decision horizon must invalidate/recompute affected recommendation facts.

The canonical occurrence's athlete-local performed time/date, not provider sync date, must drive weekly windows and spacing.

---

## Invariants that must not regress

1. **One physical workout -> one adaptation/recovery dose.** App + Garmin must never double-count.
2. **Source semantics have field-level precedence.** App/structured data owns intent/exercises/sets/RPE; Garmin enriches telemetry.
3. **Generic strength does not silently become exact `primary_strength`.** Preserve ADR-0016/event-plan semantics.
4. **Recent strength still affects spacing even when role identity is unresolved.** This is the missing behavior in the incident.
5. **Garmin cardio-oriented load metrics do not erase a resistance-training exposure.** Low TE/load is not evidence that no meaningful strength session occurred.
6. **Sparse Garmin set rows are diagnostic, not authoritative strength volume.** Existing Activities policy already points this way.
7. **Late sync changes current facts.** Recommendation state cannot remain indefinitely stale after new performed-training evidence arrives.
8. **Same-day doubles remain representable.** Avoid reverting to date-only identity.
9. **Manual reconciliation decisions stay sticky.** Recommender consumes canonical linkage; it does not invent another matcher.
10. **Historical pre-#321 app logs remain usable.** Reuse the legacy adapter/read-through path.

---

## Observability requirements

For every recommendation reason involving weekly coverage or recency, debug/telemetry should make the evidence legible:

- `performedOccurrenceId`;
- attached source kinds and stable source IDs;
- local performed date/time;
- canonical modality;
- exact workout identity if known;
- coverage role credited/not credited;
- reason for no credit;
- recent-exposure fact and age;
- confidence/provenance;
- recommendation invalidation/recompute version or occurrence watermark.

A future support/debug view should be able to answer, for this incident:

> “We saw one strength occurrence yesterday from app + Garmin. It counts as recent strength. It [does/does not] satisfy `primary_strength` because … . Therefore today’s full-body candidate was [suppressed/eligible] because … .”

---

## Recommended decision

Proceed with a staged recommendation cutover to ADR-0034 rather than patching `completedTraining.ts` with another special-case match.

1. Introduce a canonical occurrence -> recommendation-facts adapter.
2. Use canonical broad exposure facts for recency/spacing first.
3. Use structured/app semantic identity for exact weekly-role credit.
4. Include legacy strength records via the existing normalized adapter/read-through.
5. Add late-arrival invalidation/recomputation.
6. Run dual-read parity diagnostics against the old completed-training path.
7. Remove the raw Garmin + adherence reconciliation path after parity gates pass.

This fixes the reported next-day duplicate-strength behavior while preserving the planner's deliberate distinction between “some resistance training happened” and “the exact required full-body role was fulfilled.”
