# Phase 6.2c — Recommendation quality and weekly coverage correctness

* **Status:** **Implemented.** ADR-0016's dual-ledger contract, regression suite, and
  semantic-baseline review are complete. Phase 7A resolved the historical greedy allocation
  interaction described below; the current baseline matches the affected cycling scenarios.
* **Architecture contract:** [`docs/adr/0016-adaptation-credit-and-weekly-coverage.md`](../adr/0016-adaptation-credit-and-weekly-coverage.md).
* **Coaching source authority:** [`docs/macrocycle-v5.md`](../macrocycle-v5.md).
* **Behavior change:** yes; `POLICY_VERSION` is bumped and semantic changes must be reviewed before baseline mutation/merge.
* **Runtime calendar rule:** cycling plan blocks are derived from `event.timing?.planningDate ?? event.date`; there is no literal September race date in planning authority.
* **Regression-fixture rule:** test dates may be fixed for determinism, but fixtures must be synthetic and **relative-date-based** in what they assert.

---

## 1. Goal

Represent **physiological adaptation credit** and **weekly programming-role fulfillment** as different concepts.

A hard race-specific cycling session may legitimately earn aerobic, threshold, fatigue-resistance, and surge adaptation. That does **not** mean it fulfilled a required `aerobic_volume` or `sustained_quality` programming role. The weekly plan must be able to preserve distinct aerobic-volume, sustained-quality, event-specific, strength, and recovery functions while existing safety/readiness/spacing gates remain authoritative.

The escaped case that motivated this increment is now a named contract: `cycling_specificity_after_hard_race_specific` — an A-priority cycling event in Specificity with exact hard Race-Specific Cycling history on day -1.

---

## 2. Existing accepted decisions — ADR-0016

ADR-0016 already records the architecture decision; this plan does **not** create a second ADR.

The accepted contract is:

1. **Dual ledgers.** The existing fractional `WeeklyObjective` ledger remains physiological/adaptation accounting. Weekly programming-role coverage is a separate count-based ledger.
2. **Explicit role identity.** Coverage is earned only through exact authored workout/template identity mapped by the cycling event-plan coverage table. Stimulus magnitude, display title, broad modality, or category alone cannot invent a coverage role.
3. **Safety outranks coverage.** Time, equipment, injury, readiness/fatigue, hard-load caps, and spacing remain hard gates before coverage affects ordering.
4. **Rolling coverage.** Coverage is evaluated over a rolling seven-day window, with plan-block boundaries respected.
5. **Event-relative plan.** Cycling Build/Specificity/taper/race/recovery blocks derive from the actual event planning date. Travel remains an explicit availability/day-context overlay rather than an automatically fabricated pre-race week.
6. **Sequence search remains experimental.** Greedy stays production until the corrected semantics are measured; beam search must preserve the same lexicographic coverage ordering when it is evaluated.

Unresolved implementation decisions should be recorded as amendments to ADR-0016, not by reopening the already-accepted adaptation-vs-coverage decision.

---

## 3. Coverage model

The authoritative coverage vocabulary remains in `app/src/workouts/event-plan.ts`, including:

- `easy_aerobic`
- `sustained_quality`
- `outdoor_event_specific`
- `primary_strength`
- `recovery_or_rest`
- taper/race-specific roles.

`PlanObjectiveDefinition.coverageKey` makes those roles decision-bearing. The coverage ledger stores required minimum session counts separately from physiological `requiredCredit`.

### Adaptation may fan out; coverage may not be inferred

A Race-Specific Endurance workout can legitimately earn aerobic and threshold **adaptation** credit. It only earns `outdoor_event_specific`/other coverage keys that the authored event-plan mapping explicitly assigns to its detailed workout id. It cannot satisfy `easy_aerobic` or `sustained_quality` merely because its stimulus vector overlaps those axes.

### Exact fixed-activity identity

`FixedActivity` may optionally persist `templateId` and/or `workoutId` when `expectedStimulus` is intended to participate in scoped objective/coverage logic. Supplied identities must resolve to one consistent active catalog prescription.

A legacy fixed activity without catalog identity may still reserve time/cost and may contribute to a truly unscoped physiological objective, but it cannot invent a cycling programming role. No title-keyword inference is allowed.

---

## 4. Stable occurrence identity and idempotency

Template/workout ids identify a **family**, not one training occurrence. All projection/history/coverage paths therefore use a stable occurrence key.

```ts
interface ExposureIdentity {
  occurrenceKey?: string;
  templateId?: string;
  workoutId?: string;
}

interface CoverageCredit {
  occurrenceKey: string;
  date: string;
  coverageKey: EventPlanCoverageKey;
  source: 'completed' | 'projected' | 'fixed_activity';
}
```

Canonical keys:

- selected/projected daily recommendation: `recommendation:<YYYY-MM-DD>`;
- a reconciled completed event linked to that recommendation: the **same** `recommendation:<YYYY-MM-DD>` key;
- unmatched completed event: `completed:<event-id>`;
- fixed activity: `fixed:<activity-id>`.

Rules:

1. one occurrence may earn adaptation on several physiological axes;
2. one occurrence may earn several coverage keys only when the authored mapping explicitly declares them;
3. the same occurrence is counted at most once per ledger transition;
4. projection -> completed reconciliation reuses the same occurrence key instead of creating a second training session;
5. selected recommendations and fixed-activity projections are deduplicated **before** applying objective/fatigue/coverage state changes.

Legacy history without an occurrence key uses a conservative deterministic fallback and is collapsed rather than double-counted.

---

## 5. Weekly urgency and sequencing

Coverage is a lexicographic signal after hard gates, not another arbitrary coefficient.

Current ordering:

- tier 0 — the hard role explicitly nominated for this date;
- tier 1 — an unmet immediately-fillable required minimum, or repair of a missed/expired hard role once the aerobic floor is established;
- tier 2 — deferred support/target coverage;
- tier 3 — no active coverage advancement.

`easy_aerobic` is the aerobic-volume floor for hard-role repair. `primary_strength` remains a required role but does not veto the next feasible cycling-quality repair. `recovery_or_rest` is a required weekly shape but is normally deferred to a fatigue/adjacency/low-opportunity-cost day rather than forced on the first healthy day of a new rolling window.

A nominated quality/event-specific anchor outranks a different overdue hard role on that date. If an anchor is infeasible because of hard safety/fatigue/spacing constraints, the still-missing role remains repairable later in the rolling horizon.

Beam-search branch pruning must preserve this coverage tier before cumulative utility; otherwise the beam would discard the same lexicographic semantics used to rank daily candidates.

---

## 6. Event-relative cycling plan

`buildCyclingEventPlan(event)` derives the schedule from the actual target:

```text
planning date = event.timing?.planningDate ?? event.date
Build         = planning date -84 .. -36 days
Specificity   = planning date -35 .. day before taper
A taper       = final 14 days
B taper       = final 5 days
C taper       = none by default
Race          = planning date
Recovery      = +1 .. +7 days
```

The old `buildSeptemberCyclingEventPlan` symbol may remain only as a backwards-compatible alias for tests/importers. It is not calendar authority. Likewise any legacy `SEPTEMBER_*` coverage constant name is a naming compatibility issue, not a hard-coded race date.

---

## 7. Today/tomorrow projection contract

Today and tomorrow are part of the same rolling planning state, not two independent recommendations.

For tomorrow evaluation, the projection includes today's selected recommendation with:

- exact template/workout identity;
- stimulus credit;
- external fatigue cost;
- session role/history for recovery spacing;
- stable `recommendation:<date>` occurrence identity;
- today's booked fixed cost/exposure where applicable.

Today's check-in-derived availability object is reused through eligibility and ranking so `TIME_BUDGET_EXCEEDED` cannot see a looser profile budget than the earlier candidate filter.

---

## 8. Deterministic regression contracts

### `specificityCoverageContract.test.ts`

The direct escaped-case contract requires, after a hard race-specific day -1:

- appropriate immediate recovery/support is allowed;
- at least one true easy-aerobic cycling exposure;
- a distinct sustained-quality cycling exposure once recovered;
- appropriately spaced event-specific work during the rolling horizon;
- technical/mobility work may appear but cannot substitute for all developmental roles;
- hard cycling roles stay separated by the existing hard spacing gates.

### Shared Phase 6.3 scenario

`simulation/scenarios.ts` contains `cycling_specificity_after_hard_race_specific` with exact initial completed history. The same scenario is consumed by `scenarios.test.ts`/the analysis harness, so this escaped case is part of future semantic regression evidence rather than a one-off unit fixture.

### Other required tests

- exact workout/template -> coverage mapping;
- race-specific adaptation does not satisfy easy-aerobic/sustained-quality coverage;
- coverage expiration over the rolling window;
- arbitrary cycling event dates produce event-relative blocks;
- fixed-activity exact identity round-trip and mismatch rejection;
- projected/completed occurrence identity is idempotent;
- today affects tomorrow load/credit/spacing;
- greedy and beam both honor the golden-week safety/coverage contract.

---

## 9. Implementation status

### Implemented on PR #17

- [x] ADR-0016 accepted and linked as the architecture authority.
- [x] Separate adaptation and weekly coverage ledgers.
- [x] Exact catalog mapping for coverage, using the same detailed-workout resolver as prescription generation.
- [x] Event-relative cycling `PlanDefinition`; literal September race-date dependency removed.
- [x] Distinct `easy_aerobic`, `sustained_quality`, `outdoor_event_specific`, `primary_strength`, and recovery coverage contracts.
- [x] Coverage-aware lexicographic ranking after hard gates.
- [x] Today check-in availability reused through ranking.
- [x] Today's chosen recommendation projected into tomorrow cost/stimulus/history.
- [x] Fixed-activity optional exact template/workout identity added to service/rules boundary.
- [x] Stable occurrence-key contract added for recommendation/completed/fixed projections.
- [x] Beam pruning updated to preserve coverage lexicographic order.
- [x] Direct escaped-case Specificity regression added.
- [x] Shared Phase 6.3 `cycling_specificity_after_hard_race_specific` input added.

### Final acceptance evidence

- [x] Full frontend + Firestore-emulator suite green on the final head (`npm run check`:
      537 passed / 29 skipped; `npm run test:rules`: 29 passed; `uv run pytest`/`ruff`/`mypy`
      all clean).
- [x] Shared escaped-case scenario contract green (`specificityCoverageContract.test.ts`,
      `specificityScenario.test.ts`, `coverage.test.ts`, `coverageOccurrence.test.ts` --
      8/8 passing).
- [x] Review the semantic recommendation diffs (`npm run simulate:diff` against the
      committed baseline). The current diff reports only newly added scenarios; no existing
      baseline scenario changed.
- [x] The historical recovery-share spike and strength-role loss are resolved. Current and
      committed results match for `cycling_gran_fondo_A`, `cycling_criterium_A`, and
      `cycling_criterium_stressed_A`: 39.3%/39.3%/42.9% rest-or-recovery share respectively,
      with `strength_maintenance` resolved in all four simulated weeks. Phase 7A's explicit
      role reservations prevent the greedy planner from losing healthy developmental roles
      to supporting work without altering the production fatigue-fusion policy.
- [x] Resolve/reply to every remaining PR review thread with the validating commit/CI
      evidence -- done, with this finding surfaces explicitly rather than silently
      accepting the diff to close out the threads.

---

## 10. Rollback conditions

Do not bless the semantic baseline if any of the following occurs:

- hard safety/time/equipment/injury gates regress;
- required cycling roles are satisfied by broad stimulus overlap rather than exact coverage identity;
- the escaped Specificity case loses true Zone 2 or distinct sustained quality;
- quality/event-specific work stacks without the existing spacing protection;
- a projection/completed reconciliation counts one physical session twice;
- the new policy causes an unexplained recovery/rest spike across healthy build/Specificity scenarios;
- beam search appears better only because it no longer honors the same coverage ordering as greedy.

If one of these occurs, keep the previous reviewed baseline and fix the policy before recalibration.
