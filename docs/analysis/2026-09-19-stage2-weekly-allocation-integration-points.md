# Stage 2 weekly-allocation integration points for typed performance goals (2026-09-19)

**Date:** 2026-09-19
**Status:** point-in-time analysis
**Scope:** map the exact engine files, functions and data shapes that PG5.2, PG5.3, PG6
and PG7 of [docs/plans/strength-speed-power-performance-goals.md](../plans/strength-speed-power-performance-goals.md)
will touch, before any of that code is written. Produced while scoping the PR that
shipped PG5.1 ([PR #671](https://github.com/Szczepanov/adaptive-training-recommender/pull/671)),
after review cut that PR down from an originally-proposed "PG5-PG7 in one pass" scope.

---

## Why this exists

PG5-PG7 wire a previously-inert typed goal (`UserGoal.performanceTarget`, ADR-0041) into
real weekly-planning decisions for the first time. Before writing any of that code, this
audit answers eight structural questions so the next implementation session doesn't have
to re-derive them from scratch, and so an architecture decision that clearly needs one
(§3) gets made deliberately rather than discovered mid-implementation.

---

## 1. Goal-to-context adapter

`app/src/engine/adapters.ts`'s `mapContextFromGoalsAndTrainingSettings(goals, ...)`
builds `UserContext`. As of PG5.1 it also calls
`mapGoalsToPerformanceGoalDemands(goals)` (from `app/src/engine/performanceGoalDemand.ts`)
and attaches the result as `UserContext.performanceGoalDemands`. **Nothing reads that
field yet** — `performanceGoalDemand.architecture.test.ts` enforces this more broadly than
a fixed engine-file allowlist: it recursively scans production `.ts`/`.tsx` modules under
`app/src` and permits the field only in `engine/models.ts` (the contract declaration) and
`engine/adapters.ts` (the projection write). Any other production reference fails the guard.

`performanceGoalDemand.ts` already exports `comparePerformanceGoalDemands`, a
deterministic comparator (priority desc → earlier `targetDate` first → dated before
open-ended → ascending `goalId`) matching the plan's PG7 tie-break text exactly.
**PG7 must reuse this comparator rather than reimplementing the tie policy.**

`UserContext.goals.{shortTerm,midTerm,longTerm}` (the pre-existing, structurally
analogous decorative field) is confirmed unused by `rules.ts`/`optimizer.ts`/
`evergreenStrategy.ts` — `UserContext` itself is largely a UI/composition-boundary
object, not the direct input to planning functions. Do not assume adding a consumer
inside `adapters.ts` or `UserContext`'s type is sufficient to make demand data "live" —
the actual planning entrypoints take narrower, purpose-built inputs (see §2-3).

## 2. Broad training priorities → dose translation

`app/src/engine/evergreenStrategy.ts`'s `resolveEvidenceBackedStrategy(goalOrEvent, athleteState)`
is fed from `TrainingIntentProfile.priorities` (a persisted, athlete-selected field,
**not** derived from `UserGoal[]`), and returns
`EvidenceBackedStrategy { requirements: AdaptationDoseRequirement[], hardSessionCap?, warnings }`.

- `strength_muscle` → `strengthRequirement('required')`: a fixed floor
  (`dose: {unit:'sessions', value:2}`, `target: {min:2,target:2,max:3}`,
  `substitutionPolicy.permittedModalities: ['Strength']`) with **no exercise identity at
  all**.
- `speed_power` → gated, optional `high_intensity` credit only when
  `canUseConditionalPrior` (established athlete, high data quality, not adverse
  recovery); generic threshold/interval credit, not movement-specific.

`AdaptationDoseRequirement` has **no field today** for exact exercise/subject identity.
PG5.3's "refine in place rather than duplicate" therefore needs new surface on this type
(e.g. an optional narrowing/preference field), not an overload of an existing one. Adding
a **second** `AdaptationDoseRequirement` with `adaptation: 'strength'` would double-count
floor/target dose in `weeklyDosePacking.ts`'s `packWeeklyDose` — this is the literal
double-counting PG5.3 must avoid, and the existing type gives no shortcut around doing it
properly.

## 3. Weekly allocation / role reservation — the open design question

**Governing ADR:** `docs/adr/0018-weekly-allocation-and-role-reservations.md`.
**Implementation:** `app/src/engine/weeklyAllocation.ts`'s `resolveWeeklyRoleReservations`
(a deterministic backtracking search over `RequiredRoleOccurrence[]`), driven by
`app/src/engine/planner.ts`'s per-day forecast loop, fed by `app/src/engine/coverage.ts`'s
`buildCoverageState` → `deriveRequiredRoleOccurrences`.

Authority order actually implemented today, in `planner.ts`, per forecast day:

1. hard safety/eligibility gate;
2. fatigue-tier gating;
3. **role-reservation intersection** — `RequiredRoleOccurrence.eligibleTemplateIds`
   narrows the ranking candidate set before scoring, when a reservation exists;
4. normal `rankCandidates`/optimizer scoring on the surviving set.

**`resolveWeeklyRoleReservations`'s search objective is "maximize count of fulfilled
occurrences," with ties broken by `windowEnd → coverageKey → ordinal → id`. Every
`RequiredRoleOccurrence` is weighted identically — there is no authority-tier dimension
in the search itself.** Naively appending performance-target occurrences into the same
`occurrences` array the search consumes would let it trade a broad-adaptation slot for a
performance-target slot (or vice versa) purely by count, violating the plan's required
order (broad adaptation must outrank performance-target coverage). This is a genuine gap,
not a wiring detail, and needs a decision before implementation:

- **Option A — extend the search with an explicit priority/tier dimension.** Keeps one
  unified search and one set of tie-break rules, but changes `resolveWeeklyRoleReservations`'s
  objective function, which ADR-0018 governs.
- **Option B — sequential reservation passes** (broad-adaptation first, performance-target
  second, over remaining unreserved dates only). Matches "priority order" semantics more
  directly, but is exactly the "new greedy pass" the plan's PG7 section explicitly warns
  against building without ADR sign-off.

**Recommendation: resolve this with its own ADR amendment (or a new ADR referencing
ADR-0018) before writing PG7's implementation**, not as an implementation-time judgment
call. Whichever option is chosen, `weeklyAllocation.ts` must be added to
`app/scripts/check-policy-drift.mjs`'s `decisionAffectingFiles` (it is a real, active gap
today — see §6) as part of that same PR.

## 4. Continuous stimulus-benefit scoring is the wrong layer for exercise identity

`app/src/engine/optimizer.ts`'s `calculateStimulusBenefit` scores candidates on continuous
`SessionTemplate.stimulusProfile` axes against `WeeklyObjective.targetStimulus`, with
weights pinned as reviewed product policy in
`app/src/knowledge/optimizerScoringKnowledge.ts` (`stimulusBenefitWeightsPolicy`,
asserted by `optimizerScoringPolicyAlignment.test.ts`). **That specific scoring function
has no per-exercise identity concept.**

Do not generalize that observation to `rankCandidates` as a whole. The live ranking path
already carries **exact authored-coverage identity** through
`coverageNeedTierForTemplate` → `coverageKeysForTemplate` → authored workout identity,
and `rankCandidates` sorts `coverageNeedTier` before recovery preference, benefit tier
and utility. Separately, when ADR-0018 has nominated a reservation for the date,
`planner.ts` intersects the candidate set with that occurrence's
`eligibleTemplateIds` before ranking. Exact authored identity therefore participates at
two existing layers: reservation eligibility and lexicographic coverage ordering.

**Conclusion:** "this candidate provides direct conventional-deadlift practice" must not
be implemented as another `calculateStimulusBenefit` weight. PG7 should extend/reuse the
existing discrete coverage/reservation machinery (including the current coverage-tier
ordering where ranking fallback/support logic needs it), with the ADR in §3 deciding how
performance-target occurrences coexist with stronger broad-adaptation reservations.
Changing `stimulusBenefitWeightsPolicy` is appropriate only if the continuous utility
calibration itself changes, not merely because a new exact-identity coverage rule exists.

## 5. Exercise/session coverage classification is new code, and has a schema question

Two separate, non-unified schemas exist for "this session contains exercise X":

- **Post-hoc (logged execution):** `app/src/workouts/oneRepMaxWriteback.ts`'s
  `deriveOneRepMaxUpdatesForSession`, matching `session.exercises[].exerciseId` on a
  *completed* `StrengthSession`. Not applicable to planning-time classification.
- **Pre-hoc (authored catalog), evergreen path:** `WorkoutDefinition.blocks[].steps[].exerciseId`
  (`app/src/workouts/models.ts`) — the schema `weeklyDosePacking.ts`'s
  `exactWorkoutIds`/`EVERGREEN_PACKING_COVERAGE` actually resolve through
  (`WORKOUTS_BY_ID`). **No reusable production helper exists** to answer "does this
  `WorkoutDefinition` contain exercise X" — every occurrence found is inline test code.
- **Pre-hoc, external/authored-session path:** `app/src/engine/authoredSessionProfiles.ts`
  (`requiredExerciseSteps`, `classifyStep`) is the closest existing per-exercise
  classifier, but it is an explicit default-off, non-production measurement candidate
  (M8.1: "nothing here is imported by any production selection path... code exists is
  never itself authorization") operating on the **different** `sessions/models.ts`
  `SessionStep.exerciseRef` schema.

**PG5.2's coverage classifier must decide which schema is authoritative for evergreen-plan
coverage** (almost certainly `workouts/models.ts`, since that's what the evergreen
dose-packing pipeline actually resolves) and will need to write this classifier as new
code — it is not a reuse of `authoredSessionProfiles.ts`, which targets a different
pipeline entirely.

## 6. `POLICY_VERSION` / `check-policy-drift.mjs`

`POLICY_VERSION` lives in `app/src/engine/policy.ts`, with an append-only
`HISTORICAL_POLICY_VERSIONS` array retaining prior policy identities. The current naming
convention is `YYYY-MM-<slug>-vN`.

`app/scripts/check-policy-drift.mjs` maintains an explicit `decisionAffectingFiles`
allowlist plus a blanket guard for `app/src/workouts/catalog/`. Relevant entries for this
work already include `rules.ts`, `optimizer.ts`, `planner.ts`, `adapters.ts`,
`evergreenStrategy.ts`, `weeklyDosePacking.ts`, `coverage.ts`, `evergreenPlanning.ts`,
`planSchedule.ts`, `templates.ts`, `workouts/models.ts`, `workouts/prescription.ts`,
`workouts/event-plan.ts` and `sessions/catalogSessionAdapter.ts`; the allowlist also
contains other decision-affecting engine surfaces unrelated to PG5-PG7. This is therefore
a relevant subset, not an exhaustive transcription of the file.

**Confirmed gap, still open after PG5.1:** `app/src/engine/weeklyAllocation.ts` — the
file PG7 must actually change — is **not** on this list. Today that's masked because
`planner.ts` (which *is* listed) is always touched alongside it in practice, but a PG7
change isolated to `weeklyAllocation.ts` could slip past the drift gate undetected.
**Add `weeklyAllocation.ts` to `decisionAffectingFiles` as part of PG7's own PR**, not
speculatively before then.

## 7. Simulation harness (what a human actually reviews)

`make simulate` = `npm run simulate:scenarios` + `npm run simulate:diff`.

- `simulate:scenarios` → `app/scripts/simulate-scenarios.mjs`, SSR-loads
  `src/engine/simulation/analyze.ts`'s `runAllScenarios`, writes
  `artifacts/simulation-reports/latest/report.json` with per-scenario aggregate
  distributions: rest/recovery-day %, event-anchor hit-rate, objective-credit-by-template
  breakdown, and **ADR-0018 role-allocation status counts** (`reserved`/`fulfilled`/
  `missed`/`unresolved_search_budget`, straight from `WeeklyRoleAllocationReport`).
- `simulate:diff` → `app/scripts/simulate-diff.mjs` re-runs scenarios and prints a semantic
  diff against the committed `docs/analysis/simulation-baseline.json` — the artifact a
  human reads to judge "did this change alter live recommendations, and is that
  intended."
- `simulate:update-baseline -- --reviewed` refuses to run without the literal
  `--reviewed` flag: a human must run `simulate:diff`, read the distribution deltas, and
  only then intentionally re-baseline. **This is the actual human sign-off gate** for any
  change that alters persisted recommendation distributions.

**Caveat confirmed against `app/src/engine/simulation/scenarios.ts`:** the committed
simulation scenarios do not include a typed `performanceTarget`. `simulate:diff` showing zero
change is therefore a weak signal for "this is inert" — it may just mean "never
exercised." **PG5.3/PG7 should add at least one scenario fixture with a typed
performance goal** before relying on `simulate:diff` as meaningful evidence of impact
(or its absence).

## 8. Existing shortfall/diagnostic pattern

The codebase consistently uses a discriminated-union `code`/`reason` field plus a
human-readable `message`, attached at the layer that discovered the miss — never
collapsed into a generic bucket:

- `evergreenStrategy.ts`: `InferenceDiagnostic.code`, `PolicyWarning.code` (e.g.
  `'conditional_prior_withheld'`).
- `weeklyDosePacking.ts`: `PackingWarning.code` (`'below_guideline_range' |
  'guideline_target_shortfall' | 'goal_requirement_shortfall' | 'minimum_dose_shortfall' |
  'no_exact_eligible_role' | 'goal_constraint_conflict'`), tagged with `adaptation`.
- `weeklyAllocation.ts`: `WeeklyRoleMissReason` (`'no_exact_candidate' |
  'hard_safety_or_recovery' | 'daily_ledger_capacity' | 'projected_fatigue' |
  'fixed_seed' | 'no_conflict_free_date'`), attached only when `status === 'missed'` —
  **never** conflated with `'unresolved_search_budget'` (ADR-0018 D-MISS: budget
  exhaustion is never converted into a safety miss or false infeasibility).

`app/src/engine/performanceGoalDemand.ts` already forward-declares
`PerformanceGoalCoverageMissReason` (PG5.4) matching this exact shape and the plan's own
list of reasons. **PG7 should attach it to whatever outcome record its allocation layer
produces per performance-goal demand**, following this convention rather than reusing
`'goal_requirement_shortfall'`/`'no_exact_candidate'`, which already mean something else
(broad-adaptation vs. exact-role misses respectively).

---

## Summary table: what each remaining capability actually touches

| Capability | Primary files | New surface needed | Real risk if rushed |
|---|---|---|---|
| PG5.2 (planning-rule registry) | new file; reads `workouts/models.ts` | coverage classifier (§5); resolves the schema question | inventing a broad-adaptation string not evidence-backed |
| PG6 (catalog audit/fill) | `workouts/catalog/*`, `workouts/exercises*.ts` | at least one conventional-deadlift-capable session | inventing new sets/reps/%1RM defaults without SKR review |
| PG5.3 (dose/coverage refinement) | `evergreenStrategy.ts`, `weeklyDosePacking.ts` | new optional field on `AdaptationDoseRequirement` | narrowing an existing floor before PG6 gives it real coverage (regression) |
| PG7 (allocation-authority wiring) | `weeklyAllocation.ts`, `planner.ts`, `coverage.ts` | priority-tier resolution (§3, needs its own ADR) | search trading a broad-adaptation slot for a performance-target slot by accident |
