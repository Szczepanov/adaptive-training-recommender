# Issue #458 — deterministic sequencing and ranking-counterfactual diagnostics

Status: **Implemented** (2026-09-08, this worktree; not yet merged to `main`)
Blocked by: none (implementable directly against current `main`; see [Relationship to PR #453](#relationship-to-pr-453))
Unlocks: Priority 2 (phase-specific sequence intent) and Priority 3 policy experiments in
`docs/analysis/2026-09-07-recommender-optimization-opportunities.md`; a future ADR-0015
beam-search re-evaluation
Addresses: GitHub issue
[#458](https://github.com/Szczepanov/adaptive-training-recommender/issues/458)

---

## Status and scope

This plan implements **PR A ("sequencing observability, no behavior change")** from
`docs/analysis/2026-09-07-recommender-optimization-opportunities.md` §11, which is exactly
issue #458's scope: deterministic sequencing diagnostics (§4 of that analysis) plus the
rank-counterfactual fields needed for the lexicographic-ranking audit (§6). The analysis
document explicitly folds both into one PR because the ranking counterfactual is cheap
derived data once the sequencing-diagnostics seam exists, and both are pure, deterministic,
zero-production-behavior-change instrumentation.

This is **diagnostics only**. No hard gate, ranking-tier precedence, spacing rule, or fatigue
weight changes as part of this work. Per the analysis's design principle #1 ("observe before
gating") and its own acceptance criteria for both priorities, the explicit definition of done
for this plan is that **no live recommendation output changes** — verified by scenario
snapshot diffing (see [Verification](#verification)).

### Relationship to PR #453

`docs/analysis/2026-09-07-recommender-optimization-opportunities.md` is committed on PR
[#453](https://github.com/Szczepanov/adaptive-training-recommender/pull/453)'s branch
(`fix/effective-dose-week-ahead-projection`), which is **open, not yet merged** into `main`
as of this plan. This plan's engineering seams (`optimizer.ts` ranking internals,
`simulation/analyze.ts` trace types, `planner.ts` forecast diagnostics) do not depend on
PR #453 landing first — they can be built directly against current `main`. If PR #453 merges
first, rebase onto it so the analysis doc exists at its documented path; if this plan lands
first, add the analysis doc's path as a forward reference once #453 merges. Either order is
safe because the two PRs touch non-overlapping logic (PR #453: `activeDose` projection
fidelity; this plan: read-only diagnostics derived from already-selected candidates).

---

## Design principles carried over from the analysis

1. Observe before gating — every new field is a diagnostic, never a new hard constraint.
2. Zero production behavior change — no live recommendation output changes.
3. Zero persisted-audit format change — `RecommendationAudit.candidateScores` (the
   Firestore-persisted shape) does not gain new fields from this work (see
   [Persistence-boundary hardening](#persistence-boundary-hardening-in-scope) below for why
   this needs an explicit fix, not just "don't touch the type").
4. Forecast truth and completed truth remain distinct — diagnostics read projected
   (`WeekAheadDay`) and decision-trace state; they never mutate performed-training history.
5. Deterministic output for identical scenario input — no randomness, no wall-clock
   dependence beyond what already exists in the simulation harness.

---

## Current architecture this plugs into

- `app/src/engine/optimizer.ts::rankCandidates()` already computes, per candidate:
  `coverageNeedTier`, `recoveryPreferenceTier`, `benefitScore`, `costPenalty`,
  `utilityScore`. It also computes a per-candidate **benefit tier** today, but only as a
  local `Map<RankedCandidate, number>` (`benefitTierByCandidate`,
  [optimizer.ts:978-985](../../app/src/engine/optimizer.ts)) that is discarded after
  sorting — never attached to the candidate or exposed to callers.
- `app/src/engine/rules.ts` (today/tomorrow path) and `app/src/engine/planner.ts` (forecast
  days, a separate greedy loop) each call `rankCandidates`/`rankCandidatesByUtility`
  independently and each narrow the result into their own trace shape
  (`Recommendation.decisionTrace.candidateScores` and `WeekAheadDay.diagnostics`
  respectively). **Neither trace shape currently carries `coverageNeedTier`,
  `recoveryPreferenceTier`, or a benefit tier** — they only carry `utilityScore`,
  `benefitScore`, `costPenalty`, `excludedReasons`.
- `app/src/engine/simulation/analyze.ts` already builds `ScenarioDecisionTrace[]` from both
  paths (`traceFromRecommendation`, `traceFromForecastDay`) into one common shape consumed by
  `ScenarioResult`, the simulation report, and the AI-judge corpus builder
  (`app/scripts/build-plan-judge-corpus.mjs`). This is the correct aggregation point for new
  corpus-level metrics — it already unifies both ranking call sites.
- `app/src/engine/provenance.ts` builds the **persisted** `RecommendationAudit` from
  `Recommendation.decisionTrace` via `candidateScores: trace.candidateScores` — a direct
  reference, not a field-by-field map (see next section).

### Persistence-boundary hardening (in scope)

`provenance.ts:55` currently does:

```ts
candidateScores: trace.candidateScores,
```

`RecommendationAudit.candidateScores` (`models.ts:1776`) is typed as
`{ templateId; utilityScore; excludedReasons }[]`, but `Recommendation.decisionTrace
.candidateScores` (`models.ts:830`) already carries two extra fields today
(`benefitScore`, `costPenalty`). Because the assignment is a direct reference, not a
narrowing map, **those extra fields are already being persisted into
`RecommendationAudit` today**, silently ahead of their type declaration. This is a
pre-existing, independent gap, not something introduced by this issue — but it means simply
*not adding new fields to `RecommendationAudit`'s TypeScript type* would not actually keep
them out of persisted documents once this plan adds more fields to
`Recommendation.decisionTrace.candidateScores`.

**Action (small, low-risk, in scope):** change `provenance.ts` to build
`RecommendationAudit.candidateScores` with an explicit field map:

```ts
candidateScores: trace.candidateScores.map(c => ({
    templateId: c.templateId,
    utilityScore: c.utilityScore,
    excludedReasons: c.excludedReasons,
})),
```

This is what the existing type already promises; it stops being sensitive to how many
diagnostic fields get added to the in-memory trace, closing an existing type/runtime
mismatch while making this plan's "zero persisted-format change" acceptance criterion
actually true rather than incidentally true. Cover it with a unit test asserting
`buildRecommendationAudit(...)`'s `candidateScores` entries only ever contain those three
keys, even when the input trace carries the new diagnostic fields below.

---

## Work items

### 1. `RankedCandidate.benefitTier` (optimizer.ts)

Promote the existing local benefit-tier computation onto the candidate itself so all callers
can see it without recomputing tie-band logic:

- Add `benefitTier?: number` to `RankedCandidate` (`optimizer.ts:111-123`).
- In `rankCandidates()`, after computing `benefitTierByCandidate`
  (`optimizer.ts:978-985`), assign `candidate.benefitTier = getBenefitTier(candidate)` for
  every `accepted` candidate before the final lexicographic sort. Leave it `undefined` for
  `rejected` candidates (tier is meaningless once a candidate is hard-excluded).
- No change to sort behavior or `RankCandidatesResult` shape otherwise.

### 2. `computeRankingCounterfactual()` (new pure function, optimizer.ts)

```ts
export interface RankingCounterfactual {
    selectedTemplateId: string;
    coverageNeedTier: 0 | 1 | 2 | 3;
    recoveryPreferenceTier: 0 | 1;
    benefitTier: number;
    utilityScore: number;
    bestUtilityTemplateId: string | null;
    bestUtilityScore: number | null;
    selectedVsBestUtilityGap: number | null;
    utilityWinnerBlockedByCoverageTier: boolean;
    utilityWinnerBlockedByRecoveryTier: boolean;
    utilityWinnerBlockedByBenefitTier: boolean;
    /** Cheap proxy for "the selection advances an explicit required weekly programming
     * role" (coverageNeedTier <= 1, matching the existing rationale-string convention at
     * optimizer.ts:967). A precise weekly-role-allocation feasibility cross-check is a
     * follow-up (see Deferred). */
    selectedAdvancesRequiredRole: boolean;
}

export function computeRankingCounterfactual(
    result: RankCandidatesResult,
    selectedTemplateId: string,
): RankingCounterfactual | null
```

Implementation: find `selected` in `result.accepted` (return `null` if absent — e.g. the
recovery-fallback path with no accepted candidates); find `bestUtility` as the
max-`utilityScore` member of `result.accepted` (ignoring tier order entirely — this is the
"if only utility decided" counterfactual); the three `utilityWinnerBlockedBy*Tier` booleans
are `true` when `bestUtility !== selected` **and** the specific tier field differs between
them (a candidate can be blocked by more than one tier simultaneously; report all that
differ, not just the first).

This is pure and takes only already-computed ranking output — no new ranking logic, no
change to selection.

### 3. Wire into both ranking call sites, as sibling data — not into the persisted shape

- `rules.ts` (`evaluateTrainingWithIntent`/`evaluateNextDayPlanWithIntent`, the two
  `decisionTrace: { ... }` object literals at lines ~770 and ~794): add a **new sibling
  key**, not a widening of `candidateScores`, e.g.
  `decisionTrace.rankingAudit: RankingCounterfactual | null`, computed via
  `computeRankingCounterfactual(rankingResult, pick?.template.id ?? '')`. Keeping this as a
  new key (rather than adding fields to `candidateScores` entries) means
  `provenance.ts`'s existing `trace.candidateScores` reference is untouched by this
  addition regardless of the hardening in item 0 above — belt and suspenders.
- Add `rankingAudit?: RankingCounterfactual` to `Recommendation['decisionTrace']`
  (`models.ts:828-852`). Do **not** add it to `RecommendationAudit` (`models.ts:1758-1796`)
  or to `provenance.ts`'s audit builder — it is intentionally simulation/analysis-only and
  must not appear in persisted documents. Add a unit test asserting
  `buildRecommendationAudit(...)` output has no `rankingAudit` key even when the input
  recommendation carries one.
- `planner.ts` forecast-day loop (~line 1505, the `diagnostics: { ... }` literal): add
  `diagnostics.rankingAudit: RankingCounterfactual | null` the same way, computed from the
  same `ranked`/`rankCandidates` result already in scope there. Add the field to
  `WeekAheadDay['diagnostics']` (`planner.ts:105-125`).

### 4. `ScenarioDecisionTrace.rankingAudit` (simulation/analyze.ts)

- Add `rankingAudit: RankingCounterfactual | null` to `ScenarioDecisionTrace`
  (`analyze.ts:41-73`).
- `traceFromRecommendation()` reads it from `recommendation.decisionTrace?.rankingAudit`.
- `traceFromForecastDay()` reads it from `day.diagnostics?.rankingAudit`.

This single change makes the ranking-counterfactual audit available uniformly for both the
today/tomorrow path and the forecast-day path, at the same aggregation point the analysis
identifies as already unifying both (`analyze.ts` §2.4 of the analysis doc).

### 5. `sequencingMetrics.ts` (new pure module) — Priority 1 metrics

New file: `app/src/engine/simulation/sequencingMetrics.ts`. Pure functions over
`ScenarioDecisionTrace[]` (already carries selected cost/stimulus/fatigue per day) — no new
inputs required. Implements the analysis's §4.1–§4.5 metrics:

```ts
export interface SequencingDiagnostics {
    residualFatigueCollision: {
        perDay: Array<{ date: string; collision: number; topDimensions: string[] }>;
        meanCollision: number;
        maxCollision: number;
    };
    adjacentCostOverlap: {
        maxLowerBodyOverlap: number;
        maxImpactTissueOverlap: number;
        maxNeuromuscularOverlap: number;
        meanOverlap: number;
    };
    qualitySpacing: {
        minGapDays: number | null;
        medianGapDays: number | null;
        adjacentQualityDayCount: number;
        longestQualityStreak: number;
        qualityPer3DayWindowMax: number;
        qualityPer7DayWindowMax: number;
    };
    hardDayConcentration: {
        weekly: Array<{
            weekIndex: number;
            hardDayCount: number;
            maxHardStreak: number;
            recoveryAfterHighCollisionCount: number;
            recoveryWhileFatigueLowAndWorkFeasibleCount: number;
        }>;
    };
    opportunityCost: {
        // Aggregated from decisionTrace.rankingAudit across all days.
        utilityWinnerBlockedCount: number;
        meanBlockedUtilityGap: number;
        maxBlockedUtilityGap: number;
        blockedByTier: { coverage: number; recovery: number; benefit: number };
    };
}

export function computeSequencingDiagnostics(
    traces: readonly ScenarioDecisionTrace[],
): SequencingDiagnostics
```

Notes on faithful translation of the analysis's formulas:

- **Residual-fatigue collision** (§4.1): `collision_t = Σ_d(F_t[d] * C_t[d]) / max(ε,
  Σ_d(C_t[d]))` using `trace.fatigue.combined` (pre-session, already the last thing computed
  before selection) and `trace.selected.projectedCost`. `ε = 1e-6`; a day with
  ~zero-cost session (pure rest) reports `collision = 0` rather than `NaN`.
- **Adjacent cost-vector overlap** (§4.2): needs the *previous day's effective-dose cost
  vector decayed to the current date*. Reuse the existing per-dimension fatigue decay
  half-lives already defined in `fatigue.ts` (do not invent new decay constants) — export
  the relevant per-dimension decay function from `fatigue.ts` if it is not already exported,
  rather than duplicating the half-life table.
- **Quality-session spacing** (§4.3): "key quality work for the current phase/event
  context" — for this first PR, classify quality sessions as
  `category ∈ {'Hard Endurance', 'Race-Specific Endurance', 'Moderate Endurance'}` (matching
  `ANCHOR_HISTORY_CATEGORIES`-adjacent semantics already in `optimizer.ts`) plus heavy
  strength (`HEAVY_LOWER_BODY_STRENGTH_CATEGORIES` / `'Full-body Strength'`). Do not attempt
  phase-aware classification yet — that is explicitly Priority 2's job.
- **Hard-day concentration / recovery placement** (§4.4): "recovery day occurring while
  fatigue is low and unresolved high-priority work is still feasible" needs
  `activeObjectives` (already on `ScenarioDecisionTrace`) to determine "unresolved
  high-priority work... feasible" — define "feasible" conservatively as "at least one
  active objective has `projectedCredit < requiredCredit`" for this first cut.
- **Opportunity-cost / regret** (§4.5): a direct aggregation over the new
  `rankingAudit` field from item 4 — no new computation, just aggregation.

Keep every metric a pure reduction over its inputs (no I/O, no `Date.now()`), so the same
scenario input always reproduces identical output (analysis acceptance criterion for
Priority 1).

### 6. Extend `ScenarioResult` and `computeMetrics()` (analyze.ts)

- Add `sequencingDiagnostics: SequencingDiagnostics` to `ScenarioResult`
  (`analyze.ts:74-91`).
- In `computeMetrics()` (`analyze.ts:233-331`), call
  `computeSequencingDiagnostics(decisionTraces)` and include the result. This is the only
  call site — every scenario execution path (`runScenario`, the rolling-daily corpus builder
  path) already funnels through `computeMetrics()` or builds an equivalent
  `decisionTraces`-shaped result, so no second wiring point is needed for the primary
  simulation report.
- **Rolling-daily path** in `app/scripts/build-plan-judge-corpus.mjs`
  (`runRollingDailyScenario`, lines ~307-370) builds its own result object by hand rather
  than calling `computeMetrics()`. Add
  `sequencingDiagnostics: analyzeModule.computeSequencingDiagnostics(decisionTraces)` there
  too so both simulation paths expose the same diagnostics.

### 7. Judge-packet and corpus-report wiring

- `packetFromResult()` in `build-plan-judge-corpus.mjs` (~line 290): add
  `sequencingDiagnostics: result.sequencingDiagnostics` to `engineSummary`. This exposes the
  new metrics to judge-packet consumers **without changing `plan` (session-by-session
  content)**, matching the acceptance criterion "judge packets can include them without
  changing the actual plan text".
- New report script: `app/scripts/report-sequencing-diagnostics.mjs` (or extend
  `analyze-plan-judge.mjs` if that is the more natural home — check its current structure
  before deciding) that:
  - runs the standard scenario corpus,
  - ranks scenario/day cases by `residualFatigueCollision` and by
    `rankingAudit`-derived opportunity-cost gap,
  - prints the top 20 largest ordinal-vs-utility disagreements (analysis §6 acceptance
    criterion) with template IDs and the blocking tier,
  - cross-references case IDs against the committed persona/general judge baseline files
    (`docs/analysis/persona-judge-baseline.json`, `docs/analysis/plan-judge-baseline.json`)
    to flag cases that are both high-collision/high-regret **and** low-scoring on
    `sequencing` in the judge baseline — this answers the analysis's explicit question:
    "which cases have the worst sequence collision, and do they overlap with the cases the
    judge scores poorly on sequencing?"
  - add this script to `package.json` (e.g. `"report:sequencing": "node
    scripts/report-sequencing-diagnostics.mjs"`) and to the relevant Makefile/CLAUDE.md
    command list if `make simulate` is the natural place for it — confirm with the Makefile
    before wiring it into `make all`/`make check` (this is a report, not a gate, so it
    should not fail CI by default).

### 8. Tests

- `app/src/engine/optimizer.rankingCounterfactual.test.ts` — unit tests for
  `computeRankingCounterfactual()`: a case where the utility winner matches the lexicographic
  winner (all blocked flags `false`, `selectedVsBestUtilityGap === 0`); a case where a
  higher-coverage-tier candidate blocks a higher-utility one
  (`utilityWinnerBlockedByCoverageTier === true`); a case with no accepted candidates
  (`null` result); a case with exactly one accepted candidate (`bestUtility === selected`,
  gap `0`).
- `app/src/engine/simulation/sequencingMetrics.test.ts` — unit tests per metric family using
  small hand-built `ScenarioDecisionTrace[]` fixtures: collision-score normalization
  (including the pure-rest zero-cost edge case), a known two-day overlap value, a known
  quality-gap sequence, a known hard-streak/recovery-placement sequence, and an
  opportunity-cost aggregation from a fixture with a mix of blocked/unblocked days.
- `app/src/engine/provenance.test.ts` (extend existing, or add if none exists for this
  boundary) — assert `buildRecommendationAudit(...)`'s `candidateScores` output never
  contains `benefitScore`, `costPenalty`, or any new diagnostic key, and that
  `rankingAudit` never appears on the persisted `RecommendationAudit`, even when the input
  `Recommendation.decisionTrace` carries all of them.
- Scenario snapshot / diff check: run `npm run simulate:scenarios` and
  `npm run simulate:diff` before and after this change and confirm **zero diff** in
  recommended templates/durations/modes across the full scenario corpus — this is the
  concrete falsifiable form of "zero production behavior change".

---

## Suggested commit/PR sequence

This is small enough to ship as **one PR** (matching the analysis's "PR A" framing), but if
splitting is preferred for reviewability:

1. `optimizer.ts`: `benefitTier` + `computeRankingCounterfactual` + unit tests (item 1, 2, 8a).
2. `provenance.ts` persistence-boundary hardening + test (item 0) — safe to land
   independently and first, since it is a pure bugfix with no behavior change either way.
3. `rules.ts` + `planner.ts` + `models.ts` wiring (item 3).
4. `simulation/analyze.ts` + `sequencingMetrics.ts` + tests (item 4, 5, 6, 8b).
5. `build-plan-judge-corpus.mjs` + new report script (item 7).

---

## Acceptance criteria (rolled up from the analysis, made concrete for this repo)

- [x] Deterministic output for identical scenario input (no `Date.now()`/`Math.random()` in
      any new function). Verified by a dedicated determinism test in
      `sequencingMetrics.test.ts`.
- [x] `POLICY_VERSION` bumped to `2026-09-sequencing-ranking-diagnostics-v1`. This repo's
      `check-policy-drift.mjs` CI gate requires a bump whenever `optimizer.ts`/`planner.ts`/
      `rules.ts` change at all, mechanically, regardless of proven behavioral equivalence --
      its narrow "dormant change" exceptions are reserved for code with genuinely no live
      caller, which does not describe this PR (the new diagnostic fields ARE computed on
      every live decision, they just aren't consumed by selection). Bumping is the correct,
      convention-following resolution rather than building a new bespoke exception for a
      shape of guarantee ("computed but unused for selection") the exception mechanism isn't
      designed to verify mechanically.
- [x] **Zero behavior change**, verified more rigorously than `npm run simulate:diff` alone:
      `simulate:diff` against the *committed* baseline shows pre-existing drift unrelated to
      this work (reproduced identically on a clean pre-change tree). The falsifiable check is
      a byte-for-byte diff of two full `simulate:scenarios` JSON reports (before/after this
      change, same commit otherwise) with only the new diagnostic fields
      (`sequencingDiagnostics`, `rankingAudit`) and volatile metadata
      (`capturedAt`/`commit`) stripped: **identical**, confirming no recommended template,
      duration, mode, or rationale changed.
- [x] `RecommendationAudit`'s persisted shape (verified by a unit test, not just the type
      declaration) is unchanged: no `rankingAudit`, no `benefitScore`/`costPenalty` leak --
      see the new regression test in `provenance.test.ts`.
- [x] Unit tests cover metric normalization (collision score, overlap) and date-gap
      arithmetic (quality spacing), matching the analysis's stated acceptance bar -- 17 tests
      in `sequencingMetrics.test.ts`, 6 in `optimizer.rankingCounterfactual.test.ts`.
- [x] `ScenarioResult.sequencingDiagnostics` is present for both the standard scenario-corpus
      path and the rolling-daily judge-corpus path (verified against a real generated
      corpus, not just unit fixtures).
- [x] Judge packets (`packetFromResult`) include the new diagnostics in `engineSummary`
      without any change to `plan` (the judge-visible session content).
- [x] A report can answer: "which cases have the worst sequence collision, and do they
      overlap with cases the judge scores poorly on sequencing?" --
      `npm run report:sequencing` (after `npm run build:plan-judge-corpus`), cross-referenced
      against the committed judge baselines' weakest/strongest-case subsets. Note: full
      per-case judge sequencing scores are not all in the committed baselines (only the
      weakest/strongest subsets are), so the report is honest about which cases it has no
      judge score for rather than fabricating one.
- [x] The top 20 largest ordinal-vs-utility ranking disagreements are enumerable from the
      report script, each naming the blocking tier breakdown.
- [x] `make check` / `npm run check` pass with no new type or lint errors -- 355 test files,
      3296 tests passed, 0 new errors.

### Real findings from the first corpus run (not part of this plan's scope to act on)

Running the new report against the current 68-case judge corpus surfaced a concrete,
falsifiable instance of the exact hypothesis the analysis raised in §2.5/§6: on several
cases, the **lexicographic utility winner was blocked on the large majority of days**
(e.g. 11 of 11 days in multiple cases), most often by the benefit-tier boundary rather than
the coverage or recovery tiers. This is evidence, not a decision -- per this plan's own
scope, it justifies a follow-up measurement-driven audit PR (Priority 3 "Option A/B/C" in
the analysis), not a precedence change made here.

---

## Deferred / explicitly out of scope

- **`selectionPreservedRequiredRoleAllocation`** as a precise weekly-role-allocation
  feasibility check (cross-referencing `weeklyAllocation.ts` reservations against what the
  utility winner would have consumed) is replaced in this plan by the cheaper
  `selectedAdvancesRequiredRole` proxy (`coverageNeedTier <= 1`). A precise version needs to
  simulate re-running weekly-role allocation with the counterfactual pick, which is
  materially more engineering for a diagnostic whose primary purpose (per the analysis) is
  triage, not proof. Revisit if the corpus report shows the proxy is misleading in practice.
- **Phase-aware quality-session classification** (Priority 2) is a separate, larger plan;
  this plan's `sequencingMetrics.ts` intentionally uses a static category list.
- **Any ranking-tier precedence change** (Priority 3's "candidate policy changes" — Options
  A/B/C in the analysis §6) is out of scope. This plan only measures; a follow-up ADR would
  be required before changing precedence, per the analysis's own acceptance criteria
  ("a follow-up ADR only if data justifies changing precedence").
- **Beam-search re-evaluation** (ADR-0015) is explicitly deferred pending this plan's data.

---

## Risks

- **Low overall** (matches the analysis's own risk rating for "PR A").
- The main risk is scope creep into phase-aware metrics or ranking-policy changes while
  implementing — mitigated by the explicit Deferred section above and by the zero-diff
  acceptance criterion, which makes any accidental behavior change fail loudly in CI.
- The persistence-boundary hardening (item 0) touches `provenance.ts`, a security/audit-path
  file; keep that change minimal (an explicit field map, nothing else) and covered by its
  own test before combining it with the rest of the diagnostics work.

---

## Verification

- `cd app && npm run check` (TypeScript, ESLint, Vitest, workout catalog).
- `cd app && npm run simulate:scenarios && npm run simulate:diff` — must show no behavioral
  diff.
- `cd app && npm run judge:local` (or the fuller `judge:run` if available in CI) — confirms
  the corpus builder still runs end-to-end with the new `engineSummary.sequencingDiagnostics`
  field present.
- New report script run against the current scenario corpus, manually reviewed for
  plausibility (e.g. collision scores near 0 for rest days, near 1 only for genuinely
  high-fatigue high-cost pairings) before relying on it for any follow-up prioritization.
