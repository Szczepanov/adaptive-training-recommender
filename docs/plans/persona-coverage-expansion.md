# Persona coverage expansion

**Status:** Ready
**Blocked by:** none — branch from `main` at or after `af87b8d1` (PR #292 merged)
**Unlocks:** nothing formally; expected to surface new engine findings the same way PR #292's persona suite did

---

## Purpose

Analyze the current 3-persona / 9-case suite in `app/scripts/ai-judge/personaScenarios.mjs`,
add new personas that exercise combinations it does not yet cover, run them through
`persona:local:stability`, and treat whatever the judge flags with the same rigor PR #292
used: verify against the actual generated plan before trusting a judge complaint, trace any
real finding to its root cause with a live diagnostic (not just re-reading source), fix it
minimally, add a regression test, and only then update the reviewed baseline.

This is a task brief for whoever (agent or engineer) picks it up — read it in full before
writing any fixture code.

## Why this is worth doing

PR #292 started as a fix for one reported bug (endurance+strength priority starvation) and,
by the time it merged, had grown to 8 documented findings — most of them discovered not by
reading code, but by a **3-persona, 9-case suite** repeatedly hitting combinations the ~1600
deterministic unit tests never construct:

- `persona_former_elite_return` (Running-preferred, `endurance`+`strength_muscle`) found the
  original priority-tier starvation bug, then — after that was "fixed" — found that no
  Running template could ever earn `aerobic_volume` coverage credit at all (a duration-floor
  mismatch between `end_easy_02` and `running_easy_continuous_01`).
- `persona_health_fat_loss` (no indoor bike, `health` priority, prefers
  Strength/Walking/Cycling) found that fixing the above bug fully exposed a second,
  previously-masked one: `health`/`balanced_performance` treated aerobic as `required` and
  strength as merely `target`, which produced a Strength-free plan for anyone who couldn't
  reach aerobic coverage any other way but Running.

Every one of these came from a *narrow, specific combination* of priority + preferred
modality + equipment gap. That's the signal worth acting on: this suite's value scales with
how many distinct combinations it covers, not with how many cases exist per combination.

## Current state (read before writing fixtures)

All persona fixtures live in one file:
[`app/scripts/ai-judge/personaScenarios.mjs`](../../app/scripts/ai-judge/personaScenarios.mjs).

- Helper functions already exist for everything a persona needs: `subjective(overrides)`,
  `objectiveGarminNeutral()` / `objectiveGarminAdverse()` / `objectiveUnavailable()`,
  `settings({equipment, guardrails, weekdayMaxMinutes, weekendMaxMinutes})`,
  `context({goals, preferredModalities, deprioritizedModalities, equipment, guardrails,
  maxTimeMinutes})`, `intent(priorities, targetSessions, maxSessions)`,
  `preferences(preferredModalities)`, and `makeScenario({...})`. New personas should compose
  these, not reinvent them — that's how the existing 3 stay consistent with each other.
- `buildPersonaFamilies()` returns an array of `{familyId, changedAxis,
  comparisonInstruction, cases}` — one family per persona, 3 cases each (a baseline, an
  adverse-recovery variant, and a persona-specific third axis: symptom flare, low time, or
  low motivation for the existing three).
- `assertPersonaFixtureIntegrity(families)` enforces structural invariants (no duplicate
  ids, evergreen-only, no real names, no-wearable fields actually null, etc.) — extend this
  with any new invariant a new persona should never violate, the same way the strength-flare
  and former-elite checks were added.
- **Two scripts hardcode the current counts and must be updated together with any new
  persona**, or their validation will reject the run:
  - `app/scripts/run-persona-ai-judge.mjs` calls `buildPersonaFamilies()` directly (no count
    literal there).
  - `app/scripts/update-persona-judge-baseline.mjs` hardcodes
    `EXPECTED_FAMILY_COUNT = 3` and `EXPECTED_CASE_COUNT = 9` — bump both by however many
    families/cases you add, or `persona:update-baseline -- --reviewed` will refuse to run.
  - `app/scripts/ai-judge/__tests__/personaScenarios.test.mjs` — check it for count
    assertions too before running it.
- Baselines: `docs/analysis/persona-judge-baseline.json` (persona suite) and
  `docs/analysis/plan-judge-baseline.4b.json` / `plan-judge-stability.4b.json` (unrelated —
  that's the event/criterium-based `judge:e2e:quick` suite, not personas; you shouldn't need
  to touch it for this task unless a persona change somehow perturbs the evergreen code paths
  that suite also exercises).
- Commands: `npm run persona:local:stability` (from `app/`) regenerates
  `artifacts/persona-plan-judge/latest/*`; `npm run persona:update-baseline -- --reviewed`
  promotes a reviewed run to the committed baseline; both require Ollama running locally
  with the configured model (see the console output of a prior run for which one).

## Pitfalls from PR #292 — read this before trusting a judge score

The local judge model (`hf.co/empero-ai/Qwen3.8-4B-Distill-GGUF` for plan-judge,
`...-9B-...` for persona) is good at finding real problems and **not** reliable on precise
detail attribution across a multi-day or multi-case plan. Twice this session it flagged
something that turned out to be fabricated or misapplied on inspection:

1. It once cited "Day 11 Race Simulation (50-95 min)" as a violation for a case whose actual
   14-day plan contained no Race Simulation session at all — almost certainly detail bleed
   from a different family it judged in the same batch.
2. It flagged `str_full_01 (45-60 min)` as violating a `maxTimeMinutes=30` constraint on two
   specific dates — both of which were weekend days where the persona's own fixture
   legitimately allows a 90-minute cap (only `weekdayMaxMinutes` was constrained). The judge
   over-generalized the persona's "only 30 minutes today" framing to the whole plan instead
   of tracking which days it actually applied to.

**Before treating any judge flag as a real bug**, pull the actual case from
`artifacts/persona-plan-judge/latest/corpus.json` and check the concrete day-by-day plan
(`case['plan']`) — dates, templates, durations — against what the persona's own fixture
actually constrains that day (weekday vs weekend caps differ; `date -d "$date" +%A` is enough
to check). Only escalate to root-causing if the plan itself is wrong, not just the judge's
prose about it.

**When you do find a real bug and go to fix it**, prefer tracing it live over reasoning from
source alone — this is not optional. A representative example from this session: reading
`evergreenStrategy.ts`/`weeklyDosePacking.ts` in isolation strongly suggested the packing
math was still asymmetric after one fix attempt; a small throwaway Vitest file that called
`resolveEvidenceBackedStrategy` → `packWeeklyDose` → `buildCoverageState` directly with the
persona's exact inputs and inspected the actual returned objects (write results to a scratch
JSON file with `writeFileSync` since the test reporter here doesn't surface `console.log`)
showed the real, different answer in under a minute. Delete the throwaway test file
afterward — it should never be committed.

**One specific trap if a duration/time-cap fix is involved**: don't materialize an
auto-applied dose adjustment directly into a `template` field that other code (coverage
credit, cross-week history accounting) also reads for its authored identity/duration. An
earlier attempt at Finding 7 did exactly that and silently broke three unrelated, previously
passing multi-week scenario tests (`scenarios.test.ts`, `specificityCoverageContract.test.ts`)
by changing what those days counted as delivered stimulus. The fix that stuck kept `template`
authored/untouched everywhere and exposed the adjustment as a sibling `activeDose`/
`adjustment` field, mirroring how `Recommendation` already does it — display consumers
(`WeekAheadStrip.tsx`, the judge/simulation trace) opt in explicitly; bookkeeping doesn't see
it. If you touch anything in this area again, run the **full** engine suite
(`npx vitest run src/engine`, not just the file you'd expect to be affected) before
concluding a change is safe.

**Always run the full loop before updating a baseline**: `npx tsc -b`, `npx vitest run
src/engine` (or `npm run check` for the complete typecheck+lint+test+workout-validation
pass), then `npm run persona:local:stability`, inspect
`artifacts/persona-plan-judge/latest/judge-stability.json` and `judge-scores.jsonl` for every
family (not just the new one — check the existing 3 didn't regress), and only run
`persona:update-baseline -- --reviewed` once you've actually looked at the numbers.

## Candidate personas (grounded in specific, currently-untested code paths)

Pick some or all of these — each is chosen because a specific branch of the engine is
provably never exercised by the current 9 cases, not because it "sounds different."

1. **Walking-only, no-equipment, `health` priority.** Direct sibling of the Running-only bug
   Finding 4 fixed, but for Walking. `EVERGREEN_SESSION_COVERAGE`'s `aerobic_volume` entry
   (`app/src/workouts/event-plan.ts`) only lists `cycling_zone2_standard_01` and
   `running_easy_continuous_01` — there is no Walking-modality workout in it at all. A
   Walking-preferring, no-bike, non-runner persona (e.g. an older or injury-averse athlete
   who explicitly avoids running) may have **zero** reachable candidate for the same
   `required` aerobic role Finding 4 just made non-droppable for `health` — worth checking
   whether that's an intentional design gap or the same class of bug, before assuming Finding
   4 + Finding 8 together generalize past Running/Cycling.
2. **`balanced_performance` priority, not `health`.** Shares the same `healthOrBalanced`
   branch in `resolveEvidenceBackedStrategy` (`app/src/engine/evergreenStrategy.ts:227`) that
   Findings 4 and 8 both touched, but no current persona sets this priority specifically —
   only `health` has been exercised end-to-end through personas. Confirm it behaves
   identically (it should, per the code, but that's exactly the kind of assumption this
   suite exists to check).
3. **Established training history + a performance priority** (`endurance`, `speed_power`, or
   `sport_readiness`). All 9 existing cases use `initialHistory: []`, so
   `inferAthleteTrainingState` never returns `dataQuality: 'high'` /
   `trainingAgeProxy: 'established'` — meaning the entire `canUseConditionalPrior` /
   `high_intensity` optional-requirement / `hardSessionCap: 2` branch
   (`evergreenStrategy.ts:236-244`) has never been reached by a persona. Give a persona a
   populated `initialHistory` (12+ sessions, ≥28 observed days, internally consistent
   modality/type labels so `hasConflictingStructuralEvidence` doesn't trip) and check that
   the conditional high-intensity session actually shows up, is capped at the stated 2
   sessions/week, and doesn't crowd out the required aerobic/strength floors.
4. **Tight time budget with full equipment**, as a health/balanced persona rather than the
   event/criterium context `judge_pref_45min` already covers — stresses
   `resolveTimeCapDoseAdjustment` (`app/src/engine/optimizer.ts`) end-to-end through the
   evergreen path specifically, which the plan-judge suite's criterium fixtures don't
   exercise.
5. **Injury/guardrail constraint stacked with an equipment gap** (e.g. a lower-body
   restriction *and* no indoor bike, on a `health` or `endurance` persona) — two independent
   gating systems (`injuryPolicy.ts` restrictions and equipment-based template exclusion)
   that are each unit-tested alone but not obviously tested together through a persona that
   also has to hit a `required` coverage role.

Don't feel obligated to do all five in one pass — even one or two done with full rigor (per
the pitfalls section above) is more valuable than five done superficially.

## Execution protocol

1. Branch from `main` (already done if you're reading this on
   `personas/expand-coverage`, created from `af87b8d1`).
2. Read `personaScenarios.mjs` in full — don't skim; the helper composition pattern matters
   for consistency.
3. Pick 1-3 candidate personas from the list above (or a different combination you can
   justify against a specific, cited, currently-unreached code branch — that standard, not
   "seems like a reasonable persona," is what makes a case worth its judge-run cost).
4. Write the new persona context/intent/preferences/persona-object/cases following the
   existing pattern exactly (see `strengthContext`/`healthContext`/`formerEliteContext` and
   their cases for the shape). Add each new family to the array `buildPersonaFamilies()`
   returns, and extend `assertPersonaFixtureIntegrity` with whatever new invariant that
   persona should never violate.
5. Update `EXPECTED_FAMILY_COUNT` / `EXPECTED_CASE_COUNT` in
   `update-persona-judge-baseline.mjs`, and any count assertions in
   `scripts/ai-judge/__tests__/personaScenarios.test.mjs`.
6. Run `npx tsc -b` (this file is `.mjs` but touches typed engine exports transitively via
   Vite SSR at runtime, not at typecheck time — the real check here is step 7).
7. Run `npm run persona:local:stability` from `app/`.
8. For every family (new **and** existing), read `judge-stability.json` and
   `judge-scores.jsonl`. For any flag, pull the actual plan from `corpus.json` and verify it
   before believing it (see Pitfalls above).
9. If a flag is real: trace it to root cause with a live diagnostic (throwaway Vitest file,
   delete before committing), fix minimally in the engine (not in the fixture), add a
   permanent regression test near the fix, and document the finding — follow the style of
   `docs/analysis/2026-08-29-pr-292-evergreen-priority-time-cap-review.md` and its "Finding 8"
   sibling doc if the fix is substantial enough to warrant its own write-up.
10. Run the full loop again after any engine fix: `npm run check` (typecheck, lint, full
    Vitest suite, workout validation), then re-run `persona:local:stability` and confirm both
    the new and the existing personas look right.
11. Only once satisfied: `npm run persona:update-baseline -- --reviewed`, review the diff to
    `docs/analysis/persona-judge-baseline.json`, and commit.
12. Open a PR. Reference this plan and any finding docs it produced.

## Definition of done

- At least one new persona family added, composed from the existing helpers, following the
  established fixture pattern.
- `assertPersonaFixtureIntegrity` extended to guard whatever that persona is specifically
  supposed to prove.
- `persona:local:stability` run, every flag (new and pre-existing families) manually
  verified against the actual generated plan, not taken on the judge's word.
- Any real finding fixed in the engine with a root-cause trace, a regression test, and a
  written finding doc — or explicitly confirmed clean with no further action needed.
- `npm run check` green.
- Persona baseline updated with `--reviewed` and committed, reflecting a run you have
  actually looked at.
