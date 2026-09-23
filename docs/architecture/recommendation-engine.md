# Recommendation Engine Architecture

How `app/src/engine/` turns a morning's data into a prescribed session.

> **Accuracy note.** Rewritten 2026-08-08 against the engine as it actually is. The
> previous version described a `REST / RECOVERY / AEROBIC_BASE / QUALITY_STRENGTH` mode
> hierarchy with fixed thresholds ("HRV drop > 10%", "sleep score < 65") that the code has
> not used for some time, and omitted every module added by ADR-0006 onward.
> Keep this file updated with the code — a confidently wrong architecture doc is worse
> than none (finding F13).

---

## Two selection paths

A template can reach the athlete through **two distinct selection paths with different
filtering rules** (distinct, not independent — Path B runs Path A internally for mode and
envelopes, so the readiness computation is shared; only the *selection* differs). Any change here must be evaluated against both.

### Path A — readiness only (`evaluateTraining`)

```text
readiness → mode (train | modify | recover) → category allow-list → date-hash pick
```

Pure and synchronous. No history, no events, no periodization. Still reachable directly
via `evaluateNextDayPlan`, and it computes the mode and safety envelopes that Path B
depends on.

Phase-gated templates (`phaseEligibility`) are excluded from Path A entirely — it holds no
`PeriodizationResult`, so it cannot evaluate them at all.

### Path B — intent-aware (`evaluateTrainingWithIntent`, `generateWeekAheadPlan`)

```text
ENRICHED_TEMPLATES → eligibility → envelope + mode ceilings → phase eligibility
                   → rankCandidates → top pick
```

Asynchronous; resolves training intent from completed/adherence history first. Path B consumes `evaluateReadinessAndSafetyEnvelope` to obtain `mode`, `envelopes`, and `telemetry` directly, sharing the exact readiness calculation with Path A without running a discarded template selection (F9 resolved under ADR-0012).

### Not a third selection path — adjudication (`externalSession.ts`, ADR-0019)

`externally_planned` mode adds a second *entry point*, not a third selection path. The
plan's author has already selected; the engine only adjudicates:

```text
placed imported session → GateableSession → same clinical/feasibility/ceiling/dose ladder
                        → proceed | scale | defer | skip | advisory
```

Nothing is ranked, and `Recommendation.decisionTrace.candidateScores` is empty by
construction. The authority ordering below is unchanged and gains no step — an imported
session clears exactly the gates a catalog template clears, through the same
`evaluateTemplateEligibility` and `resolveExecutionDose` calls, because
`eligibility.ts` was widened to `GateableSession` rather than given a parallel path
(D-CANDIDATE).

Two short-circuits sit above the ladder: an `isEvent` session is always `advisory`
(D-EVENT), and a `reducible: false` session defers instead of scaling (D-IRREDUCIBLE).

`externalCritique.ts` reviews the placed week using the *selection* modules
(`microcycle.ts`, `planner.ts`, `optimizer.ts`) and emits advisory findings only. It
cannot import `externalSession.ts`, and `externalArchitecture.test.ts` enforces both that
boundary and the absence of any runtime import from `optimizer.ts`/`planner.ts` into
adjudication.

### Authored occurrence authority (`authoredSessionGates.ts`, ADR-0023)

An active `replace_recommendation` occurrence is resolved at the `Home.tsx` composition
boundary for its Warsaw-local date. Its pinned manual definition is hash-verified, then
adjudicated through `evaluateTemplateEligibility`, readiness envelopes, the plan-tier
ceiling, and injury/category restrictions. An approved or scaled form is saved as a new,
content-addressed `ExecutionPrescription`, whose hash also covers its exact source reference;
the recommendation and audit retain the source reference, occurrence ID, and prescription
hash. Replay verifies the saved occurrence date, authority, and manual definition revision
before accepting that binding. The primary's audit records
`authoredOccurrence` and has no catalog candidate scores, so replay proves an adjudicated
authority decision rather than pretending the catalog ranked it.

`additional_session` occurrences are independently hash-verified and adjudicated in stable
placement order. Each accepted item consumes the remaining same-day minutes and systemic
cost ceiling before the next is considered; rejected or unresolvable items remain inert and
are reported in the rationale. Authored definitions still lack modeled equipment and
environment requirements, so their source-neutral v1 schema cannot yet express more than
the common gates; no inferred requirements are used.

The placement in `Home.tsx` is a temporary composition seam, not a second planner. It uses
the normal engine result only to obtain current readiness/availability inputs and safe
fallback; moving date-scoped occurrence resolution into `planningMode.ts` remains the
follow-up needed to fully realize ADR-0023's single planning-authority design.

---

## Planning authority and coverage sets (`planningMode.ts`, `evergreenPlanning.ts`)

`resolvePlanningContext` is the single authority for planning mode. A persisted
`TrainingIntentProfile` supplies the athlete-owned mode, ordered priorities, and weekly
minimum/typical/maximum session commitment; `UserPreferences` remains the owner of
weekday/weekend duration and hard unavailable modalities.

`externally_planned` is effective only when the athlete selected it **and** a session is
actually placed on the date. Choosing the mode does not by itself suspend the engine: an
unplanned day resolves to `evergreen` with `externalFallback: true`, which the caller must
label rather than present as an ordinary pick (ADR-0019 D-EXT).

An eligible event remains event-directed for profile-less athletes, preserving the legacy
path. An explicit `event_directed` profile uses an eligible event when present. Otherwise
the effective mode is `evergreen`: it has no focus event and no event strategy, even if an
event record exists. Event-directed cycling uses `structured_plan`; Running, triathlon, strength, and general events retain demand-derived planning. Running race-specific objectives are modality-scoped and half-marathon/marathon demand adds a long-run durability objective; the generic single-sport aerobic-base objective intentionally remains cross-training-creditable. Triathlon demand creates separate swim, bike, and run aerobic objectives so one discipline cannot silently satisfy the whole sport. Outdoor cycling and swimming are hard-gated by declared bicycle/swim access.

For evergreen mode, `resolveEvergreenPlan` combines bounded completed history with the
profile and real schedule availability. `resolveEvidenceBackedStrategy` establishes dose
requirements before `resolveTrainingCapacity` and `packWeeklyDose` map them to exact
workout identities. When acute adverse recovery is detected (`isSevereAdverseRecoveryReadiness`),
the conditional high-intensity prior (`canUseConditionalPrior`) is withheld, emitting a typed
`conditional_prior_withheld` policy warning and preventing quality dose escalation during autonomic collapse.
The legacy 2-to-6-session table is only an equal-dose placement
tie-breaker; it does not set a physiological requirement or hide a capacity shortfall.

Event-free `health` planning also resolves `healthPlanningPolicy.ts`
`resolveHealthPlanningPolicy` from the current intent and preferences. Explicit Running
support means Running is preferred and is neither deprioritized nor avoided. Without that
support, the unified optimizer gives feasible Walking/Cycling easy-aerobic candidates a
soft ranking prior. When the profile also has no explicit endurance,
speed/power, or sport-readiness priority, it withholds Hard Endurance as generic quality
filler; explicit performance priorities retain their high-intensity authority. Non-hard
Running and preferred Moderate Endurance remain available. Quality Endurance is
limited to one prior occurrence in a rolling seven-day window and is withheld from the
projected horizon after adverse recovery;
the next fresh planning check may re-enable it. This is an adherence-oriented product
heuristic, not a clinical intensity prescription. It does not apply to event-directed
plans, explicit Running support as defined above, or the required health aerobic/strength dose roles.

The coverage registry has two descriptors. `september_cycling_event` is the frozen,
event-directed cycling contract. `evergreen_general` is a rolling seven-day `general`
descriptor with modality-specific exact identities, including a continuous easy run that
is distinct from walk-run. `buildCoverageState` receives the descriptor from the active
plan, so the coverage tier is meaningful for eventless athletes too.

Authored travel blocks scale planned dose through `applyPlanningOverlays` across
structured, demand-derived, and evergreen paths. Fixed activities retain schedule
ownership and constrain availability before candidates are selected.

---

## Module map

```text
                    DailyRecoverySnapshot + DailySubjectiveCheckin
                                      │
                    adapters.ts  ─────┴─────  validation.ts
                                      │
                                 DailyReadiness
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
   rules.ts                    trainingIntent.ts              eligibility.ts
   mode + envelopes            resolves plan-side intent      hard gates
   + strain telemetry                 │                       (time, equipment,
        │                    ┌────────┼────────┐               environment,
        │                    ▼        ▼        ▼               guardrails)
        │            periodization  microcycle  fatigue
        │            phase/focus    objectives  6D decay
        │                    └────────┼────────┘
        │                             ▼
        │                       optimizer.ts
        │                    benefit / (1 + cost) × modifiers
        └─────────────────────────────┼─────────────────────────────┐
                                      ▼                             ▼
                                   dose.ts                     planner.ts
                             execution dose ceiling        7-day projection
                                      │                             │
                                      ▼                             │
                            workouts/prescription.ts ◄──────────────┘
                                      │
                              provenance.ts → RecommendationAudit
```

| Module | Responsibility |
|---|---|
| `adapters.ts` | Firestore canonical models → engine inputs; provides `createSubjectiveOnlyObjectiveInput()` for wearable-free operation |
| `validation.ts` | Schema validation and sanitisation at the persistence boundary |
| `eligibility.ts` | The single hard-gate resolver: time, equipment, environment, guardrails |
| `rules.ts` | Strain scoring, `train`/`modify`/`recover` mode, safety & plan envelopes, adjustment tiers |
| `periodization.ts` | Event lifecycle, focus-event resolution, continuous phase weights |
| `microcycle.ts` | Weekly objectives and the authoritative fractional objective-credit ledger |
| `stimulus.ts` | Stimulus-boundary validation and objective-specific credit derivation |
| `fatigue.ts` | Six-dimensional fatigue with exponential decay and unsaturated external-load depth |
| `optimizer.ts` | Candidate ranking: objective benefit vs cost, plus named timing/preference modifiers |
| `trainingIntent.ts` | Composes periodization + objectives + fatigue + planned dose |
| `dose.ts` | Validates and intersects planned dose with the clinical ceiling and athlete adjustment |
| `planner.ts` / `weeklyAllocation.ts` | Rolling 7-day projection, projected-credit ledger, exact-role reservation evidence and weekly anchor preferences |
| `provenance.ts` / `replay.ts` | Audit construction and current-policy verification; historical policies are audit-only |
| `sequenceIntent.ts` | Derives phase-specific, bounded ranking multipliers for spacing, density, recovery, and long sessions from canonical `PhaseWeights`; never overrides hard gates or exact-role coverage |
| `occupationalLoad.ts` | Separates optional adapted occupational baseline from daily acute work using confidence and load-area overlap, and reports physical-work/activity-adjusted-ambient-step overlap |

### Wearable-free composition boundary

`mapSnapshotToEngineInput(null)` supplies unavailable wearable telemetry and therefore adds
no wearable-derived strain. This adapter behavior does not by itself authorize planning.
`Home.tsx` and `PlanView.tsx` first require a complete minimum safety check-in and either a
usable recovery snapshot or a Garmin state canonically confirmed as disconnected through
ADR-0029. A connected account with a missing snapshot is directed to sync; an unknown
connection state fails closed. Training history, clinical/injury restrictions, equipment,
availability, post-recovery buffering, and the normal planner remain unchanged.

### Anthropometry and fueling observation boundary (ADR-0039 / ADR-0040)

`app/src/anthropometry/` (protocol-versioned home tape measurements, body-mass source
reduction/trends) and the check-in's optional `hunger1To10`/`hungerTiming` fields are
observation-only per D-BC-AUTH: `engineIsolation.test.ts` asserts zero imports of
`app/src/anthropometry/` from `app/src/engine/`, `hungerRecommendationInvariance.test.ts`
asserts identical recommendation output across every hunger value/timing/absence, and
`mapCheckinToSubjectiveInput` never reads the hunger fields. Neither signal reaches
`SubjectiveInput`, readiness, fatigue, safety envelopes, candidate ranking or
`RecommendationAudit`, and no raw measurement/hunger value is written to analytics, console
telemetry or error reports. `POLICY_VERSION` is unaffected (verified by
`scripts/check-policy-drift.mjs`).

Storage is `users/{userId}/anthropometry_entries/{entryId}`, owner-scoped exactly like every
other `users/{uid}/...` collection, with corrections tracked by a monotonic `revision` rather
than duplicate documents. Per ADR-0040, the Firestore client can read its owner-scoped rows but
cannot mutate them directly: a token-verified, server-authoritative API validates/canonicalizes
the full protocol and owns create/correct/delete transactions. Retention/export/deletion follows
the same account-deletion path as
every other `users/{uid}/...` document (see
[`physiological-identity-passport.md`](./physiological-identity-passport.md)'s equivalent
note) — no separate retention policy exists yet and should be revisited before this data grows
large enough to matter. `migrate_user_data.py`'s generic subcollection walk covers this
collection without code changes.

---

## Mode selection (`rules.ts`)

Three modes, not four: **`train`**, **`modify`**, **`recover`**.

> "Separates acute deviation from longer-term adverse trend for decision support; it does
> not diagnose non-functional overreaching or overtraining syndrome."

Objective strain is a continuous, **self-normalised** score — not fixed absolute
thresholds. Each of HRV, RHR, sleep score, and respiration rate contributes two z-scored terms:

* **acute** — today vs this person's own trailing 7-day baseline
* **chronic** — the 7-day baseline's drift from the 28-day baseline, weighted ×1.5,
  because a multi-day trend predicts overreaching better than one noisy night

Normalisation uses the athlete's own trailing 28-day stdev/MAD, floored (HRV 3 ms, RHR
1.5 bpm, sleep 4 pts, respiration 1.0 br/min MAD) so a flat metric cannot produce an explosive z-score. Each metric's
contribution is capped at ±2.0 so one outlier cannot dominate.

```text
strain = Σ metric(acute + 1.5 × chronic) × weight     HRV 0.5, RHR 0.3, sleep 0.2, respiration 0.3
       + sleepFloorPenalty          sleep score < 50           → +0.5
       + bodyBatteryDeficit         ramps 50 → 25              → up to +0.3
       + recentHardSessions         ≥2 hard in 3 days          → +1.0
       + conservativeBias           athlete preference         → +0.4
```

| Mode | Trigger | Candidate ceiling |
|---|---|---|
| `recover` | strain ≥ 2.2, fatigue score > 7, pain, body battery ≤ 20, or already trained today | `Rest` / `Mobility/Recovery` |
| `modify` | strain ≥ 1.0, fatigue score > 5, or soreness > 6 | `systemicCost <= 0.5` |
| `train` | otherwise | category allow-list (Path A) or plan-tier ceiling (Path B) |

`modify` caps by **systemic cost**, not by category — so upper-body strength (cost 0.3)
remains available on a day when legs and intervals are not.

Two overrides sit on top: a **post-recover buffer** softens a fresh `train` to `modify` the
day after a mandated recovery day, and an **already-trained-today** override forces
`recover` regardless of how green the numbers look.

---

## Objective credit and stimulus authority (`stimulus.ts`, `microcycle.ts`)

Phase 4 uses one fractional objective-credit model. `deriveObjectiveCredit` validates an
untrusted/persisted stimulus profile once at the boundary, while internal fan-out uses
`deriveObjectiveCreditFromProfile` on already canonical profiles. The canonical profile has
eight `0..1` axes; legacy `aerobicCapacity`, `thresholdDevelopment`, and
`surgeRepeatability` are accepted only as persistence-boundary renames. A supplied
non-finite or out-of-range known axis makes the record `DataState.INVALID`.

`WeeklyObjective.completedCredit` is completed-evidence authority. For endurance/power
objectives, credit is scaled by measured completed/planned duration when both are available,
and an independently supplied completion ratio scales separately. Strength maintenance does
not treat elapsed duration as a proxy for useful sets/load.

`completedExposures` is compatibility display state only. Both completed and projected
paths derive it through the same `0.5 credit/exposure` compatibility projection; it does
not resolve objectives when fractional credit says they are still outstanding.

Keyword matching remains a last-resort compatibility path for old/external records without
structured stimulus. A match contributes `0.5` credit to the **same** ledger rather than a
parallel counter, making mixed structured/legacy replay order-independent.

### Evidence hierarchy for completed training (Phase 5.5, `completedTraining.ts`)

Generalises the coarse modality x intensity inference above into a named, ordered
`EvidenceTier` (strongest to weakest): `exactPrescribedMatch` (adherence confirms a
catalog template with an authored `stimulusProfile`) → `completedStructuredWorkout` /
`measuredEffort` (Garmin `activityTrainingLoad` alongside Training Effect -- the closest
currently-ingested proxy for "completedStructuredWorkout" and per-interval
power/HR/cadence structure, which nothing ingests yet) → `garminTrainingEffect` →
`durationIntensity` (an intensity tag alone) → `athleteClassification` (modality guessed
from free text) → `genericModalityFallback` (nothing known at all).
`classifyGarminTier`/`stimulusConfidenceForTier` produce `CompletedExposure`'s existing
`stimulusConfidence` ('exact' | 'inferred' | 'unknown') from this ladder, replacing what
used to be an ad hoc `exactTemplateMatch`/`hasStimulus`/`modality` check.

`stimulus.ts`'s `CONFIDENCE_CREDIT_WEIGHT` (exact 1.0, inferred 0.75, unknown 0.4) then
discounts `deriveObjectiveCreditFromProfile`'s earned credit by that confidence -- every
caller that doesn't pass a confidence defaults to `'exact'` (unchanged full-credit
behavior, e.g. `planner.ts` scoring an authored candidate template). This closes the
asymmetry the plan named: `DEFAULT_STIMULUS_BY_MODALITY.Unknown` used to be all-zero even
though `DEFAULT_COST_BY_MODALITY.Unknown` was not, so an unplanned, unclassifiable session
was charged fatigue but credited no adaptation at all. It now carries a real, deliberately
conservative generic profile, discounted rather than zeroed.

A stimulus profile no longer requires a *known* modality to be creditable --
`genericModalityFallback` still credits a modality-agnostic objective. This is safe only
because `deriveObjectiveCreditFromProfile` now **fails closed**: a modality- or
category-scoped objective is rejected (not silently skipped) when the evidence's
modality/category is unknown, rather than the previous behavior where an absent
`context.modality`/`context.category` bypassed the restriction entirely.

### Manual strength history (default-off)

`strength_sessions` is wired as the third `TrainingHistorySnapshot` source behind
`ManualTrainingPolicy`. Production explicitly uses `off`: no strength-history query is
issued, `sourceStates.manualTraining` remains `MISSING`, and the history revision retains
its pre-strength shape. This operational isolation matters because an unused Firestore
read must not make ordinary planning fail.

The explicit `included` path is measurement-only until strength plan S3.3 records a ship
decision. It reads `[throughDateExclusive - windowDays, throughDateExclusive)`, fails
closed on any invalid/unavailable record, derives completed/abandoned set logs through
`strengthExposure.ts`, and includes session IDs plus update times in the immutable source
revision. A manual log linked to a recommendation uses the same occurrence key as
Garmin/adherence reconciliation, so one physical session is replayed once. Enabling this
path would change decisions and therefore requires the D-STRCOST evidence, a policy-version
bump, deliberate simulation-baseline review, and historical replay verification.

---

## Planned and execution dose authority (`trainingIntent.ts`, `dose.ts`)

`PlannedDose` has independent `{ volume, intensity }` components. The persisted audit
contract is finite `volume ∈ [0,1]`, `intensity ∈ [0,1.2]`.

* **Explicit-plan mode:** the active authored `PlanBlock` owns both dimensions, bounded only
  by that persisted contract. Generic days-to-event phase scaling cannot overwrite an
  authored travel/taper dose.
* **Generic mode:** objective urgency shapes volume while periodization supplies intensity.
* **Optimizer:** a hard candidate is inadmissible below planned intensity `0.8`; intensity
  is not a disguised duration multiplier.
* **Execution:** `resolveExecutionDose` fails closed on invalid/out-of-contract planned
  dose, applies an athlete easier/harder adjustment to volume, and intersects volume with
  the independent clinical/readiness ceiling.

Recommendation provenance persists both planned and execution dose when available.

### Authored travel overlays

Travel is an explicit, user-owned `AuthoredPlanBlock`, persisted at
`users/{userId}/plan_blocks/{blockId}`. `planBlockService.ts` validates the date range and
the independent `0..1` volume/intensity scales on both reads and writes; `firestore.rules`
enforces the same owner-scoped shape. `Home.tsx` supplies available blocks to today's,
tomorrow's, and week-ahead Path B calls. An active travel block takes precedence over its
overlapping derived event block, so it owns both its planned dose and its exactly declared
weekly objectives (aerobic volume plus maintenance strength); it is never inferred from an
event title, venue, or fixed activity.

Travel dose scaling only ever *reduces* what an otherwise-eligible candidate pool offers —
it does not itself guarantee that pool is non-empty. Before `end_easy_05`, every
`Easy`/`Moderate`/`Hard Endurance` candidate in `templates.ts` required `indoor_bike`,
`outdoor_bike`, or `swim_access` equipment, or (Running/Walking) was hard-tagged
`environment: 'outdoor'`; a travel day with no bike/treadmill access and an indoor-only
environment override excluded all of them on hard constraints, leaving only
`Rest`/`Mobility/Recovery` candidates regardless of dose scaling (issue #677).
`end_easy_05` ("Equipment-Free Aerobic Circuit", `Cross Training` modality,
`requiredEquipment: []`, `environment: 'either'`) closes that gap with a genuinely
zero-equipment, RPE-based bodyweight cardio option — it does not fabricate access to
cycling, weights, or a hotel gym the athlete does not have.

### Taper as an explicit contract (Phase 5.7, `microcycle.ts`, `periodization.ts`, `planSchedule.ts`)

Before this, `taperActive`/`volumeScale` reduced volume, but nothing represented "preserve
useful, event-specific intensity" as its own thing -- `generateWeeklyObjectives` simply
stopped generating a `race_specific_endurance` objective for the whole taper window
(`!phaseWeights.taperActive`), so whatever survived `phaseEligibility.requiresTaper`
gating and utility ranking was accidental, not requested. `event-plan.ts`'s
`taper_sharpening`/`race_week_strength` coverage roles already named the real intent;
nothing consumed them as objective targets.

Both `generateWeeklyObjectives` branches (generic days-to-event and plan-derived) now
generate a taper-calibrated `race_specific_endurance` objective during `taperActive`
instead of omitting it, and lower the `strength_maintenance` target to a race-week-primer
level -- calibrated against `end_taper_sharpen_01`'s own (deliberately lower) stimulus
profile in `templates.ts`, not the full peak-block `end_race_sim_01` bar, which a taper
session structurally cannot clear. `PlanObjectiveDefinition` (`planSchedule.ts`) gained an
optional `role: PlanSessionRole` field -- previously declared but never assigned to
anything -- and the authored September event plan's taper block now actually requests its
own `taper_sharpening`/`race_week_strength` coverage keys instead of only the generic
`easy_aerobic` one.

### Pre-event restrictions and taper-window strength/density guard (Issue #679, `optimizer.ts`)

`evaluateRecoveryConstraints`'s D1-D7 pre-event restriction now also gates `triathlon`
events, not only `cycling_event`/`running_race`. For A/B events, strength is blocked D-1
through D-3, hard work D-1/D-2, generic `Moderate Endurance`/`Hard Endurance` at D-3,
and exhaustive work D-3 through D-7, while a light `Race-Specific Endurance` sharpening
touch may remain available at D-3. An unauthored C-priority event deliberately skips the
D-3 through D-7 restrictions so normal build dose and quality can continue through D-3;
the shared D-1/D-2 strength/hard gates still apply. An athlete-authored C taper opts back
into the A/B-style D-3 restrictions.

A second, independent restriction now covers the *full* resolved taper window
(`resolveEventTaper`, the same cycling/running/triathlon categories, not only the D1-D7
band above -- `strength_meet` is deliberately excluded, since its own taper is a deload of
strength work itself, not something to treat as nonessential): a Strength candidate is
excluded once systemicCost exceeds `TAPER_LIGHT_STRENGTH_MAX_SYSTEMIC_COST`
(0.35) or a strength touch already occurred earlier in the window (`TAPER_STRENGTH_TOUCH_LIMIT`
= 1) -- "reduced nonessential strength" rather than an outright ban. A Moderate/Hard
Endurance candidate is excluded when one already occurred within
`TAPER_MODERATE_DENSITY_MIN_GAP_DAYS` (3) days, preventing a stacked, build-like block near
the event while still allowing spaced, brief discipline-specific touches. Race-Specific
Endurance is deliberately excluded from this generic full-taper density guard because brief
event-specific touches can remain appropriate near the event. Priority-A race week has a
separate Issue #676 interaction guard below, which can hard-exclude substantial Race-Specific
Endurance when another hard/race-specific exposure occurred in the preceding three days.

### Whole-horizon recent-load and Priority-A race-week interaction policy (Issue #676)

Issue #676 adds two deliberately distinct controls:

* **Whole-horizon recent-load moderation:** when two systemicCost >= 0.50 sessions already
  sit in the rolling six-day history, another non-anchor systemicCost >= 0.50 candidate gets
  a 0.40 benefit multiplier. Required/nominated anchors are exempt from this *soft* moderation
  but remain subject to every hard recovery/taper gate. The 0.40 value is product calibration,
  not a physiological threshold.
* **Priority-A race-week interaction guard:** within D-1..D-7 of an A cycling/running/triathlon
  event, a candidate at systemicCost >= 0.50, or Race-Specific Endurance above 0.45, is
  excluded when the preceding three days contain either systemicCost >= 0.50 work or
  Race-Specific Endurance above 0.45. This closes the prior asymmetry where a 0.46-0.49
  race-specific exposure could contribute to quality stacking without satisfying the generic
  hard-history threshold.

No new universal three- or four-day spacing rule was added for all endurance-event strength
sessions. The race-week failure mode in #676 is already covered by the full-taper strength
restriction from #679 (at most one light <=0.35 touch) and by severe-recovery re-entry, which
keeps Strength out through day 5. Concurrent-training evidence is context-dependent and does
not justify turning those exact 3/4-day gaps into a global physiological invariant.

### Cycling event-demand durability split (Issue #675, `periodization.ts`, `optimizer.ts`)

Demand-derived cycling planning distinguishes sustained gran-fondo durability from criterium
surge repeatability. A raw cycling demand profile with aerobicEndurance and fatigueResistance
at or above 0.8, and repeatedSurges below 0.6, creates the
`obj_cycling_gran_fondo_durability` objective. Its target is aerobicEndurance 0.9,
fatigueResistance 0.85 and thresholdPower 0.6; completion requires at least 0.6 on both
aerobicEndurance and fatigueResistance from a Cycling `Race-Specific Endurance` template.

The compact criterium surge template is phase-eligible only when the governing event's
repeatedSurges demand is at least 0.6, so it cannot satisfy a low-surge gran-fondo plan.
Long-horizon `Race-Specific Endurance` benefit is also preserved only for that same
**cycling + high-aerobic + high-fatigue-resistance + low-surge** predicate instead of applying
the exception to unrelated high-aerobic running/triathlon events. The existing eligibility,
injury, recovery, taper, duration, daily-ledger and weekly-anchor gates remain authoritative;
the change selects a more appropriate feasible stimulus rather than maximizing duration
unconditionally.

When a time cap or modify-tier decision materializes an easier dose, ranking uses that
**effective candidate** for dose-sensitive stimulus benefit, weekly-role coverage, dimensional
fatigue cost, and the extra-recovery/conservative systemic-cost penalties. This prevents an
abbreviated session from claiming the authored workout's duration-based coverage or paying its
full fatigue cost. Template identity, category/modality, hard feasibility/safety checks, and
unrelated legacy authored-load heuristics remain authored-template policy unless separately
migrated and re-governed; effective-dose materialization is not a blanket rewrite of those rules.

The legacy scenario pair remains a matched 60-minute control. Capacity-sensitive acceptance
is enforced separately in the plan-judge event-demand family with a 120-minute check-in,
90-minute weekday profile cap and 120-minute weekend cap. Its invariant gate requires both
gran-fondo priority variants to select the sustained `end_race_specific_01` above 60 minutes
and requires that demand-specific exposure to exceed the matched compact criterium
`end_crit_surges_01` exposure in both duration and effective fatigue-resistance stimulus.
The comparison is intentionally template-specific because both plans may also contain other
generic race-specific work. This prevents a nominal 90-120-minute fixture from silently
collapsing back to 60 minutes while measuring the event-demand distinction the policy owns.

### Graduated recovery re-entry after severe adverse recovery (Issues #679/#676, `planner.ts`)

The severe-adverse-recovery restriction (`isSevereAdverseRecoveryReadiness`) previously
widened from recovery-only to a 0.5 ceiling and then to 0.65 by offset 3 before snapping
straight to the unrestricted candidate pool at offset 4. The first #679 patch extended
offsets 4-5 at 0.35, which accidentally made that ladder non-monotonic: day 3 could admit
tempo/threshold or Strength work before days 4-5 tightened again.

The final policy is deliberately conservative because a forecast has no real future
readiness reading to re-check: offsets 1-2 are Rest/Mobility-Recovery only; offset 3 may add
non-Strength, non-Moderate/Hard/Race-Specific work up to
`RECOVERY_REENTRY_EARLY_MAX_SYSTEMIC_COST` (0.35); offsets 4-5 widen that same low-intensity
non-Strength pool to `RECOVERY_REENTRY_LATE_MAX_SYSTEMIC_COST` (0.5). Issue #676 adds one
narrow taper exception during offsets 4-5: before an A/B cycling/running/triathlon event,
Race-Specific Endurance at systemicCost <=0.45 may be admitted on D-2 or D-3. The unrestricted
candidate pool is still reached only from day 6 onward. Recovery-only forecast dates use
effective `recover` semantics; graduated re-entry dates use effective `modify` semantics
for dose selection, allocation viability, displacement diagnostics, and the surfaced
forecast fatigue tier. These exact boundaries remain product policy, not a claim that a
single adverse wearable snapshot establishes a universal five-day physiological recovery
timeline.

### Multi-event: one taper authority, multiple demand contributors (Phase 5.6, `periodization.ts`)

`evaluatePeriodizationPhase` still picks exactly one governing event (the **taper
authority**) -- but now by a full, commented total order: priority, then proximity, then
planning date, then event id as a determinism backstop (never a real ranking signal). Two
events genuinely tied through every real criterion surface via the new
`governingEventTie` field rather than being silently resolved by the id backstop as if it
meant something.

Every other eligible, scheduled event within a 35-day window (matching the existing
Specificity-phase threshold) is a **demand contributor**: `objectivesFromDemand` (shared
with Phase 5.7's own objective generation) derives objectives from *that event's own*
demand vector, category, and own taper state -- never a blended vector, which is the
reason this sits after Phase 2's explicit objectives at all. `resolveMultiEventObjectives`
unions a contributor's objectives into the authority's own by `ObjectiveKey`: on a
collision the authority's title/qualification/targetStimulus/id win, and only the
required amount grows, via `max()` -- two similar B-events never demand double one
B-event's work by summing. A contributor's `threshold_quality` objective landing inside
the authority's taper window is dropped, not silently reweighted, with an athlete-facing
reason recorded (`DroppedContributorObjective.message`).

Only the taper authority ever sets `volumeScale`/`intensityScale` -- contributors supply
objectives only. Wired into `planner.ts`'s `prepareWeekAheadPlanSeed`, reaching the live
week-ahead pipeline for any athlete with more than one active dated event; a no-op
otherwise (`simulate:diff` confirms zero semantic change against the committed baseline).
The plan-derived path (`PlanDefinition`) is not wired to contributors in this increment.

---

## Candidate ranking (`optimizer.ts`)

Phase 3 introduced a single, unified ranking path (`rankCandidates`) driven by shared context (`buildOptimizationContext`). Candidates are evaluated via strict **Lexicographic Ordering**:

1. **Hard Eligibility Gates** (Level 1–3): Time budget, required equipment, injury constraints, safety envelopes, phase eligibility, planned-intensity admissibility, and dated role-aware recovery constraints (`QUALITY_SPACING_VIOLATION`, `HARD_LOWER_BODY_SPACING_VIOLATION`, `ROLLING_HARD_CAP_EXCEEDED`, `ANCHOR_PROTECTION_VIOLATION`, `RECOVERY_WINDOW_UNELAPSED`). Filtered candidates carry explicit `excludedReasons`.

`RECOVERY_WINDOW_UNELAPSED` (added `POLICY_VERSION` `2026-08-recovery-window-propagation-v1`,
PR #212) rejects a hard/anchor candidate when a *prior placed session's own declared*
`loadProfile.recoveryHours` window (e.g. 48h/54h/72h) has not yet elapsed — a consequence of an
earlier decision, not a property of the candidate itself. `weeklyAllocation.ts` re-validates
already-placed later reservations when an earlier placement retroactively triggers it.
2. **Objective Benefit** (Level 4): Scores a template's stimulus profile against currently unresolved weekly objectives (`calculateStimulusBenefit`). Higher objective satisfaction strictly outranks non-objective candidates regardless of preference multipliers. Candidates that do not satisfy an unresolved objective and whose modality is deprioritized by the athlete receive a $0.25\times$ benefit scaling ($0.20\times$ for avoided/disliked), preventing non-preferred high-stimulus sessions from entering top benefit tiers when objectives are satisfied or absent. Weekly-anchor timing and missing supported triathlon-modality coverage are also Level-4 architecture signals.
3. **Utility Score** (Level 5 & 6): `utility = (benefit / (1 + fatigueCost)) × preferenceMultiplier`. Used to sort candidates of comparable objective benefit (within `0.05` benefit score). Modality preferences scale utility ($1.35\times$ preferred, $0.25\times$ deprioritized, $0.20\times$ disliked).

Strength-maintenance benefit takes the stronger of `maxStrength` and `hypertrophy` target/evidence rather than allowing field order to choose which axis counts.

Event-priority matching is modality-based: cycling events match Cycling, running races match
Running, triathlons match Swimming/Cycling/Running, and strength meets match Strength when the
existing objective qualification allows the priority boost. Existing A/B behavior stays at
`1.40`/`1.25`. C-priority **cycling/running/triathlon** events enter that same event-aware
ranking with a neutral `1.00` multiplier; C-priority general targets and strength meets retain
their prior behavior rather than inheriting unrelated penalties from the C-race fix. A second
Race-Specific Endurance exposure within the rolling six-day history receives a `0.35`
multiplier for B endurance events; C endurance competitions without an active athlete-authored
taper defer that repeat dampener until D-2, preserving build load through D-3 while the existing
final 48-hour gates remain in force. An authored taper restores the resolved taper-window
exhaustive-work restriction and repeat-session dampener. C endurance events still have no
inferred taper by default.

For low-surge cycling durability demand, event specificity stays in the scoring layer rather
than becoming a global feasibility gate. During the final 35 days before the event, a Cycling
candidate with repeated-surge stimulus at least `0.6` and above event demand remains eligible,
but its event-aware benefit is scaled by `event repeatedSurges / candidate repeatedSurges`.
Earlier than D-35 that specificity factor is inactive, so a distant Gran Fondo does not ban
VO2/surge development during Base/Build.

### The planner/workout-library boundary (Phase 5.2, `planningCandidate.ts`)

Detailed `WorkoutDefinition`s (the prescription catalog) already carry recovery hours,
mechanical/eccentric load, technical environment, contraindications, and per-workout
minimum spacing after hard lower-body work -- but the planner selects a coarse
`SessionTemplate` first, so that richer data used to arrive only *after* the decision it
should have informed. Concretely: `evaluateRecoveryConstraints`'s hard-lower-body spacing
gate was a flat 2-day rule with no per-workout data behind it at all.

`PlanningCandidate` (`derivePlanningCandidate`, `PLANNING_CANDIDATE_INDEX`) resolves each
catalog workout against its linked engine template -- enough semantics to sequence a
week, without dragging blocks/variants/parameters into the planner; prescription
generation (`resolveWorkoutPrescription`) stays downstream and unchanged. Wired into
`OptimizationOptions.resolveMinimumDaysAfterHardLowerBody` (optional, defaults to the
identical flat rule so every caller that doesn't pass it is unaffected): a workout's own
`eligibility.minimumDaysAfterHardLowerBody` can now tighten *or* correctly loosen that
gate per workout instead of one generic number for every lower-body session.

Lives in `engine/`, not `workouts/models.ts` as a first read of the type might suggest --
`engine/models.ts` already imports from `workouts/models.ts`, so a type referencing
`SessionRole`/`Modality`/`WorkoutStimulusProfile`/`TrainingEnvironment` inside
`workouts/models.ts` would make that dependency circular.

---

## Authority ordering

The engine's real hierarchy. This is *authority precedence* (what wins when two rules
conflict), which happens to also match the actual filter/sort sequence
`evaluateTrainingWithIntent` runs today: the candidate list is narrowed by every step down
through phase eligibility *before* `rankCandidates` ever runs, and dated recovery
constraints are themselves evaluated as `rankCandidates`' own first (hard-filter) pass,
ahead of objective benefit and utility:

```text
clinical / safety gates     hard exclusion — never overridable
        ↓
feasibility                 time, equipment, environment, guardrails
        ↓
readiness mode ceiling      train / modify / recover cost caps
        ↓
phase eligibility           event-relative template gating (Path B only)
        ↓
planned intensity gate      hard-class candidates require adequate plan intensity
        ↓
dated recovery constraints  quality spacing, rolling hard caps, anchor protection,
                            prior session's own declared recovery window (RECOVERY_WINDOW_UNELAPSED)
        ↓
lexicographic priority      objective/timing benefit outranks preference
        ↓
utility score & cost        dimensional interference & preference multipliers
```

Preferences rank; they never unlock. An avoided modality is a hard exclude on Path A and a
0.2× soft penalty on Path B — a deliberate distinction, since taste must never behave like
a safety constraint ([ADR-0007](../adr/0007-adaptive-multisport-engine-architecture.md) §6).

### Injury gate sub-ordering (Phase 5.4)

Within the "clinical / safety gates" step above, `injuryPolicy.ts` itself has a total
order that a single `soreness: 1-10` scalar can't express, because it can't distinguish a
knee from an Achilles from general DOMS:

```text
InjuryConstraint (hard, persisted)   TrainingSettings.injuries -- exclude/limit never weakened
        ↓
observed tissue response (may tighten)   today's per-region check-in (DailyCheckin.tsx)
        ↓
wearable-derived readiness (may tighten) HRV/RHR/body battery -- acts through the separate
                                          fatigue/mode pipeline, not this gate at all
```

`resolveEffectiveInjuryConstraints` (called from `adapters.ts`
`mapContextFromGoalsAndTrainingSettings`) implements the first two steps: it merges a
day's `RegionTissueResponse[]` into the standing `InjuryConstraint[]`, but only ever
raises a region's severity for that one read, never lowers it, and never persists the
result back to `TrainingSettings`. Wearable-derived readiness has no parameter into that
function at all — a structural guarantee, not just tested behavior, that a good HRV
reading can't loosen what tissue response or the injury constraint decided.

A check-in-only athlete with no standing `InjuryConstraint` at all is not a gap in this
chain: `resolveEffectiveInjuryConstraints` already synthesizes a **today-only** constraint
directly from a bare `RegionTissueResponse`, scoped with `reviewBy: today` so it can never
outlive the day that produced it. `resolveInjuryRestrictions` then turns that into the same
`impliedGuardrails`/`restrictedCategories` a persisted injury would, and `eligibility.ts`
excludes any `SessionTemplate` whose `safetyTags` intersect an active guardrail — the same
mechanism, same code path, regardless of source.

### Template/workout safety-tag alignment and the one-day pending-recheck carry (issue #680)

Two related gaps surfaced from a persona-judge review of a check-in-only shoulder/back
symptom flare, both fixed without adding a new safety-filtering mechanism:

- **Mistagged templates.** `SessionTemplate.safetyTags` is the only guardrail-consuming
  metadata layer with a live consumer; `WorkoutDefinition.contraindicationTags` and
  `ExerciseDefinition.contraindicationTags` have none (`sessionChoiceEligibility.ts`'s own
  docstring documents this). Several strength templates' `safetyTags` didn't reflect what
  their linked workout (via `workoutForTemplate()`, `workouts/prescription.ts`) actually
  contained — e.g. `str_upper_pull_01` ("Pull-up Strength Practice") had `safetyTags: []`
  despite resolving to a workout built entirely from shoulder-tagged exercises. Fixed for
  the reported instances; `engine/templateWorkoutSafetyAlignment.test.ts` now pins every
  strength template's `safetyTags` as a superset of what its resolved workout's exercises
  imply for the upper-limb and lumbar guardrail families (the lower-limb families are
  deliberately out of scope — see that test file's own comment for why).
- **One-day pending-recheck carry.** `resolveEffectiveInjuryConstraints` only ever
  considers *today's* `tissueResponses`, so a today-only constraint (no standing injury)
  vanished the moment a later day's check-in simply had no entry for that region — even
  with no explicit settled follow-up. `injuryPolicy.ts`'s `deriveCarriedRegionRestrictions`
  / `resolveEffectiveInjuryConstraintsWithRecheck` layer a bounded, one-day-only carry on
  top of the unchanged base resolver: a region carries forward exactly one additional local
  day when the next day reports nothing for it, cleared by either that day's own response
  (any severity) or an already-covering standing injury. This is a product-policy
  uncertainty hold, not a clinical "settled evidence required" gate — see
  `docs/analysis/2026-09-19-symptom-compatible-substitution-investigation.md` and the
  registered `policy.injury.tissue_recheck_carry_v1` claim for the exact scope and why a
  fixed elapsed-time window is not evidence-backed.

  The carry is computed at the composition boundary (`engine/composer.ts`
  `composeDailyDecisionInput`, reusing the subjective-history range read it already
  performs — no extra read) and passed into `mapContextFromGoalsAndTrainingSettings` as a
  compact `CarriedRegionRestriction[]`, never a raw check-in. It is deliberately omitted
  from every provisional/forecast-day context construction (`Home.tsx`, `PlanView.tsx`),
  preserving the same no-forecast-leakage contract that already applies to today-only
  tissue-derived restrictions.

`rules.ts`'s recommendation rationale also surfaces a short, generic note ("An active
injury/tissue restriction is limiting shoulder-loading ... options today") whenever
`context.constraints.impliedGuardrails` is non-empty in a `train`/`modify` mode, so a
symptom-compatible substitution is visible to the athlete rather than only appearing in
`decisionTrace.excludedReasons`. It reads `impliedGuardrails` (decision-affecting data),
never `injuryPolicyTrace` (lineage-only, and `injuryPolicyLineageEquivalence.test.ts`
enforces that the trace can never influence the selected recommendation).

---

## Completed load and fatigue (`completedTraining.ts`, `fatigue.ts`)

Completed-session cost starts from the existing six-dimensional cost vector. When a
comparable planned/catalog duration exists, abbreviated work scales the vector down; a
recorded session longer than the intended reference is capped at a fully delivered `1.0`
duration scale rather than manufacturing unbounded fatigue. An independently measured
completion ratio can scale it further.

External replay retains an unsaturated `rawExternalLoadFatigue` state so accumulated load
is not lost at the ranking clamp. Ranking sees the clamped projection. External and internal
fatigue are currently fused with `max()`. ADR-0014's harness comparison found the tested
capped-addition candidate worse; that is why `max()` is retained. It is **not** declared
safe or calibrated, and the aggregate scenario recovery-share gate remains release authority.

`computeInternalResponseStrain` in `fatigue.ts` also evaluates unlogged ambulatory load: when
an acute ambient step surge occurs on $D-1$ ($\ge 1.8\times$ 7d baseline and $\ge +6,000$ excess steps
after deducting estimated steps from logged running/field/walking sessions via `estimateActivitySteps`),
it introduces a proportional tissue-strain contribution into the `impactTissue` and `lowerBody`
fatigue dimensions to prevent high-impact lower-body prescriptions following unlogged heavy hiking/walking
days without double-counting structured activities or requiring athlete subjective soreness input.

---

## Multi-day projection

`planner.ts` chains the same pipeline forward with three confidence tiers — `confirmed`
(today), `provisional` (tomorrow's readiness-branch preview), `projected` (day 2+) — and
a hard fatigue-tier ceiling, because `benefit / (1 + cost)` is asymptotic and would
otherwise never actually select rest. Nothing beyond today is persisted. See
[ADR-0008](../adr/0008-week-ahead-planning.md).

Forecast recommendations never mutate completed credit. They accumulate in
`WeeklyObjective.projectedCredit`; forecast unresolved state uses
`completedCredit + projectedCredit`, while live unresolved state ignores projected credit.
The planner's `objectiveCredits` display is derived from the same V2 objective-credit
function used by the live ledger, not the old `stimulusCoverage >= 0.6` model.

Rolling re-resolution carries that state by `WeeklyObjective.id`, never the display
`key`: one triathlon week deliberately contains separate Swimming, Cycling, and Running
`zone2_aerobic` objectives with the same key but different qualification contracts.

**Day-by-day local fatigue tier evaluation and modeled recovery headroom.** Forecast days are
evaluated locally against the planner's projected fatigue state as-of that date (`planner.ts`
`evaluateProjectedDate`). The separate `rollingLoadBudget.ts` envelope now carries a stable
athlete-specific catalog-load budget across the seven future dates beginning tomorrow once
sufficient baseline history exists. The week-ahead wrapper obtains a separate 49-day evidence
snapshot (42-day stable baseline plus the excluded recent seven-day window) while operational
fatigue and microcycle bookkeeping remain explicitly bounded to seven days. The day-1 provisional recommendation is already selected by the separate next-day evaluator and
is charged to the envelope without being re-ranked; planned fixed-activity and schedule-overlay
expected costs reserve capacity across their horizon dates, and generated day-2+ candidates are
gated. Candidate budget cost uses the same automatic easier dose that ranking will prescribe on
modify/time-capped days. Acute fatigue may still decay and improve the daily tier, but that decay does not replenish the
same fixed forecast envelope. Sparse history leaves this new gate inactive; existing
safety/feasibility controls remain authoritative. The catalog-load envelope is a product
guardrail, not a calibrated physiological recovery measurement or universal dose-response model;
its exact limits are registered with those limitations in the knowledge library.

### Required weekly-role reservations (ADR-0018)

Weekly anchors remain preferences. `weeklyAllocation.ts` adds a separate, exact-identity
ledger for still-unfulfilled authored *minimum* roles, and allocates them before the greedy
loop can spend their only safe date on supporting work.

**One hard-gate path.** `planner.ts` exports `evaluateProjectedDate`, the single seam that
resolves availability, phase eligibility, environment, the projected fatigue tier, planned
dose, injury and spacing for one forecast date. The greedy day loop and the allocator both
call it, so the allocator is not a second rules engine: it never re-implements
`PROJECTED_FATIGUE_*` filtering or `rankCandidates` acceptance.

**Bounded stateful search.** `resolveWeeklyRoleReservations` is a deterministic
backtracking search over required role occurrences only. It enumerates exact eligible
date/template candidates from the least-loaded (root) state, then re-proves every tentative
assignment against the *actual* projected fatigue/history transition of the assignments
accumulated so far -- so two dates that are individually feasible but conflict after the
first pick cannot both be reserved. Its one `WeeklyAllocationSearchBudget` is seven dates,
14 occurrences, four canonically ordered candidates per occurrence and 1,024
state-transition nodes. Reaching a cap returns the best-known jointly feasible partial
allocation and marks the remainder `unresolved_search_budget` -- never a safety miss.
Wall-clock time is not a semantic cut-off; p95 ≤50 ms / p99 ≤100 ms on the live-sized
fixture is an operational gate only.

**Protection during greedy selection.** Reservations are recomputed after every selected
forecast day. On a reserved date the planner ranks only candidates that fulfil that
occurrence when exact candidates survive the date gates; if the dynamic state has made
them unsafe, safety wins and the role relocates or is reported. Reservation presence is
not an exemption from allocation preservation: even an exact candidate that fulfils the
current occurrence can spend rolling-budget capacity needed by another later occurrence.
Therefore every non-recover selection -- discretionary support, an exact reserved-role
candidate, or Rest -- is admitted only while the incumbent allocation is proven to survive
its projected cost (or an equal-cardinality reallocation is proven). A true recover-tier
selection is exempt: Rest-first outranks role fulfilment and the loss is attributed to
recovery.

The support check is fail-closed. It considers the bounded viability set even when that set
contains one ranked candidate, and distinguishes a proven degradation from an exhausted
search budget. If no candidate proves preservation, the planner may use Rest only when Rest
itself proves preservation; otherwise it returns an unresolved allocation outcome rather
than falling through to the highest-ranked candidate. A required role that is infeasible
because committed load consumed the rolling envelope is reported with the typed
`rolling_load_budget` miss reason, while inability to prove a result within bounded search
remains `unresolved_search_budget`. Anchor placement and `conservativeBias` do not bypass
or resize the rolling envelope.

Outcomes are typed (`reserved`, `fulfilled`, `missed`, `unresolved_search_budget`) with
`wasMoved` as an annotation rather than a status, and are surfaced unchanged through
`WeekAheadPlan.allocationReport` to the simulator report and the week-ahead UI. They are
forecast evidence: never completed training, and never a substitute for the persisted
recommendation audit. `recovery_or_rest` stays on the coverage ledger but does not reserve
a training date. The production planner remains greedy; the Phase 5.1 beam-search prototype
is not part of this path.

### Fixed activities (Phase 5.3, projected exposures since Phase 6.2b)

`FixedActivity` (external commitments -- a booked class, a match, travel) is persisted at
`users/{userId}/fixed_activities/{activityId}` via `fixedActivityService.ts`, the same
user-owned/validated-at-the-rule pattern as `goals` (ADR-0002). `Home.tsx` reads the
current week's activities for the week-ahead strip (`WeekAheadOptions.fixedActivities`)
and, separately, today's/tomorrow's activities for the live/next-day decision
(`evaluateTrainingWithIntent`/`evaluateNextDayPlanWithIntent`) -- a booked or travel
commitment on today or tomorrow affects the actual pick, not only the forecast strip. An
`availabilityOverride` on an activity caps that day's whole training budget (e.g. a travel
day) before the activity's own `durationMin` is deducted; several overrides on the same
day take the most restrictive. `fixed` (movable vs immovable) is captured but not yet
consumed -- it becomes load-bearing once sequence search (5.1/5.2) can reason about
shifting a movable placeholder.

**An activity's own `environment`/`equipment` describe only that activity, never the whole
day (D6-B).** A football match at an outdoor field does not imply a separate same-day
session must also be outdoor or football-equipped. A true day-wide restriction (a travel
day where every session that day really is stuck at a hotel gym) is a separate, explicit
`availabilityContextOverride: { environment?, equipment? }` field, validated independently
in `validation.ts`/`firestore.rules` and consumed by `resolveAvailability` (intersecting
owned equipment, restricting environment) and, in the planner loop and the live path
alike, by filtering candidates whose own `environment` conflicts with it.

**Booked activities are projected exposures, not just calendar blockers (Phase 6.2b).**
`resolveAvailability` returns a dimensional `reservedCapacityCostProfile`, summed only from
activities' explicitly authored `expectedCost` -- a missing value contributes zero, never
an invented default (D6-C). Same-day ranking sees this reservation (additively fused onto
projected fatigue via `applyCompletedSessionLoad`, not `max()`, so it cannot be masked by
already-elevated fatigue) without marking the load as already completed. An activity's
`expectedStimulus`, if present, is credited against unresolved objectives through the same
canonical credit primitive as a structured exposure (`deriveObjectiveCreditFromProfile`)
*before* that day's own candidate is ranked -- crediting it afterward would let the
optimizer separately prescribe redundant work for an objective the booked activity already
covers. At the end of the day, the activity's cost becomes real (not merely reserved) load
for the following day's fatigue projection. Completed activities are excluded from all of
this so their load is never projected a second time. See
[docs/plans/phase-6-evidence-and-operational-assurance.md](../plans/phase-6-evidence-and-operational-assurance.md)
6.2b for the full change description, decisions D6-B/D6-C/D6-D, and test list; see
[docs/plans/phase-5-sequence-planning.md](../plans/phase-5-sequence-planning.md) 5.3 for
the original storage/validation contract.

**D-LEDGER admission in the rolling planner.** Before each projected date is ranked,
`fixedActivityLedger.ts` reconciles pending fixed commitments by their stable occurrence key and
newest `updatedAt` revision. `resolveAvailability` consumes that same deduplicated set. The
planner passes the resulting entries to `computeDailyLedger`, keeps overlay load as a date-level
ceiling reservation, and uses `admitsCandidate` to exclude any non-Rest candidate that cannot
fit both remaining minutes and systemic cost. Conflicting equal-revision fixed-activity facts
fail closed; Rest stays available as the safe non-training fallback. This is pure forecast
accounting, not a Firestore read or a replacement for the transactional intraday
`daily_ledgers/{date}` launch aggregate.

### Bounded sequence search prototype (Phase 5.1, `sequenceSearch.ts`) -- not live

The "projected" tier above is a greedy walk: each day takes `rankCandidates`' rank-0 pick
with no visibility into how that choice constrains later days. `sequenceSearch.ts`'s
`beamSearchWeekAheadPlan` is a bounded beam-search prototype (width 15, 5 candidates/day
by default) that scores whole partial sequences instead, reusing `rankCandidates`'
existing hard-gate-before-scoring separation rather than reimplementing it. Benchmarked
against greedy on the Phase 0 invariants and semantic scenario harness
(`npm run compare:sequence-search`): zero new hard-constraint or golden-week violations,
and strictly better weekly-objective resolution in several scenarios, at a real ~5.7x
compute cost and a materially lower rest-day frequency the harness can't judge as better
or worse on its own. **Adoption is deferred, not rejected** -- see
[ADR-0015](../adr/0015-sequence-planning-and-session-role-model.md) for the full
comparison data and reasoning. Greedy (`generateWeekAheadPlan`) remains the live default;
`sequenceSearch.ts` is not imported by any production code path.

---

## Morning Decision Evidence & Progressive Disclosure (`decisionEvidence.ts`, `MorningDecisionCard.tsx`)

The dashboard presents morning recommendations through progressive disclosure answering three core questions immediately:
1. **What should I do today?** Dominant Hero Decision Card with immediate session clarity (title, modality, target duration, 1-line rationale, execution mode badge), immediate primary session launch CTA, and a 1-tap **Easier / Harder** stepper.
2. **Why?** Pure synthesis (`decisionEvidence.ts:assembleMorningDecisionEvidence`) evaluating:
   - **Ranked Evidence Factors**: Weighted drivers across autonomic recovery, tissue safety, periodization demand, and chronic baseline deficit with impact indicators.
   - **Day-over-Day Deltas**: Overnight physiological delta comparisons against yesterday and 28-day chronic baselines (HRV overnight, resting heart rate, sleep score, wake body battery).
3. **What should make me change that decision?**
   - **Hard Gates vs Soft Optimization Boundaries**: Clear separation between hard safety guardrails (clinical pain flags, acute illness anomalies, systemic load ceilings) which strictly lock "Harder" adjustments, and soft optimization factors (sport preferences, role reservations).
   - **Decision Invalidation Triggers**: Explicit boundary triggers (e.g. warmup pain exceeding 3/10, available time dropping under 30 minutes, equipment/venue shifts).
   - **1-Tap Situational Alternatives**: Instant pivots for time crunches (20m, 30m, 45m), zero-equipment home bodyweight flows, joint mobility sessions, and active recovery walks.
   - **Honest Data Confidence**: Tiered confidence ratings (`High`, `Moderate`, `Low`) based on biometric and subjective data availability, avoiding false precision when inputs are missing.

### Activity Reclassification Overrides (`activityOverrideService.ts`, `completedTraining.ts`)
Athletes can correct Garmin misclassifications (sport modality, intensity tag, 1–10 RPE, stimulus focus) directly from Activity Telemetry. Overrides are persisted in Firestore under `users/{userId}/activity_overrides/{activityId}` and integrated into `completedTraining.ts:candidateEventFromGarmin` to adjust downstream load, fatigue, and recovery credit.

---

## Data-confidence observability (`dataConfidence.ts`)

`DecisionComposer.composeDailyDecisionInput` computes a dashboard-only
`DataConfidenceScore` after the normal source-state composition step. The evaluator reports
four bounded diagnostics (completeness, freshness, baseline maturity, and physiological
plausibility), an operational coverage tier, per-signal status, and plain-language
cautions. Freshness uses the snapshot sync timestamp together with metric dates: sleep,
HRV, RHR, and wake Body Battery must belong to the target date, while `totalSteps` must
belong to the completed Warsaw calendar day D-1.

This score is **not a third readiness authority**. It is not passed into
`evaluateReadinessAndSafetyEnvelope`, eligibility, dose, or ranking, and therefore cannot
strengthen or weaken a recommendation. Existing fail-closed composition and adverse-only
readiness rules remain authoritative. The dashboard indicator exposes why evidence is
missing, stale, immature, or implausible; the neighboring Garmin sync control remains the
actual ingestion action.

The confidence profile is recomputed when dashboard data is composed and is not persisted
in `RecommendationAudit`. Consequently it describes current composition-time evidence and
must not be presented as frozen replay provenance. Adding it to decision policy or replay
would require an explicit ADR/schema change, Firestore validation updates, and a
`POLICY_VERSION` review.

---

## Verification & audit tooling

### Coverage visibility (`test:coverage` / `pytest --cov`)

`cd app && npm run test:coverage` emits terminal, JSON, and HTML V8 coverage reports to
`app/artifacts/coverage/frontend/`. `uv run pytest --cov=garmin_sync --cov-report=term-missing
--cov-report=xml:artifacts/coverage/python/coverage.xml` emits backend terminal and XML
coverage reports. CI uploads both directories as review artifacts without a global coverage
threshold; engine behavior contracts remain the decision-quality gate.

### Multi-week scenario simulation (`simulate:scenarios`)
Executed via `cd app && npm run simulate:scenarios`. Runs synthetic athlete scenarios across multi-week spans to audit engine periodization, fractional objective fulfillment, fatigue decay curves, anchor placements, modality coverage, and constraint safety. Outputs `report.json` and `report.md` to `app/artifacts/simulation-reports/latest/`.

### Calibration evidence (`simulate:calibrate`)

Executed via `cd app && npm run simulate:calibrate`. It reruns the same bounded synthetic
corpus and writes compact per-day decision traces plus per-scenario and aggregate trigger
frequencies to `app/artifacts/calibration-reports/latest/`. Traces retain canonical template
and objective identifiers, derived fatigue/cost/stimulus vectors, gate codes, and optimizer
scores; they intentionally exclude raw Garmin payloads, free-text check-ins, and Firebase
exports. This is policy-regression evidence, not clinical calibration, and the report makes
no automatic threshold recommendation.

### Fatigue-fusion comparison (`simulate:fatigue-fusion`)

Executed via `cd app && npm run simulate:fatigue-fusion`. It runs the real planner and
hard gates under production `max` and simulation-only bounded-additive fusion, then compares
fatigue trajectories, selections, recovery, objective misses, constraint violations, and
runtime. The selector is unavailable to live callers; the current evidence retains `max`
because additive increases recovery and objective misses without a safety benefit.

### Recommendation decision replay (`replay:recommendation`)
Executed via `cd app && npm run replay:recommendation -- <audit.json>`. Accepts a JSON snapshot of a historical recommendation and passes it into `replayRecommendationAudit()` ([`app/src/engine/replay.ts`](../../app/src/engine/replay.ts)). The current policy version can be verified for reproducibility. Known historical policy versions remain auditable but are explicitly rejected as executable replay unless that historical decision function is bundled in a future build.

An external decision (ADR-0019) ranked nothing, so the highest-utility check does not apply
to it. Instead it is verified against the plan revision its audit names: pass the stored
revision as a second argument (`-- <audit.json> <revision.json>`) and the script recomputes
its SHA-256 through `externalPlanHash.ts`. Without the revision the decision is reported as
**not reproducible** rather than quietly passing, and a revision whose content has changed
under the same revision number fails with an explicit hash-mismatch reason (D-IMMUT).

### Sequence-search comparison (`compare:sequence-search`)
Executed via `cd app && npm run compare:sequence-search`. Runs every scenario through both the production greedy planner and the Phase 5.1 beam-search prototype ([`app/src/engine/sequenceSearch.ts`](../../app/src/engine/sequenceSearch.ts)) using the identical `runScenario` harness, and reports the comparison (rest-day share, constraint violations, golden-week invariants, per-scenario deltas, timing). Outputs `comparison.json` to `app/artifacts/sequence-search-comparison/` (gitignored, regenerable). See [ADR-0015](../adr/0015-sequence-planning-and-session-role-model.md).

---

## Related decisions

| ADR | Covers |
|---|---|
| [0006](../adr/0006-reconciled-strain-telemetry.md) | Acute vs multi-day-drift strain decomposition; completed-load replay amendment |
| [0007](../adr/0007-adaptive-multisport-engine-architecture.md) | Six-tier engine, dual profiles, safety vs preference authority |
| [0008](../adr/0008-week-ahead-planning.md) | Rolling 7-day projection and confidence tiers |
| [0009](../adr/0009-training-intent-history.md) | History-seeded intent; the `TrainingHistoryProvider` boundary |
| [0010](../adr/0010-decision-provenance-and-audit-replay.md) | `DataState`, audit records, replay, `POLICY_VERSION` |
| [0011](../adr/0011-weekly-architecture-anchors.md) | Weekly anchors and ranking modifiers |
| [0012](../adr/0012-plan-intent-authority.md) | Explicit plan authority and plan-side intent ownership |
| [0014](../adr/0014-objective-credit-v2-and-honest-load.md) | Fractional credit V2, honest load, projected credit and fusion evidence |
| [0017](../adr/0017-training-intent-profile-and-planning-modes.md) | `planningMode.ts` as the sole planning-mode authority |
| [0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | Externally-authored plans, session adjudication, placement, critique and replay |

Known divergences between these decisions and the code are tracked in
[the 2026-08-08 review](../analysis/2026-08-08-architecture-review.md); remediation is
sequenced in [`docs/plans/`](../plans/).
