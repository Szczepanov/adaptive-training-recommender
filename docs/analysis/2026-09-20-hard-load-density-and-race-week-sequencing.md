# 2026-09-20 — Issue #676 remediation: Hard-load density, race-week sequencing, and severe recovery sharpening

Point-in-time record of the investigation and remediation of [Issue #676](https://github.com/Szczepanov/adaptive-training-recommender/issues/676):
AI-judge sensitivity diagnostics identifying weak whole-horizon load sensitivity after recent hard training,
quality stacking during race week, and over-conservative severe recovery re-entry eliminating pre-event sharpening.

---

## Background and Findings

### 1. Weak whole-horizon load sensitivity after recent hard training (confirmed)

**Symptom**:
In `judge_load_hard_yesterday` (compared against `judge_load_none`), the immediate Day 1–2 response was appropriately cautious
(two easy days before any quality exposure), but the cumulative 14-day plan accrued 5 hard sessions—exceeding the no-load baseline
despite the athlete having performed an unabsorbed hard workout on $D-1$. The judge noted that recent hard training should dampen
overall hard-session density or cumulative systemic cost across the planning horizon, rather than solely shifting the Day 1 selection.

**Root Cause**:
The rolling hard density gate (`evaluateRecoveryConstraints`) enforced a hard cap of 2 hard sessions per 7-day rolling window (`diff <= 6`),
but in candidate utility ranking (`rankCandidates`), non-anchor hard sessions (`systemicCost >= 0.50`) competed on equal footing
for high-priority weekly objectives once the rolling cap was not violated on a given day. Because the athlete began with a clean slate
after the initial 2-day refractory period, subsequent days accumulated hard sessions up to the ceiling without horizon-level cost moderation.

**Remediation**:
- In `optimizer.ts` (`rankCandidates`), introduced whole-horizon benefit moderation: when the rolling 6-day hard session count is $\ge 2$,
  any candidate with `systemicCost >= 0.50` that is not explicitly fulfilling a designated weekly anchor has its utility score reduced
  (`benefit *= 0.40`).
- This dampening allows necessary anchor sessions to proceed when safe, but strongly disincentivizes additional non-anchor hard sessions,
  ensuring that cumulative systemic cost and hard session density for `judge_load_hard_yesterday` remain strictly $\le$ `judge_load_none`.

---

### 2. Race-week quality density guard before Priority A events (confirmed)

**Symptom**:
In `judge_int_race7_hard_yday`, having completed a hard workout on $D-1$ followed by race-week planning (7 days out from an A-priority criterium)
allowed high-cost criterium surges to be placed in close proximity (within 3 days) of the prior hard work alongside taper sharpening,
resulting in dense quality sequencing immediately prior to competition.

**Root Cause**:
Existing pre-event constraints limited exhaustive work and capped volume, but did not impose a strict refractory spacing between
recent hard training and race-week high-cost surges or race-specific workouts when approaching competition.

**Remediation**:
- In `optimizer.ts` (`evaluateRecoveryConstraints`), added an explicit race-week quality density guard for Priority A events in the 7-day pre-race window:
  if an event is 1 to 7 days out, candidates with `systemicCost >= 0.50` or category `Race-Specific Endurance` with `systemicCost > 0.45`
  are blocked if a hard session (`systemicCost >= 0.50` or race-specific `> 0.45`) occurred within the preceding 3 days ($1 \le \text{diff} \le 3$).
- Scoped strictly to Priority A events to preserve intentional race-preparation flexibility for Priority B events (where race-specific work
  receives benefit moderation rather than a hard exclusion gate).

---

### 3. Severe recovery re-entry and pre-event sharpening (confirmed)

**Symptom**:
In `judge_int_race7_badobj`, severe objective adversity (HRV down 2 SD, RHR up 2 SD, poor sleep) produced 7 consecutive Rest/Mobility days
from a single adverse snapshot, completely suppressing pre-event neuromuscular sharpening ($D-2$/$D-3$) before an A-event and causing athlete
flatness/detraining prior to competition. Additionally, the daily forecast diagnostics reported `train` fatigue tier when rest was forced.

**Root Cause**:
The severe recovery re-entry ladder in `planner.ts` strictly restricted days 1–5 to low systemic cost without an exception for light pre-race
neuromuscular touchpoints, and the forecast diagnostics in `planner.ts` surfaced raw fatigue evaluation tiers rather than effective
recovery-tier overrides.

**Remediation**:
- In `planner.ts` (`isRecoveryReentryCandidate`), allowed light pre-event sharpening (`Race-Specific Endurance`, `systemicCost <= 0.45`, e.g.
  `end_taper_sharpen_01`) during late re-entry (days 4–5 / offset $\ge 4$) on $D-2$ or $D-3$ before an A- or B-priority endurance event.
- In `planner.ts`, introduced `effectiveFatigueTier`: dates under `isRecoveryOnlyDate` report `'recover'`, and dates under re-entry report `'modify'`.
  This provides transparent diagnostic accounting and prevents 7-day over-resting while respecting acute recovery needs.

---

### 4. Concurrent endurance-strength spacing (confirmed)

**Symptom**:
In endurance event preparations (`cycling_event`, `running_race`, `triathlon`), full-body strength sessions could be placed with only 1–2 days
separation across the planning horizon, compromising musculoskeletal recovery for primary sport exposures.

**Root Cause**:
Lower-body strength spacing enforced $\ge 2$ days between heavy lower-body sessions, but did not impose endurance-specific spacing for
full-body or general strength maintenance sessions.

**Remediation**:
- In `optimizer.ts` (`evaluateRecoveryConstraints`), added endurance-event strength spacing rules:
  - Any heavy strength session (`systemicCost >= 0.60` or `costProfile.lowerBody >= 0.60`) requires $\ge 4$ days since any prior strength session.
  - Any general strength session requires $\ge 3$ days since any prior strength session.
- Updated `isStrengthResolved` to ensure endurance events acknowledge resolved strength objectives when adequate stimulus has been placed.

---

## Verification Summary

1. **Unit & Scenario Tests**:
   - `recentLoadHorizonDensity.test.ts`: Confirms strict whole-horizon density ordering (`hard_yesterday` $\le$ `none`) and safe 2-day initial ease.
   - `raceWeekInteractionsSequencing.test.ts`: Verifies race-week quality density spacing, pre-event sharpening during late re-entry, and endurance strength spacing.
   - `policy.test.ts`: Verifies `POLICY_VERSION` transition to `'2026-09-hard-load-density-race-week-sequencing-v1'`.
   - Full Vitest suite: 508 test files passed (5,902 tests), 0 failed.
2. **Knowledge Architecture & Lineage**:
   - Registered and validated updated claims in `sportsKnowledge.ts` (`rollingHardDensityCap`, `hardLowerBodySpacing`, `severeAdverseRecoveryReentry`)
     and `taperFuelingKnowledge.ts` (`preEventRestrictionsPolicy`).
   - `npm run validate:knowledge`, `validate:knowledge-coverage`, `validate:knowledge-freshness`, and `validate:workouts` passed clean.
3. **Simulation & Drift**:
   - `npm run simulate:scenarios` and `npm run simulate:diff` verified intended directional changes across the 39-scenario benchmark corpus.
4. **Backend Invariants**:
   - `uv run ruff check .` and `uv run pytest` (977 tests) passed clean.
