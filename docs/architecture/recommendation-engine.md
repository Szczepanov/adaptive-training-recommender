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
| `adapters.ts` | Firestore canonical models → engine inputs |
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
| `planner.ts` | Rolling 7-day projection, projected-credit ledger and weekly anchor pre-pass |
| `provenance.ts` / `replay.ts` | Audit construction and current-policy verification; historical policies are audit-only |

---

## Mode selection (`rules.ts`)

Three modes, not four: **`train`**, **`modify`**, **`recover`**.

Objective strain is a continuous, **self-normalised** score — not fixed absolute
thresholds. Each of HRV, RHR and sleep score contributes two z-scored terms:

* **acute** — today vs this person's own trailing 7-day baseline
* **chronic** — the 7-day baseline's drift from the 28-day baseline, weighted ×1.5,
  because a multi-day trend predicts overreaching better than one noisy night

Normalisation uses the athlete's own trailing 28-day stdev, floored (HRV 3 ms, RHR
1.5 bpm, sleep 4 pts) so a flat metric cannot produce an explosive z-score. Each metric's
contribution is capped at ±2.0 so one outlier cannot dominate.

```text
strain = Σ metric(acute + 1.5 × chronic) × weight     HRV 0.5, RHR 0.3, sleep 0.2
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

---

## Candidate ranking (`optimizer.ts`)

Phase 3 introduced a single, unified ranking path (`rankCandidates`) driven by shared context (`buildOptimizationContext`). Candidates are evaluated via strict **Lexicographic Ordering**:

1. **Hard Eligibility Gates** (Level 1–3): Time budget, required equipment, injury constraints, safety envelopes, phase eligibility, planned-intensity admissibility, and dated role-aware recovery constraints (`QUALITY_SPACING_VIOLATION`, `HARD_LOWER_BODY_SPACING_VIOLATION`, `ROLLING_HARD_CAP_EXCEEDED`, `ANCHOR_PROTECTION_VIOLATION`). Filtered candidates carry explicit `excludedReasons`.
2. **Objective Benefit** (Level 4): Scores a template's stimulus profile against currently unresolved weekly objectives (`calculateStimulusBenefit`). Higher objective satisfaction strictly outranks non-objective candidates regardless of preference multipliers. Weekly-anchor timing and missing supported triathlon-modality coverage are also Level-4 architecture signals.
3. **Utility Score** (Level 5 & 6): `utility = (benefit / (1 + fatigueCost)) × preferenceMultiplier`. Used to sort candidates of comparable objective benefit (within `0.05` benefit score).

Strength-maintenance benefit takes the stronger of `maxStrength` and `hypertrophy` target/evidence rather than allowing field order to choose which axis counts.

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
dated recovery constraints  quality spacing, rolling hard caps, anchor protection
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

### Fixed activities (Phase 5.3)

`FixedActivity` (external commitments -- a booked class, a match, travel) is persisted at
`users/{userId}/fixed_activities/{activityId}` via `fixedActivityService.ts`, the same
user-owned/validated-at-the-rule pattern as `goals` (ADR-0002). `Home.tsx` reads the
current week's activities and passes them into `WeekAheadOptions.fixedActivities`, which
`resolveWeeklyAnchors`/`resolveAvailability` (`schedule.ts`) already consumed -- the gap
this closed was the absent Firestore source, not the consuming logic. An
`availabilityOverride` on an activity caps that day's whole training budget (e.g. a travel
day) before the activity's own `durationMin` is deducted; several overrides on the same
day take the most restrictive. `fixed` (movable vs immovable) is captured now but not yet
consumed -- it becomes load-bearing once sequence search (5.1/5.2) can reason about
shifting a movable placeholder. See
[docs/plans/phase-5-sequence-planning.md](../plans/phase-5-sequence-planning.md) 5.3 for
the full storage/validation contract.

---

## Verification & audit tooling

### Multi-week scenario simulation (`simulate:scenarios`)
Executed via `cd app && npm run simulate:scenarios`. Runs synthetic athlete scenarios across multi-week spans to audit engine periodization, fractional objective fulfillment, fatigue decay curves, anchor placements, modality coverage, and constraint safety. Outputs `report.json` and `report.md` to `app/artifacts/simulation-reports/latest/`.

### Recommendation decision replay (`replay:recommendation`)
Executed via `cd app && npm run replay:recommendation -- <audit.json>`. Accepts a JSON snapshot of a historical recommendation and passes it into `replayRecommendationAudit()` ([`app/src/engine/replay.ts`](../../app/src/engine/replay.ts)). The current policy version can be verified for reproducibility. Known historical policy versions remain auditable but are explicitly rejected as executable replay unless that historical decision function is bundled in a future build.

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

Known divergences between these decisions and the code are tracked in
[the 2026-08-08 review](../analysis/2026-08-08-architecture-review.md); remediation is
sequenced in [`docs/plans/`](../plans/).
