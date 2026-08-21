# Phase 9: Subjective baselines in readiness mode

* **Status:** In progress. ADR-0020 is Accepted; 9.1-9.7 are done. Only 9.8 remains, and it
  additionally needs Phase 9.0's prospective evidence, which has not yet been collected.
* **Blocked by:** nothing at the plan level. Individual work items list their own blockers
  in the task board below.
* **Strongly preceded by:** [Phase 9.0](./phase-9-0-shadow-mode-and-decision-journal.md) — its shadow block supplies the prospective evidence required before a production ship decision
* **Unlocks:** a decision on whether adverse within-athlete subjective drift belongs in the mode gate at all
* **Decisions:** ADR-0020 (D-SUBJHIST, D-SUBJDRIFT, D-SUBJADD, D-SUBJFLOOR, D-SUBJCOV, D-SUBJEST, D-SUBJPURE, D-SUBJANCHOR, D-SUBJCAL, D-SUBJAUDIT)

## Goal

Build an adverse-only subjective drift candidate behind a simulation-only selector, extend
the scenario corpus so the measurement can detect it, compare reasonable estimator choices,
and then decide whether the signal deserves prospective validation and eventual production
use. Shipping is **not** the goal of this plan; deciding is.

## The chicken-and-egg, and how this plan resolves it

D-SUBJCAL says estimator details, coefficients and the go/no-go come from evidence. But
measurement requires a working implementation. Building it and shipping it in one step
would make the ADR's evidence discipline decorative.

The repository already solved this pattern for fatigue fusion. `FatigueFusionPolicy`
threads a selector through the real planner while production keeps the established default,
and the comparison harness measures the alternative without making it live.

**Phase 9 follows that pattern.** Subjective drift is implemented behind a
`SubjectiveDriftPolicy` defaulting to `'off'`, so production remains bit-identical until a
separate reviewed decision changes the live default.

The evidence has two levels:

1. synthetic scenarios answer **is this mechanism safe, bounded and non-pathological?**;
2. Phase 9.0's prospective real-athlete record answers **does it appear useful in the
   workflow that would actually consume it?**

Synthetic fixtures may reject the idea. They may not, by themselves, authorize shipping.

---

## Preconditions

* ADR-0020 accepted.
* **9.5 must land before 9.6 is run.** A comparison against the old constant-subjective
  corpus would be structurally unable to exercise drift.
* **Phase 9.0 is not required to build 9.1–9.7**, but a production ship decision in 9.8
  requires its prospective evidence (or an equivalent later prospective corpus). If that
  evidence is not adequate, the selector stays off.

---

## Work items

### 9.1 Subjective baseline computation `[x]`

**Current behaviour.** Nothing baselines subjective data. `mapCheckinToSubjectiveInput`
maps one day's check-in to `SubjectiveInput` and nothing else reads prior check-in history.

**Change.** Add `engine/subjectiveBaseline.ts`, pure, with a versioned estimator policy:

```ts
export interface SubjectiveBaselinePolicy {
  estimatorId: string;
  recentWindowDays: number;
  longWindowDays: number;
  minRecentRecordedDays: number;
  minLongRecordedDays: number;
  variabilityFloor: number;
  contributionCap: number;
}

computeSubjectiveBaseline(
  checkins: readonly DailySubjectiveCheckin[],
  asOfDate: string,
  policy: SubjectiveBaselinePolicy,
): SubjectiveBaseline | null
```

**D-SUBJHIST is load-bearing:** `asOfDate` is exclusive. A decision for date `D` may only
use check-ins whose local date is `< D`. Today's submitted check-in never participates in
the baseline used to interpret today.

The first reference policy remains intentionally simple so 9.6 has a concrete candidate to
measure:

* 7 prior calendar days as the recent window;
* 28 prior calendar days as the long reference;
* mean location and population stdev;
* 1.0-point variability floor;
* per-component cap matching the existing `STRAIN_Z_CAP` (2.0).

These are **reference candidate values, not ADR invariants** (D-SUBJEST). Coverage requires
both a recent-window count and a long-window count; the exact minima are policy fields and
must be included in 9.6 sensitivity analysis rather than disguised as physiological facts.

`SubjectiveBaseline` records at least:

```ts
{
  estimatorId: string;
  historyThroughDateExclusive: string;
  recentRecordedDays: number;
  longRecordedDays: number;
  lastObservationDate: string | null;
  // per participating metric: recent location, long location, variability
}
```

Only **distinct complete scored dates** count. A partial minimum-safety check-in can still
carry pain/illness meaning for that day, but its null subjective dimensions do not mature a
baseline.

Reuse the context brief's coverage conventions where they truly match, but do not force one
single `recordedDays` constant onto both recent-state and long-reference eligibility.

**Done when** the function is pure; `asOfDate` is excluded by test; duplicate dates and
partial safety-only check-ins cannot inflate either coverage count; zero-variance input is
bounded by the policy floor; and either insufficient recent or insufficient long coverage
returns `null`.

**Implementation note.** `engine/subjectiveBaseline.ts` implements exactly this contract:
`SubjectiveBaselinePolicy`, `REFERENCE_SUBJECTIVE_BASELINE_POLICY` (7/28 windows, 1.0
variability floor, 2.0 cap matching `STRAIN_Z_CAP` -- documented as a reference candidate,
not an invariant, per D-SUBJEST), and `computeSubjectiveBaseline`. Coverage is deduplicated
by date via a `Map`, counted separately for the recent and long windows, and a date counts
only when all six subjective dimensions are finite scores in the 1–10 range.
`dataQuality.isComplete` is deliberately **not** the baseline authority because it also
requires unrelated form/execution fields such as `timeAvailableMin`; missing one of those
must not erase an otherwise complete subjective observation. Malformed estimator policies
fail fast before they can produce impossible coverage or non-finite variability.
`historyThroughDateExclusive` restates the exclusive boundary on the output so a consumer
never has to re-derive it. `minRecentRecordedDays`/`minLongRecordedDays` reuse
`contextBrief.ts`'s existing ~36% coverage ratio (`SUBJECTIVE_BASELINE_MIN_DAYS` /
`SUBJECTIVE_BASELINE_DAYS`) as a starting point, duplicated rather than imported so this
module carries no dependency on the brief renderer. The calculator accepts the minimal
structural `SubjectiveCheckinForBaseline` input rather than importing
`DailySubjectiveCheckin`, so the foundational `models.ts` module is not part of a circular
type dependency. `DailyReadiness` can now carry the result (9.2), and `rules.ts` consumes it
only when the explicit default-off drift selector is exercised (9.3); the composition
boundary still does not supply real history until 9.4.

---

### 9.2 Carry the baseline on `DailyReadiness` `[x]`

**Current behaviour.** `DailyReadiness` is `{ subjective, objective }`. Objective baselines
arrive precomputed on `DailyRecoverySnapshot.derived`; subjective history has no equivalent.

**Change.** Add optional `subjectiveBaseline?: SubjectiveBaseline | null` to
`DailyReadiness`. Absent means no relative subjective signal and preserves today's behaviour.

`evaluateReadinessAndSafetyEnvelope` must **not** gain a history provider, async signature,
or Firestore read (D-SUBJPURE).

**Done when** the field exists, is optional, and the evaluator's purity/synchronous contract
is otherwise unchanged.

**Implementation note.** `DailyReadiness.subjectiveBaseline?: SubjectiveBaseline | null`
was added in `models.ts`. The 9.2 regression proved the field was inert before 9.3; the
readiness evaluator remained pure and synchronous. After 9.3, `rules.ts` reads the field
only behind the explicit `SubjectiveDriftPolicy` selector, whose production default remains
`'off'`. `subjectiveBaseline.ts` no longer imports `DailySubjectiveCheckin`/`models.ts`, so
the earlier type-only cycle has been removed rather than accepted as permanent structure.

---

### 9.3 The drift term, behind a default-off selector `[x]`

**Current behaviour.** `evaluateReadinessAndSafetyEnvelope` computes `objectiveStrain` from
`metricStrain` plus contextual penalties, and derives mode from absolute subjective
thresholds plus that score.

**Change.** Add `SubjectiveDriftPolicy = 'off' | 'drift'`, defaulting to `'off'` at every
production call site, mirroring the fatigue-fusion measurement pattern.

Under `'drift'`, the first **reference estimator** uses the 9.1 candidate baseline:

* compare recent prior history with longer prior history only — today is not in either;
* sign each metric so adverse movement is positive;
* normalize by the bounded variability estimate;
* floor favourable movement at zero;
* cap the component;
* aggregate with experimental per-metric weights into a separate `subjectiveDrift` score;
* add that non-negative score to the accumulating decision score compared with the existing
  modify/recover thresholds.

This 7/28 z-style arithmetic is the reference candidate for the harness, **not the accepted
meaning of D-SUBJDRIFT**. The ADR only fixes persistent adverse within-athlete change and
tighten-only direction; D-SUBJEST leaves windows/scaling/caps as policy choices.

Every existing absolute trigger stays byte-identical (D-SUBJFLOOR). There must be **no
subtraction path**: no baseline can turn an absolute `modify`/`recover` into a less
restrictive mode.

**Done when** `'off'` is bit-identical to current behaviour across the corpus,
`'drift'` is unreachable from production callers, and a property test proves no possible
baseline can lower the resulting mode.

**Implementation note.** `subjectiveDriftStrain` (exported from `rules.ts`) implements the
reference estimator as specified: per metric, adverse movement is signed positive
(duplicating `contextBrief.ts`'s `higherIsBetter` polarity table rather than importing it),
divided by the baseline's floored `variability`, floored at zero, capped at the existing
`STRAIN_Z_CAP` (2.0), weighted, and summed. The cap is a reference-candidate convention,
not a runtime use of `SubjectiveBaselinePolicy.contributionCap`; 9.6 must thread any
alternative cap explicitly rather than silently duplicating the formula. `Math.max(weight,
0) * clamp(z, 0, cap)` is structurally incapable of subtracting for finite valid baseline
inputs and weights (D-SUBJADD), and property coverage asserts that the resulting mode is
never less restrictive under `'drift'` than under `'off'` across the tested readiness,
gap, variability and weight sweep.

`evaluateReadinessAndSafetyEnvelope` gained two new trailing parameters --
`subjectiveDriftPolicy: SubjectiveDriftPolicy = 'off'` and `subjectiveDriftWeights:
SubjectiveDriftWeights = REFERENCE_SUBJECTIVE_DRIFT_WEIGHTS` -- both defaulted, so every
existing call site is untouched and `'off'` stays bit-identical to pre-Phase-9 behaviour. The
drift score augments only the local `strainForThresholds` used for mode selection. The
existing objective-only counterfactual/telemetry variables (`strainWithoutDrift`,
`multiDayDriftIsDecisionRelevant`, `DecisionScoreTelemetry.totalDecisionScore`) remain
unchanged until 9.7 adds a separately readable, reconciling subjective-drift component.
Therefore 9.6 must not interpret today's `totalDecisionScore` as drift-inclusive and must not
reimplement the arithmetic in a second path; it should consume/extend the canonical drift
helper while 9.7 supplies the final telemetry/audit contract.

Threading the selector further through `evaluateTrainingWithIntent`,
`generateWeekAheadPlanWithIntent`, or the composer is out of scope here. 9.4 supplies real
baseline history at the composition boundary, and 9.6 is the first intended caller that
explicitly exercises `'drift'` for measurement. Existing tests additionally guard that the
production default remains `'off'`.

`POLICY_VERSION` deliberately remains `2026-08-external-plan-provenance-v1` while this
implementation is dormant, exactly as D-SUBJAUDIT requires: default-off code cannot alter a
persisted decision and therefore must not fabricate a new policy identity. The
`check-policy-drift.mjs` guard now compares the actual base/head `POLICY_VERSION` values
instead of merely checking whether `policy.ts` was touched. It permits this narrow ADR-0020
default-off case only while no other production source is changed, and it now includes
`subjectiveBaseline.ts` in the decision-affecting set so a future live estimator change
cannot silently retain an old policy identity. If 9.8 later enables drift on the deciding
path, that cutover gets the real version bump and moves the outgoing value into
`HISTORICAL_POLICY_VERSIONS`.

---

### 9.4 Composition boundary supplies the baseline `[x]`

**Current behaviour.** `composer.ts` reads today's check-in only.

**Change.** Add one bounded validated range read for prior subjective history. For decision
date `D`, the read ends at `D - 1`; `D` itself is never fetched into the baseline window.

Use a true date-range query, not `getRecentCheckins`: a document `limit(days)` is not a
calendar-day window when there are gaps.

Do **not** feed raw Firestore type assertions into `computeSubjectiveBaseline`. Every record
must pass the same parser/ownership/date validation as a single check-in read. An invalid
record contributes nothing to coverage and is surfaced as a data-quality issue rather than
coerced into neutral values.

A failed or invalid range yields no subjective baseline and therefore zero subjective drift.
Today's ordinary absolute safety logic still runs from today's valid check-in.

**Done when** the baseline reaches the evaluator, history is strictly `throughDateExclusive`,
failed/invalid/sparse prior history leaves the decision unchanged, and the added history read
is bounded to one range query per composed decision.

**Implementation note.** `composer.ts` bundles `checkinService.getCheckinsInRangeState(userId,
D-28, D)` into the same `Promise.allSettled` batch as its other reads (one range read per
composed decision), reusing `parseSubjectiveCheckin` per document so an invalid row surfaces
as a `subjectiveHistoryIssues` entry rather than a raw type assertion. Any non-`AVAILABLE`
history state degrades `ComposedDailyDecisionInput.subjectiveBaseline` to `null` without
throwing; today's absolute safety path (today's own check-in) is read independently and is
unaffected either way. `composer.test.ts`'s "Phase 9.4 subjective baseline boundary" block
covers the mature-history, unavailable-history, issues-surfaced, and sparse-history cases.
Threading `ComposedDailyDecisionInput.subjectiveBaseline` onto the `DailyReadiness` consumed
by the real `evaluateTrainingWithIntent`/`evaluateReadinessAndSafetyEnvelope` call sites
remains out of scope here, same as 9.3's note: `decisionComposer` has no production caller
today, and 9.6/9.8 are where a live wiring decision belongs.

---

### 9.5 Give the scenario corpus real subjective variance `[x]`

**This is the work item the measurement depends on, and it must land before 9.6.**

**Previous behaviour.** `scenarios.ts` supplied constant subjective values to almost every
scenario, making every synthetic athlete's subjective variance effectively zero. Any
relative drift candidate would therefore appear to do nothing for fixture reasons.

**Change.** Add deterministic per-athlete subjective scale-use profiles:

| Fixture | Shape | What it must prove |
|---|---|---|
| Habitual low reporter | Readiness ~3, fatigue ~7, flat | Relative history never relaxes an absolute-threshold `modify` |
| Habitual high reporter | Readiness ~8, fatigue ~2, flat | A stable high reporter remains stable; future adverse drift can be tested without an absolute floor already firing |
| Slow drifter | Readiness 8 → 6 over three weeks, never crossing an absolute threshold | Persistent deterioration exists for a drift candidate to detect |
| Noisy but stationary | Mean stable, day-to-day swing ±2 | Noise is distinguishable from persistent drift |
| Chronically sore | Soreness baseline ~7, stable | Relative normality never cancels the absolute soreness floor |

**Preferred source later:** once Phase 9.0 has run, use the observed block to re-parameterize
at least one deterministic profile. The current invented profiles remain useful policy
fixtures, but they do not become real-athlete evidence merely because they resemble plausible
behaviour.

**Implementation note.** `engine/simulation/subjectiveProfiles.ts` is daily-resolution and
deterministic. `runScenario` still samples one decision per chained week, so the five new
`subjective_*` scenarios sample days `0, 7, 14, 21`; `subjectiveProfiles.test.ts` exercises
the full 28-day series directly. No stored check-in history is seeded yet because 9.4 has
not landed; 9.4's integration tests will build validated historical check-in documents from
the same deterministic series.

Because these are new scenarios, `simulate:diff` reports `[NEW SCENARIO]` and no committed
baseline changes.

**Done when** all five profiles exist; every subjective dimension intended to be variable
has non-zero variance; the slow drifter has a clear early/late shift; habitual-low and
chronically-sore remain exactly `modify` under today's absolute logic; and habitual-high,
slow-drifter and noisy-stationary remain `train` under today's logic.

---

### 9.6 Comparison harness and estimator sensitivity `[x]`

**Change.** Add `runSubjectiveDriftComparison` to `simulation/analyze.ts` and
`scripts/simulate-subjective-drift.mjs`, modelled on the fatigue-fusion comparison. Run the
real planner and hard gates under `'off'` and the reference `'drift'` candidate and report:

* changed selections and modes;
* recovery/rest share;
* objective misses and constraint violations;
* each 9.5 profile separately;
* the specific subjective components that contributed;
* sensitivity to window length, recent/long coverage requirements, variability floor/cap,
  participating metrics, weights, and any chronic multiplier.

If the reference result is materially driven by outliers/discrete scale effects, add at
least one robust alternative (for example a median/rank-based variant) before interpreting
the result. The ADR intentionally does not pre-select the winner.

The report must explicitly distinguish:

**Synthetic safety/regression evidence** — can reject unsafe/pathological behaviour.

**Real-world usefulness evidence** — cannot be established by these fixtures and comes from
Phase 9.0/9.8.

**Done when** the harness runs through production gates, the five fixtures are individually
reported, reasonable estimator choices do not hide a materially different conclusion, and
no automatic production recommendation is emitted.

**Implementation note.** `scenarios.ts`'s `subjective_*` scenarios now attach a real
`subjectiveBaseline` to `readinessForDate` (computed from the profile's own deterministic
daily series via `computeSubjectiveBaseline`, strictly `< date`) -- previously only the
mechanics-only "9.6a" evaluator-level harness (`subjectiveDriftComparison.ts`) could see any
drift signal. `evaluateTrainingWithIntent`/`evaluateNextDayPlanWithIntent` (`rules.ts`) gained
trailing `subjectiveDriftPolicy`/`subjectiveDriftWeights` parameters mirroring
`fatigueFusionPolicy`'s existing threading, both defaulting to `'off'` at every production
call site; `generateWeekAheadPlanWithIntent`/`planner.ts` deliberately do not read the
selector (forecast-day tiers come from `fatigueTierFor(peakFatigue)`, not
`evaluateReadinessAndSafetyEnvelope`, and `planner.ts` sits outside the policy-drift guard's
dormant exception) -- stated as an explicit report limitation, matching 9.3's precedent that
threading past today/tomorrow is out of scope.

`simulation/analyze.ts` adds `runSubjectiveDriftComparison` (modelled directly on
`runFatigueFusionComparison`: real planner/hard gates, `'off'` vs `'drift'`, full
`SCENARIOS` corpus) and `runSubjectiveDriftSensitivityComparison` (the same real-planner
comparison swept across the existing 8 `SUBJECTIVE_DRIFT_SENSITIVITY_CONFIGS`, reused from
`subjectiveDriftComparison.ts` rather than duplicated). `scripts/simulate-subjective-drift.mjs`
now runs all three layers -- 9.6a mechanics, the planner-level comparison, and the
planner-level sensitivity sweep -- into one `report.md` that states the
synthetic-safety-evidence/real-world-usefulness-evidence distinction explicitly.

Actually running the harness against the full corpus confirmed every non-`subjective_*`
scenario diffs to exactly zero (the regression control holds), and `subjective_slow_drifter`
is detectable (`train -> modify`, 6 changed selections) exactly as the plan named it. The
sensitivity sweep showed smoothly graded, non-pathological behaviour across every window/
floor/weight variant tested (e.g. a tighter `variabilityFloor: 0.5` strengthens the effect,
a looser `1.5` weakens it to zero, half-weights and fatigue/soreness-only weights attenuate
it) with no sign of an outlier- or discrete-scale-driven artifact -- so per the plan's
conditional language, no robust median/MAD alternative was added; the report states this
conclusion rather than assuming it. Habitual-low and chronically-sore showed zero mode
changes under every measured config, satisfying the "no relaxation" acceptance criterion.
`aggregate.constraintViolationDelta` was `0` throughout -- drift never introduced a
constraint violation `'off'` didn't already have -- though `restOrRecoveryDayDelta`/
`recoverySelectionDelta` **can** go negative for `subjective_slow_drifter` in aggregate: an
earlier day's changed selection alters what the chained multi-week simulation accumulates as
history, which can shift *when* a later recovery day falls. D-SUBJADD's never-less-restrictive
guarantee is a per-decision invariant (proven by `rules.test.ts`'s property test), not a claim
that a multi-week aggregate share can only rise -- the new `scenarios.test.ts` coverage
documents this distinction rather than asserting a stronger (and false) aggregate invariant.

`check-policy-drift.mjs`'s policy-affecting file set was left unchanged (`analyze.ts`,
`scenarios.ts`, `subjectiveDriftEvidence.ts` all live under `engine/simulation/`, already
exempt), so this work item required no CI-guard change by itself -- see 9.7's note for the
guard change that *was* needed.

---

### 9.7 Telemetry, audit and rationale `[x]`

**Change.** Add `subjectiveDrift` to `DecisionScoreTelemetry` as a separately readable
component that reconciles to the total.

When drift is enabled for a deciding path, `RecommendationAudit` records compact normalized
provenance (D-SUBJAUDIT), at least:

```text
estimatorId / estimatorPolicyVersion
historyThroughDateExclusive
recentRecordedDays
longRecordedDays
subjectiveDriftContribution
bounded per-metric contributions
decisionRelevant
```

Do not copy raw historical subjective scores or free-text notes into the recommendation
audit.

Extend the existing decision-relevant-drift rationale annotation with the same
counterfactual question: did subjective drift change the mode? Mention it to the athlete only
when it actually mattered.

**Done when** telemetry reconciles, replay verifies the normalized drift provenance, the
audit remains compact/non-raw, and rationale is counterfactually decision-relevant.

**Implementation note.** `DecisionScoreTelemetry` (`models.ts`) gained an optional
`subjectiveDrift?: number` field; `evaluateReadinessAndSafetyEnvelope` now populates it and
changed `totalDecisionScore` to `objectiveStrain + subjectiveDrift` so the components
reconcile exactly. Under production's `'off'` default `subjectiveDrift` is always `0`, so
this is bit-identical to pre-9.7 output -- confirmed by the full existing test suite passing
unchanged. A live-safe `subjectiveDriftIsDecisionRelevant` counterfactual was added inline
(mirroring the existing `multiDayDriftIsDecisionRelevant` pattern exactly: computed from
`objectiveStrain` alone through the same threshold logic, compared against the pre-override
`mode`), and wired into `evaluateTraining`'s ("Path A") rationale alongside the existing
`multiDayDriftIsDecisionRelevant` line -- scoped there rather than into
`evaluateTrainingWithIntent`'s optimizer-driven rationale, matching precedent and the 9.3
note that threading further is out of scope. Neither addition references the literal string
`'drift'`, so the existing `rules.test.ts` guard (no non-test engine file outside
`simulation/` may contain that literal) is untouched.

A new `estimatorPolicyVersion` (`rules.ts`'s `SUBJECTIVE_DRIFT_ESTIMATOR_POLICY_VERSION`,
currently `'subjective-drift-score-v1-equal-weights-strain-z-cap'`) was added alongside
`estimatorId` on `SubjectiveDriftAudit`/`SubjectiveDriftDecisionEvidence`: `estimatorId`
identifies the *baseline* estimator's own parameterization (windows/floor/coverage --
already varied per sensitivity config), while `estimatorPolicyVersion` identifies the
*scoring* policy (weights + cap-source convention) that turns a baseline into a strain
contribution, so a future weights/cap change is distinguishable from a future baseline
change. `subjectiveDriftAuditReplayErrors` (`subjectiveDriftAudit.ts`) validates it as a
non-empty string alongside the existing checks. Fixing this also surfaced and corrected a
double-count: `buildSubjectiveDriftDecisionEvidence`'s `totalDecisionScoreWithDrift` used to
add `contribution` on top of `drift.telemetry.totalDecisionScore` under the assumption that
telemetry did not yet include the subjective term -- now that it does (this work item), that
addition would have double-counted, so it was simplified to read the reconciled telemetry
value directly.

`firestore.rules`'s `hasValidRecommendationAudit` allow-lists an optional `subjectiveDrift`
key and validates its shape via a new `hasValidSubjectiveDriftAudit` helper (estimator
identifiers non-empty, coverage counts non-negative integers, contribution non-negative,
the canonical six-metric key set exactly, `decisionRelevant` boolean); emulator coverage in
`firestoreRules.emulator.test.ts` exercises an accepted well-formed write and seven distinct
malformed-shape rejections. Production `Home.tsx` is unchanged and still supplies no
subjective-drift evidence, so real persisted audits keep the exact legacy shape.

`check-policy-drift.mjs`'s dormant-exception was widened (not the trigger list -- only the
"no other production source may change" filter) to also tolerate `models.ts`, `provenance.ts`,
`subjectiveDriftAudit.ts` and `replay.ts` alongside `rules.ts`/`subjectiveBaseline.ts`, since
this work item's changes to those files are evidence/telemetry-only and cannot alter what
mode a real decision selects. Verified directly against this work's actual diff: the widened
exemption applies cleanly with no `POLICY_VERSION` bump required.

---

### 9.8 Prospective go / no-go `[ ]`

A successful 9.6 is **necessary but not sufficient** to ship.

Read 9.6 together with Phase 9.0's prospective shadow/check-in record (or an equivalent later
prospective corpus). Report whether engine/manual disagreements or actual-outcome differences
concentrate on days where prior subjective history had already moved adversely, and whether
the candidate would have improved or merely made the engine more conservative.

Then record one of:

1. **Ship** — prospective evidence supports the mechanism and a stable estimator; flip the
   production default, bump `POLICY_VERSION`, move the outgoing value to
   `HISTORICAL_POLICY_VERSIONS`, and update the simulation baseline in a separate reviewed
   commit.
2. **Ship narrowed** — e.g. only selected metrics/estimator settings are supported; document
   exactly which evidence excluded the rest, then perform the same policy-version/baseline
   cutover.
3. **Reject / keep off** — no useful prospective signal, excessive conservatism, or unstable
   estimator sensitivity. Mark ADR-0020 `Rejected` or record the narrowed no-ship outcome.

If prospective evidence is insufficient, **do not complete 9.8**: leave the selector off and
state that the decision is deferred. Synthetic fixtures alone are not a ship criterion.

**Done when** the outcome is recorded in ADR-0020 with both simulation and prospective
evidence. Writing code is not what closes this task.

---

## Tests to add

| Area | Behaviour asserted |
|---|---|
| `subjectiveBaseline` | Decision date excluded; recent and long coverage tracked separately; duplicate dates/partial check-ins do not inflate coverage; bounded zero-variance handling. |
| `rules` (property) | For any baseline input, `'drift'` never produces a less restrictive mode than `'off'`. |
| `rules` | Every absolute trigger fires identically under both policies. |
| `rules` | Chronically elevated soreness remains `modify`/`recover` regardless of relative normality. |
| `rules` | `'off'` is bit-identical to pre-Phase-9 output on the committed corpus. |
| `composer` | Range ends at `D - 1`; failed/invalid/sparse history leaves the decision unchanged; invalid records do not count. |
| `architecture` | No production call site passes `'drift'`. |
| `replay` | Audit carrying estimator id, exclusive history boundary, coverage and contribution replays coherently. |
| `simulate:diff` | No changed pre-existing baseline scenario while default is `'off'`. |

## Acceptance criteria

- [x] `npm run check` and `npm run test:rules` pass.
- [x] `npm run simulate:diff` reports no changed pre-existing baseline scenario (9.5 fixtures appear as `[NEW SCENARIO]`).
- [x] `check-policy-drift.mjs` passes — **no `POLICY_VERSION` bump while the live default is `'off'`**.
- [x] A history-leak regression proves date `D` never contributes to the baseline used for decision `D` (`subjectiveBaseline.test.ts` — `excludes a check-in dated exactly asOfDate (D-SUBJHIST)`, plus a future-date exclusion case).
- [ ] The property test proving drift can only tighten passes.
- [ ] Every 9.5 fixture has the intended variance/absolute-mode properties.
- [x] The slow-drifter fixture is detectable by at least one measured drift candidate without noisy-stationary becoming pathologically restrictive; failure is valid evidence against the candidate.
- [x] 9.6 reports estimator/parameter sensitivity rather than presenting one arbitrary setting as physiological truth.
- [x] Habitual-low and chronically-sore show no relaxation under every measured candidate.
- [ ] 9.8 does not ship from synthetic evidence alone; the final outcome cites prospective evidence or explicitly defers.
- [ ] Any live/default decision change bumps `POLICY_VERSION` exactly at cutover, not when dormant code is introduced.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| A zero-variance corpus produces a false "no signal". | 9.5 is a hard precondition of 9.6. |
| Synthetic profiles measure fixtures, not people. | Treat 9.6 as safety/regression evidence only; require Phase 9.0 prospective evidence for production. |
| Today's check-in leaks into today's baseline and is partly double-counted. | D-SUBJHIST uses `throughDateExclusive = D`; composer and baseline tests enforce it. |
| Sparse long-window history hides missing recent state. | D-SUBJCOV requires recent and long coverage separately. |
| Mean/stdev arithmetic is brittle on an ordinal/discrete scale. | Reference estimator is experimental; 9.6 reports sensitivity and adds a robust alternative if materially needed. |
| The term tightens too readily and raises recovery share without useful signal. | 9.6 exposes the mechanical effect; 9.8 requires prospective usefulness before shipping. |

**Rollback.** Until 9.8 flips the live default, production is bit-identical and there is
nothing behavioural to roll back. After a ship decision, reverting the default is a policy
change and receives its own `POLICY_VERSION`; do not "restore" an old version string and
make two different live policies share an identity.

## Out of scope

* Surfacing subjective baselines before check-in submission — forbidden by D-SUBJANCHOR.
* Using subjective normalization to relax today's absolute thresholds.
* Backfilling subjective history that was never recorded.
* Treating synthetic scenarios as clinical validation.
* Any change to objective strain, `metricStrain`, or the existing absolute subjective
  thresholds in this phase.
* Adopting beam search, revisiting fatigue fusion, or unrelated deferred decisions.

## Docs to update

- [x] ADR-0020 → `Accepted` before starting 9.1–9.4/9.6–9.7; final outcome recorded at 9.8.
- [ ] `architecture/recommendation-engine.md` — mode-selection formula gains the optional adverse subjective-drift component if shipped.
- [x] `AGENTS.md` — engine map gains `subjectiveBaseline.ts` once implemented.
- [x] `plans/README.md` — decision-register rows once ADR-0020 is accepted.
- [x] `docs/README.md` — index row.

---

## Task board

| # | Task | Status | Blocked by |
|---|---|:--:|---|
| 9.1 | Subjective baseline computation | `[x]` | ADR-0020 |
| 9.2 | Carry the baseline on `DailyReadiness` | `[x]` | 9.1 |
| 9.3 | Drift term behind a default-off selector | `[x]` | 9.2 |
| 9.4 | Composition boundary supplies the baseline | `[x]` | 9.2 |
| 9.5 | Scenario corpus subjective variance | `[x]` | — |
| 9.6 | Comparison harness + estimator sensitivity | `[x]` | 9.3, 9.5 |
| 9.7 | Telemetry, audit and rationale | `[x]` | 9.3 |
| 9.8 | Prospective go / no-go | `[ ]` | 9.6, Phase 9.0 prospective evidence |

9.5 remains independently useful whether ADR-0020 ships or not: readiness scenarios should
not all exercise a constant subjective vector. Its invented numbers are explicitly fixture
evidence only until the prospective block can re-parameterize or challenge them.
