# Phase 9: Subjective baselines in readiness mode

* **Status:** Draft
* **Blocked by:** [ADR-0020](../adr/0020-subjective-baselines-in-readiness-mode.md) acceptance
* **Strongly preceded by:** [Phase 9.0](./phase-9-0-shadow-mode-and-decision-journal.md) — its shadow block turns 9.5 from inventing subjective variance into sampling the athlete's own
* **Unlocks:** a decision on whether self-normalised subjective drift belongs in the mode gate at all
* **Decisions:** ADR-0020 (D-SUBJDRIFT, D-SUBJADD, D-SUBJFLOOR, D-SUBJCOV, D-SUBJSD, D-SUBJPURE, D-SUBJANCHOR, D-SUBJCAL, D-SUBJAUDIT)

## Goal

Build the self-normalised subjective drift term behind a simulation-only selector, extend
the scenario corpus so the measurement can actually detect it, run the comparison, and
then decide whether it ships. Shipping is **not** the goal of this plan; deciding is.

## The chicken-and-egg, and how this plan resolves it

D-SUBJCAL says the coefficients and the go/no-go come from calibration evidence. But
calibration requires a working implementation. Building it and shipping it in one step
would make the ADR's evidence discipline decorative.

The repository already solved this exact problem for fatigue fusion. `FatigueFusionPolicy`
threads a `'max' | 'additive'` selector through `fatigue.ts` and `planner.ts`, defaulting
to production behaviour at every call site, and `runFatigueFusionComparison` runs the real
planner and hard gates under both. The additive selector has never been reachable by a
live caller.

**Phase 9 follows that pattern exactly.** The drift term is implemented behind a
`SubjectiveDriftPolicy` defaulting to `'off'`, so every production path is bit-identical
until a separate, evidence-backed decision flips it.

---

## Preconditions

* ADR-0020 accepted.
* **9.5 must land before 9.6 is run.** Reading a comparison against the current corpus
  would produce a confidently wrong answer — see the work item for why.
* **Phase 9.0's block should precede 9.5** where scheduling allows. It is not a hard
  blocker — 9.5's invented profiles are still better than a constant — but a real 4–6 week
  check-in record makes the profiles observed rather than assumed, and the calibration is
  only as good as the variance it is measured against.

---

## Work items

### 9.1 Subjective baseline computation `[ ]`

**Current behaviour.** Nothing baselines subjective data. `mapCheckinToSubjectiveInput`
maps one day's check-in to `SubjectiveInput` and nothing else reads check-in history.

**Change.** Add `engine/subjectiveBaseline.ts`, pure, exporting:

```ts
computeSubjectiveBaseline(
  checkins: readonly DailySubjectiveCheckin[],
  asOfDate: string,
): SubjectiveBaseline   // { avg7d, avg28d, stdev28d, recordedDays } per metric, or null
```

Per metric: trailing 7-day average, trailing 28-day average, 28-day population stdev
floored at `SUBJECTIVE_STDEV_FLOOR` (1.0 point, D-SUBJSD). `recordedDays` counts **distinct
complete scored dates**, not documents. A partial minimum-safety check-in can still carry
important pain/illness flags, but its null readiness dimensions are not observations of
the subjective score vector and therefore cannot mature the baseline. Returns `null`
outright below `SUBJECTIVE_BASELINE_MIN_DAYS` (D-SUBJCOV) so no caller can accidentally
consume a sub-threshold baseline.

Reuse the shape of `contextBrief.ts`'s existing coverage logic rather than inventing a
second convention; the brief's `SUBJECTIVE_BASELINE_MIN_DAYS` and the engine's must be one
exported constant, not two literals that can drift.

**Done when** the function is pure, a sub-threshold history returns `null`, duplicate-date
records and partial safety-only check-ins cannot inflate `recordedDays`, and a zero-variance
history yields the stdev floor rather than a division by zero.

---

### 9.2 Carry the baseline on `DailyReadiness` `[ ]`

**Current behaviour.** `DailyReadiness` is `{ subjective, objective }`. Objective baselines
arrive precomputed on `DailyRecoverySnapshot.derived`; subjective has no equivalent.

**Change.** Add an optional `subjectiveBaseline?: SubjectiveBaseline | null` to
`DailyReadiness`. Absent is a supported input and means "no baseline available", which is
exactly today's behaviour.

`evaluateReadinessAndSafetyEnvelope` must **not** gain a history provider, an async
signature, or a Firestore read (D-SUBJPURE). It stays pure and synchronous; the baseline is
data handed to it, the same way `derived.hrv7dAvg` already is.

**Done when** the field exists, is optional, and `evaluateReadinessAndSafetyEnvelope`'s
signature is otherwise unchanged.

---

### 9.3 The drift term, behind a default-off selector `[ ]`

**Current behaviour.** `evaluateReadinessAndSafetyEnvelope` computes `objectiveStrain` from
`metricStrain` plus contextual penalties, and derives mode from absolute subjective
thresholds plus that strain.

**Change.** Add `SubjectiveDriftPolicy = 'off' | 'drift'`, defaulting to `'off'` at every
call site, mirroring `FatigueFusionPolicy`'s plumbing through `rules.ts` and `planner.ts`.

Under `'drift'`, compute a `subjectiveDrift` score:

* **7d vs 28d only.** No acute today-vs-7d term (D-SUBJDRIFT).
* Per metric: `z = (avg7d − avg28d) / stdev28d`, signed so that adverse movement is
  positive, then `clamp(adverse, 0, STRAIN_Z_CAP)` — the same floor-at-zero `metricStrain`
  already applies, which is what makes the term structurally incapable of granting relief
  (D-SUBJADD).
* Summed with per-metric weights, added to the accumulating strain compared against
  `STRAIN_MODIFY_THRESHOLD` / `STRAIN_RECOVER_THRESHOLD`.

Every existing absolute trigger stays byte-identical (D-SUBJFLOOR). There must be **no
subtraction path**: assert in review that no expression can reduce a strain total or
de-escalate a mode already set by an absolute trigger.

Weights, the drift multiplier, and whether `motivation`/`mentalStress` participate are
placeholders pending 9.6 — do not tune them by hand here (D-SUBJCAL).

**Done when** `'off'` produces bit-identical output to today across the whole corpus
(`simulate:diff` clean), `'drift'` is unreachable from any production caller, and a
property test proves no baseline value can lower the resulting mode.

---

### 9.4 Composition boundary supplies the baseline `[ ]`

**Current behaviour.** `composer.ts` fans out six reads via `Promise.allSettled`; check-ins
are fetched for one date only.

**Change.** Add a seventh read for the trailing 28-day check-in range and pass
`computeSubjectiveBaseline`'s result through `DailyReadiness`.

Use **`checkinService.getCheckinsInRange`**, not `getRecentCheckins`. The latter applies
`limit(days)` to a date-ordered query and returns the most recent N *documents*, so with
gaps it spans more than N days and the D-SUBJCOV coverage count reads as complete whenever
it is not — the gate would silently always pass. This defect was found and fixed in the
context brief; do not reintroduce it here.

`getCheckinsInRange` currently returns raw Firestore documents through a type assertion.
Do **not** feed that output directly to `computeSubjectiveBaseline`. Either introduce a
validated range reader that applies `parseSubjectiveCheckin` to every record (and migrate
the context brief to share it), or parse every record at this composition boundary. An
invalid/user-mismatched record contributes nothing and is surfaced as a data-quality issue;
it must never be coerced into neutral readiness values or counted toward baseline coverage.

A failed read yields no baseline, which degrades to today's behaviour. It must not throw.

**Done when** the baseline reaches the evaluator, a failed, invalid, or sparse check-in
range leaves the decision unchanged, invalid records cannot inflate coverage, and the added
query is bounded to one range read per decision.

---

### 9.5 Give the scenario corpus real subjective variance `[ ]`

**This is the work item the measurement depends on, and it must land before 9.6.**

**Current behaviour.** `scenarios.ts` `stableReadiness()` returns the same subjective values
every day — `readiness: 6, sleepQuality: 6, fatigue: 4, soreness: 4, stress: 4,
motivation: 6` — and almost every scenario uses it unmodified. The handful that differ
(`healthy_fresh`, `high_fatigue`, `readiness_crash_then_return`) substitute a *different
constant*, and `readinessForWeek` generates per week rather than per day.

So every synthetic athlete has **zero subjective variance**. Their 7-day and 28-day
averages are identical, every z-score is exactly zero, and the drift term contributes
nothing anywhere in the corpus.

Running 9.6 against this corpus would report "no effect" — and that result would be an
artefact of the fixtures, not evidence about the idea. It would close ADR-0020 as
`Rejected` for entirely the wrong reason.

**Change.** Extend the corpus with per-athlete *subjective scale profiles* — the personal
scale-use differences the whole ADR exists to correct.

**Preferred source: the Phase 9.0 block.** If
[Phase 9.0](./phase-9-0-shadow-mode-and-decision-journal.md) has run, its export carries
4–6 weeks of the athlete's real check-ins. Derive the profiles' *parameters* — baseline
level per metric, day-to-day standard deviation, and the shape of any real drift — from
that record instead of choosing them. The fixtures stay synthetic and deterministic, since
the corpus must remain reproducible; what changes is that their numbers are observed rather
than invented, and at least one of them is the athlete who will actually use the result.

Without 9.0, the table below stands as written, and the limitation in the risk table
("synthetic profiles measure fixtures rather than people") applies at full strength.

The profiles to build either way:

| Fixture | Shape | What it must prove |
|---|---|---|
| Habitual low reporter | Readiness ~3, fatigue ~7, flat | Drift does **not** relax an absolute-threshold `modify`; this quantifies the tighten-only rule's accepted false-positive trade-off |
| Habitual high reporter | Readiness ~8, fatigue ~2, flat | Does not escape a real decline because the absolute floor is far away |
| Slow drifter | Readiness 8 → 6 over three weeks, never crossing an absolute threshold | The case the term exists for: currently invisible, must become visible |
| Noisy but stationary | Mean stable, day-to-day swing ±2 | Must **not** trigger — noise is not drift |
| Chronically sore | Soreness baseline 7, stable | The safety case: must not read as "normal, proceed" |

This also requires a per-day subjective series rather than a per-week constant. Verify
whether `readinessForDate` alone suffices, or whether `runScenario` must additionally seed
a synthetic check-in history for `computeSubjectiveBaseline` to read — the harness supplies
readiness per decision point, not a stored 28-day check-in series, and 9.1 needs the latter.

Because these are new scenarios, `simulate:diff` reports them as `[NEW SCENARIO]` and no
committed baseline changes.

**Done when** at least the five fixtures above exist, each produces non-zero subjective
stdev, and the drifter's 7d/28d averages actually diverge over its span.

---

### 9.6 Comparison harness `[ ]`

**Change.** Add `runSubjectiveDriftComparison` to `simulation/analyze.ts` and
`scripts/simulate-subjective-drift.mjs`, modelled directly on
`runFatigueFusionComparison` / `simulate-fatigue-fusion.mjs`: run the real planner and hard
gates under `'off'` and `'drift'`, and report per-scenario and aggregate deltas for changed
selections, mode distribution, recovery share, rest/recovery days, objective misses, and
constraint violations. Output to `artifacts/subjective-drift-reports/latest/` (gitignored).

The report must answer D-SUBJCAL's two open questions explicitly: does `motivation` add
signal or noise, and does drift need `CHRONIC_STRAIN_MULTIPLIER`'s ×1.5 treatment.

**Done when** the harness runs both policies through the production planner, the report
distinguishes the five 9.5 fixtures individually, and it makes no automatic threshold
recommendation.

---

### 9.7 Telemetry, audit and rationale `[ ]`

**Change.** Add `subjectiveDrift` to `DecisionScoreTelemetry` as a third independently
readable component that still reconciles arithmetically to the total. Add the baseline's
`recordedDays` and the drift contribution to `RecommendationAudit` (D-SUBJAUDIT) — a
decision that depended on a 28-day subjective window is not reproducible from an audit that
omits how many days that window held.

Extend the existing decision-relevant-drift rationale annotation (the objective equivalent
already exists via `multiDayDriftIsDecisionRelevant`) to subjective drift, with the same
counterfactual test: did this term change the mode?

**Done when** telemetry reconciles, `replay.ts` verifies an audit carrying the new fields,
and the rationale mentions subjective drift only when it actually changed the decision.

---

### 9.8 Go / no-go `[ ]`

**Change.** Read 9.6's report and take one of three outcomes, recording it in ADR-0020:

1. **Ship** — flip the production default to `'drift'` with calibrated weights, bump
   `POLICY_VERSION`, move the outgoing value to `HISTORICAL_POLICY_VERSIONS`, update the
   committed simulation baseline in a separate reviewed commit.
2. **Ship narrowed** — e.g. drift on soreness and readiness only, `motivation` dropped.
3. **Reject** — mark ADR-0020 `Rejected`, keep subjective baselines in the brief and Data
   view only, and leave `'off'` as the permanent default. **This is a valid, useful
   outcome**, exactly as D-FUSE's negative result was.

**Done when** the outcome is recorded in the ADR with the evidence that produced it. Writing
code is not what closes this task.

---

## Tests to add

| Area | Behaviour asserted |
|---|---|
| `subjectiveBaseline` | Sub-threshold coverage returns `null`; distinct-date counting; partial safety-only check-ins do not count as scored coverage; zero-variance yields the stdev floor, not a division by zero. |
| `rules` (property) | For any baseline input, `'drift'` never produces a *less* restrictive mode than `'off'`. This is D-SUBJFLOOR made mechanical. |
| `rules` | Every absolute trigger fires identically under both policies. |
| `rules` | A chronically elevated soreness baseline does not reduce that athlete's mode — the safety inversion the ADR exists to prevent. |
| `rules` | `'off'` is bit-identical to pre-Phase-9 output on the committed corpus. |
| `composer` | A failed, invalid, or sparse check-in range leaves the decision unchanged and does not throw; invalid records do not count toward coverage. |
| `architecture` | No production call site passes `'drift'`; the selector is simulation-only, mirroring the fatigue-fusion assertion. |
| `replay` | An audit carrying baseline coverage and drift contribution replays reproducibly. |
| `simulate:diff` | No changed pre-existing baseline scenario while the default is `'off'`. |

## Acceptance criteria

- [ ] `npm run check` and `npm run test:rules` pass.
- [ ] `npm run simulate:diff` reports no changed pre-existing baseline scenario (9.5's fixtures appear as `[NEW SCENARIO]`).
- [ ] `check-policy-drift.mjs` passes — no `POLICY_VERSION` bump while the default is `'off'`.
- [ ] The property test proving drift can only tighten passes.
- [ ] Every 9.5 fixture produces non-zero subjective stdev, verified in the 9.6 report.
- [ ] The slow-drifter fixture shows a mode change under `'drift'` that `'off'` does not produce — if it does not, the term does nothing useful and 9.8 outcome 3 applies.
- [ ] The habitual-low and chronically-sore fixtures show **no** relaxation under `'drift'`.
- [ ] 9.8's outcome is recorded in ADR-0020 with its evidence.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Calibrating against a zero-variance corpus produces a false "no signal". | 9.5 is a hard precondition of 9.6 and an acceptance criterion in its own right. |
| Synthetic subjective profiles are invented, so the calibration measures fixtures rather than people. | Narrowed, not removed, by running [Phase 9.0](./phase-9-0-shadow-mode-and-decision-journal.md) first: its block supplies observed parameters for the profiles. Beyond that it is unavoidable — this is policy-regression evidence, not clinical validation, the same limitation `simulate:calibrate` already states about itself. The fixtures bound the *shape* of the effect, not its real-world magnitude. |
| The term tightens too readily and raises recovery share without benefit. | Exactly what 9.6 measures; that outcome is 9.8 option 3, and it is the same reason `max` was retained over additive fusion. |
| Ordinal data treated as interval. | Recorded in ADR-0020 as an accepted compromise; bounded by the stdev floor and the ±2.0 cap. |

**Rollback.** Until 9.8 flips the default, there is nothing to roll back — production is
bit-identical. After a ship decision, reverting is a one-line default change plus a
`POLICY_VERSION` restore; no persisted document shape changes, since the new audit fields
are additive and optional.

## Out of scope

* Surfacing subjective baselines anywhere in the check-in flow — forbidden by D-SUBJANCHOR.
* Backfilling subjective history. It cannot be reconstructed, which is why D-SUBJCOV exists.
* Reworking the corpus beyond what 9.5 needs.
* Any change to objective strain, `metricStrain`, or the absolute thresholds.
* Adopting beam search, revisiting fatigue fusion, or any other deferred decision this
  plan's harness happens to touch.

## Docs to update

- [ ] ADR-0020 → `Accepted` before starting; → outcome recorded at 9.8.
- [ ] `architecture/recommendation-engine.md` — the mode-selection section's strain formula gains a third component.
- [ ] `AGENTS.md` — `engine/` map gains `subjectiveBaseline.ts`.
- [ ] `plans/README.md` — decision-register rows once ADR-0020 is accepted.
- [ ] `docs/README.md` — index row.

---

## Task board

| # | Task | Status | Blocked by |
|---|---|:--:|---|
| 9.1 | Subjective baseline computation | `[ ]` | ADR-0020 |
| 9.2 | Carry the baseline on `DailyReadiness` | `[ ]` | 9.1 |
| 9.3 | Drift term behind a default-off selector | `[ ]` | 9.2 |
| 9.4 | Composition boundary supplies the baseline | `[ ]` | 9.2 |
| 9.5 | Scenario corpus subjective variance | `[ ]` | — |
| 9.6 | Comparison harness | `[ ]` | 9.3, 9.5 |
| 9.7 | Telemetry, audit and rationale | `[ ]` | 9.3 |
| 9.8 | Go / no-go | `[ ]` | 9.6 |

9.5 is startable immediately and independently of the ADR — a corpus with realistic
subjective variance is worth having whether or not the drift term ever ships, because
every readiness-related scenario currently exercises a constant. Starting it *after*
Phase 9.0's block is nonetheless better: the same work, with observed parameters instead of
chosen ones.