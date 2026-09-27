# Issue #805 — Periodic multidirectional and skill exposure

| | |
|---|---|
| **Status** | `Draft` — decisions D-A to D-F are open for review |
| **Source** | [issue #805](https://github.com/Szczepanov/adaptive-training-recommender/issues/805) |
| **Blocked by** | Decisions D-A to D-F; Phase 0 (#804 wiring gaps F1–F3) for the positive planning acceptance criterion |
| **Unlocks** | Retires `cod_lateral` from the context-brief ledger's unmodelled list; first authoritative cadence for ledger `overdue` |
| **Baseline** | `main` @ `d0f5e299` (#847 merged), `POLICY_VERSION = 2026-09-longitudinal-mechanical-impact-exposure-v1` |

All symbols below exist on the baseline unless marked **new**.

## Goal

Let an athlete explicitly opt in to periodic broad-athleticism / sport-skill maintenance without
changing primary sport or requiring weekly field work. Recommend a qualifying session only when the
capability is due, #804's mechanical progression authority permits the exact identity, and
event/recovery/preference/environment/capacity constraints allow it. Every due-but-unfulfilled or
lapsed target produces a typed, visible reason (ADR-0044 D9: blocked capabilities are *suspended,
not substituted*).

## Base

Implement on a branch from `main` at or after `d0f5e299`. #847 is merged, so no stacking is needed.

---

## Findings that shape the design (verified in code)

These were found while reviewing an earlier draft of this plan against the merged #804 code.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | **Nothing in the live paths can reach stage 4.** `resolveEvergreenPlan` calls `evaluateMechanicalStageProgression` without `targetStage`, so `requested = lastExposure.stage` and the stage never advances. | `evergreenPlanning.ts` `resolveEvergreenPlan` | `field_controlled_maintenance_01` is the only multidirectional + ball-skill identity, and it is stage 4. "Use #847's eligible set directly" means the multidirectional/sport-skill target is **unreachable** for anyone not already doing stage-4 work. |
| F2 | **No live caller supplies tissue check-ins.** `rules.ts` omits the `mechanicalCheckinHistory` argument entirely. `planner.ts` defaults it to `[]`, and no service, simulation or script passes it. | `rules.ts` `evaluateTrainingWithIntent` path; `planner.ts` options `mechanicalCheckinHistory` | Follow-up verdict is always `missing`, so progression is held forever, even when `targetStage` is passed. |
| F3 | **The history is 7 days, not 28.** `intent.history` comes from `resolveTrainingIntent(..., windowDays = 7, ...)` at both call sites. | `trainingIntent.ts` `resolveTrainingIntent` | (a) A 28-day window cannot be evaluated from `intent.history`. (b) #847's 14-day re-entry rule actually runs on 7 days of data, so an exposure 8–13 days ago looks like "no history" and triggers a stage-1 reset. |
| F4 | **The consent gate blocks the feature.** `optimizer.ts` excludes every `requiresExplicitModalityPreference` template with `EXPLICIT_MODALITY_PREFERENCE_REQUIRED` unless `Field` is in `preferredModalities`. The persona prefers only `Cycling` and `Strength`. | `optimizer.ts` candidate filtering; `templates.ts` `field_technical_01/02`, `field_maint_01` | "Keep the flag" without saying how the opt-in satisfies it means the opt-in does nothing. The only workaround is adding `Field` to preferred modalities, which changes all general scoring. |
| F5 | **Firestore rules were missed.** `hasValidTrainingIntentProfile` uses `keys().hasOnly([...])`, and the TS validator rejects unknown keys. | `app/firestore.rules`; `validationCore.ts` `validateTrainingIntentProfile` | A new field is rejected server-side unless the rules change too, and then `npm run test:rules` is required. No migration is needed if the field is **optional** (absent = opted out). |
| F6 | **`sport_readiness` already exists** as a `TrainingPriority`. It drives the #804 mechanical target, aerobic dose, health policy and quality prior. | `models.ts` `TrainingPriority`; `evergreenStrategy.ts`; `weeklyAerobicDose.ts` | The plan must say why a separate opt-in exists and that the two are independent. |
| F7 | **The event-directed path is separate.** `resolveEvergreenPlan` returns `null` outside evergreen mode. Event mode uses `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE`, which already has an optional `field_maintenance` role (build/peak only; taper/race rejected by the validator), and #847 did **not** wire mechanical gating into it. | `workouts/event-plan.ts` | "Thread into evergreen planning" leaves event proximity undefined. Unlocking field work in event mode would bypass the mechanical authority. |
| F8 | **A diagnostics seam already exists.** `contextBriefExposureLedger.ts` lists `cod_lateral` in `UNMODELLED` with `source: '#805'`, and its header says `overdue` is "never emitted until an authoritative cadence/max-gap policy exists". | `contextBriefExposureLedger.ts` | This is the natural home for missed/lapsed visibility. |
| F9 | **The persona judge cannot test cadence.** The cycling hybrid family runs `weeks: 2`, `events: []`, with no check-in history. | `app/scripts/ai-judge/personaSuite.mjs` `buildCyclingPrimaryHybridFamily` | The "no weekly checkbox / no session inflation" criteria need deterministic multi-week engine tests. The judge adds a qualitative case only. |
| F10 | **The catalog already states a cadence.** `field_controlled_maintenance_01`'s `full` variant and `sourceNotes` say "every 7–10 days" (event-block football maintenance). | `workouts/catalog/field.ts` | The 28-day claim must explicitly reconcile with this, or reviewers and alignment tests will read it as a contradiction. |

---

## Open decisions (recommended defaults; resolve before the plan moves to `Approved`)

Each decision is written as the recommended default. Record the outcome here when the plan is
approved. A decision that changes a claim or rule also needs lineage (Phase 6).

- **D-A: Opt-in is independent of `sport_readiness`.** The priority keeps its broad effects. The
  opt-in only adds the capability target and consent. Neither implies the other.
- **D-B: The opt-in guarantees a mechanical requirement exists.** If opted in and
  `resolveEvidenceBackedStrategy` would not emit `mechanical_exposure` (for example
  `priorities = ['health']`), emit it at `optional` priority, subject to the unchanged
  `mechanicalWithheldReason`. The capability rides #804's existing weekly **support** occurrence
  and never gets its own.
- **D-C: Progression steering (opted-in athletes only).** When a capability is due and its required
  stage is above the current verdict stage, pass `targetStage = requiredStage`. The evaluator still
  caps at +1 per step and requires 2 normal follow-ups, so authority stays with #847. Also narrow
  the mechanical support occurrence to the highest eligible stage so progression actually happens.
  Without this, stage 4 stays unreachable (F1). This is a new decision rule and needs lineage.
- **D-D: v1 covers evergreen mode only.** In `event_directed` mode the evaluator still runs for
  diagnostics and reports `deferred / event_directed_mode`. The existing event `field_maintenance`
  role and its `Field`-preference gate stay unchanged, so the opt-in never unlocks un-gated field
  work there. Evergreen event proximity is already handled: `mechanicalWithheldReason` suspends on
  `Peak/Taper` and `Post-Event Recovery`, and #805 maps that to `deferred / event_phase`.
- **D-E: Consent is narrow.** The opt-in satisfies `requiresExplicitModalityPreference` only for
  templates whose workout is a capability identity for an **enabled** capability. It never does so
  when `Field` is in `unavailableModalities` (reported as `modality_unavailable`) or
  `deprioritizedModalities` (treated as explicit dislike, reported as `modality_deprioritized`).
  Injury, equipment and environment exclusions are unchanged.
- **D-F: Diagnostics are not persisted in v1.** Surface them through `PolicyWarning`,
  `ResolvedEvergreenPlan` and the context-brief ledger. Do not extend the persisted recommendation
  audit schema, which would mean validator, rules and schemaVersion work.

---

## Phase 0 — Prerequisite: close #804 wiring gaps (separate PR, lands first)

These are #847 defects (F1–F3), not #805 scope. They change #804 behavior, so they need their own
`POLICY_VERSION` bump and simulation baseline review.

1. Source structured check-ins (`DailySubjectiveCheckin` with `tissueResponses`) in orchestration
   and pass them to `resolveEvergreenPlan` from **both** `rules.ts` and `planner.ts`, following the
   lazily-imported default-provider pattern (`trainingHistory.ts`). Find the existing check-in
   read service; do not add Firestore access to an evaluator.
2. Build `mechanicalExposureHistory` from a window of ≥14 days. The recommendation is to extend the
   condition that prepares `historySnapshot.athleteStateEvidence` (28 days,
   `ATHLETE_STATE_HISTORY_WINDOW_DAYS`). Add a test that an exposure 10 days ago keeps the stage.
3. Simulation: give scenario fixtures a way to supply check-in history. Without it every
   scenario-level progression test is vacuous.

**Gate:** if Phase 0 is not merged, #805 can ship only the opt-in, mapping, evaluator and
diagnostics. The positive AC ("receives periodic field work") must then be reported as
unreachable, not claimed.

---

## Phase 1 — Persist the opt-in

- `engine/models.ts`: **new** `AthleticCapabilityKey = 'linear_speed_skill' | 'acceleration_deceleration' | 'multidirectional_change_of_direction' | 'sport_skill'`.
  On `TrainingIntentProfile`, add the optional field
  `capabilityMaintenance?: { enabled: boolean; capabilities: AthleticCapabilityKey[] }`.
- `engine/validationCore.ts` `validateTrainingIntentProfile`:
  - Add the key to `TRAINING_INTENT_PROFILE_KEYS`, but exclude it from the "missing" check.
  - If present, it must be an object with exactly `enabled` (boolean) and `capabilities` (unique,
    known keys, non-empty when `enabled`).
  - Absent means opted out. No schemaVersion bump and no migration.
- `app/firestore.rules` `hasValidTrainingIntentProfile`: add to `hasOnly` only, not `hasAll`, and
  mirror the shape checks. Add emulator tests: accepts absent, accepts a valid value, rejects
  unknown capability, rejects extra sub-keys.
- `services/trainingIntentProfileService.ts`: `upsert` writes with `{ merge: true }`, so to opt out
  write `enabled: false`; omitting the field will not clear it. Test this explicitly.
- `components/preferences/TrainingPlanSection.tsx` (and `usePreferences.ts`): add one explicit,
  default-off toggle ("Keep broad athletic skills: sprinting, braking, change of direction, ball
  skill"). v1 writes all four capabilities; the schema still supports subsets later. Follow
  `docs/standards/ui-ux.md`, then refresh the Playwright visual fixtures at mobile and desktop
  widths.
- `visual/fixtures.ts` and simulation `scenarios.ts` profile fixtures: leave them without the field
  (this proves backward compatibility).

## Phase 2 — Capability identities (authored, exact)

**New** `app/src/workouts/athleticCapability.ts`, modeled on `mechanicalExposure.ts` /
`powerExposure.ts`:

| workoutId | #804 stage | Capabilities (proposed — authored claim, confirm) | Required steps |
|---|---|---|---|
| `field_sprint_mechanics_foundation_01` | 2 | `linear_speed_skill` | `a_march`, `falling_starts` |
| `field_acceleration_braking_01` | 3 | `linear_speed_skill`, `acceleration_deceleration` | `accel_20m`, `braking_sticks` |
| `field_controlled_maintenance_01` | 4 | `acceleration_deceleration`, `multidirectional_change_of_direction`, `sport_skill` | `decelerations`, `cuts`, `ball_skill` (per capability) |

- Each identity declares its `stage` by **reading** `mechanicalIdentityFor(workoutId).stage`, never
  re-declaring it. Assert that every capability identity is a #804 `maintenance_candidate`.
- `qualifyingVariants`: `full` and `reduced` only.
  - `return_to_training` omits `braking_sticks` in `field_acceleration_braking_01`, and omits
    `decelerations` and `cuts` in `field_controlled_maintenance_01`. It is therefore
    non-qualifying for those capabilities.
  - The validator must check, per capability, that every qualifying variant retains that
    capability's steps.
- Explicitly **not** mapped: every `running_*`, `running_walk_run_01`, `strength_reactive_power_01`.
  Add a test that iterates `MECHANICAL_QUALIFYING_IDENTITIES` and asserts no running identity earns
  any capability (AC: generic Running never satisfies COD or ball skill).
- `sport_skill` is sport-neutral: the identity carries `sport: 'football'` as metadata. Future
  racket/court identities add rows, not keys.
- **New** `grantsAthleticCapabilityCredit({ workoutId, capability, variant?, isReadinessModifiedDose? })`
  mirrors `grantsMechanicalExposureCredit`. Readiness-modified doses fail closed. An unknown variant
  is allowed only for the same reason #847 allows it on the planning-history path; note this
  residual risk in the claim.
- Hook `validateAthleticCapabilityIdentities` into `app/scripts/validate-workouts.ts`, as #847 did.

## Phase 3 — Pure rolling evaluator

**New** `app/src/engine/capabilityMaintenance.ts`, with no IO and no `Date.now()`:

```ts
export const ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS = 28; // owned by the new claim (Phase 6)

evaluateCapabilityMaintenance({
  asOfDate, planningHorizonDays,             // horizon = resolveEvergreenPlan `days`
  preference,                                 // profile.capabilityMaintenance
  exposures, observedWindowDays,              // ≥28-day identity-bearing history (see Phase 4)
  mechanicalVerdict, mechanicalWithheld,      // #804 results — consumed, never recomputed
  planningMode, modalityState,                // unavailable / deprioritized Field
}): CapabilityMaintenanceResult             // one entry per enabled capability
```

Per-capability `status`:

- `disabled`
- `insufficient_history`: `observedWindowDays < interval`. This never reads as `due`.
- `satisfied`: carries `lastQualifyingDate` and `nextDueDate = last + 28`.
- `due`: `nextDueDate ≤ asOf + planningHorizonDays − 1`. The horizon lead avoids adding a second
  constant.
- `overdue`: `asOf > nextDueDate`, or no qualifying exposure in the window. This is the audited
  "missed" state.

For `due` and `overdue`, add `fulfilment: 'plannable' | 'deferred' | 'blocked'` with a typed
`reason`:

- **Mechanical** (from the #804 verdict and warning):
  - `mechanical_guardrail` (verdict `blocked`)
  - `mechanical_withheld` (spacing, illness or tissue response)
  - `mechanical_stage_insufficient { currentStage, requiredStage }`
  - `mechanical_requirement_absent` (#804 target withheld)
- **Recovery and clinical:** `adverse_recovery`, `clinical_symptoms`
- **Event context:** `event_phase`, `event_directed_mode`
- **Preference:** `modality_unavailable`, `modality_deprioritized`
- **Capacity:** `no_support_capacity` (set after allocation)

Unit tests should cover:

- Boundary days 27, 28 and 29.
- The horizon-lead edge.
- Warsaw date math via `addDaysToLocalDateString` and `getLocalDateString`, never
  `toISOString().split`.
- Multi-capability credit from one session.
- A `return_to_training` or readiness-modified dose earning nothing.
- `insufficient_history` never producing `due`.

## Phase 4 — Planning integration (evergreen only)

1. **History (F3).** In `trainingIntent.ts`, when `profile.capabilityMaintenance?.enabled`, ensure
   `historySnapshot.athleteStateEvidence` is prepared. Extend its condition; it already carries
   `observedWindowDays = 28`. Pass `observedWindowDays` through so a narrower source yields
   `insufficient_history`. Add a test asserting
   `ATHLETE_STATE_HISTORY_WINDOW_DAYS >= ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS`. Do **not** use
   `rollingLoadBudgetHistory`: it silently falls back to 7-day history for providers without a
   snapshot API.
2. **Strategy.** In `evergreenStrategy.ts` `resolveEvidenceBackedStrategy`, apply D-B. The profile
   is already in scope via `priorities`; thread the opt-in the same way.
3. **Evaluator call.** In `evergreenPlanning.ts` `resolveEvergreenPlan`:
   - Run the capability evaluator.
   - Apply D-C by passing `targetStage` to `evaluateMechanicalStageProgression`.
   - Compute the narrowed allow-list for the mechanical support occurrence:
     1. If eligible ∩ capability identities for due capabilities is non-empty, use that set.
     2. Otherwise use the highest-stage eligible identities.
     3. Otherwise use the unchanged #804 list.
   - Pass the result into `buildEvergreenPlanDefinition` through the existing
     `mechanicalEligibleWorkoutIds` parameter. This reuses #847's allow-list seam; do not add a
     parallel one.
   - Return the result on `ResolvedEvergreenPlan` as **new** `capabilityMaintenance`.
4. **Consent (D-E).** In `optimizer.ts`, thread a `capabilityConsentWorkoutIds` set through the
   optimizer options (populated only for opted-in, due capabilities) and exempt those templates from
   `EXPLICIT_MODALITY_PREFERENCE_REQUIRED`. Resolve template ↔ workout through `engineTemplateIds`
   and `workoutIdForTemplateId`. Keep `requiresExplicitModalityPreference: true` on every field
   template.
5. **No inflation.** Do not add a coverage requirement, occurrence or objective. After allocation,
   if the support occurrence was not placed or was not given a capability identity, set
   `fulfilment = blocked / no_support_capacity`.
6. **Event mode (D-D).** `rules.ts` and `planner.ts` compute the evaluator result for diagnostics
   even when `resolveEvergreenPlan` returns `null`.

Verify environment behavior for the `environment: 'outdoor'` templates. Confirm which existing gate
excludes them when outdoor training is unavailable, and map that gate to
`environment_unavailable`. If no such gate exists, record the gap; do not invent one.

## Phase 5 — Diagnostics

- `evergreenStrategy.ts` `PolicyWarning.code`: add `'capability_maintenance_unfulfilled'`, emitted
  once per due or overdue capability that is not `plannable`. The message names the capability, the
  reason and `nextDueDate`.
- `contextBriefExposureLedger.ts`:
  - Remove `cod_lateral` from `UNMODELLED`.
  - Add `CAPABILITIES` entries for multidirectional COD and sport skill, confirmed only through
    `grantsAthleticCapabilityCredit`.
  - Emit `overdue` for opted-in athletes, importing the interval from
    `capabilityMaintenance.ts`. The ledger owns no policy.
  - Update the header comment and the "No authoritative cadence…" output string.
  - If the ledger input lacks the profile, add it as an optional input; absent means no `overdue`.

## Phase 6 — Knowledge lineage (ADR-0033, ADR-0044 D10)

**New** `app/src/knowledge/athleticCapabilityKnowledge.ts`, registered in `sportsKnowledgeRegistry.ts`:

- Claim `policy.evergreen.athletic_capability_maintenance_v1`, classified `product_heuristic` with
  low certainty. It owns:
  - default-off explicit opt-in
  - the 28-day interval and horizon-lead due rule
  - the capability → identity mapping
  - narrow consent (D-E)
  - progression steering (D-C)
  - evergreen-only scope (D-D)
- The claim text must reconcile the issue's 2–6 week range with F10's 7–10-day event-block football
  cadence.
- `knowledgeCoverage.ts`: add a new item `evergreen.athletic_capability_maintenance`. Also update
  the currentRule text of the existing explicit-modality-preference item and of
  `evergreen.mechanical_exposure`, because D-B and D-C change them.
- `optimizerScoringKnowledge.ts`: amend the explicit-preference claim statement to cover capability
  consent.
- **New** `athleticCapabilityPolicyAlignment.test.ts`: the interval constant, mapping table,
  qualifying variants, consent exemptions and warning code must all match the claim. Run the
  existing `mechanicalExposurePolicyAlignment.test.ts` too.

## Phase 7 — Scenarios and persona

**Deterministic engine tests** (primary evidence, in `evergreenPlan.test.ts` or a new
`capabilityMaintenance.planning.test.ts`). The fixture is a cycling-primary hybrid profile with
`priorities: ['endurance', 'strength_muscle']`.

| Case | Expectation |
|---|---|
| Opted-in, stage-4-ready history (synthetic check-ins with normal follow-up), 29 days since last field session | `field_controlled_maintenance_01` is planned in the mechanical support slot, and the session count is unchanged vs opted-out |
| Opted-out, same history | No field template planned; exclusion reason `EXPLICIT_MODALITY_PREFERENCE_REQUIRED` |
| Opted-in with `avoid_high_impact` active | `blocked / mechanical_guardrail`; nothing is substituted |
| Opted-in, adverse recovery or clinical symptoms | `blocked / mechanical_requirement_absent` (from #804's withheld warning) |
| Opted-in, `Field` in `unavailableModalities` / `deprioritizedModalities` | `blocked / modality_unavailable` / `modality_deprioritized` |
| Opted-in, evergreen `Peak/Taper` phase | `deferred / event_phase` |
| Opted-in, `event_directed` mode | `deferred / event_directed_mode`; no field work unlocked |
| Opted-in, cold start (stage 1) | `blocked / mechanical_stage_insufficient { current: 1, required: 2+ }`; the support slot carries the stage-appropriate identity |
| 8-week projection, opted in | ≤1 capability session per 28-day window, total sessions/week equal to opted-out, and the target never re-fires while `satisfied` |

**Simulation:** add an 8-week scenario family in `engine/simulation/scenarios.ts` (opted-in vs
opted-out, needs Phase 0 check-in support) and review `make simulate` / `simulate:diff`.

**Persona judge:** add `persona_cycling_hybrid_broad_athleticism` to
`buildCyclingPrimaryHybridFamily`. It needs its own `intent` clone with the opt-in, plus a judge
expectation that field work is periodic, subordinate to cycling quality, and never displaces key
cycling sessions. Also update the family validation in `personaSuite.mjs`. The judge is
qualitative only; the cadence claims rest on the tests above.

## Phase 8 — Documentation and policy version

- `docs/architecture/recommendation-engine.md`: add a capability-maintenance section next to the
  #804 section. Update the workout-library contract docs for the new identity table.
- `docs/plans/README.md` status board, per repo convention.
- `engine/policy.ts`: bump `POLICY_VERSION` from
  `'2026-09-longitudinal-mechanical-impact-exposure-v1'` to (for example)
  `'2026-09-periodic-athletic-capability-maintenance-v1'`, and **prepend** the old value to
  `HISTORICAL_POLICY_VERSIONS`. Update `policy.test.ts`.

---

## Acceptance-criteria traceability

| Issue AC | Covered by |
|---|---|
| Intent expresses broad athleticism separately | Phase 1, D-A |
| Rolling requirement without changing event modality | Phases 3–4 |
| Field templates explicitly mapped | Phase 2 table and validator |
| Generic Running never satisfies COD/ball skill | Phase 2 running-exclusion test |
| Opted-in cycling scenario receives periodic field work | Phase 7 row 1 (**requires Phase 0**) |
| No field work without opt-in | Phase 7 row 2 |
| `avoid_high_impact` blocks | Phase 7 row 3 |
| Event proximity deprioritizes/removes | Phase 7 rows 6–7 (D-D) |
| Missed/blocked target diagnosable | Phases 3 and 5 (`overdue`, typed reasons, ledger) |
| No weekly checkbox / no session inflation | Phase 7 row 9 |
| Sport-agnostic | Phase 2 (`sport` metadata, neutral keys) |
| Lineage and alignment tests | Phase 6 |
| Persona coverage | Phase 7 persona case |
| CI, simulation, policy drift, `POLICY_VERSION` | Verification, Phase 8 |

## Verification (report what was actually run, and its exit code)

```bash
cd app && npx tsc -b                                  # not `tsc -p .` — it checks nothing
cd app && npm test                                    # inner loop
cd app && npm run test:rules                          # firestore.rules changed (needs emulator + Java)
cd app && npm run check
cd app && npm run simulate:plan-judge
cd app && node scripts/check-policy-drift.mjs origin/main
make simulate                                         # simulate:diff is advisory; main already shows 3 pre-existing diffs
make verify                                           # canonical handoff gate
```

Also refresh and review the Playwright visual fixtures for the preferences screen.

## Risks

- **Stage-4 reachability (F1–F2).** Without Phase 0 and D-C the headline behavior never occurs.
  Even with them, a cold start needs about 6 qualifying exposures with normal next-day tissue
  check-ins, which at one support slot per week is 6+ weeks. Expect `mechanical_stage_insufficient`
  as the common early state, and make sure the UI copy says so.
- **Stage ratchet.** #804 derives stage from the *last* exposure. A stage-2 session after a stage-4
  session drops eligibility to stage 2. D-C's highest-stage narrowing reduces this; do not
  "fix" it inside #805.
- **Consent widening.** D-E must exempt only exact capability identities. A test must prove a
  non-capability Field template stays excluded for an opted-in athlete.
- **Variant uncertainty.** Planning history (`CompletedExposure`) has no `workoutVariantId`, so a
  `return_to_training` dose that is not flagged readiness-modified would be over-credited. This is
  the same residual risk as #804; document it in the claim and do not widen it.
- **Profile writes.** A merge-write cannot delete a field, so opt-out must write `enabled: false`.
- **Environment gap.** If no gate excludes `outdoor` templates when outdoor access is unavailable,
  the "available environment" AC is only partially met. Report it rather than inventing a gate.
