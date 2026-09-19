# 2026-09-19 — Issue #679 remediation: Olympic-triathlon taper, recovery re-entry, weekday cap

Point-in-time record of the investigation into [Issue #679](https://github.com/Szczepanov/adaptive-training-recommender/issues/679):
three problems an external LLM judge reported in the `persona_triathlon_established_olympic`
persona family (`docs/analysis/persona-judge-baseline.json`, `manual_external` run,
`analyzedAt: 2026-09-19T13:32:37Z`, family sensitivity median 6.8/10, taper case 5.2/10).
Each finding below was reproduced deterministically against the real engine (not just
inferred from the judge's commentary) before any fix was written.

## Findings

### 1. Weekday-cap case never actually carried a 45-minute cap — confirmed, root cause was a fixture bug, not an engine bug

`persona_triathlon_established_olympic_short_time` is synthesized in
`app/scripts/ai-judge/personaSuite.mjs`'s `buildActiveTriathlonFamily` by relabeling the
intermediate-Olympic catalog's `short_time` case onto the "established" persona identity.
`normalizeCase(shortTimeSource, { id, label })` did not pass `context`, so it silently fell
back to the baseline case's `context` (75-minute weekday cap) instead of the source case's
own 45-minute-capped context — the case's entire defining perturbation was discarded.
Once the fixture correctly carries the 45-minute cap, the existing cap-safe-dose machinery
(`eligibility.ts`'s `withCapSafeDose`, `optimizer.ts`'s `resolveTimeCapDoseAdjustment`/
`materializeEffectiveDose`) enforces the *returned* session's duration range correctly with
no engine change needed — confirmed by dumping every day's `durationMin`/`durationMax`
against the cap both before and after the fixture fix.

**Disposition: confirmed and fixed.** `personaSuite.mjs` now passes
`context: shortTimeSource.scenario.context` for this case.

### 2. No recovery re-entry gate after severe adverse recovery — confirmed, real engine gap

`planner.ts`'s severe-adverse-recovery restriction was a fixed 3-day calendar window
(`isRecoveryPersistedDate = isSevereAdverseRecovery && offset <= 3`); day 4 onward reached
the fully unrestricted candidate pool regardless of whether the athlete had actually
recovered. Reproduced against the real `adverse_recovery` case: two rest days were followed
immediately by `swim_threshold_01` (Moderate Endurance, systemicCost 0.6) and `str_upper_01`
(Strength) on days 4-5 — exactly the "four-day block containing threshold swimming and
strength" the judge reported.

A forecast day has no real future readiness reading to re-check against, so a literal
"wait for a fresh check-in" gate is not implementable for projected days. During review of
the first fix, the extended ladder was found to be internally inconsistent: offset 3 still
allowed systemicCost <=0.65 (including generic Moderate Endurance and potentially Strength)
while the newly-added offsets 4-5 tightened back down to <=0.35. That could allow the very
threshold/tempo work the fix was meant to defer *before* the re-entry window became stricter.

The final implementation is monotonic: days 1-2 are Rest/Mobility-Recovery only; day 3 may
add non-Strength, non-Moderate/Hard/Race-Specific work at systemicCost <=0.35
(`RECOVERY_REENTRY_EARLY_MAX_SYSTEMIC_COST`); days 4-5 widen that same low-intensity,
non-Strength pool to <=0.5 (`RECOVERY_REENTRY_LATE_MAX_SYSTEMIC_COST`); the unrestricted
pool is reached only from day 6.

**Disposition: confirmed and fixed, including review follow-up for the non-monotonic first implementation.**

### 3. No real taper restriction for triathlon (or running) events beyond the generic volume floor — confirmed, real engine gap

`optimizer.ts`'s pre-event strength/hard/exhaustive restriction
(`evaluateRecoveryConstraints`) was gated to
`focusEvent.category === 'cycling_event' || focusEvent.category === 'running_race'` only —
a triathlon A-event never entered that branch, so none of the existing D1-D7 restrictions
applied. Separately, even within that D1-D7 band, nothing addressed the outer 8-14 day
taper window, where `periodization.ts`'s volume-only taper (`volumeScale` floor 0.6,
`intensityScale` held at 1.0 — a deliberate "volume down, intensity held" design, not a
bug) does not by itself prevent placing multiple Strength sessions or stacked Moderate
Endurance days. Reproduced against the real `taper` case: two Upper-body Strength sessions
and two Moderate Endurance runs (one 3 days before the race) across the 14-day window.

Fixed in three parts, all in `evaluateRecoveryConstraints`:
- The existing D1-D7 restriction now also covers `triathlon` events.
- D-3 now excludes generic Moderate/Hard Endurance while preserving light
  Race-Specific Endurance sharpening, so the reported "tempo three days before race"
  symptom cannot survive merely because it is below the exhaustive-work threshold.
- A new, independent restriction covers the full resolved taper window
  (`resolveEventTaper`) for the same cycling/running/triathlon categories: a Strength
  candidate is excluded once systemicCost exceeds 0.35 or a touch has already occurred in
  the window (at most one light touch, not zero); a Moderate/Hard Endurance candidate is
  excluded when one already occurred within the prior 3 days.
  `strength_meet` is deliberately excluded from this second restriction — a strength
  meet's own taper is a deload of strength work itself, not something the guard should
  suppress as "nonessential." (An earlier version of this fix applied the guard to every
  A/B event regardless of category; `npm run simulate:diff` against the committed baseline
  showed it altering `strength_meet_powerlifting_B`, which is exactly the over-broad
  "identical rule for every athlete" the issue's Non-goals warn against. Narrowed before
  landing.)

**Disposition: confirmed and fixed.**

### 4. Corpus doc assigns the 14-day taper perturbation to the wrong tier — flagged, not fixed

`docs/analysis/2026-08-30-triathlon-persona-corpus.md` documents the 14-day taper horizon
as belonging to the Advanced/70.3 tier, not Olympic — yet `personaSuite.mjs` synthesizes
`persona_triathlon_established_olympic_taper` by borrowing the taper case from the
*advanced half-iron* catalog family and relabeling it onto the Olympic persona
(`taperSource = requireCase(advancedFamily, 'persona_triathlon_advanced_half_iron_taper')`).
This composition looks deliberate (build one "established" persona that exercises all
three perturbations regardless of which catalog tier originally authored each one), so it
was left as-is rather than "fixed" against a doc that may simply be describing the earlier,
non-composed catalog. Recorded here rather than silently picked, per this repo's
doc-disagreement convention.

**Disposition: noise (a stale doc note, not an engine or fixture defect) — left unresolved, flagged for a future doc pass.**

### 5. Local judge ("Preserved" at 8.5/10) vs. external judge (5.2/10 on the taper case) divergence — flagged, not resolved

`docs/analysis/2026-09-03-persona-judge-safety-and-modality-tuning.md`'s local `persona:diff`
stability run reported this family "Preserved" at a family-level 8.5/10 as recently as
2026-09-03, only reporting the family aggregate rather than the four case-level scores the
external review exposes. The external `manual_external` review is treated as the more
trusted source in this repo (`docs/analysis/ai-plan-judge.md`), but it is still N=1 per
case. This investigation did not re-run the external judge (that is a manual,
out-of-band workflow this session cannot execute) or the local GPU judge (`judge:local`
family) — evidence here is the deterministic unit/simulation assertions below, not a new
judge sample.

**Disposition: not resolved — re-running both the local and external judge against this
branch is an explicit follow-up, not something this change can self-certify.**

## Evidence gathered this session

- Deterministic engine-level fixtures added:
  `app/scripts/ai-judge/__tests__/establishedOlympicTriathlonPersona.test.mjs` runs the
  real `runScenario` engine path against all four persona cases and pins: baseline
  discipline preservation; the adverse-recovery re-entry ramp; every weekday session's
  full duration range against the 45-minute cap; and the taper case's strength/density
  bounds.
- Knowledge registry alignment:
  `app/src/knowledge/taperFuelingKnowledge.ts`'s `policy.taper.pre_event_restrictions_v1`
  claim updated (v1 -> v2) to describe the triathlon inclusion and the new taper-window
  guard; a new claim `policy.load_recovery.severe_adverse_recovery_reentry_v1` registered
  in `app/src/knowledge/sportsKnowledge.ts`; both covered in
  `app/src/knowledge/knowledgeCoverage.ts` and pinned by alignment tests in
  `app/src/knowledge/loadIntensityRecoveryPolicyAlignment.test.ts` and
  `app/src/knowledge/taperFuelingKnowledge.test.ts`.
- `POLICY_VERSION` bumped to `2026-09-triathlon-taper-recovery-reentry-capacity-v1`
  (`app/src/engine/policy.ts`) — this changes recommendation decision logic for
  triathlon/running/cycling A-B events and severe-adverse-recovery forecasts.
- `npm run persona:build` — corpus builds cleanly (30 cases, 9 families).
- `npm run simulate:scenarios` + `npm run simulate:diff` — the (advisory, non-blocking)
  semantic diff shows changes confined to cycling/running/triathlon A-event scenarios and
  the adverse-recovery/readiness-crash scenarios; no unrelated scenario (including the
  strength-meet taper scenario, after the category-scoping fix above) changed.
- Original branch validation before review follow-up: full `npx vitest run src/engine src/knowledge scripts/ai-judge`: 258 files, 3731 tests
  passing.
- Review follow-up added deterministic assertions for the complete severe-recovery ladder
  (including day 3), and D-3 generic Moderate/Hard taper exclusion while keeping a light
  Race-Specific sharpening candidate admissible. Final CI status is recorded on PR #683.

## Not done in this session

- Re-running the external (`judge:external:export`/`import`) or local GPU
  (`judge:local`/`judge:local:stability`) AI-judge samples against this branch — both are
  separate, manual/long-running workflows outside this session's scope. The deterministic
  fixtures above are evidence that the three reported symptoms no longer reproduce; they
  are not a replacement for re-scoring the persona family.
- Reconciling the corpus-doc tier note (finding 4) or the local/external judge divergence
  (finding 5) — both flagged as follow-ups above rather than resolved here.
