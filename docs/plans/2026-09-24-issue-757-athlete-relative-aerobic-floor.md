# Issue #757 — Athlete-relative aerobic-volume coverage floor

| Field | Value |
|---|---|
| Status | `In progress` |
| Issue | [#757](https://github.com/Szczepanov/adaptive-training-recommender/issues/757) |
| Blocked by | Nothing: #744 (PR #764) and #756 (PR #766) are merged |
| Policy impact | Yes: bump `POLICY_VERSION` (I5) |
| Knowledge impact | Yes: the #744 placeholder coverage item `stimulus.aerobic_volume_duration_floor` gains a registered claim and an alignment test (I4, ADR-0033) |

---

## 1. Problem

Weekly `aerobic_volume` coverage is binary, and `coverage.ts` `hasRequiredAerobicDose`
grants it once an exposure's effective `durationMin` reaches the catalog workout's
`duration.minimumMin`. That is 30 min for `cycling_zone2_standard_01`,
`running_easy_continuous_01` and `walking_brisk_continuous_01`. The packer
(`weeklyDosePacking.ts` `EVERGREEN_PACKING_COVERAGE`) budgets the role at the same
minimum.

Coverage tier is the **first** sort key in `optimizer.ts` `rankCandidates`. So the same
30 minutes "checks off" a must-have aerobic session for a deconditioned beginner and for a
cyclist whose normal Z2 ride is 60 min. It also lets a 30-min walk satisfy the role for a
cycling-primary athlete, even though the dose-scaled `zone2_aerobic` objective ledger
values that walk at only 75% of a full ride.

## 2. Decisions (approved 2026-09-24)

| # | Question | Decision |
|---|---|---|
| D1 | Floor definition | `floor = max(catalogMinimum, round5(0.75 × median))`, where `median` is the athlete's median full-dose continuous aerobic session duration over the preceding 28 days. The rule needs **≥ 4** qualifying sessions and otherwise falls back to the catalog minimum. |
| D2 | Cross-modality | **One athlete-level floor.** It comes from the athlete's typical session across all aerobic modalities and applies to every `aerobic_volume` identity. A 30-min walk no longer counts for a 60-min cyclist. Coverage stays binary, with no partial credit. |
| D3 | Unreachable floor under a hard cap | **No credit, plus an explicit shortfall.** When the cap keeps every candidate below the floor, no candidate earns `aerobic_volume` credit. Candidates therefore tie on the coverage tier, and no modality flip happens. The unmet role is reported through the packer's existing shortfall warnings. The floor is **not** clamped to the cap. |
| D4 | Scope | Evergreen **and** event coverage sets. Both use the same check, and one rule keeps them consistent. |

**Deferred (not in this change).** The issue's point 4, converging the binary coverage
ledger with the dose-scaled objective ledger through partial coverage credit, is a larger
model change. It stays a follow-up. D2 and D3 remove the concrete symptoms without it.

### 2.1 Rule details

- **Qualifying sessions.** A session qualifies when all of the following hold:
  - its date is in `[asOf − 28, asOf)`; `asOf` is exclusive (Warsaw calendar dates, I2);
  - its modality is a continuous aerobic modality (`Cycling`, `Running`, `Walking`,
    `Swimming`);
  - it is not a readiness-modified (`modify`-tier) dose (#756);
  - its `durationMin` is finite and ≥ the smallest catalog minimum among the
    `aerobic_volume` identities (30 min today).

  The last condition keeps commutes and short incidental walks from dragging the median
  down.
- **Why the median.** One long weekend ride cannot ratchet the floor upward. The 0.75
  fraction keeps a normal-but-shorter weekday session creditable.
- **Rounding and clamping.**
  - The floor is rounded to the nearest 5 min.
  - It is clamped to each workout's catalog `maximumMin`, so a floor always stays
    attainable for that identity.
  - It never goes below that workout's own `minimumMin`.
- **Planned vs completed sessions (review of PR #768).** A completed session meets the
  floor with its actual duration. A planned session (a ranked candidate or a projected
  forecast pick) meets it with the upper bound of its prescribed range. The lower bound
  must still reach the catalog minimum, as before.
  - A 30–60 min Zone 2 ride on a free day therefore claims the role, while a ride capped
    at 35 min cannot.
  - The first implementation compared every candidate's lower bound, 30, with the floor,
    45. That made the role unreachable for established athletes even on free days.
  - The weekly role allocator (`weeklyAllocation.ts` `attachExactEligibleIdentities`)
    applies the same floor.
- **Evidence source (review of PR #768).** `trainingIntent.ts` `resolveTrainingIntent`
  resolves `TrainingIntent.aerobicVolumeFloor` once, and every horizon uses it. The rule
  **never adds a history read**. A caller-prepared snapshot fixes the history revision
  for a dashboard refresh, and tests pin that contract.
  - The floor reuses, in order:
    1. the 28-day athlete-state evidence, which endurance/speed-power/sport-readiness
       evergreen profiles already read;
    2. an operational snapshot that spans 28 days;
    3. the rolling-load window, only when the intent fetched it itself with no prepared
       snapshot (simulation, replay).
  - With none of these, it fails closed to the catalog minimum. This keeps today and the
    week-ahead forecast on the same floor.
  - **Known limitation.** The dashboard (`Home.tsx`, `PlanView.tsx`) prepares a 7-day
    snapshot. In production, the athlete floor is therefore active today only for
    evergreen profiles that already read athlete-state evidence. Event-mode and other
    evergreen athletes keep the catalog minimum until the dashboard prepares a wider
    snapshot. That change also affects the daily rolling-load budget, so it is a
    separate follow-up.
- **Forecast horizon.** The floor is resolved once, as of the decision date, and then held
  constant across the week-ahead projection. Projected sessions do not move the floor
  inside a horizon.
- **Packing under an unreachable floor (refined during implementation).** The first
  implementation raised the packed `aerobic_volume` role to the athlete floor
  unconditionally. Under a 35-min cap, the packer then dropped the role entirely: the
  established-cyclist scenario lost its `zone2_aerobic` objective and fell from 7 rides to
  3, with strength filling the week. That is the "silently drop the aerobic role" outcome
  the issue forbids.
  - `evergreenPlanning.ts` `aerobicPackingForFloor` now raises the role duration only
    when some usable window can hold the floor.
  - Otherwise, the role stays planned at its catalog duration, and an explicit
    `minimum_dose_shortfall` for `aerobic_endurance` states that capped sessions do not
    earn exact aerobic-volume coverage.
  - Coverage *credit* still uses the unclamped athlete floor (D3).

### 2.2 Worked examples

| Athlete (28-day history) | Median | Floor | 30-min walk | 35-min capped ride | 45-min ride |
|---|---|---|---|---|---|
| New user, no history | n/a | 30 (catalog) | credit | credit | credit |
| Novice: 6 × 30–35 min | 30 | 30 (0.75 × 30 = 22.5 → catalog) | credit | credit | credit |
| Established cyclist: 8 × 60 min | 60 | 45 | **no credit** | **no credit** (explicit shortfall) | credit |
| 3 × 60 min only | n/a (< 4) | 30 (catalog) | credit | credit | credit |

## 3. Implementation checklist (TDD order)

Work items are numbered `AF1`–`AF6`. All paths are under `app/src/`.

### AF1: tests first (RED)

1. **`engine/aerobicVolumeFloor.test.ts`** covers the new pure helper:
   - no history, or fewer than 4 qualifying sessions → catalog fallback;
   - the 60-min cyclist → 45;
   - the novice → catalog 30;
   - readiness-modified, sub-30, non-aerobic and out-of-window exposures are excluded;
   - the median resists a single long outlier;
   - rounding goes to 5 min;
   - the per-workout clamp to `maximumMin`.
2. **`engine/coverage.test.ts`** covers:
   - an established 60-min cyclist: a 30-min ride or walk earns no exact
     `aerobic_volume` credit, and a 45-min ride does;
   - a new user with no history: behaviour is unchanged;
   - a capped day where no candidate reaches the floor: no candidate gets an
     `aerobic_volume`-driven coverage tier, so a ride and a walk tie at the coverage tier.
3. **`engine/weeklyDosePacking.test.ts`** (or the evergreen planning test): an athlete
   floor above the day caps produces an explicit shortfall warning.

### AF2: implementation (GREEN)

1. **New `engine/aerobicVolumeFloor.ts`:**
   - named constants: fraction 0.75, minimum samples 4, window 28 days, rounding 5 min;
   - `resolveAerobicVolumeFloor(exposures, asOfDate)`, returning
     `{ floorMin, source: 'athlete_history' | 'catalog_minimum', sampleCount, medianMin }`;
   - `aerobicVolumeFloorForWorkout(workoutId, floor)`.
2. **`engine/coverage.ts`:**
   - `hasRequiredAerobicDose` takes the resolved athlete floor;
   - `coverageKeysForExposure`, `coverageKeysForTemplate` and `buildCoverageState` accept
     an optional floor;
   - `CoverageState` carries the floor, so `coverageNeedTierForTemplate` applies it to
     candidates;
   - when no floor is supplied, behaviour is unchanged.
3. **Callers:**
   - `rules.ts` resolves the floor from `intent.rollingLoadBudgetHistory` and passes it
     to `buildCoverageState`;
   - the `optimizer.ts` `buildOptimizationContext` fallback passes the floor too;
   - `planner.ts` resolves it once in the forecast seed and threads it into
     `evaluateProjectedDate`.
4. **Packer:** `evergreenPlanning.ts` `resolveEvergreenPlan` raises the `aerobic_volume`
   role's `durationMinutes` to the athlete floor. Capacity shortfalls then surface through
   the existing `PackingWarning` path.
5. **`workouts/event-plan.ts`:** update the `aerobic_volume` notes in both coverage sets.

### AF3: knowledge lineage (I4, ADR-0033)

- Register a product-policy claim, `policy.stimulus.aerobic_volume_athlete_relative_floor_v1`
  (`heuristic`, `evidenceCertainty: 'not_applicable'`).
- Its limitations must say explicitly that:
  - the evidence does not show a sharp "minimum effective session" threshold in trained
    athletes;
  - the fraction, window and sample minimum are calibration heuristics;
  - the rule is a coverage-admission floor, not a claim of dose adequacy.
- Update `stimulus.aerobic_volume_duration_floor` to `covered`, with the claim in
  `knowledgeRefs` and updated `codeRefs`. Adjust the inventory summary in
  `knowledgeCoverage.test.ts`.
- Add an alignment test asserting that the claim matches the implemented constants.

### AF4: simulation

Add a novice and an established scenario under the **same** time cap to
`engine/simulation/scenarios.ts`. They should show different, explained aerobic coverage.

### AF5: policy and docs

- Bump `POLICY_VERSION`.
- Add a sentence to `docs/architecture/recommendation-engine.md`.
- Register this plan in `docs/plans/README.md`.

### AF6: gates and baselines

- Run `make check`, `make simulate`, `npm run simulate:plan-judge`, the policy-drift check
  and `npm run persona:build`.
- Persona non-regression: walks must not re-emerge as the aerobic filler in
  `persona_cycling_hybrid_low_time` or `persona_cycling_hybrid_baseline`.
- Refresh baselines in a separate, reviewed `chore(baselines)` commit.

## 4. Risks

| Risk | Mitigation |
|---|---|
| A higher floor raises packed weekly minutes and may trigger capacity shortfalls for time-limited established athletes | This is the intended, explicit behaviour (D3). The shortfall is reported rather than hidden. |
| A floor that ratchets up after a few long rides | The median needs ≥ 4 sessions, the fraction is 0.75, and the floor is clamped to the catalog maximum. |
| Event plans for trained cyclists change more than evergreen plans | Covered by the simulation diff review (D4). |
| Completed history without a duration | `hasRequiredAerobicDose` already fails closed on a missing `durationMin`. |
