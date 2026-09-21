# Issue #706 review memo

Purpose: shareable analysis for an independent agent reviewing whether issue #706 describes a defect, a design ambiguity, or behavior already covered by the current weekly-allocation implementation.

Issue: https://github.com/Szczepanov/adaptive-training-recommender/issues/706

Current status: Open. The issue describes an anchor-day rolling-budget scenario and proposes using conservativeBias / Extra Recovery Margin as a possible resolution. The current owner comment rejects both that preference coupling and an anchor-day budget bypass, and instead recommends protecting high-priority weekly-objective feasibility within the rolling envelope.

## Executive conclusion

The owner comment has the right policy direction, but part of its proposed implementation is already present in the repository. The current code already has a bounded weekly role allocation search and a greedy-planner viability check that use the real projected-date hard-gate path.

The evidence presently supports this narrower conclusion:

> The observed fixed-commitment exhaustion case is expected hard-gate behavior, not an anchor-placement bug. The remaining question is whether there is a missing regression proving that discretionary planner choices cannot consume the last feasible opportunity for a higher-priority weekly role when an alternative allocation exists.

Recommended disposition:

1. Do not add an anchor-day bypass in isLoadBudgetAdmitted.
2. Do not make conservativeBias control rolling-budget admission or reservation.
3. Keep #706 open, retitled around rolling-budget-aware D-SUPPORT fail-open behavior.
4. Add focused Case A/B/C regressions and an explicit rolling-budget role-miss reason.
5. Fix the ranked[0] fail-open fallback and surface unresolved allocation when preservation is not proven.
6. Update the relevant ADR wording, then close #706 after the implementation and regressions pass.

## Question under review

The issue asks whether a rolling catalog-load budget should protect an event-specific or quality anchor date, and whether Extra Recovery Margin should decide the conflict.

The important policy distinction is not “anchor versus budget” in the abstract. There are three different situations.

### Case A: committed load already makes the objective infeasible

Fixed activities and schedule overlays are commitments. If their expected costs alone consume the relevant rolling envelope, there is no remaining feasible budget for another positive-cost session. An anchor exception would intentionally violate the hard envelope.

Expected behavior:

- the candidate remains budget-excluded;
- the anchor loses as a timing preference;
- the planner records a typed infeasibility or missed-coverage reason where applicable;
- the engine never exceeds the rolling envelope merely to preserve the anchor.

This is the scenario exercised by the current anchor exhaustion probe. It is not, by itself, evidence of a defect.

### Case B: discretionary choices consume the last feasible future opportunity

The budget still permits a required/key session, but an earlier lower-priority planner choice consumes capacity before the required objective is evaluated. This is a legitimate candidate defect: a greedy horizon decision may destroy the only feasible way to satisfy a higher-priority weekly role.

Expected behavior:

- the required role is protected within the feasible envelope;
- the lower-priority support candidate is rejected, relocated, or dose-adjusted when that preserves a real feasible objective witness;
- if no witness exists after committed load and hard gates are applied, the role is recorded as infeasible rather than forcing an unsafe or over-budget session.

### Case C: the nominated anchor date is infeasible, but another date or dose works

An anchor is a preferred placement, not an admission authority. If the anchor date fails a readiness, injury, taper, daily-capacity, or rolling-budget gate while another date/dose can fulfil the same objective inside the envelope, the objective should move.

Expected behavior:

- preserve objective/role coverage where feasible;
- report that the role moved from its nominated date;
- do not bypass hard gates merely because the original date was nominated.

The current probe does not distinguish these cases, so it cannot decide the policy question without being split.

## Current implementation evidence

### Budget admission precedes anchor ranking

In app/src/engine/planner.ts, evaluateProjectedDate constructs rolling-budget entries and defines isLoadBudgetAdmitted. It includes projected history, incomplete fixed activities with expected cost, and schedule-overlay costs. It then computes:

1. budgetAdmitted from ledger-admitted candidates;
2. fatigueGated from budget-admitted candidates;
3. anchorRole for the date;
4. optimizationContext with anchor information.

Consequently, an anchor bonus cannot rescue a candidate that fails the rolling budget. This is consistent with the ADR-0011 rule that anchors are ranking preferences applied after hard gates, but the interaction with ADR-0043 should be made explicit in the docs.

This ordering is not enough to establish a bug. It is correct for Case A and Case C. A defect would require demonstrating Case B: a discretionary choice was admitted even though it destroyed a feasible higher-priority allocation that the current weekly allocator should have preserved.

### conservativeBias is downstream of admission

conservativeBias currently affects projected fatigue thresholds and candidate ranking. The rolling budget itself remains preference-independent. A budget-excluded candidate never reaches the ranking stage, so changing Extra Recovery Margin cannot currently affect the anchor-versus-budget result.

This separation is desirable:

- Extra Recovery Margin describes readiness/risk interpretation and ranking caution;
- rolling-budget admission is deterministic horizon accounting;
- weekly role protection is allocation policy;
- an unrelated boolean should not silently govern all three.

Using conservativeBias as a budget-protection switch would create semantic coupling, alter default behavior for users whose preference is false, and give a UI label a hidden effect on a hard admission policy. If a future user-facing control is required, it should be a new explicit policy with its own lineage and calibration, not an implicit reuse of conservativeBias.

### Weekly role reservation already exists

The repository has an implemented weekly allocation layer:

- app/src/engine/weeklyAllocation.ts defines resolveWeeklyRoleReservations.
- The allocator searches over minimum required role occurrences using deterministic bounded DFS/backtracking.
- Each tentative assignment is re-evaluated through the injected AllocationDateEvaluator.
- The planner implementation of that evaluator calls the same projected-date evaluation seam used by normal planning, so rolling-budget, daily-ledger, fatigue, safety, and other hard gates are not reimplemented in a parallel rules engine.
- The search state is an unordered assignment set and projected evaluation is rebuilt in date order, which is intended to prevent occurrence-examination order from changing the result.
- The explicit deterministic bounds are seven dates, fourteen occurrences, four candidates per occurrence, and 1,024 projected-state transitions.
- If the search cannot prove a result within those limits, it returns unresolved_search_budget rather than pretending the role was definitively missed.

### Greedy planner viability protection already exists

In generateWeekAheadPlan, the planner:

1. creates an allocationEvaluator backed by projectedEvaluation;
2. resolves weekly role reservations;
3. re-resolves reservations as the forecast advances;
4. identifies reserved candidates for the current date;
5. evaluates otherwise-ranked candidates with preservesAllocation;
6. rejects a candidate when it would reduce the achievable required-role allocation or invalidate an incumbent reservation, subject to the declared search budget.

This corresponds closely to the owner comment’s proposed short-term forward-feasibility guard. The implemented Phase 7 plan explicitly describes the same contract: an unreserved support candidate or discretionary Rest is excluded when it reduces maximum achievable required-role reservation count, invalidates an earlier-deadline reservation, or cannot prove preservation within the bounded search.

Therefore, describing weekly allocation / forward feasibility as wholly future work would be inaccurate. The right review question is whether the existing implementation has a specific rolling-budget starvation gap or merely lacks a focused regression for it.

## Interpretation of the current audit evidence

The scenario-audit run used real engine paths and ignored scratch probes.

### Anchor-day budget exhaustion

The probe placed three fixed commitments on non-anchor days whose combined systemic cost exceeded the weekly ceiling. Hard Endurance candidates on the anchor date were excluded, and the exclusion set was unchanged when the same date was treated as ordinary rather than anchor.

Interpretation: this confirms that anchor ranking does not bypass a hard rolling-budget failure. It does not show that a feasible required objective was destroyed by a lower-priority discretionary choice. It is Case A unless the probe is redesigned.

### Cross-dimension budget probes

The minimal cross-dimension probe was clean under the current code. Realistic/catalog variants produced apparent anomalies because real Strength templates carry positive cardiovascular cost; under ADR-0043, a positive candidate is not a zero-contribution exception merely because one dimension is small. Those variants were rejected as false positives or duplicates of established budget semantics.

### conservative-bias candidate

The conservative-bias candidate was independently refuted. Budget exclusion behavior was unchanged because the budget is intentionally preference-blind and operates before ranking. This supports rejecting conservativeBias as the resolution mechanism.

### Undated fixed activity

The undated fixed-activity probe was clean. The implementation reserves an undated one-time expected cost once against the shared horizon rather than multiplying it once per forecast date.

### Independent review status

The Sol 5.6 review agent classified the conservative-bias candidate as refuted and the anchor candidate as a design/duplicate concern rather than a confirmed defect. A separate Sol 5.6 adversarial verifier also refuted the conservative-bias candidate. No additional confirmed finding survived the audit funnel beyond the already closed #705 context.

## Recommended policy hierarchy

The following hierarchy reconciles ADR-0011, ADR-0018, and ADR-0043:

1. Clinical, injury, readiness, acute-fatigue, taper, and daily-capacity constraints are hard feasibility gates.
2. Fixed activities and schedule overlays are committed load and consume rolling-envelope capacity before discretionary planning.
3. The rolling catalog-load budget is a hard total envelope for established profiles.
4. Required/high-priority weekly objective coverage receives allocation priority within the feasible envelope.
5. Anchor dates are preferred placements for that coverage, not admission authority.
6. Ranking preferences, including Extra Recovery Margin, choose among candidates that remain feasible; they do not create budget capacity.
7. If committed load and hard gates make an objective impossible, the engine reports the typed miss/infeasibility rather than violating the envelope.

This hierarchy preserves both existing principles:

- “Anchors nudge; they do not command.”
- A candidate that exceeds the rolling envelope is rejected.

The missing documentation detail is that weekly objective allocation should be performed before discretionary utility choices consume the remaining feasible envelope. That is the meaningful part of the owner comment to preserve.

## Recommended validation plan

The independent reviewing agent should inspect or request tests for these contracts.

### Required regression scenarios

1. Committed exhaustion: fixed/overlay costs alone leave no relevant budget. The key candidate remains excluded; no anchor bypass occurs; the result contains a typed infeasibility or missed-coverage reason.
2. Discretionary starvation: a lower-priority support candidate is individually admissible, but accepting it removes the last feasible candidate for a higher-priority weekly role. The support candidate is rejected, moved, or dose-adjusted.
3. Anchor relocation: the nominated anchor date is infeasible, but another date or dose satisfies the same required role. The reservation moves and reports wasMoved.
4. No feasible witness: no date/dose can satisfy the role after committed load and hard gates. The engine reports a miss; it does not exceed the envelope.
5. Candidate self-cost: an anchor/objective-matching candidate that itself exceeds a relevant remaining dimension stays rejected.
6. Existing completion: a completed/fixed activity that already satisfies the role does not trigger a duplicate reservation.
7. Provisional profile: insufficient baseline evidence preserves current provisional behavior and does not accidentally activate the reservation contract.
8. Eventless week: no cycling/event-specific anchor semantics leak into a base week.
9. Preference independence: toggling conservativeBias does not change rolling-budget admission or weekly reservation semantics.
10. Order independence: equivalent facts produce equivalent protected-role feasibility regardless of the order in which lower-priority forecast dates are examined.

### Evidence the test should expose

The test should report, at minimum:

- nominated date and assigned date;
- role/objective identity;
- candidate template and active dose;
- rolling-budget profile confidence;
- fixed/overlay cost contribution;
- candidate cost contribution;
- budget exclusions and their dimensions;
- reservation status and miss reason;
- whether a lower-priority candidate was vetoed by preservesAllocation;
- whether the search returned budgetExhausted or a proven result.

Avoid asserting that every anchor must survive. The invariant is preservation of the highest-priority feasible objective within the hard envelope, not universal anchor protection.

## Suggested issue disposition

The original anchor/budget and Extra Recovery Margin questions are settled as “no / no.”
The narrowed issue scope is:

> Rolling-budget-aware weekly allocation allows a lower-priority projected choice to remove the last feasible required-role witness.

The implementation also needs to report committed-load misses as `rolling_load_budget` and
must not fall through to `ranked[0]` when bounded D-SUPPORT preservation cannot be proven.
The fix should target weeklyAllocation.ts / planner.ts viability behavior. It should not
introduce an anchor-specific bypass or couple the result to conservativeBias.

## Questions for the independent reviewing agent

Please return a verdict on each question separately:

1. Does the current Case A reproduction demonstrate a defect, or expected hard-gate infeasibility?
2. Does the current planner actually protect Case B through resolveWeeklyRoleReservations and preservesAllocation, including rolling-budget exclusions?
3. Is there a reproducible Case B counterexample in the current code?
4. Does Case C relocate/dose-adjust the required role when a feasible alternative exists?
5. Are unresolved_search_budget, typed misses, and safety/recovery fallbacks correctly distinguished from proven infeasibility?
6. Should any part of conservativeBias influence budget admission or reservation?
7. Which exact tests or documentation changes are necessary before closing #706?

Expected review output: CONFIRMED, PLAUSIBLE, or REFUTED for the remaining defect hypothesis; exact code-path citations by symbol; any counterexample input; and a recommended issue disposition.

## Source files

- Issue #706: https://github.com/Szczepanov/adaptive-training-recommender/issues/706
- app/src/engine/planner.ts
- app/src/engine/weeklyAllocation.ts
- app/src/engine/rollingLoadBudget.ts
- docs/adr/0011-weekly-architecture-anchors.md
- docs/adr/0018-weekly-allocation-and-role-reservations.md
- docs/adr/0043-rolling-catalog-load-budget.md
- docs/plans/phase-7-weekly-allocation-and-role-reservations.md

## Verification performed

- Frontend typecheck passed.
- Six ignored scenario-audit probe files passed.
- Focused committed planner, rolling-budget, and travel-overlay tests passed: 76 tests.
- Sol 5.6 independent review used for candidate triage.
- Sol 5.6 adversarial verification refuted the conservative-bias candidate.
- No tracked production, test, baseline, or configuration files were changed by the audit.

## Follow-up review: narrowed #706 scope

The recommended narrowing is supported by the current code and should supersede the
earlier “close if the focused regression passes” framing.

### Confirmed fail-open path

In `generateWeekAheadPlan`, when viability protection applies, the planner searches the
bounded ranked subset with `preservesAllocation`. However, the final selection still uses
the equivalent of:

    first candidate that proves preservation
    or ranked[0]
    or Rest fallback

Therefore, if every candidate in the bounded viability set fails preservation, `ranked[0]`
can still be selected even though it is precisely the candidate that destroys the incumbent
or only future required-role witness. This is a confirmed implementation path, independent
of whether anchor dates should ever bypass the rolling envelope.

The safe outcomes should instead be one of:

- select a fallback whose projected allocation preservation is explicitly proven;
- recompute a valid alternative allocation and select it;
- surface an unresolved allocation state when the bounded search cannot prove preservation.

The planner must not silently convert “preservation was not proven” into “choose the highest
ranked candidate anyway.”

### Missing typed budget miss reason

`WeeklyRoleMissReason` currently includes safety/recovery, daily-ledger capacity, projected
fatigue, fixed-seed, no-exact-candidate, and no-conflict-free-date reasons, but not a
rolling-budget reason. The projected-date conversion does expose `LOAD_BUDGET_EXCEEDED` in
candidate exclusion reasons, yet `missReasonFor` does not track that blocker when classifying
a required-role outcome.

The narrowed issue should add a `rolling_load_budget` role-miss reason and preserve the
distinction between:

- a proven committed-load budget miss;
- an unresolved search-budget result;
- a discretionary candidate rejected to preserve a feasible required-role witness.

### Revised classification

- Original anchor-protection hypothesis: `REFUTED`.
- Extra Recovery Margin as the protection switch: `REFUTED`.
- Case-B starvation as a general concern: `PLAUSIBLE`.
- Fail-open selection after bounded viability cannot prove preservation: `CONFIRMED`.
- Missing explicit budget-caused role-miss classification: `CONFIRMED`.

### Revised issue scope

Recommended title:

> Ensure rolling-budget-aware D-SUPPORT cannot fail open and reports budget-caused role
> misses explicitly

The original “should anchors bypass the budget / should Extra Recovery Margin decide?”
question is settled as “no / no.” The remaining work is to ensure that the ADR-0018
allocation contract remains true after ADR-0043 introduced rolling budget as another hard
feasibility dimension.

### Additional required tests

Add or request focused coverage for:

1. Case A committed-load exhaustion produces `rolling_load_budget`, does not bypass the
   envelope, and does not pretend the role was unresolved search budget.
2. Case B contains an individually admissible, high-ranked support candidate and exactly one
   future exact-role witness. Selecting support must be vetoed or relocated; it must not
   fall through to `ranked[0]` after preservation failure.
3. If no bounded candidate proves preservation, Rest is selected only after its preservation
   is proven; otherwise the result is explicitly unresolved.
4. Case C distinguishes a required-role reservation moving dates from an anchor preference
   moving dates. A moved role must retain its role identity and report the movement.
5. Preference-independence holds dose constant: toggling `conservativeBias` cannot alter
   budget policy or reservation semantics.
6. A separate modify-dose test permits a conservative dose to change the candidate's charged
   cost while keeping the budget policy itself preference-independent.

The resulting disposition should be: keep #706 open, narrow it to the confirmed fail-open
and missing-diagnostic work, implement the fix and focused regressions, then close it.

## Implementation follow-up

The narrowed work has now been implemented in the working tree:

- `selectViableForecastCandidate` removes the D-SUPPORT `ranked[0]` fail-open path, applies
  viability even when only one discretionary candidate remains, explicitly proves Rest as a
  fallback, and surfaces unresolved allocation when preservation cannot be proven.
- Allocation preservation is tri-state: `preserves`, `degrades`, or
  `unresolved_search_budget`; incomplete incumbent or follow-up searches are not treated as
  proof of preservation.
- `rolling_load_budget` is now a typed role-miss reason, using the canonical
  `ROLLING_LOAD_BUDGET_EXCEEDED` blocker constant. Planner displacement classification also
  reports budget-caused misses explicitly.
- Real planner regressions cover committed Case A, discretionary Case B, one-candidate
  fail-closed selection, preference independence at a constant dose, modify-dose cost
  changes, and the separation between role identity and soft anchor placement. Existing
  occurrence-relocation coverage remains in the weekly allocator tests.
- ADR-0018 and ADR-0043 now state the hierarchy: committed load → hard rolling envelope →
  required-role allocation within remaining capacity → anchor placement → ranking
  preferences.
- `POLICY_VERSION` and the rolling-budget policy version advanced to v3; the prior v2 is
  historical.

Post-change verification: frontend typecheck passed; the full frontend check passed with
pre-existing lint/knowledge warnings only; 528 test files and 6,049 tests passed; the
scenario simulation and plan-judge invariants passed. The advisory simulation diff reports
expected recommendation changes from the fail-closed policy and the committed baseline was
left unchanged for separate review.
