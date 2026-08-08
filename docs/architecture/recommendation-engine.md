# Recommendation Engine Architecture

How `app/src/engine/` turns a morning's data into a prescribed session.

> **Accuracy note.** Rewritten 2026-08-08 against the engine as it actually is. The
> previous version described a `REST / RECOVERY / AEROBIC_BASE / QUALITY_STRENGTH` mode
> hierarchy with fixed thresholds ("HRV drop > 10%", "sleep score < 65") that the code has
> not used for some time, and omitted every module added by ADR-0006 through ADR-0011.
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
                   → rankCandidatesByUtility → top pick
```

Asynchronous; resolves training intent from adherence history first. Path B consumes `evaluateReadinessAndSafetyEnvelope` to obtain `mode`, `envelopes`, and `telemetry` directly, sharing the exact readiness calculation with Path A without running a discarded template selection (F9 resolved under ADR-0012).

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
| `microcycle.ts` | Weekly objectives and exposure crediting |
| `fatigue.ts` | Six-dimensional fatigue with exponential decay |
| `optimizer.ts` | Candidate ranking: benefit vs cost, plus named modifiers |
| `trainingIntent.ts` | Composes periodization + objectives + fatigue + planned dose |
| `dose.ts` | Intersects planned dose with the clinical ceiling and athlete adjustment |
| `planner.ts` | Rolling 7-day projection and the weekly anchor pre-pass |
| `provenance.ts` / `replay.ts` | Audit construction and verification |

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

## Candidate ranking (`optimizer.ts`)

Phase 3 introduces a single, unified ranking path (`rankCandidates`) driven by shared context (`buildOptimizationContext`). Candidates are evaluated via strict **Lexicographic Ordering**:

1. **Hard Eligibility Gates** (Level 1–3): Time budget, required equipment, injury constraints, safety envelopes, phase eligibility, and dated role-aware recovery constraints (`QUALITY_SPACING_VIOLATION`, `HARD_LOWER_BODY_SPACING_VIOLATION`, `ROLLING_HARD_CAP_EXCEEDED`, `ANCHOR_PROTECTION_VIOLATION`). Filtered candidates carry explicit `excludedReasons`.
2. **Objective Benefit** (Level 4): Scores a template's stimulus profile against currently unresolved weekly objectives (`calculateStimulusBenefit`). Higher objective satisfaction strictly outranks non-objective candidates regardless of preference multipliers.
3. **Utility Score** (Level 5 & 6): `utility = (benefit / (1 + fatigueCost)) × preferenceMultiplier`. Used to sort candidates of comparable objective benefit (within `0.05` benefit score).

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
dated recovery constraints   quality spacing, rolling hard caps, anchor protection (F3)
        ↓
lexicographic priority      objective benefit outranks preference (Level 4)
        ↓
utility score & cost        dimensional interference & preference multipliers (Level 5-6)
```

Preferences rank; they never unlock. An avoided modality is a hard exclude on Path A and a
0.2× soft penalty on Path B — a deliberate distinction, since taste must never behave like
a safety constraint ([ADR-0007](../adr/0007-adaptive-multisport-engine-architecture.md) §6).

---

## Multi-day projection

`planner.ts` chains the same pipeline forward with three confidence tiers — `confirmed`
(today), `provisional` (tomorrow's readiness-branch preview), `projected` (day 2+) — and
a hard fatigue-tier ceiling, because `benefit / (1 + cost)` is asymptotic and would
otherwise never actually select rest. Nothing beyond today is persisted. See
[ADR-0008](../adr/0008-week-ahead-planning.md).

---

## Verification & audit tooling

### Multi-week scenario simulation (`simulate:scenarios`)
Executed via `cd app && npm run simulate:scenarios`. Runs synthetic athlete scenarios across multi-week spans to audit engine periodization, microcycle objective fulfillment, fatigue decay curves, anchor placements, and constraint safety. Outputs `report.json` and `report.md` to `app/artifacts/simulation-reports/latest/`.

### Recommendation decision replay (`replay:recommendation`)
Executed via `cd app && npm run replay:recommendation -- <audit.json>`. Accepts a JSON snapshot of a historical recommendation and passes it into `replayRecommendationAudit()` ([`app/src/engine/replay.ts`](../../app/src/engine/replay.ts)) to verify deterministic decision reproducibility and log rationale differences.

---

## Related decisions

| ADR | Covers |
|---|---|
| [0006](../adr/0006-reconciled-strain-telemetry.md) | Acute vs multi-day-drift strain decomposition |
| [0007](../adr/0007-adaptive-multisport-engine-architecture.md) | Six-tier engine, dual profiles, safety vs preference authority |
| [0008](../adr/0008-week-ahead-planning.md) | Rolling 7-day projection and confidence tiers |
| [0009](../adr/0009-training-intent-history.md) | History-seeded intent; the `TrainingHistoryProvider` boundary |
| [0010](../adr/0010-decision-provenance-and-audit-replay.md) | `DataState`, audit records, replay, `POLICY_VERSION` |
| [0011](../adr/0011-weekly-architecture-anchors.md) | Weekly anchors and ranking modifiers |

Known divergences between these decisions and the code are tracked in
[the 2026-08-08 review](../analysis/2026-08-08-architecture-review.md); remediation is
sequenced in [`docs/plans/`](../plans/).
