# Phase 3 — One ranking path, lexicographically ordered

* **Status:** Ready — F5 resolution decided 2026-08-08 (see 3.4)
* **Depends on:** Phase 0 (**hard** — this phase changes ranking behaviour and is
  unmeasurable without the invariant suite), ADR-0010 from Phase 2
* **Unlocks:** Phase 5 (sequence search needs a coherent scoring layer to sit on)
* **Addresses:** F3, F4, F5
* **Rough effort:** 3–4 days

---

## Goal

Replace modality-repetition suppression with explicit recovery and role constraints,
make both optimizer call sites agree, and stop the week-ahead strip assuming tomorrow is
always green.

---

## 3.1 — F3: replace modality anti-stacking

### Why "add a date" is not the fix

`RecentHistoryEntry` (`optimizer.ts:24-28`) has no `date`, so
`getConsecutiveModalityCount` treats array adjacency as calendar adjacency, contradicting
ADR-0008 §6. Adding the field makes the rule *correct* — and still the wrong shape.

The hazard was never `Cycling, Cycling, Cycling`. It is:

```text
hard lower-body quality
      ↓ insufficient recovery
hard lower-body quality
```

Three cycling sessions in a week — Tuesday threshold, Thursday Zone 2, Saturday
race-specific — is a *correct* build week for a cycling A-event. The current rule
suppresses the third to 0.15×, which against the 1.40× A-event boost nets **0.21×** and
steers the plan away from precisely the modality the event requires.

### The replacement

**Structured history.** Extend the entry to carry what a recovery rule actually needs:

```ts
export interface SessionHistoryEntry {
  date: string;
  templateId: string;
  modality: Modality;
  role: SessionRole;
  intensityClass: IntensityClass;
  systemicCost: number;
  lowerBodyCost: number;
}
```

**Explicit constraints** replacing `consecutiveCount >= 2 || rollingCount >= 2`:

| Constraint | Rule |
|---|---|
| Quality spacing | ≥ 48 h between two `quality`-role sessions |
| Hard lower-body | no back-to-back sessions with `lowerBodyCost >= 0.6` |
| Rolling hard cap | ≤ 3 sessions with `systemicCost >= 0.5` in any rolling 7 days |
| Anchor protection | no heavy lower-body strength within 1 day of a key cycling session |
| Variety | applies **only** among candidates in the same role and modality |

Note the last row: variety is a tie-break between equivalent options, never a reason to
change what kind of session a day gets. That is the distinction the current code loses.

### 3.2 — Lexicographic ordering, not more multipliers

The present architecture asks one multiplicative score to arbitrate safety,
periodization, interference, recovery, preference and variety at once. F3 is the proof it
cannot: two independently reasonable multipliers compose into a policy nobody chose.

```text
1. Safety and feasibility            hard filter
2. Must-have plan obligations        hard filter where the window still allows it
3. Sequence and recovery constraints hard filter
4. Objective coverage and timing     primary sort key
5. Expected fatigue cost             secondary sort key
6. Preference / variety / convenience  tie-break only
```

Levels 1–3 filter. Levels 4–6 sort what survives. Utility scoring stays — inside a
single equivalence class. Once the role for a day is fixed to, say, *supporting aerobic*,
scalar utility is exactly the right tool for choosing between indoor Zone 2, an outdoor
easy ride, and cross-training given readiness, equipment and preference.

**Implementation shape.** `rankCandidatesByUtility` becomes:

```ts
rankCandidates(candidates, context) →
  applyHardConstraints(...)      // levels 1-3, each rejection carrying a named reason
  .then(groupByEquivalenceClass) // role + modality
  .then(orderClasses)            // level 4-5
  .then(rankWithinClass)         // level 6 — the existing utility formula, unchanged
```

Rejection reasons must be named and surfaced in `decisionTrace.candidateScores`, which
today records `excludedReasons: []` unconditionally (`rules.ts:530`) — an audit field
that has never carried data.

### 3.3 — F4: one optimizer invocation

The two call sites differ (verified):

| | `rules.ts:497-514` | `planner.ts:477-485` |
|---|---|---|
| `systemicCost` in history | absent → Patch 1c dead | present → live |
| `modality` | set to the *type* string | omitted |
| preferences | fabricated literal | real / `NEUTRAL_PREFERENCES` |
| anchor context | never passed | passed |

Extract `buildOptimizationContext(intent, context, preferences, date)` used by both, and
delete the fabricated `UserPreferences` literal at `rules.ts:503-509`.

**Test:** given identical inputs, both call sites produce identical `RankedCandidate[]`.
This is the assertion that keeps them from drifting again.

### 3.4 — F5: stop assuming tomorrow is green

`Home.tsx:332` hardcodes `nextDayPlan.branches.green.recommendation`. ADR-0008 §1
specifies the user-selected branch; no selector exists, so yellow and red are computed
(three full `evaluateTrainingWithIntent` passes) and discarded, and every projected day
is seeded from a best-case tomorrow.

> **Decision (2026-08-08): build the selector.** Add tier selection to the next-day card
> and thread it into `generateWeekAheadPlanWithIntent`.
>
> The cheap alternative — default to `yellow` and amend the ADR — was considered and
> rejected. It swaps one wrong fixed assumption for a less wrong fixed assumption while
> still discarding two of the three branches the engine already computes. The three
> `evaluateTrainingWithIntent` passes are being paid for regardless; the only thing
> missing is a control to choose between them, which is a small piece of UI against an
> API that already returns all three. Defaulting to yellow would leave that waste in
> place permanently and remove the pressure to fix it.
>
> **Fallback if the UI slips past this phase:** ship `yellow` as the default *and* amend
> ADR-0008 §1 in the same commit, so the ADR never describes a selector that does not
> exist. Do not ship the yellow default silently.

---

## Tests to add

* `optimizer.test.ts` — three cycling sessions across 7 days with ≥48 h spacing receive
  **no** repetition penalty; two hard lower-body sessions on consecutive days do.
* `optimizer.test.ts` — a preference multiplier cannot promote a candidate above one that
  satisfies a must-have obligation (the lexicographic guarantee).
* `optimizer.test.ts` — `excludedReasons` is populated for every filtered candidate.
* parity test for 3.3 (above).
* `goldenWeek.test.ts` — the `it.fails` assertion from Phase 0.2 flips to passing. **This
  is the definition of done for 3.1.**

## Acceptance criteria

- [ ] `getConsecutiveModalityCount` / `getRollingModalityCount` deleted or reduced to a
      tie-break input
- [ ] date-aware, role-aware history threaded from both call sites
- [ ] hard constraints separated from sort keys; rejection reasons named
- [ ] Phase 0 golden-week event-modality assertion passes
- [ ] both call sites produce identical rankings for identical input
- [ ] `Home.tsx` no longer hardcodes `branches.green`
- [ ] `POLICY_VERSION` bumped

## Risks & rollback

* **This changes recommendations for every user.** It is the most behaviourally
  significant phase before the sequence planner. Land 3.1 and 3.3 separately, each with
  its own semantic diff read in review.
* **Over-correction.** Removing suppression entirely could reintroduce the "tempo trap"
  Patch 1c was written for. The rolling hard cap is what replaces it — verify against the
  Phase 0 aggregate bound on same-template streaks, not by intuition.
* Rollback is per-commit; the constraint layer is additive to the existing filter chain
  until the multipliers are deleted, so the two can briefly coexist behind a flag.

## Out of scope

Sequence search across days (Phase 5). This phase makes a *single day's* ranking coherent
and correctly informed; it does not yet optimise the week as a unit.

## Docs to update

* **ADR-0008** — amend §6: the date-less history is fixed; state the real constraint model
* **ADR-0007** — amend §5/§6: anti-stacking is superseded
* **ADR-0010** — record the lexicographic priority model as accepted
