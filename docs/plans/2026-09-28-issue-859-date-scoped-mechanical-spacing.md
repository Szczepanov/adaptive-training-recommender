# Issue #859 — Date-scoped #804 consecutive-day mechanical spacing

| | |
|---|---|
| **Status** | `In review` — implementation is complete on PR #887; merge remains the delivery gate |
| **Source** | [issue #859](https://github.com/Szczepanov/adaptive-training-recommender/issues/859) |
| **Analysis** | [2026-09-28 issue #859 date-scoped mechanical-spacing analysis](../analysis/2026-09-28-issue-859-date-scoped-mechanical-spacing-analysis.md) |
| **Blocked by** | Nothing. #804 and #805 are merged; PR #855 explicitly left this as the independent follow-up. |
| **Unlocks** | Correct #804 weekly planning after a recent mechanical exposure; correct #805 capability placement/status instead of week-wide `mechanical_withheld` from a one-day spacing condition |
| **Baseline** | Reviewed against `main` @ `616f7fe9`. Rebase before implementation and use the then-current `POLICY_VERSION`. |

All symbols below exist on the baseline unless marked **new**.

> **Implementation note (28 September 2026):** PR #887 implements the work packages below. They are retained as the review/verification record rather than pending implementation instructions. The implemented boundary is the active #804 `mechanical_exposure` requirement; non-#804 running plans remain unchanged. Mark this plan `Implemented` only after merge.

## Goal

Correct #804's no-consecutive-calendar-day guardrail so it excludes mechanical candidates only on the
calendar day immediately following an actual or already-projected mechanical exposure.

Preserve all other #804 stage/tissue/clinical decisions as the shared planning-horizon verdict.

The implementation must also preserve ownership boundaries:

- #804 spacing applies only when the active plan carries #804's `mechanical_exposure` requirement;
- ordinary running or field recommendations in plans without #804 must not acquire a new global adjacency rule;
- #805 may use a later non-adjacent date in the same planning horizon and must not report the whole window as
  `deliberately_suspended/mechanical_withheld` solely because yesterday contained mechanical work;
- projected mechanical assignments affect later-date feasibility but never count as performed tissue-response
  evidence for stage progression.

## Preconditions

Before coding:

1. rebase from current `main`;
2. re-read:
   - `docs/architecture/recommendation-engine.md`;
   - ADR-0018;
   - ADR-0033;
   - ADR-0044, especially D9–D10;
   - this plan and its analysis;
3. verify issue #859 is still open and no later PR has already changed the same semantics;
4. record the current `POLICY_VERSION`; do **not** reuse the baseline value in this plan if main has advanced;
5. run the focused current tests once to establish the pre-change baseline:
   - `mechanicalProgression.test.ts`;
   - `mechanicalExposurePolicyAlignment.test.ts`;
   - relevant `coverage`, `optimizer`, `weeklyAllocation`, #805 planning/cycle tests;
   - active persona deterministic tests.

## Resolved implementation decisions

### M859-D1 — split by temporal scope, not by feature

`MechanicalProgressionVerdict` remains the source for:

- stage;
- tissue-response verdict;
- illness/pain/guardrail withholding/blocking;
- 14-day re-entry;
- response-gated progression;
- exact stage-eligible workout ids.

The previous-calendar-day rule is removed from that object and becomes date-scoped feasibility.

### M859-D2 — spacing is dynamic projected-state feasibility

The gate is derived for every evaluated date from history available to that date.

A projected mechanical selection on D must make D+1 mechanically ineligible inside allocator search. This
rules out a one-time static not-before date as the sole implementation.

### M859-D3 — #804 activation scopes the rule

The date-scoped gate exists only when the resolved plan has a `mechanical_exposure` requirement.

This is the correction to the temporary PR #855 prototype. A catalog workout may be a mechanical identity
for incidental capability credit without making every plan subject to #804.

### M859-D4 — preserve current mechanical-identity semantics

Adjacency is triggered by an exact catalog identity recognized by `mechanicalIdentityFor`.

Do not change to:

- modality/category matching;
- generic `impactTissue` cost;
- free-text labels;
- stimulus profile;
- new contact-count thresholds;
- a different variant-credit definition.

This work changes **scope**, not the underlying identity policy.

### M859-D5 — true source suspensions remain horizon-wide

Illness, current pain, `avoid_high_impact`, knee swelling/acute pain guardrails and adverse tissue response
retain their existing semantics.

The implementation must not make those conditions automatically “expire tomorrow” in a forecast that has no
new real check-in.

### M859-D6 — one canonical feasibility path

The weekly allocator does not get a bespoke spacing algorithm.

`AllocationDateEvaluator` continues to call production `evaluateProjectedDate`; date-scoped spacing flows
through the same `CoverageState` and `rankCandidates` hard-gate path as the actual forecast.

## Work package M859-0 — lock current behavior with failing/negative regressions

**Depends on:** nothing.
**Purpose:** prevent implementation from accidentally broadening #804 or weakening other source gates.

### M859-0.1 — progression evaluator tests

In `mechanicalProgression.test.ts`, change/add focused tests that encode the new split:

1. **RED before implementation:** an exposure yesterday, otherwise healthy evidence and a valid current/held stage
   must no longer force `eligible: false`.
2. Illness still yields a withheld verdict.
3. Active `avoid_high_impact`, knee swelling or acute-pain guardrail still yields blocked.
4. Current pain still blocks.
5. Severe/adverse tissue response still withholds/regresses.
6. Missing follow-up evidence still prevents advancement.
7. >=14-day gap still re-enters at Stage 1.

The test name should state that spacing moved out of the horizon-wide progression verdict; do not imply that
the no-consecutive-day policy disappeared.

### M859-0.2 — preserve non-#804 endurance behavior

Add or pin a deterministic test around the established endurance-history persona that failed during PR #855's
temporary implementation.

The invariant is architectural, not a demand for one exact 14-day sequence:

- when the resolved evergreen plan contains no #804 `mechanical_exposure` requirement, #859 adds no new
  `CONSECUTIVE_MECHANICAL_DAYS` exclusion;
- the existing easy-run preservation invariant remains valid.

If a smaller engine test can prove this more directly, keep both the local ownership test and the existing persona
assertion rather than making the persona the only guard.

### M859-0.3 — capture the positive issue reproduction

Add one focused planner/coverage fixture with:

- active #804 `mechanical_exposure` requirement;
- exact mechanical exposure on D-1;
- at least one eligible mechanical identity;
- usable capacity later in the horizon.

Before the implementation, prove the current defect: the starting-date verdict empties the shared allow-list /
causes the role to be unavailable throughout the horizon. Convert this into the target assertions in M859-3 rather
than retaining a test whose expected value is known-bad.

## Work package M859-1 — separate adjacency from `MechanicalProgressionVerdict`

**Depends on:** M859-0.
**Files:** `app/src/engine/mechanicalProgression.ts`, `mechanicalProgression.test.ts`.

### M859-1.1 — remove the adjacency early return

Delete the branch in `evaluateMechanicalStageProgression` that returns `withheld` solely because
`lastExposure.date` equals the previous calendar date.

Do not alter the ordering or semantics of the remaining hard guardrail, pain, illness, tissue-response, gap,
retention or progression logic.

### M859-1.2 — add one pure spacing helper

Add a small exported helper owned by #804, for example:

`hasAdjacentMechanicalExposure(targetDate, exposures): boolean`

Use the final name that best matches existing code conventions.

Contract:

- input is a target local date plus exact exposure identity/history;
- only the prior calendar date is relevant;
- a prior exposure qualifies when its exact workout resolves through `mechanicalIdentityFor`;
- if only a canonical template id is present, use the existing template-to-workout mapping at the caller/adapter
  boundary rather than inventing category inference;
- no check-in, stage, progression or capability-cadence logic belongs in this helper;
- use local-date utilities, not UTC-millisecond arithmetic.

Prefer a narrow input shape if that avoids importing the whole coverage model into the policy module.

### M859-1.3 — unit tests for the helper

Cover:

- D-1 exact Stage-1/2/3/4 identity => true;
- D-2 => false;
- same-day/future records => false;
- non-mechanical identity => false;
- no identity => false;
- the helper does not require the exposure to have earned weekly coverage credit.

## Work package M859-2 — derive #804-scoped date state in coverage

**Depends on:** M859-1.
**Files:** `app/src/engine/coverage.ts` plus focused tests.

### M859-2.1 — extend `CoverageState`

Add an explicit date-scoped field, recommended shape:

`mechanicalSpacingBlocked: boolean`

If the team prefers a structured sub-object for future explainability, keep it minimal; do not introduce a new
generic constraint framework for this issue.

The field means:

> On `CoverageState.asOfDate`, #804's active mechanical-exposure policy has an exact mechanical exposure on the
> immediately previous calendar date, so exact mechanical candidates are inadmissible today.

It is **not** a coverage-credit result and does not itself say the weekly mechanical requirement is fulfilled.

### M859-2.2 — scope computation to #804 requirement presence

In `buildCoverageState`:

1. build/resolve the plan requirements as today;
2. determine whether this plan carries `mechanical_exposure`;
3. only when it does, inspect history for D-1 exact mechanical identity;
4. populate `mechanicalSpacingBlocked`.

This ownership condition is mandatory.

A plan that has no #804 mechanical requirement returns `false` even if yesterday's workout is an incidental
mechanical identity such as an easy run.

### M859-2.3 — use actual + projected exact history

The computation must work with the history that `buildCoverageState` already receives:

- completed exposure identity;
- selected forecast history;
- tentative weekly-allocation assignments that `projectedEvaluation` injects before later dates are evaluated.

When a history entry has `workoutId`, prefer it. When it has only `templateId`, use the existing canonical
template→workout resolution.

Do not make canonical coverage-credit arrays the spacing authority: an exposure can be relevant to adjacency even
when it does not fulfill the weekly mechanical role.

### M859-2.4 — coverage tests

Prove:

- active mechanical requirement + D-1 mechanical identity => `true`;
- same plan at D+1 with no D exposure => `false`;
- no mechanical requirement + identical D-1 history => `false`;
- non-mechanical D-1 => `false`;
- template-only projected identity resolves correctly;
- readiness/credit metadata does not silently redefine the existing identity-based spacing behavior.

## Work package M859-3 — enforce the scoped date gate in the canonical rank/allocation path

**Depends on:** M859-2.
**Files:** `optimizer.ts`, `weeklyAllocation.ts`, planner/allocation tests.

### M859-3.1 — stable hard exclusion in `rankCandidates`

After the existing hard modality/injury gates and before ranking benefit/utility can select the candidate, add:

`CONSECUTIVE_MECHANICAL_DAYS`

when both are true:

1. `coverageState.mechanicalSpacingBlocked`;
2. the candidate's exact canonical workout identity has `mechanicalIdentityFor` metadata.

Do not block all Running, Field, Strength or plyometric categories.

Do not let preferred modality, capability consent, benefit tier or utility override this hard gate.

### M859-3.2 — allocator blocker classification

Add `CONSECUTIVE_MECHANICAL_DAYS` to `weeklyAllocation.ts`'s safety/recovery exclusion classification.

This ensures an occurrence that truly cannot fit because every feasible slot is adjacent reports a typed
`hard_safety_or_recovery` miss instead of looking like a generic search conflict.

### M859-3.3 — dynamic tentative-assignment regression

Add an allocator/planner test whose search state includes a tentative mechanical assignment.

Required behavior:

- D0 mechanical assignment;
- D1 exact mechanical candidate rejected with `CONSECUTIVE_MECHANICAL_DAYS`;
- D2 can accept it if no other hard gate rejects it.

Run the same test with occurrence ordering perturbed if practical to preserve ADR-0018's order-independence intent.

### M859-3.4 — today / tomorrow / week-ahead parity

Verify the rule through all active recommendation surfaces that consume evergreen coverage:

- today's recommendation;
- next-day branch;
- week-ahead projected dates.

The same input/history should not produce different adjacency semantics merely because it entered through a
different orchestration path.

If one path lacks the exact `CoverageState`/history needed to make this true, fix the orchestration wiring rather
than duplicating the rule in `rules.ts`.

## Work package M859-4 — align #805 fulfilment and recurrence

**Depends on:** M859-3.
**Files:** #805 capability maintenance planning/tests, potentially comments only in production code.

### M859-4.1 — one-day spacing is no longer a capability suspension

After M859-1, the shared `mechanicalVerdict` should not be ineligible solely due to adjacency.

Add a #805 integration test:

- capability is due/overdue;
- #804 requirement is present;
- yesterday was an exact mechanical exposure;
- today is mechanically spacing-blocked;
- a later non-adjacent date has adequate environment/capacity.

Expected:

- capability fulfilment remains `plannable`;
- no `deliberately_suspended/mechanical_withheld` solely due to yesterday's exposure;
- placement/reservation lands on a later admissible date;
- the support occurrence remains subordinate to primary required roles.

### M859-4.2 — preserve real source suspension semantics

Add paired tests proving that when the shared verdict is ineligible for a true horizon-wide reason:

- illness / adverse tissue source withholding still becomes `deliberately_suspended/mechanical_withheld`;
- clinical block stays `clinical_symptoms` / mechanical guardrail according to current precedence;
- no inadmissible placement is created.

### M859-4.3 — extend the deterministic #804 × #805 cycle proof

The existing eight-week/cycle family should cover the regression directly:

- an exposure immediately before a planning boundary blocks only the adjacent date;
- later dates inside the same horizon remain candidates;
- a newly selected projected mechanical touch blocks its next date;
- recurrence does not depend on the weekly planning boundary.

Do not claim this fixes #858's duration-fidelity limitation; keep that follow-up independent.

## Work package M859-5 — knowledge lineage, policy version and architecture docs

**Depends on:** M859-1 through M859-4 behavior finalized.
**Files:** `mechanicalExposureKnowledge.ts`, `mechanicalExposurePolicyAlignment.test.ts`,
`engine/policy.ts`, `docs/architecture/recommendation-engine.md`.

### M859-5.1 — revise `policy.evergreen.mechanical_exposure_v1`

Advance the current claim version (v3 on the reviewed baseline; expected v4 unless main changes it first).

The statement must explicitly distinguish:

- horizon-wide stage/tissue/source-policy verdict;
- date-scoped no-consecutive-calendar-day candidate gate;
- active-#804-requirement scope;
- actual/projected exact mechanical history as the adjacency input;
- projected history affects feasibility only, not performed tissue-response confirmation;
- exact threshold remains a conservative product guardrail, not a universal physiological interval.

Keep:

- `claimType: 'heuristic'`;
- `maturity: 'heuristic'`;
- `evidenceCertainty: 'not_applicable'`;
- the existing scientific sources and limitations unless implementation uncovers a genuine evidence change.

Update the review date.

### M859-5.2 — update alignment tests

`mechanicalExposurePolicyAlignment.test.ts` should stop asserting that #859 remains a known horizon-scoping
limitation.

Instead pin meaningful semantic phrases/metadata that establish:

- date-scoped candidate gate;
- #804 mechanical-requirement scope;
- full 14-day stage/tissue evidence remains separate;
- projected feasibility does not become performed progression evidence.

Avoid a brittle test that copies the entire prose claim.

### M859-5.3 — bump `POLICY_VERSION`

This change can alter recommendations and therefore must bump the live policy version.

Implementation procedure:

1. read the then-current `POLICY_VERSION`;
2. choose a descriptive successor such as
   `2026-09-date-scoped-mechanical-spacing-v1` if still appropriate;
3. prepend the exact previous value to policy history according to the existing contract;
4. run the policy-drift check against the implementation branch base SHA.

Do not hard-code `616f7fe9` as the drift base after rebasing.

### M859-5.4 — architecture doc

Update the #804 section of `docs/architecture/recommendation-engine.md`:

- remove the “known #859 horizon-scoping limitation” wording;
- explain that the progression verdict owns stage/tissue/source state;
- explain that per-date coverage/ranking owns adjacent-day spacing;
- state that allocator tentative assignments are replayed through the same projected-date gate;
- state the #804 activation boundary so incidental mechanical identities outside #804 do not inherit the rule.

No accepted ADR needs mutation.

## Work package M859-6 — deterministic and repository-wide verification

**Depends on:** M859-5.

### M859-6.1 — focused tests

Run at minimum the test files touched above plus:

- #804 wiring tests;
- #805 capability planning and cycle tests;
- optimizer/coverage/weekly-allocation tests;
- active persona deterministic tests;
- knowledge coverage/alignment tests;
- policy tests.

### M859-6.2 — repository gates

Run the repo-prescribed verification for a recommendation-policy change. At minimum, unless current instructions
have changed:

- `make check`;
- `make simulate`;
- deterministic plan/persona simulation gates;
- policy-drift check;
- any static knowledge/workout gates reached by `make check`.

If the repo's current AGENTS/CLAUDE instructions require a broader `make verify`, follow the current instructions
rather than this dated list.

### M859-6.3 — semantic diff review

Do not treat a changed simulation snapshot as automatically bad or automatically acceptable.

The expected footprint is narrowly directional:

- plans with active #804 and a mechanical exposure immediately before the evaluated horizon may recover later
  mechanical placements that were previously suppressed;
- #805 may stop reporting a week-wide `mechanical_withheld` in that case;
- the immediately adjacent day must remain blocked;
- plans without an active #804 mechanical requirement should not change due to this issue.

Investigate any recommendation diff outside that envelope before refreshing a baseline.

### M859-6.4 — PR evidence

The implementation PR description must include:

- before/after reproduction of the issue;
- exact test(s) proving D0 blocked / D1+ recover;
- proof that a projected assignment blocks its own next day;
- proof that true illness/clinical/tissue suspensions remain horizon-wide;
- proof that the established endurance-only persona does not regress;
- #805 status/placement proof;
- `POLICY_VERSION` transition;
- simulation/persona footprint and explanation;
- commands run and CI state.

## Acceptance criteria

- [ ] A mechanical exposure on D-1 blocks mechanical candidates on D under active #804.
- [ ] The same D-1 exposure does **not** blank the rest of the seven-day #804 horizon.
- [ ] A projected mechanical assignment on D dynamically blocks D+1.
- [ ] D+2 can become eligible again when no other gate blocks it.
- [ ] Plans without #804's `mechanical_exposure` requirement do not acquire the gate.
- [ ] Exact mechanical identity, not modality/category/`impactTissue`, is the spacing authority.
- [ ] Illness remains horizon-wide withheld.
- [ ] Pain / `avoid_high_impact` / knee-swelling guardrails remain blocked.
- [ ] Severe/adverse tissue response remains withheld/regressed according to current semantics.
- [ ] Missing follow-up and 14-day re-entry behavior are unchanged.
- [ ] #805 due capability after a D-1 exposure can remain `plannable` and reserve later in the horizon.
- [ ] #805 true source suspensions remain `deliberately_suspended`.
- [ ] `CONSECUTIVE_MECHANICAL_DAYS` is a typed hard feasibility blocker.
- [ ] `policy.evergreen.mechanical_exposure_v1` and its alignment test describe the new scope.
- [ ] `POLICY_VERSION` is bumped from the implementation branch's actual predecessor.
- [ ] Architecture docs no longer describe #859 as an open limitation.
- [ ] Focused tests, repository checks and simulation/persona gates pass.
- [ ] Any semantic baseline change is reviewed and limited to the intended #804/#805 cases.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Global optimizer gate changes ordinary running | M859-D3: derive the state only for plans carrying `mechanical_exposure`; pin the established endurance persona. |
| Static placement constraints fail after future allocation | M859-D2/M859-3.3: recompute from projected history through `AllocationDateEvaluator`. |
| Removing spacing from progression weakens true safety blocks | M859-0.1 and M859-4.2 pin every real block/withhold category before refactor. |
| Forecast assignments accidentally become stage evidence | Keep projected adjacency in coverage/optimizer only; progression uses performed mechanical evidence/check-ins. |
| Same rule duplicated in coverage and optimizer | Keep identity/date helper with #804 policy owner; coverage derives state, optimizer consumes state. |
| New exclusion reason is diagnostically invisible | Add to allocator hard safety/recovery blocker classification and assert it. |
| #805 changes cadence or session commitment unintentionally | No cadence constants, placements or support-tier rules change; integration test checks same occurrence semantics. |
| Policy claim overstates science | Keep heuristic/not-applicable classification; update only temporal/ownership scope. |
| Main advances during implementation | Rebase first; resolve current claim version and policy predecessor from the rebased tree. |

## Rollback

No persistence migration or user-data rewrite is planned.

If production verification exposes an unacceptable recommendation footprint:

1. revert the code changes that moved adjacency into date-scoped coverage/ranking;
2. revert the matching knowledge/architecture wording and policy-version successor as one policy change;
3. restore the prior horizon-wide limitation explicitly;
4. retain the new regression tests that explain why the attempted scope failed, adjusting expected behavior only if
   the rollback intentionally restores the known issue;
5. do not “fix” the rollback by making the rule global outside #804.

## Out of scope

- changing the no-consecutive-calendar-day threshold;
- introducing a 48-hour biological-recovery constant;
- changing `MECHANICAL_CONTINUITY_WINDOW_DAYS`;
- changing #805 cadence / due-offset policy;
- redefining mechanical identity or qualifying variants;
- changing contact-count or running-duration dose policy;
- #858 simulation duration fidelity;
- event-directed mechanical/field policy;
- new future check-in prediction;
- generic multi-constraint architecture work beyond the smallest `CoverageState` addition;
- persistence/audit-schema changes;
- making #804 spacing apply to athletes whose current plan does not own #804 mechanical exposure.

## Implementation handoff

The intended production data flow after this issue is:

`resolveEvergreenPlan`
→ one horizon-wide stage/tissue `MechanicalProgressionVerdict`
→ `buildEvergreenPlanDefinition` with the non-spacing stage allow-list
→ per-date `buildCoverageState`
→ scoped `mechanicalSpacingBlocked` from D-1 actual/projected exact identity
→ `rankCandidates` hard exclusion
→ ADR-0018 allocator retries later feasible dates through the same `evaluateProjectedDate` path.

That separation is the core invariant. If implementation requires bypassing it, stop and update the analysis/design
before shipping.
