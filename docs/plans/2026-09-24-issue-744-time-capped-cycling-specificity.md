# Issue #744 — Keep cycling on time-capped days for cycling-primary athletes

| Field | Value |
|---|---|
| Status | `In review`: TC1–TC5 and the deterministic part of TC6 are implemented; externally scored plan/persona judge baselines await a comparable reviewed run (§10) |
| Issue | [#744](https://github.com/Szczepanov/adaptive-training-recommender/issues/744) |
| Blocked by | Nothing |
| Unlocks | [#756](https://github.com/Szczepanov/adaptive-training-recommender/issues/756) (modify-tier walking), [#757](https://github.com/Szczepanov/adaptive-training-recommender/issues/757) (athlete-relative aerobic floor), and [#758](https://github.com/Szczepanov/adaptive-training-recommender/issues/758) as a soft dependency (cap-fitting cycling quality). See §8 |
| Policy impact | Yes: bump `POLICY_VERSION` (I5) |
| Knowledge impact | Yes: one new decision-authority rule, needing a claim, a coverage item and an alignment test (I4, ADR-0033) |

---

## 1. Verdict

> Historical diagnosis from before the implementation. The outcome and current verification
> are recorded in §10; verify any behaviour described below against the current code.

The issue describes a real symptom, but it gets the mechanism wrong. Its proposed fix,
"add a compact dose and boost cycling rank", would not change the outcome.

- **The symptom is real.** In `persona_cycling_hybrid_low_time`, the current `main`
  (`324e2694`) plans **7 Brisk Continuous Walks, 4 cycling sessions, 2 strength sessions
  and 1 rest day** across 14 days.
- **Eligibility is not the cause.** `end_easy_01` is eligible on every capped day and is
  picked 4 times.
- **Ranking preference is not the cause either.** In the ranking audit, cycling has the
  *higher* utility on every day a walk wins.
- **The actual cause is a coverage floor combined with an asymmetric easier dose.**
  - Under a time cap, the engine replaces the full Zone 2 Spin with its authored
    `easierDose`, a 20–30 min "Light Spin".
  - That dose starts below the catalog floor of 30 min, so it earns no `aerobic_volume`
    weekly-coverage credit.
  - The walk's easier dose is authored at exactly 30 min, so it keeps the credit.
  - Coverage tier is the **first** sort key in `rankCandidates`, so the walk wins before
    preference or utility are compared.

**Recommended fix.** When a time cap alone forces a smaller dose, and the template's own
authored minimum fits the cap, truncate the authored prescription to the cap. Do not
switch to the readiness-oriented easier dose. Apply this only to `Easy Endurance`
templates whose easier dose starts below their own minimum. A throwaway prototype of this
rule changed **1 of 39** simulation scenarios, **1 of 96** plan-judge cases and **2 of 36**
persona cases. It produced **0** constraint violations, and the plan-judge invariants
still passed.

---

## 2. Review of the issue's claims

| Issue claim | What the code and fixture actually say |
|---|---|
| "30-minute weekday cap, 90–120 min weekends" | The fixture (`personaSuite.mjs`, `lowTimeContext`) sets `maxTimeMinutes: 35` and `weekdayMaxMinutes = weekendMaxMinutes = 35`. There is **no weekday/weekend split**, and the case label says "35-minute training window". |
| "4 rides, 4 walks, 3 rest, 1 mobility, 2 strength" | The current plan is **4 rides, 7 walks, 2 strength, 1 rest** (reproduced with `npm run persona:build`). The committed baseline rationale agrees ("7 Brisk Continuous Walks versus only 4 cycling sessions"). |
| Flag `low_time_replaces_cycling_with_walking` | The baseline flags are `excessive_walking_substitution_under_time_cap` and `day1_cycling_preference_ignored`. |
| "`end_easy_01` `durationRange` `[45, 75]`; `low` variation `35–45 min`" | `end_easy_01` is authored as `durationMin: 30, durationMax: 60`, with `easierDose` 20–30 min at `doseRatio: 0.6`. The template has no `doseVariations` or `low` field. |
| "Hard time gate in `eligibility.ts`/`optimizer.ts` disqualifies easy cycling" | It does not. `evaluateTemplateEligibility` checks only `durationMin <= cap`, and 30 ≤ 35 passes. `withCapSafeDose` then attaches the authored 20–30 dose, which fits. |
| "`indoor_trainer` equipment" | The engine token is `indoor_bike`. The persona has `hasIndoorBike: true` and outdoor-bike access (`end_easy_04` is scheduled in other cases). |
| Proposal 2: make compact cycling outrank walking | Cycling already has the higher utility: 0.65 vs 0.49 on 09-01, and 0.73 vs 0.56 on 09-04. The walk wins earlier, on **coverage tier** (1 vs 3). A preference boost at the utility layer cannot change that order. |
| Proposal 1: add a compact dose to `templates.ts` | This would work only if the new dose starts at ≥ 30 min, the `cycling_zone2_standard_01` catalog minimum. It would also split the template's duration semantics into two authored doses. §4 compares this option with the recommended one. |

The acceptance criterion "`npm run persona:build` passes" cannot measure the outcome.
That command only builds the corpus; it does not score it. §7 replaces it with a
deterministic regression test.

---

## 3. Root cause, with evidence

The evidence comes from the `rankingAudit` in `decisionTraces` for
`persona_cycling_hybrid_low_time`, generated through `runScenario` on `324e2694`.

| Date | Mode | Selected | Coverage tier | Best-utility candidate | Coverage tier |
|---|---|---|---|---|---|
| 09-01 | modify | `end_walk_01` (30 min) | **1** | `end_easy_01` (utility 0.65 > 0.49) | 3 |
| 09-04 | train | `end_walk_01` (30 min) | **1** | `end_easy_04` (utility 0.73 > 0.56) | 3 |
| 09-05 / 09-06 | train | `end_walk_01` (30 min) | **1** | Blocked by coverage tier | 3 |
| 09-12 / 09-13 | train | `end_walk_01` (30 min) | **1** | `end_easy_04` / `end_easy_01` | 3 |

The chain, symbol by symbol:

1. **`eligibility.ts` `withCapSafeDose`.** When the cap is exceeded, it "prefers the
   author's easier variation when it can start inside the cap". For `end_easy_01` at a
   35-min cap, that variation is the 20–30 min `easierDose` at ratio 0.6.
2. **`optimizer.ts` `resolveTimeCapDoseAdjustment`.** When `durationMax > cap` and the
   easier dose fits, it selects `template.easierDose`. **The same dose serves two purposes:
   a readiness-driven modify day and a purely time-driven cap.**
3. **`optimizer.ts` `rankCandidates`.** It materializes the effective candidate at 20–30
   min through `materializeEffectiveDose`, then computes `coverageNeedTierForTemplate` on
   that effective candidate.
4. **`coverage.ts` `coverageKeysForExposure` and `hasRequiredAerobicDose`.**
   `aerobic_volume` counts only when `durationMin` ≥ the catalog workout's
   `duration.minimumMin`, which is 30 for both `cycling_zone2_standard_01` and
   `walking_brisk_continuous_01`. The spin's effective `durationMin` is 20, so it gets no
   credit and lands on tier 3. The walk's effective `durationMin` is 30, so it gets credit
   and lands on tier 1.
5. **`rankCandidates` sort order.** The order is coverage tier, then recovery tier, then
   benefit tier, then preferred-today, then utility. The walk wins at step one.

**Why only cycling is affected.** Among the `aerobic_volume` identities, the cycling Z2
templates (`end_easy_01`, `end_easy_04`) are the only ones whose `easierDose.durationMin`
(20) sits below their own `durationMin` (30):

| Template | Base duration (min) | Easier dose (min @ ratio) |
|---|---|---|
| `end_walk_01` | 30–60 | 30–30 @ 0.75 |
| `end_easy_02` | 30–40 | 30–30 @ 0.75 |
| `end_easy_01` / `end_easy_04` | 30–60 | 20–30 @ 0.6 |

So on any capped train day, the time cap quietly removes the Zone 2 ride's weekly-coverage
identity, even though the authored 30-min minimum fits the cap.

---

## 4. Options considered

| # | Option | Assessment |
|---|---|---|
| A | Re-author the `end_easy_01`/`end_easy_04` `easierDose` to 30 min | **Rejected.** The same dose drives readiness-limited modify days, including adverse-recovery re-entry, which the judge scored 9.1 for its "20–30 minute modified indoor Zone 2 spins". This option would raise modify-day load for every cycling athlete in order to fix a time-cap problem. |
| B | Add a second authored "compact" dose to `templates.ts`, as the issue proposes | **Viable, but inferior.** It needs a new `SessionTemplate` field, authoring for each template, and routing in every `resolveTimeCapDoseAdjustment` caller. It encodes by hand what the authored `durationMin` already states: the prescription is valid from 30 min. |
| C | Boost preferred-modality utility | **Ineffective.** The walk wins on coverage tier before utility is consulted. See §3. |
| D | Truncate the authored prescription for **every** template on capped train days | **Too broad.** The prototype (`PROTO744=all`) also lengthened compact strength (`str_full_02` 15–25 → 30–35) and reshuffled `reduced_time_equipment_limited_borderline`. It also exposed a ratio inconsistency: the old `cap / durationMax` formula gave a 30-min walk ratio 0.50, while its authored 30-min dose is 0.75. |
| **E** | **Truncate the authored prescription only for `Easy Endurance` templates whose `easierDose` starts below their own `durationMin`, and only on non-modify days** | **Recommended.** It targets exactly the asymmetry in §3. Readiness-driven modify days keep their authored easier dose. It applies to every sport's easy aerobic work equally. The effect is confined to the Easy Endurance templates it names (`end_easy_01`, `end_easy_03`, `end_easy_04`, `end_easy_05`). |

### 4.1 Rule definition for option E

Inputs: a template, a cap, and `isModifyTier`. The truncated dose applies only when **all**
of the following hold:

- `isModifyTier === false`
- `template.category === 'Easy Endurance'`
- `template.durationMax > cap` (the cap actually binds)
- `template.durationMin <= cap` (the authored prescription can start inside the cap)
- `template.easierDose` exists and `template.easierDose.durationMin < template.durationMin`
  (the readiness dose would fall below the prescription's own floor)

When the rule applies, the active dose is the authored prescription truncated to the cap:

- `durationMin = template.durationMin`
- `durationMax = cap`
- `doseRatio = max(easierDose.doseRatio, midpoint([durationMin, cap]) / midpoint([durationMin, durationMax]))`

The ratio uses midpoints because the authored ratios in `templates.ts` sit close to a
range-midpoint reference: `end_walk_01`'s 30-min dose is 0.75 and its 60-min harder dose
is 1.35. Taking the `max` with the easier dose's ratio makes the result monotone: a
time-capped train day never prescribes *less* than the readiness-limited dose.

**Worked example.** For `end_easy_01` at a 35-min cap, the dose becomes 30–35 min at ratio
0.722 (systemic cost 0.3 × 0.722 ≈ 0.22). At a 30-min cap, it becomes 30–30 at 0.667.

In every other case, including a cap below 30 min, the current behaviour stays unchanged.
The engine falls back to the authored easier dose through the existing
`withCapSafeDose` → `easierDose` path.

---

## 5. Prototype evidence (throwaway; reverted, nothing committed)

The prototype was an env-gated branch inside `resolveTimeCapDoseAdjustment`. It was run
through `simulate-scenarios.mjs`, `build-plan-judge-corpus.mjs` +
`check-plan-judge-invariants.mjs`, and `run-persona-ai-judge.mjs --build-only`.

| Suite | Cases changed | Constraint violations |
|---|---|---|
| `simulate:scenarios` (39) | 1: `travel_day_context_override` (quality warnings 3 → 2) | 0 |
| `simulate:plan-judge` (96) + invariants | 1: `judge_pref_45min`. Invariants **pass** | n/a |
| Persona corpus (36) | 2: `persona_cycling_hybrid_low_time`, `persona_triathlon_established_olympic_short_time` | n/a |

The target case, `persona_cycling_hybrid_low_time`, before and after the change:

```text
date   before                  after
08-31  str_full_02 15-25       str_full_02 15-25
09-01  end_walk_01 30  (mod)   end_walk_01 30  (mod)   <- modify-tier; out of scope, see §8.1
09-02  end_easy_01 20-30       end_easy_01 30-35
09-03  end_easy_01 20-30       end_easy_01 30-35
09-04  end_walk_01 30          end_easy_04 30-35
09-05  end_walk_01 30          mob_01 15-30
09-06  end_walk_01 30          str_full_02 15-25
09-07  str_full_02 15-25       end_easy_01 30-35
09-08  end_walk_01 30  (mod)   str_full_03 20-30 (mod)
09-09  rest_01                 rest_01
09-10  end_easy_01 20-30       end_easy_01 30-35
09-11  end_easy_01 20-30       end_easy_01 30-35
09-12  end_walk_01 30          end_easy_04 30-35
09-13  end_walk_01 30          end_easy_01 30-35
```

Walks drop from 7 to 1, cycling rises from 4 to 9, and strength stays at 2 primary plus 1
modify. Every session still fits within 35 min, and every capped Z2 ride now starts at the
30-min `aerobic_volume` floor.

**Knock-on changes to review during implementation.** These are not blockers, but each
needs a sentence in the PR:

- **`travel_day_context_override`.** On 08-09, `mob_01` becomes a 30-min Z2 ride, which is
  the improvement. As a result, 08-12 turns from a 30–60 ride into `mob_01` 15, and the
  08-13 modify-day `str_full_03` shows a 45-min maximum. **Confirm that the 45-min maximum
  is a mode-dependent display artifact, not a cap breach.**
- **`judge_pref_45min`.** A 45-min cap reshuffles the week, and a train-mode
  `end_hard_02` replaces a modify-mode `end_easy_04` on 08-20. **Confirm the hard-session
  count is still within the invariants** (they passed) and that the change comes from the
  fatigue projection, not from a new stacking path.
- **`persona_triathlon_established_olympic_short_time`.** On 09-05, `str_lower_01`
  (40–55 min) appears. **Confirm that day's cap is ≥ 55 min.**

---

## 6. Implementation checklist (TDD order; outcome in §10)

Work items are numbered `TC1`–`TC6`, the plan-board prefix in `docs/plans/README.md`. All paths are under `app/src/`. Symbols are named instead of line numbers, per CLAUDE.md §5.

### TC1 (Step 1): write failing tests first (RED)

1. **`engine/optimizer.test.ts`**: a new `describe('resolveTimeCapDoseAdjustment — Easy
   Endurance cap truncation (#744)')` block. Each item below is one case.
   1. `end_easy_01`, cap 35, not modify: `activeDose` is `{ durationMin: 30,
      durationMax: 35 }` and `doseRatio ≈ 0.722`.
   2. `end_easy_01`, cap 35, modify: `activeDose` is the authored `easierDose`
      (20–30 @ 0.6). Readiness semantics are preserved.
   3. `end_easy_01`, cap 25 (below its own minimum): the fallback is the authored easier
      dose.
   4. `end_walk_01`, cap 35: behaviour is unchanged (authored 30–30 @ 0.75), because the
      easier dose does not start below the base minimum.
   5. `end_mod_02` (Moderate Endurance), cap 35: behaviour is unchanged (category
      out of scope).
   6. `str_full_02`, cap 35: behaviour is unchanged.
   7. A monotonicity property: for every Easy Endurance template and every cap in
      `[durationMin, durationMax)`, the truncated `doseRatio` is ≥ `easierDose.doseRatio`
      and `durationMax` is ≤ the cap.
   8. The `adjustment` keeps `{ direction: 'easier', tier: 1, originalTemplateId }` and
      carries a distinct rationale ("time cap … shortened within its authored range").
      This matches the contract the existing callers and tests rely on.
2. **`engine/coverage.test.ts`** (or the optimizer test): on a capped day with an unmet
   `aerobic_volume` minimum, both `end_easy_01` and `end_walk_01` materialized at the cap
   receive **coverage tier 1**.
3. **`engine/planner.test.ts`**: a new regression, `cycling-primary athlete keeps cycling
   on 35-minute capped train days (#744)`. Build it with the same shape as the persona:
   - `preferredModalities: ['Cycling','Strength']`, `deprioritizedModalities:
     ['Running']`, indoor and outdoor bike, cap 35, evergreen intent with
     `['endurance','strength_muscle']`.
   - Use a synthetic fixture only; do not import `personaSuite.mjs` into Vitest.

   Assert all of the following:
   - (a) every day's effective duration is ≤ 35;
   - (b) at most 1 train-mode `Walking` day in 14;
   - (c) at least 6 `Cycling` days;
   - (d) every capped Zone 2 ride has an effective `durationMin` ≥ 30.

   Run the tests and confirm they fail on `main` for the stated reason.

### TC2 (Step 2): implement (GREEN)

1. **`engine/optimizer.ts`**: add a small pure exported helper,
   `resolveCapTruncatedPrescription(template, maxTimeMinutes): DoseVariation | null`,
   that implements the §4.1 conditions and ratio. Name the constant that restricts the
   rule to `Easy Endurance` (for example `CAP_TRUNCATION_CATEGORIES`) and give it a
   comment pointing to the claim.
2. **`engine/optimizer.ts` `resolveTimeCapDoseAdjustment`**: when `!isModifyTier` and the
   cap is exceeded, try `resolveCapTruncatedPrescription` **before** falling back to
   `easierDose`. Keep the return shape. Add the new rationale text.
   - Every caller inherits the change automatically:
     - `rules.ts` (today),
     - `planner.ts` (the forecast pick, `preservesAllocation`, and the load-budget
       evaluation),
     - `sessionAlternatives.ts`,
     - `components/WeekAheadStrip.tsx`.
   - Keep the change in this one function so that projections, coverage accounting and
     the UI cannot diverge. That split-brain risk is the one the existing `planner.test.ts`
     "forecast days respect the same time cap as today" regression guards against.
3. **Leave `eligibility.ts` `withCapSafeDose` unchanged.** It still supplies the cap-safe
   *readiness* dose for modify days. Update its doc comment to say that train-day cap
   truncation for Easy Endurance happens in `resolveTimeCapDoseAdjustment`.
4. **`engine/rules.ts`**: check the progression-dose interplay: an
   `appliedProgressionDose` is taken only when its `durationMin` is ≤
   `doseAdjustment.activeDose.durationMin`. With a 30-min floor it now applies slightly
   more often. Add one assertion to the existing progression tests.

### TC3 (Step 3): knowledge lineage (I4, ADR-0033)

This is a new decision-authority rule: it changes which session wins on capped days.

1. **`knowledge/optimizerScoringKnowledge.ts`**:
   - add `timeCapEasyEnduranceTruncationPolicy:
     'policy.optimizer.time_cap_easy_endurance_truncation_v1'`;
   - add a product-policy claim (`claimType: 'heuristic'`, `maturity: 'heuristic'`,
     `evidenceCertainty: 'not_applicable'`);
   - include limitations: it is a product duration-feasibility rule, not a physiological
     dose-equivalence claim; the midpoint ratio is a calibration heuristic; and
     modify-tier dosing is unchanged;
   - state explicitly: "duration-feasible; not a claim of dose adequacy". A 30–35 min Z2
     ride earns the weekly *coverage* session, but it earns only dose-scaled *objective*
     credit. That is roughly 0.58 by estimate, against +0.80 for a full ride in the
     current traces.
2. **`knowledge/knowledgeCoverage.ts`**: add a coverage item such as
   `optimizer.time_cap_easy_endurance_truncation` (`domain: 'optimizer_scoring'`,
   `classification: 'product_heuristic'`, `coverage: 'covered'`,
   `decisionImpact: 'moderate'`, `safetyImpact: 'low'`, `researchPriority: 'none'`) with
   `codeRefs: ['engine/optimizer.ts:resolveCapTruncatedPrescription']`.
3. **`knowledge/knowledgeCoverage.test.ts`**: register the id-to-claim mapping next to
   `optimizer.unpreferred_modality_fallback`.
4. **`knowledge/optimizerScoringPolicyAlignment.test.ts`**: assert that the claim's
   statement matches the implemented category set, the modify-tier exclusion and the ratio
   rule. The test should fail if either side drifts.
5. **Record the existing aerobic-volume duration floor.**
   - **Why:** the fix makes more rides reach the 30-min catalog floor, so it relies on that
     floor more heavily. The floor is used by `coverage.ts` `hasRequiredAerobicDose` and
     by the `aerobic_volume` role duration in `weeklyDosePacking.ts`, yet today it has no
     coverage item.
   - **What:** add a coverage item such as `stimulus.aerobic_volume_duration_floor`
     (`domain: 'stimulus_credit'`, `classification: 'product_heuristic'`,
     `coverage: 'uncovered'`, `decisionImpact: 'moderate'`, `safetyImpact: 'low'`,
     `researchPriority: 'p1'`, `knowledgeRefs: []`). This follows the precedent of
     `periodization.post_event_recovery_window`, currently the only `uncovered` item.
   - **Why `moderate`:** the inventory test "zero high-impact uncovered debt" requires
     `highImpactUncovered === 0`. Marking this item `high` would need its claim first, and
     that claim is #757's work.
   - **codeRefs:** `engine/coverage.ts:hasRequiredAerobicDose` and
     `engine/weeklyDosePacking.ts`.
   - **coverageRationale:** it should say that the fixed catalog minimum is a product
     floor, not evidence-backed, and link
     [#757](https://github.com/Szczepanov/adaptive-training-recommender/issues/757).
   - **Scope:** only record the rule, with no claim yet. Designing the athlete-relative
     rule is #757's job.
6. **`knowledge/knowledgeCoverage.test.ts`**: update the exact inventory summary, since
   steps 2 and 5 add one `covered`/`none` item and one `uncovered`/`p1` item:
   - `total` goes from 65 to 67;
   - `byCoverage` becomes `{ covered: 42, partial: 17, uncovered: 2, not_applicable: 6 }`;
   - `byPriority` becomes `{ p0: 8, p1: 9, p2: 2, p3: 0, none: 48 }`;
   - `highImpactUncovered` stays 0.

   Update the comment that states which issue added items.

### TC4 (Step 4): policy version (I5)

- **`engine/policy.ts`**: move the current value to the top of
  `HISTORICAL_POLICY_VERSIONS`, and set `POLICY_VERSION =
  '2026-09-time-cap-easy-endurance-truncation-v1'`.
- From `app/`, run `node scripts/check-policy-drift.mjs <base-sha>`.

### TC5 (Step 5): docs

- **`docs/architecture/recommendation-engine.md`**: find the paragraph on time-cap and
  easier-dose handling and add one sentence stating the train-day versus modify-day split.
- **Engine docs:** reference the new symbols, not line numbers.
- **This plan:** if it is kept in `docs/plans/`, register it in
  [`docs/plans/README.md`](./README.md). When it ships, move it to `Implemented` and
  strike the present-tense problem statements (CLAUDE.md §5).

### TC6 (Step 6): baselines

- After review, refresh the simulation, plan-judge and persona baselines through the
  existing `simulate:update-baseline -- --reviewed` / `judge:update-baseline` /
  `persona:update-baseline` flows. Put this in a separate `chore(baselines)` commit, as
  in #743.

The simulation baseline has been reviewed and refreshed. The plan/persona baselines were
scored with `manual_external`; a local-model run would not be comparable. They remain
unchanged pending fresh, comparable external scoring (§10).

---

## 7. Revised acceptance criteria

- [x] In `persona_cycling_hybrid_low_time` (35-min cap), train-mode days no longer choose
      `end_walk_01` while a capped `end_easy_01`/`end_easy_04` is feasible. The persona
      corpus shows at most 1 walk and at least 6 cycling days in 14.
- [x] Every session in every simulated plan satisfies `effective durationMax ≤ cap`, with
      0 constraint violations across `simulate:scenarios`.
- [x] Modify-tier days still use the authored `easierDose`. The adverse-recovery re-entry
      spins stay at 20–30 min.
- [x] The deterministic planner regression from Step 1.3 passes. This replaces the
      unmeasurable "`persona:build` passes" criterion; `persona:build` must still run
      cleanly.
- [x] The claim, the coverage item and the alignment test are present, and the knowledge
      validators pass.
- [x] The aerobic-volume duration floor is recorded as a coverage item that links #757
      (Step 3.5).
- [ ] `POLICY_VERSION` is bumped; the policy-drift check must be rerun against the committed change.
- [ ] The gates in the next list pass, and their output is reported verbatim in the PR.

Gates, per CLAUDE.md §3 (engine/policy change):

```bash
make check
make simulate
cd app && npm run simulate:plan-judge
cd app && node scripts/check-policy-drift.mjs <base-sha>
cd app && npm run persona:build
```

`simulate:diff` is advisory. Read it and summarise the 3 knock-on cases from §5 in the PR.

---

## 8. Out of scope: follow-ups filed 2026-09-24

Do not fold any of these into #744. They are listed in the recommended order.

### 8.1 [#756](https://github.com/Szczepanov/adaptive-training-recommender/issues/756): modify-tier walking substitution (same mechanism, different trigger)

`persona_cycling_hybrid_baseline` and `_strength_preference` also schedule **4 walks at
90–120 min availability**, all on `modify` days. The judge flagged this as
`walking_substitutes_for_cycling_volume`. The mechanism matches §3: on a modify day the
readiness-driven 20–30 min light spin earns no `aerobic_volume` credit, while the 30-min
walk does.

The ranking audit shows the walk winning on coverage tier 1 against a cycling
utility winner on tier 3 on 09-01, 09-04, 09-08 and 09-13. The leading hypothesis in
#756 is that readiness doses never earn exact aerobic-volume credit, in any modality. It
touches readiness semantics, so it needs its own review. **Blocked by #744.**

### 8.2 [#757](https://github.com/Szczepanov/adaptive-training-recommender/issues/757): athlete-relative aerobic-volume floor

The fixed 30-min catalog floor treats a 30-min walk and a 60-min ride as the same
coverage session. That is too permissive for established athletes and it produces
modality flips on technicalities. #744 only *records* the floor (Step 3.5). #757
designs an athlete-relative floor, cross-modality equivalence, and explicit shortfall or
partial credit when a cap makes the floor unreachable. It may also converge the binary
coverage ledger with the dose-scaled objective ledger. **Blocked by #744.**

### 8.3 [#758](https://github.com/Szczepanov/adaptive-training-recommender/issues/758): cap-fitting cycling quality for established cyclists

Both the 90-min baseline and the 35-min case schedule **0 cycling quality sessions**,
despite tempo history. Two parts of the evergreen `sustained_quality` set contribute:

- Its only cycling identity, `cycling_controlled_threshold_4x8_01`, has a 45-min minimum,
  so it can never fit a 35-min cap.
- The cycling Tempo Ride (`end_mod_02` → `cycling_tempo_surges_01`, minimum 30) is not in
  the set.

For a time-limited trained cyclist this is the largest performance lever. #758 starts
with diagnosis, with no behaviour change. **Soft dependency on #744.**

### 8.4 Day-1 `preferredModalityToday` ignored: deliberately not filed

Day 1 schedules strength over cycling even when `preferredModalityToday: 'Cycling'`
(flag `day1_cycling_preference_ignored`). Strength wins on coverage tier 1. By the
registered claim `policy.optimizer.preferred_modality_today_tiebreak_v1`, the today
preference acts only *after* coverage tiers. Changing that would be a policy decision
against an existing claim, and the judge treated it as minor. Revisit it only if the
next persona run still flags it after #744 and #756.

### 8.5 Fixture and issue hygiene

- Correct the issue text: the cap is 35 min, not 30, and there is no weekday/weekend
  split.
- Optionally, add a genuine weekday-30/weekend-90 variant if that scenario matters. Do it
  in a separate PR, because it changes `familiesSha256` and so persona comparability.

---

## 9. Risks and open questions

| Risk | Mitigation |
|---|---|
| Capped Z2 load rises (0.6 → ~0.72 ratio on capped train days) | This applies only on train-tier days. It is still below the full dose, and the rolling load budget in `planner.ts` evaluates the same `activeDose`. |
| The midpoint ratio is a new heuristic | It is registered as product policy with an alignment test and bounded below by the authored easier dose. |
| UI label change ("Light Spin" becomes a truncated Z2 ride on capped days) | Assert the new rationale in the tests, and spot-check `WeekAheadStrip` rendering at the mobile width (per `docs/standards/ui-ux.md`) for label overflow. |
| Other Easy Endurance templates (`end_easy_03`, `end_easy_05`) change | `end_easy_05` (20–30) binds only below a 30-min cap. `end_easy_03` is a deprioritized run for this persona. The unit test in Step 1.1 covers both. |
| A 30–35 min Z2 ride "checks off" an aerobic session without being an adequate stimulus for an established cyclist | This fix corrects which session wins a tie; it makes no claim of adequacy. Weekly *coverage* is binary at the catalog floor, while the `zone2_aerobic` *objective* ledger stays dose-scaled. In the current traces a full ride adds +0.80, a 30-min walk +0.60 and a light spin +0.48, against 4 required per week, so short rides do not resolve the week's aerobic objective. The claim says so explicitly (Step 3.1). Adequacy itself belongs to #757, and the biggest time-capped performance lever to #758. |

**Decision taken (2026-09-24).** Option E, limited to Easy Endurance, is approved.
Option D (all categories) is not pursued: it lengthens compact strength sessions and would
need its own ratio review. The approval also covers the follow-ups in §8, and recording
the aerobic floor in the knowledge inventory (Step 3.5).

---

## 10. Implementation and verification (2026-09-24)

Option E is implemented in `optimizer.ts` `resolveCapTruncatedPrescription` and
`resolveTimeCapDoseAdjustment`. Capped train-tier Easy Endurance work keeps its authored
minimum; modify-tier work keeps the authored easier dose. `planner.ts`
`evaluateProjectedDate` also uses the effective severe-recovery re-entry tier when ranking,
matching the tier used for load-budget admission and the final forecast prescription. A
code-review finding exposed that mismatch, and a synthetic re-entry regression now checks
the ranked dose, final dose and weekly coverage together.

The 35-minute cycling persona now has **8 cycling, 1 walking, 3 strength, 1 mobility and
1 rest** sessions over 14 days. Every session fits the cap. The walk is a modify-tier day;
the train-tier Zone 2 rides start at 30 minutes. The deterministic 14-day regression and
focused dose, coverage, progression and re-entry tests pass. Knowledge lineage includes
the new product-policy claim, coverage item and alignment test; the fixed aerobic floor
is separately recorded as uncovered work for #757. `POLICY_VERSION` was bumped.

`make check` passed: 1,036 Python tests, 6,183 frontend tests, typecheck, lint, knowledge
and workout validators. `make simulate` passed all 39 scenarios with zero constraint
violations; the reviewed deterministic baseline was refreshed. `npm run
simulate:plan-judge` passed invariants for 96 cases across 18 families, and `npm run
persona:build` generated 36 cases across 10 families. The policy-drift check is run after
the code commit so it can compare committed changes with `origin/main`.
`npm run visual:refresh` passed 76 desktop/mobile checks; the 390-pixel Plan forecast
capture showed compact duration text without horizontal overflow. `WeekAheadStrip` renders
the effective duration, not the longer dose label.

The semantic simulation diff before baseline promotion showed the expected travel-day
improvement and a reduced-time diagnostic change. The re-entry alignment also made three
severe-recovery scenarios more conservative (more rest in place of mobility or cycling),
with no new quality warnings or constraint violations. Plan-judge hard-session invariants
still pass. The triathlon short-time persona's September 5 strength session is a weekend
session under its 90-minute weekend setting, so its 55-minute maximum fits.

The committed plan and persona judge baselines remain from a reviewed `manual_external`
run. Their new corpora were built, but replacing those baselines with scores from the
available local model would make the before/after comparison invalid. Comparable external
rescoring and `judge:update-baseline` / `persona:update-baseline` remain pending by the
user's choice; the PR must state this explicitly.
