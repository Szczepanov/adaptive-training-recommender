# Analysis — Symptom-compatible substitutions for check-in-only strength plans (issue #680)

**Date:** 2026-09-20
**Status:** Investigated and remediated; see disposition per finding below.
**Source issue:** [#680](https://github.com/Szczepanov/adaptive-training-recommender/issues/680)
**Policy version:** `2026-09-symptom-compatible-strength-safety-v1`

---

## 1. Origin

An external-LLM persona-judge review (`docs/analysis/persona-judge-baseline.json`,
`persona_strength_no_wearable_symptom_flare`) scored the check-in-only, no-wearable
strength persona's active shoulder/back flare case 6.4/10 overall / 6.6 safety-recovery-fit,
flagging that repeated full-body bodyweight sessions and a pull-up-strength session were
not clearly matched to the stated flare, and that the plan didn't visibly explain
symptom-compatible substitutions or gate re-entry on pain response. The issue asked whether
this reflected a confirmed defect, an intentional trade-off, or noise, and set acceptance
criteria spanning movement-level safety, visible rationale, a re-check gate, regression
coverage, and preserved strength specificity when symptoms are absent.

This document records the investigation's findings and disposition for each.

## 2. Finding 1 — Confirmed defect: mistagged strength templates

**Disposition: confirmed and fixed.**

The check-in → guardrail pipeline was already working correctly: `adapters.ts`
`mapContextFromGoalsAndTrainingSettings` already called `resolveInjuryPolicy` with the
day's `tissueResponses`, and `injuryPolicy.ts` `resolveEffectiveInjuryConstraints` already
synthesized a today-only `avoid_overhead_pressing` guardrail from a bare shoulder tissue
response with zero persisted `InjuryConstraint`. `eligibility.ts` correctly excludes any
`SessionTemplate` whose `safetyTags` intersect an active guardrail.

The actual defect: `str_upper_pull_01` ("Pull-up Strength Practice") and `str_full_02`
("Bodyweight Full Body Strength") both had `safetyTags: []`, despite resolving (via
`workoutForTemplate()`) to workouts built from exercises independently catalogued with
`contraindicationTags: ['acute_shoulder_pain']` (`pull_up`, `push_up`, `prone_scapular_row`,
`scapular_push_up`). The audit found the same class of gap in `str_full_01`/`str_full_03`
(→ `strength_full_body_maintenance_01`, containing `bench_press` + `pull_up`) and
`str_power_01` (→ `strength_compact_power_01`, containing `scapular_push_up`, `push_up`,
`bench_press`, `pull_up`). All five were fixed to carry `avoid_overhead_pressing`.

Root cause: three independently-maintained metadata layers exist
(`SessionTemplate.safetyTags`, `WorkoutDefinition.contraindicationTags`,
`ExerciseDefinition.contraindicationTags`), and only the first has a live consumer
(`sessionChoiceEligibility.ts` documents the other two as dead). Nothing kept them in sync.
`engine/templateWorkoutSafetyAlignment.test.ts` now pins every strength template's
`safetyTags` as a superset of what its resolved workout's exercises imply, for the
upper-limb and lumbar guardrail families specifically (see §5 for why lower-limb families
are out of scope here).

## 3. Finding 2 — Confirmed gap: no cross-day re-check gate

**Disposition: confirmed and fixed, as a bounded product-policy heuristic.**

`resolveEffectiveInjuryConstraints` only ever considers the current day's
`tissueResponses`. A today-only constraint (no standing injury) therefore vanished the
moment a later day's check-in simply had no entry for the affected region — regardless of
whether an explicit, settled follow-up had actually been recorded. `injuryPolicy.ts`'s new
`deriveCarriedRegionRestrictions` / `resolveEffectiveInjuryConstraintsWithRecheck` add a
one-day carry: a region's `limit`/`exclude` restriction carries forward exactly one
additional local day when the next day reports nothing for it, cleared by either that day's
own response (any severity) or an already-covering standing injury, and always derived
fresh from the prior day's *raw* response (never from an already-carried result) so the
one-day bound is structural rather than counter-based.

This is registered as `policy.injury.tissue_recheck_carry_v1` in
`app/src/knowledge/injuryPainKnowledge.ts`, explicitly labeled a product-policy heuristic:
the tendinopathy-progression and return-to-sport consensus sources support
contextual/criteria-based load monitoring, not a universal elapsed-time clearance window,
so this claim does not cite them as validating the one-day duration itself.

Two supporting fixes were needed for the carry to be sound:

- **Check-in persistence.** `checkinService.ts` unconditionally deleted `tissueResponses`
  whenever a write's `painOrInjury` was `false`, even when that same write carried an
  explicit, settled structured response (e.g. a next-morning follow-up answer). Fixed so an
  explicitly-supplied structured response survives on its own authority; a write with
  neither `painOrInjury: true` nor a structured response still clears stale data.
- **Follow-up prompt trigger.** The "Yesterday's Training Follow-up" UI prompt
  (`DailyCheckin.tsx`) triggered off the presence of a few specific fields
  (`painDuringTraining`, `afterTrainingState`, `sourceSessionRef`), so a morning-only
  moderate/severe reading — which *does* derive a `limit`/`exclude` restriction — could
  silently never prompt for a re-check. Now triggers on `deriveTissueSeverity(response) !==
  null`, the same severity semantics the engine itself uses.

**Scope note:** this is a one-day *uncertainty hold*, not a true "explicit settled evidence
required" gate — after a second silent day, the restriction lifts without an explicit
settled reading. That is a deliberate, bounded product-policy choice, not a claim that the
athlete's tissue has actually settled.

## 4. Finding 3 — Confirmed gap: substitution wasn't visible

**Disposition: confirmed and fixed.**

Template exclusion alone left the excluded candidates visible only in
`decisionTrace.excludedReasons`, not in athlete-facing text. `rules.ts` now appends a short,
generic rationale sentence (e.g. "An active injury/tissue restriction is limiting
shoulder-loading ... options today; the plan below already avoids those.") whenever
`context.constraints.impliedGuardrails` is non-empty in a `train`/`modify` mode. It
deliberately reads `impliedGuardrails` — real, decision-affecting data — rather than
`context.injuryPolicyTrace`, which is lineage-only and is tested
(`injuryPolicyLineageEquivalence.test.ts`) to never influence the selected recommendation
or its rationale.

## 5. Finding 4 — Corroborating evidence, not fixed here: strength specificity

**Disposition: confirmed as a real gap, explicitly deferred to already-in-progress work.**

The judge's separate complaint — that generic/bodyweight templates displace bench/deadlift
specificity, present even in the flare-free baseline case — traces to two mechanisms: every
template in a strength category shares an identical default `stimulusProfile`
(`templates.ts` `canonicalizeStimulus`), so `calculateStimulusBenefit` cannot rank
barbell-loaded work above bodyweight/pull-up/cable work; and there is no typed
goal-to-exercise-specificity bridge (`strength_muscle` is a broad `TrainingPriority`, not a
typed target). Both are exactly what the already-accepted **ADR-0041** /
`docs/plans/strength-speed-power-performance-goals.md` (Stages PG0–PG9; PG5.1–PG5.2 already
shipped as of this writing) is built to solve. Building a second, competing mechanism here
would duplicate or conflict with that in-progress plan. This finding is recorded as
corroborating evidence for PG's eventual sequencing, not implemented in this change.

## 6. Finding 5 — Out of scope, explicitly split: occupational-fatigue re-check

The issue's acceptance criteria also mention not escalating after severe occupational
fatigue without a fresh subjective reassessment. That interacts with projected-week
semantics and `physicalWork`/`occupationalBaseline` handling — a materially different
mechanism from the tissue/guardrail gate this change addresses. It is intentionally **not**
implemented here; a follow-up issue should scope it independently so this change stays
reviewable as a bounded safety/data-integrity fix.

## 7. Lower-limb tagging: a related, deliberately out-of-scope gap

The same class of bug as Finding 1 (`SessionTemplate.safetyTags` missing what a resolved
workout's exercises imply) likely also exists for the `lower_limb_impact` and
`lower_limb_strength` guardrail families (e.g. `str_lower_01`/`str_full_01`/`str_full_03`'s
`front_squat` carries `acute_knee_pain` but the templates don't carry `avoid_high_impact`).
This was deliberately excluded from `templateWorkoutSafetyAlignment.test.ts`'s scope: unlike
`avoid_overhead_pressing`, the guardrail names `avoid_high_impact` and
`avoid_heavy_lower_body` imply a load/impact level that a bare `contraindicationTag` doesn't
distinguish (a bodyweight hip hinge and a loaded barbell squat both carry region-level pain
tags but are not equivalently "heavy" or "high-impact"). Flagged as a follow-up
investigation rather than mechanically copying tags across, since it needs its own
product-policy judgment call.

## 8. Observed side-effect: the fixture now shows zero strength sessions across the flare's 2-week horizon

Running `npm run persona:build` (deterministic corpus, no external LLM) after this change
shows `persona_strength_no_wearable_symptom_flare`'s generated plan contains **0 of 14
days** with any `Strength`-modality session — down from the 2+ incompatible sessions
(pull-up, bodyweight full-body) the original judge review flagged, but also down from any
strength representation at all across the full two weeks.

This is a direct, correct consequence of the fix, not a new bug: `personaScenarios.mjs`'s
`strengthFlareContext` applies `avoid_overhead_pressing` + `avoid_heavy_spinal_loading` as a
single, static context for the entire simulated horizon (the harness does not recompose
context per simulated day — see Finding 2's discussion of why the D0/D1/D2 lifecycle is
tested directly against the pure resolvers instead of through this harness). With every
strength template's `safetyTags` now correctly reflecting its exercises (Finding 1), and no
equipment-eligible strength template left untagged for either guardrail, the two guardrails
being "on" for the full two weeks excludes every strength template for the full two weeks,
not just an initial acute window. Before this fix, the same static two-week guardrail was
already in effect; it simply failed to catch two of the templates it should have.

Making the fixture's guardrail duration time-varying would require the same kind of
harness change (per-simulated-day context recomposition) explicitly scoped out of this
change in Finding 2 — a deliberate choice, not an oversight. Whoever re-runs the external
persona judge on this change should expect a materially different flare-case plan (no
strength at all, rather than an incompatible strength selection) and judge it accordingly;
the "preserve strength specificity when symptoms are absent" acceptance criterion is better
evaluated against the baseline/work-fatigue cases (which do not carry this static
guardrail) or a future harness capable of modeling settling, not against this fixture as it
stands today.

## 9. Verification

Run and passing:

- `make check` (repo root): ruff format/check, mypy (`src/garmin_sync`, unaffected by this
  frontend-only change), 977 pytest cases, and the full frontend gate (`tsc -b`, `eslint`,
  5914 vitest cases including new coverage in `checkinService.test.ts`,
  `injuryPolicy.test.ts`, `injuryPolicyRecheckGate.test.ts`, `composer.test.ts`,
  `adapters.test.ts`, `eligibility.test.ts`, `templateWorkoutSafetyAlignment.test.ts`,
  `rules.test.ts`, and `injuryPainPolicyAlignment.test.ts` — all green) plus knowledge
  claim/coverage/freshness and workout-library validation (78 claims/83 sources validated;
  56 coverage items, 0 high-impact/high-safety uncovered debt; 184 exercises/46 workouts
  validated).
- `node scripts/check-policy-drift.mjs <base-sha>` (run from `app/`): confirms the
  `POLICY_VERSION` bump to `2026-09-symptom-compatible-strength-safety-v1` is attributed to
  already-listed decision-affecting files (`injuryPolicy.ts`, `adapters.ts`,
  `templates.ts`).
- `npm run simulate:scenarios` / `npm run simulate:diff`: 39 scenarios simulated, committed
  baseline left unchanged, no semantic differences against the committed baseline (this
  change doesn't touch any of the 39 core scenario families directly).
- `npm run persona:build` (deterministic corpus, no external LLM): regenerated 30 persona
  cases across 9 families with no structural change to the corpus shape. Directly inspecting
  the flare case's generated plan confirms the reported defect is gone (no `Strength`
  session at all appears in the 14-day flare plan, down from including the two mistagged
  templates) — see §8 for the fixture-driven side-effect this surfaces.

Not run — requires external LLM API access/cost, and is a manual follow-up step for
whoever merges this change rather than something to assume passed:

- External persona re-judging of `persona_strength_no_wearable_symptom_flare` against the
  committed baseline (`persona:local` / `persona:run` / `persona:update-baseline`).
