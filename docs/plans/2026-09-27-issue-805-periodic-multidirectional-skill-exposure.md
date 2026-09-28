# Issue #805 — Periodic multidirectional and skill exposure

| | |
|---|---|
| **Status** | `Implemented` — Phase 0A shipped in PR #854; Phase 0B and Phases 1–8 shipped in PR #855; athlete-facing diagnostics/context export shipped in follow-up #856 |
| **Source** | [issue #805](https://github.com/Szczepanov/adaptive-training-recommender/issues/805) |
| **Blocked by** | Nothing. |
| **Unlocks** | Retires `cod_lateral` from the context-brief ledger's unmodelled list; first authoritative cadence for ledger `overdue` |
| **Baseline** | Reviewed against `main` @ `305d3c4e` (#851 merged). The implementation must use the then-current `POLICY_VERSION` after prerequisite PRs land. |

All symbols below exist on the baseline unless marked **new**.

## Delivery record

The findings (F1–F15) and phase text below are the approved design as written before implementation; they are
historical, not open work. What shipped, and where it deviated:

- **Phase 0A** (check-ins, wider mechanical history, default stage target, simulation seam) shipped in PR #854.
  #805 supplies only the `targetStage` hook it reserved (D-C), raised to the highest owed capability stage.
- **Phase 0B** shipped here: `rankCandidates` rejects unavailable modalities with `UNAVAILABLE_MODALITY` before any
  preference or consent exemption.
- **Deviation — support occurrence.** An `optional` #804 requirement has `minimumSessions: 0`, so for the
  cycling-primary persona no support occurrence existed to reuse (the opted-out 8-week run contains zero mechanical
  sessions). While a capability placement exists, the single `mechanical_exposure` requirement therefore carries a
  support-tier minimum of one — the shape a `target` mechanical requirement already had — so the allocator places
  it only around primary roles. No distinct capability requirement/objective is added and the athlete's configured
  weekly session commitment is unchanged; the existing mechanical support occurrence can become reservable when a
  capability is owed. The 8-week simulation shows fewer realized training days opted-in than opted-out.
- **Deviation — date-aware placement.** Placement is resolved per planning date in `coverage.ts`
  `buildCoverageState` (narrowed allow-list plus exact-identity consent while a placement is active and unfulfilled)
  rather than by a new constraint inside `weeklyDosePacking.ts`, which never selects the mechanical support date.
- **Review-driven change — cadence vs #804 (approved 27 September 2026).** Independent review found that a due
  date of last + 14 always fell on a #804 re-entry day (gap >= 14 resets to Stage 1) and that #804's latest-stage
  rule let any Stage 2/3 linear-speed touch demote a Stage-4 athlete, so field work stalled after one or two touches.
  Resolution: the capability is due at last + 13 (the 14-day interval is now a maximum gap equal to #804's continuity
  window), and #804 holds the highest stage with explicit normal follow-up inside that window when such evidence
  exists; otherwise it retains the latest performed stage while missing follow-up still blocks advancement
  (`policy.evergreen.mechanical_exposure_v1` claim v3). This overrides the original plan note not to fix the stage
  ratchet inside #805. A deterministic eight-week cycle test drives #804 and #805 day by day and proves recurrence.
- **Other review fixes.** Consent is limited to identities of enabled capabilities (a progression-only touch may
  consent an enabled capability's identity that is not itself due — recorded deviation); a qualifying touch anywhere
  from a placement's planning date closes it. Pending placements expose their candidate identities to the weekly
  allocator with per-workout not-before dates; both reservation and coverage urgency enforce those dates, including
  when Field is already preferred. Once active, identities settling the most active placements are preferred.
- **D-A evidence scope / #857 closure.** The opt-in does not widen athlete-state evidence (which would change aerobic
  floor, power and quality decisions). Instead #804 receives a dedicated establishment read. Snapshot-backed providers
  carry the confirmed observation span; reconstruct-only providers may return the wider exposure list but fail closed
  at the conservative operational span for cadence/establishment, so missing history cannot masquerade as 28 observed days.
- **Simulation harness limits.** The 8-week family shows field work on the support slot and respects the cadence,
  but it cannot show sustained recurrence: the harness records every simulated session at template minimum duration,
  so the athlete drops below #804's "established" volume after about three weeks (in both arms), and #804's
  consecutive-day `withheld` verdict on the weekly planning day blanks the whole seven-day horizon. Recurrence is
  therefore proven by the deterministic cycle test; both harness/#804 horizon effects are follow-ups.
- **Diagnostics reach — completed by #856.** `Recommendation.capabilityMaintenance` and
  `WeekAheadPlan.capabilityMaintenance` surface planner-owned status in the morning/week-ahead readouts, including
  typed blocked/unknown/deliberately-suspended reasons. The field remains runtime-only and is not added to
  `RecommendationAudit`.
- **Context brief — completed by #856.** The same-day planner-owned `CapabilityMaintenanceResult` is forwarded into
  `ContextBriefService` and the exposure ledger when available. The brief never recomputes cadence; without a
  same-date planner result it reports cadence as unknown. Legacy unknown-variant planner credit is explained when the
  stricter ledger cannot confirm variant-specific credit.
- **Persona judge.** `persona_cycling_hybrid_broad_athleticism` was added; the LLM persona-judge baseline was not
  re-run in this change.


## Goal

Let an athlete explicitly opt in to periodic broad-athleticism / sport-skill maintenance without
changing primary sport or requiring weekly field work. Recommend a qualifying session only when the
capability is due, #804's mechanical progression authority permits the exact identity, and
event/recovery/preference/environment/capacity constraints allow it. Every due-but-unfulfilled or
lapsed target produces a typed, visible reason (ADR-0044 D9: blocked capabilities are *suspended,
not substituted*).

## Base

Implement from current `main`. #847 is merged. PR #851 only changes verification execution/performance and does not alter this design; prerequisite policy changes below may advance `POLICY_VERSION` before #805 implementation starts.

---

## Findings that shape the design (verified in code)

These were found while reviewing an earlier draft of this plan against the merged #804 code. **F1–F3 are historical prerequisite findings resolved by PR #854**; they are retained here to explain the dependency and design decisions. F4 onward remain inputs to #805 unless separately marked delivered.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | **Nothing in the live paths can reach stage 4.** `resolveEvergreenPlan` calls `evaluateMechanicalStageProgression` without `targetStage`, so `requested = lastExposure.stage` and the stage never advances. | `evergreenPlanning.ts` `resolveEvergreenPlan` | `field_controlled_maintenance_01` is the only multidirectional + ball-skill identity, and it is stage 4. "Use #847's eligible set directly" means the multidirectional/sport-skill target is **unreachable** for anyone not already doing stage-4 work. |
| F2 | **No live caller supplies tissue check-ins.** `rules.ts` omits the `mechanicalCheckinHistory` argument entirely. `planner.ts` defaults it to `[]`, and no service, simulation or script passes it. | `rules.ts` `evaluateTrainingWithIntent` path; `planner.ts` options `mechanicalCheckinHistory` | Follow-up verdict is always `missing`, so progression is held forever, even when `targetStage` is passed. |
| F3 | **Mechanical progression reads the wrong history channel.** `intent.history` is the intentionally short 7-day operational history. `resolveTrainingIntent` already has a wider 28-day `historySnapshot.athleteStateEvidence` channel, but `resolveEvergreenPlan` builds mechanical history from `intent.history`. | `trainingIntent.ts` comments and `ATHLETE_STATE_HISTORY_WINDOW_DAYS`; `evergreenPlanning.ts` | #847's 14-day re-entry rule can lose an exposure from 8–13 days ago. Fix the mechanical consumer to use the wider athlete-state evidence; do **not** widen operational fatigue/microcycle history. |
| F4 | **The consent gate blocks the feature.** `optimizer.ts` excludes every `requiresExplicitModalityPreference` template with `EXPLICIT_MODALITY_PREFERENCE_REQUIRED` unless `Field` is in `preferredModalities`. The persona prefers only `Cycling` and `Strength`. | `optimizer.ts` candidate filtering; `templates.ts` `field_technical_01/02`, `field_maint_01` | "Keep the flag" without saying how the opt-in satisfies it means the opt-in does nothing. The only workaround is adding `Field` to preferred modalities, which changes all general scoring. |
| F5 | **Firestore rules were missed.** `hasValidTrainingIntentProfile` uses `keys().hasOnly([...])`, and the TS validator rejects unknown keys. | `app/firestore.rules`; `validationCore.ts` `validateTrainingIntentProfile` | A new field is rejected server-side unless the rules change too, and then `npm run test:rules` is required. No migration is needed if the field is **optional** (absent = opted out). |
| F6 | **`sport_readiness` already exists** as a `TrainingPriority`. It drives the #804 mechanical target, aerobic dose, health policy and quality prior. | `models.ts` `TrainingPriority`; `evergreenStrategy.ts`; `weeklyAerobicDose.ts` | The plan must say why a separate opt-in exists and that the two are independent. |
| F7 | **The event-directed path is separate.** `resolveEvergreenPlan` returns `null` outside evergreen mode. Event mode uses `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE`, which already has an optional `field_maintenance` role (build/peak only; taper/race rejected by the validator), and #847 did **not** wire mechanical gating into it. | `workouts/event-plan.ts` | "Thread into evergreen planning" leaves event proximity undefined. Unlocking field work in event mode would bypass the mechanical authority. |
| F8 | **A diagnostics seam already exists.** `contextBriefExposureLedger.ts` lists `cod_lateral` in `UNMODELLED` with `source: '#805'`, and its header says `overdue` is "never emitted until an authoritative cadence/max-gap policy exists". | `contextBriefExposureLedger.ts` | This is the natural home for missed/lapsed visibility. |
| F9 | **The persona judge cannot test cadence.** The cycling hybrid family runs `weeks: 2`, `events: []`, with no check-in history. | `app/scripts/ai-judge/personaSuite.mjs` `buildCyclingPrimaryHybridFamily` | The "no weekly checkbox / no session inflation" criteria need deterministic multi-week engine tests. The judge adds a qualitative case only. |
| F10 | **The catalog already states a cadence.** `field_controlled_maintenance_01`'s `full` variant and `sourceNotes` say "every 7–10 days" in the legacy event-block football context. | `workouts/catalog/field.ts` | The general evergreen capability policy must explicitly own a different context-specific cadence rather than treating the workout note as global policy. |
| F11 | **`unavailableModalities` is promised as a hard exclusion in UI but is not enforced by the optimizer path inspected here.** The setting is persisted and the UI says those activities “will not be offered,” while `rankCandidates` does not check it. | `ModalitySections.tsx`; `preferencesService.ts`; `optimizer.ts` | #805 must not build a consent exemption on top of a false hard-gate assumption. Repair the global hard exclusion first and prove its precedence over capability consent. |
| F12 | **A horizon-lead `due` boolean alone can compress cadence.** `packWeeklyDose` chooses feasible dates by capacity/tie-break rules and has no capability due-date constraint. | `weeklyDosePacking.ts` assignment ordering | Marking a 14-day target “due” when it enters a 7-day horizon can place it immediately and repeat roughly weekly. The capability target needs a date-aware not-before/target date while reusing the same support occurrence. |
| F13 | **Variant qualification is capability-specific, not workout-wide.** `return_to_training` retains both sprint-foundation skill steps; in acceleration/braking it retains acceleration but omits braking; in controlled field maintenance it retains ball skill but omits deceleration/cuts. | `workouts/catalog/field-technique.ts`; `workouts/catalog/field.ts` | A blanket “full/reduced only” rule throws away legitimate low-risk skill credit and obscures the exact-step contract. Qualify each capability by the steps retained in each authored variant. |
| F14 | **The draft knowledge classification violates ADR-0033.** It calls the new product heuristic “low certainty”. | ADR-0033 D-SKR-MULTIAXIS / D-SKR-NO-OVERCLAIM | Product-policy numbers use `maturity=heuristic` and `evidenceCertainty=not_applicable`; scientific certainty must not be invented for the 14-day guardrail. |
| F15 | **The draft hard-codes a future policy-version predecessor even though prerequisite behavior changes must land first.** | Phase 0 + `engine/policy.ts` contract | #805 must bump from the **then-current** policy version and prepend that exact value; otherwise the plan is stale by construction. |

---

## Resolved decisions — approved 27 September 2026

These are implementation decisions. Rules that affect recommendation behavior still require the
ADR-0033 lineage and policy-version work in Phase 6/8.

- **D-A — opt-in is independent of `sport_readiness`.** `sport_readiness` keeps its existing
  broad effects. Capability maintenance is a separate, default-off expression of longitudinal
  athletic optionality; neither setting silently mutates the other.
- **D-B — opt-in guarantees a mechanical requirement exists when #804 has not deliberately
  suspended it.** If enabled and the strategy would otherwise omit `mechanical_exposure`, emit an
  `optional` requirement. It reuses #804's existing support occurrence and never creates its own
  session.
- **D-C — progression steering is explicit and remains subordinate to #804.** When a due capability
  requires a higher stage, pass `targetStage = requiredStage`; #804 still caps advancement at one
  stage and still requires two successful same-stage exposures with normal next-day tissue
  follow-up. When capability work is not yet stage-eligible, narrow the support occurrence to the
  highest currently eligible stage so progression can actually occur.
- **D-D — v1 recommendation authority is evergreen-only.** Event-directed mode computes the
  evaluator for visibility but the capability policy does not unlock event `field_maintenance`.
  Existing event roles remain unchanged. `Peak/Taper` and `Post-Event Recovery` consume #804's
  source-owned suspension state.
- **D-E — consent is narrow and precedence is explicit.** Capability opt-in satisfies
  `requiresExplicitModalityPreference` only for exact workout/capability identities that are
  currently due and enabled. It never promotes `Field` into `preferredModalities`.
  `unavailableModalities` is a hard exclusion and always wins. `avoidedModalities` blocks this
  optional capability injection rather than surprising an athlete who explicitly said they would
  rather avoid that modality. `deprioritizedModalities` remains a soft ranking preference, not a
  hard block. Injury, equipment and environment gates keep their existing authority.
- **D-F — capability diagnostics are not persisted in v1.** Surface them through
  `ResolvedEvergreenPlan`, typed warnings/readout data, and the context brief. Do not extend the
  persisted recommendation-audit schema in this feature.
- **D-G — v1 uses a fixed 14-day target interval, not 28 days and not an athlete-editable
  interval.** This is a product guardrail, **not** a validated physiological cliff. It aligns the
  broad-athleticism maintenance target with the existing 7–14-day physical-optionality architecture
  while staying less frequent than the legacy 7–10-day football/event-block note. Future
  capability-specific intervals require separate evidence/policy review.
- **D-H — status vocabulary follows ADR-0044 D9.** Keep cadence state
  (`disabled | insufficient_history | satisfied | due | overdue`) separate from fulfilment state
  (`plannable | blocked | deliberately_suspended | unknown`). Do not invent a parallel
  `deferred` semantic. Deliberate suspension never creates multiple catch-up occurrences.
- **D-I — credit is per capability × variant × retained authored steps.** A
  `return_to_training` variant may credit a capability whose exact steps remain; it must not
  credit capabilities whose defining steps were omitted. Readiness-modified ad-hoc doses still
  fail closed.

### Research boundary behind D-G

A targeted literature check found no direct trained-adult evidence validating either a 14-day or a
28-day minimum for multidirectional/COD or ball-skill maintenance. The broad maintenance review by
Spiering et al. explicitly notes insufficient athlete-specific minimum-dose data
(https://pubmed.ncbi.nlm.nih.gov/33629972/). A 2025 procedural-skill meta-analysis shows increasing
decay with longer non-use but on a months-scale, with strong task/moderator dependence
(https://pubmed.ncbi.nlm.nih.gov/40455501/). Soccer detraining evidence shows that >=2 weeks of
cessation can impair several physical qualities, but it does not establish a COD/skill maintenance
threshold (https://pubmed.ncbi.nlm.nih.gov/33400214/). Therefore 14 days is intentionally registered
as product policy with limitations, not presented as research-derived physiology.

---

## Phase 0 — Prerequisites that land before #805 planning integration

Use **two small prerequisite fixes** so #805 does not hide pre-existing defects inside a new feature.

### Phase 0A — close #804 progression/history wiring gaps (F1–F3) — **Delivered by PR #854**

PR #854 closes these #847/#804 defects with its own recommendation-policy version bump, knowledge-lineage update and simulation coverage. The checklist below is retained as the delivered contract.

1. Source structured check-ins (`DailySubjectiveCheckin` with `tissueResponses`) in orchestration
   and pass them to `resolveEvergreenPlan` from both daily and week-ahead paths. Reuse the
   existing service/provider boundary; evaluators remain pure and do not read Firestore.
2. When mechanical progression is needed, ensure
   `historySnapshot.athleteStateEvidence` is prepared and build `mechanicalExposureHistory`
   from that wider evidence. Preserve the 7-day `intent.history` operational window exactly as-is;
   its comments explicitly forbid widening fatigue/microcycle bookkeeping with athlete-state
   evidence.
3. Add regression tests proving an exposure 10 days ago is visible to the 14-day re-entry rule and
   that no wider exposure list leaks into operational fatigue/objective calculations.
4. Give simulation fixtures an explicit check-in-history seam so progression scenarios are not
   permanently stuck on `followup_missing`.

### Phase 0B — make “Unavailable Training Types” a real hard exclusion (F11)

Prefer a separate small fix PR because this corrects global preference semantics, not only #805.

1. In the canonical candidate gate, reject any template whose normalized modality is present in
   `preferences.unavailableModalities`, with a stable `UNAVAILABLE_MODALITY` reason.
2. Apply this before any preferred-modality or #805 capability-consent exemption. No override may
   re-admit an unavailable modality.
3. Add optimizer/selection tests for normal, unavailable, preferred+unavailable conflict, and
   capability-consent+unavailable conflict.
4. Cross-check the Preferences copy (“will not be offered”) against the implemented behavior and
   include the behavior change in policy-drift/versioning review.

**Gate:** Phase 0A is satisfied by PR #854. Phase 0B remains required before capability consent can truthfully claim that hard unavailability has precedence.

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
  `docs/standards/ui-ux.md`, then refresh the Playwright visual fixtures at the repository's current 360 px, 390 px, 412 px and desktop matrix.
- `visual/fixtures.ts` and simulation `scenarios.ts` profile fixtures: leave existing profiles without the field (this proves backward compatibility).
- Do not silently rewrite general modality preferences when the toggle changes. If all current qualifying identities are blocked by `Field` being unavailable/avoided, keep the opt-in and show the typed blocked state.

## Phase 2 — Capability identities (authored, exact)

**New** `app/src/workouts/athleticCapability.ts`, modeled on `mechanicalExposure.ts` /
`powerExposure.ts`. The mapping is per capability, because a single workout variant may retain one
capability while removing another.

| workoutId | #804 stage | Capability | Required retained steps | Qualifying authored variants |
|---|---:|---|---|---|
| `field_sprint_mechanics_foundation_01` | 2 | `linear_speed_skill` | `a_march`, `falling_starts` | `full`, `reduced`, `return_to_training` |
| `field_acceleration_braking_01` | 3 | `linear_speed_skill` | `accel_20m` | `full`, `reduced`, `return_to_training` |
| `field_acceleration_braking_01` | 3 | `acceleration_deceleration` | `accel_20m`, `braking_sticks` | `full`, `reduced` |
| `field_controlled_maintenance_01` | 4 | `acceleration_deceleration` | `accels`, `decelerations` | `full`, `reduced` |
| `field_controlled_maintenance_01` | 4 | `multidirectional_change_of_direction` | `cuts` | `full`, `reduced` |
| `field_controlled_maintenance_01` | 4 | `sport_skill` | `ball_skill` | `full`, `reduced`, `return_to_training` |

- Read the stage from `mechanicalIdentityFor(workoutId).stage`; never duplicate stage authority.
  Assert every capability identity is a #804 `maintenance_candidate`.
- Validation is **per mapping row**: every required step exists and every declared qualifying
  variant retains all steps for that capability.
- Explicitly not mapped: all `running_*`, `running_walk_run_01`, and
  `strength_reactive_power_01`. Generic running/mechanical work cannot satisfy COD or ball skill.
- `sport_skill` is sport-neutral. The current identity carries `sport: 'football'` metadata;
  future racket/court/etc. identities add mapping rows rather than new capability semantics.
- **New** `grantsAthleticCapabilityCredit({ workoutId, capability, variant?,
  isReadinessModifiedDose? })`: known variants use the table above; readiness-modified ad-hoc doses
  fail closed. Historical evidence with no variant may follow #804's backward-compatible unknown
  variant behavior, but the knowledge claim must state the over-credit risk until performed facts
  carry exact variant/step completion.
- Hook `validateAthleticCapabilityIdentities` into `app/scripts/validate-workouts.ts`.
- Clarify `field_controlled_maintenance_01` source notes: its 7–10-day language is the legacy
  football/event-block context; general evergreen capability cadence is owned by the #805 policy.

## Phase 3 — Pure rolling evaluator

**New** `app/src/engine/capabilityMaintenance.ts`, with no IO and no `Date.now()`:

```ts
export const ATHLETIC_CAPABILITY_TARGET_INTERVAL_DAYS = 14; // product policy, Phase 6

evaluateCapabilityMaintenance({
  asOfDate,
  planningHorizonDays,
  preference,
  exposures,
  observedWindowDays,
  mechanicalVerdict,
  mechanicalWithheld,
  planningMode,
  modalityState,
  environmentState,
}): CapabilityMaintenanceResult
```

Per-capability cadence `status`:

- `disabled`
- `insufficient_history` when `observedWindowDays < 14`; never infer `due` from partial history
- `satisfied` with `lastQualifyingDate` and `nextDueDate = last + 14`
- `due` when `nextDueDate` falls inside the planning horizon
- `overdue` when `asOfDate > nextDueDate`, or when a complete observed interval contains no
  qualifying exposure

For `due`, also return **placement authority**, not just a boolean:

- `notBeforeDate = nextDueDate`
- `targetDate = nextDueDate`

For `overdue`, `notBeforeDate = asOfDate`. This prevents a 7-day forecast from pulling a
14-day target forward by almost a week (F12).

Keep fulfilment separate from cadence:

- `plannable`
- `blocked` — an active requirement exists but a hard present constraint prevents delivery
- `deliberately_suspended` — source policy intentionally turns the requirement off for the
  window; no multi-session catch-up debt
- `unknown` — target/progress cannot be established from available evidence

Typed reasons:

- blocked: `mechanical_guardrail`, `mechanical_stage_insufficient`,
  `modality_unavailable`, `modality_avoided`, `environment_unavailable`,
  `no_support_capacity`
- deliberately suspended: `mechanical_withheld`, `adverse_recovery`,
  `clinical_symptoms`, `event_phase`, `event_directed_mode`
- unknown: `mechanical_requirement_absent`, `history_unavailable`

`deprioritizedModalities` may be exposed as soft context but does not produce `blocked`.

Unit tests cover days 13/14/15, horizon-entry without early placement, Warsaw date math via project
date helpers, one session crediting multiple capabilities, per-capability
`return_to_training` behavior, readiness-modified fail-closed behavior, incomplete-history
semantics, suspension, and the invariant that a suspension never increases the number of owed
occurrences above one.

## Phase 4 — Planning integration (evergreen only)

1. **History (F3).** When mechanical progression or capability maintenance needs longitudinal
   evidence, ensure `historySnapshot.athleteStateEvidence` is prepared. Pass its
   `observedWindowDays` and exposures to the mechanical/capability consumers. Keep
   `intent.history` at 7 days and add an architecture test preventing athlete-state evidence from
   widening operational fatigue/microcycle history.
2. **Strategy (D-B).** Thread the capability opt-in into `resolveEvidenceBackedStrategy` (do not
   infer it from `sport_readiness`). Add optional `mechanical_exposure` only when the athlete
   opted in and #804 has not source-suspended the requirement.
3. **Mechanical authority (D-C).** Run the capability evaluator, pass the highest due
   `requiredStage` as `targetStage` to `evaluateMechanicalStageProgression`, then derive the
   exact stage-eligible capability identities from the #804 verdict. #805 consumes #804; it never
   reimplements tissue progression.
4. **Date-aware reuse of the support occurrence (F12).** Extend the existing mechanical-support
   placement seam with a bounded date constraint for a due capability:
   - do not create another occurrence/objective/session;
   - a capability-bearing support occurrence must be on/after `notBeforeDate`;
   - among feasible dates, prefer the date closest to `targetDate` without displacing higher
     priority reservations;
   - an earlier generic mechanical occurrence may still happen, but it must not be narrowed or
     credited as the future capability touch;
   - if no due-window support occurrence can be placed, report `blocked/no_support_capacity`.
5. **Exact allow-list.** For the selected due-window support occurrence:
   - if stage-eligible capability identities exist, narrow to those exact workout IDs;
   - otherwise narrow to the highest-stage #804 maintenance identities to continue safe progression;
   - otherwise preserve #804's unchanged allow-list.
6. **Consent (D-E).** Thread a date-scoped `capabilityConsentWorkoutIds` set through optimizer
   options. It exempts only the exact due identities from
   `EXPLICIT_MODALITY_PREFERENCE_REQUIRED`.
   - global `UNAVAILABLE_MODALITY` from Phase 0B runs first and cannot be exempted;
   - `avoidedModalities` blocks optional capability injection;
   - `deprioritizedModalities` remains a soft penalty;
   - `requiresExplicitModalityPreference: true` remains on every field template.
7. **Environment.** Reuse existing hard environment authority:
   `evaluateTemplateEligibility` checks configured training environment, and week-ahead
   `templateFitsResolvedAvailability` checks resolved schedule-overlay/environment constraints.
   Map those rejections to `environment_unavailable`; do not add another environment policy.
8. **No inflation.** Do not add a capability coverage requirement, objective, or standalone
   occurrence. One mechanical support occurrence may satisfy multiple due capabilities through the
   exact mapping table.
9. **Event mode (D-D).** Compute the evaluator result for diagnostics in event-directed mode but do
   not feed capability consent/allow-lists into event selection. Report
   `deliberately_suspended/event_directed_mode`.

## Phase 5 — Diagnostics

- Add typed capability-maintenance diagnostics to `ResolvedEvergreenPlan`.
- Add `PolicyWarning.code = 'capability_maintenance_unfulfilled'` for due/overdue
  `blocked` or `unknown` results. Do not turn an intentional taper/recovery suspension into a
  warning; it remains visible as `deliberately_suspended`.
- `contextBriefExposureLedger.ts`:
  - remove `cod_lateral` from `UNMODELLED`;
  - add multidirectional COD and sport-skill entries whose confirmations come only from
    `grantsAthleticCapabilityCredit`;
  - **consume the resolved capability-maintenance cadence/status** instead of importing the 14-day
    constant and recomputing overdue independently;
  - if the resolved capability result is unavailable, report no authoritative overdue status
    rather than creating a second ledger;
  - update the header/readout wording accordingly.

This keeps ADR-0044's single-owner rule intact: the context brief is a readout, not another cadence
authority.

## Phase 6 — Knowledge lineage (ADR-0033, ADR-0044 D10)

**New** `app/src/knowledge/athleticCapabilityKnowledge.ts`, registered in
`sportsKnowledgeRegistry.ts`.

Claim `policy.evergreen.athletic_capability_maintenance_v1`:

- `maturity = 'heuristic'`
- `evidenceCertainty = 'not_applicable'`
- `recommendationStrength = 'conditional'`
- product-policy source, with explicit limitations that no validated 14-day COD/sport-skill
  biological minimum is established
- owns:
  - default-off explicit opt-in;
  - fixed 14-day interval;
  - horizon visibility **plus date-aware not-before/target placement**;
  - capability × identity × variant mapping;
  - narrow consent and hard-gate precedence (D-E);
  - progression steering (D-C);
  - evergreen-only recommendation authority (D-D);
  - ADR-0044 status semantics (D-H).

The claim text distinguishes the general 14-day guardrail from the workout catalog's legacy 7–10-day
football/event-block note and records the literature boundary from D-G.

Also:

- `knowledgeCoverage.ts`: add `evergreen.athletic_capability_maintenance`; update the current
  rule text for explicit-modality preference and `evergreen.mechanical_exposure`.
- `optimizerScoringKnowledge.ts`: amend explicit-preference policy to cover the narrow
  capability-consent exemption and hard unavailable-modality precedence.
- Add `athleticCapabilityPolicyAlignment.test.ts` covering interval, placement semantics, mapping,
  per-variant credit, consent, status/reason vocabulary and warning code.
- Run `mechanicalExposurePolicyAlignment.test.ts` as a regression guard.

## Phase 7 — Scenarios and persona

**Deterministic engine tests** are primary evidence (in `evergreenPlan.test.ts` or a new
`capabilityMaintenance.planning.test.ts`). Use a cycling-primary hybrid profile with
`priorities: ['endurance', 'strength_muscle']`.

| Case | Expectation |
|---|---|
| Opted-in, stage-4-ready history with normal follow-ups, 15 days since last qualifying field session | `field_controlled_maintenance_01` uses the existing mechanical support occurrence; total session count equals opted-out |
| Opted-out, same history | No capability consent; non-preferred field templates remain excluded |
| `avoid_high_impact` active | `blocked/mechanical_guardrail`; nothing substitutes for COD/skill |
| Adverse recovery or clinical symptoms | `deliberately_suspended/adverse_recovery` or `deliberately_suspended/clinical_symptoms`; no catch-up count |
| `Field` unavailable | `blocked/modality_unavailable`; capability consent cannot override it |
| `Field` avoided | `blocked/modality_avoided`; optional maintenance is not injected |
| `Field` deprioritized | remains soft preference; it is not mislabeled as a hard block |
| Configured/resolved environment excludes outdoor field work | `blocked/environment_unavailable` |
| Evergreen `Peak/Taper` | `deliberately_suspended/event_phase` |
| `event_directed` mode | `deliberately_suspended/event_directed_mode`; no field work unlocked |
| Cold start, stage 1 | `blocked/mechanical_stage_insufficient`; support slot carries the safest eligible progression identity |
| Due date enters a 7-day horizon while last exposure is only 8 days old | target is visible as `due`, but no capability-bearing occurrence is placed before day 14 |
| `field_acceleration_braking_01:return_to_training` | credits `linear_speed_skill`, not `acceleration_deceleration` |
| `field_controlled_maintenance_01:return_to_training` | credits `sport_skill`, not COD/deceleration |
| 8-week projection, opted in | no capability-triggered occurrence is placed earlier than 14 days after the prior qualifying exposure; total weekly session count equals opted-out; suspension never creates repeated catch-up debt |

**Simulation:** add an 8-week opted-in/opted-out family in `engine/simulation/scenarios.ts` after
Phase 0A supplies check-ins/history. Review `make simulate` and `simulate:diff`, preserving a
checked baseline so only new behavioral deltas are attributed to #805.

**Persona judge:** add `persona_cycling_hybrid_broad_athleticism` to
`buildCyclingPrimaryHybridFamily` with its own intent clone and opt-in. Keep the judge qualitative:
periodic field work stays subordinate to cycling quality and never displaces key cycling sessions.
Do **not** claim that the current two-week persona horizon validates the 14-day cadence; cadence/no
inflation remain deterministic-test and simulation claims.

## Phase 8 — Documentation and policy version

- `docs/architecture/recommendation-engine.md`: add a capability-maintenance section next to the
  #804 section. Update the workout-library contract docs for the new identity table.
- `docs/plans/README.md` status board, per repo convention.
- `engine/policy.ts`: after prerequisite PRs land, bump the **then-current** `POLICY_VERSION` to a new #805 identity (for example `2026-09-periodic-athletic-capability-maintenance-v1`) and prepend that exact prior value to `HISTORICAL_POLICY_VERSIONS`. Do not hard-code the pre-prerequisite value (F15). Update `policy.test.ts`.

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
| No weekly checkbox / no session inflation | Phase 4 date-aware reuse + Phase 7 horizon/8-week cases |
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
make simulate                                         # record the baseline before behavior changes; explain every new diff
make verify                                           # canonical handoff gate (current main runs independent gates concurrently)
```

Also refresh and review the Preferences Playwright fixtures at 360 px, 390 px, 412 px and desktop widths.

## Risks

- **Stage-4 reachability (F1–F2).** Without Phase 0 and D-C the headline behavior never occurs.
  Even with them, a cold start needs about 6 qualifying exposures with normal next-day tissue
  check-ins, which at one support slot per week is 6+ weeks. Expect `mechanical_stage_insufficient`
  as the common early state, and make sure the UI copy says so.
- **Stage ratchet.** #804 derives stage from the *last* exposure. A stage-2 session after a stage-4
  session drops eligibility to stage 2. D-C's highest-stage narrowing reduces this; do not
  "fix" it inside #805.
- **Consent widening.** D-E must exempt only exact capability identities on the eligible delivery date. A test must prove a non-capability Field template stays excluded and that `UNAVAILABLE_MODALITY` wins even over explicit capability consent.
- **Variant uncertainty.** Planning history (`CompletedExposure`) has no `workoutVariantId`; unknown historical variants therefore retain #804's backward-compatible over-credit risk. Known variants must use the per-capability step table, and the claim must document the unknown-variant limitation.
- **Cadence compression.** A due-within-horizon signal without a date floor recreates weekly maintenance. The date-aware placement tests are merge-blocking.
- **Profile writes.** A merge-write cannot delete a field, so opt-out must write `enabled: false`.
- **Environment authority.** Do not add a duplicate gate: configured environment and resolved schedule-overlay environment already have hard checks. The implementation risk is failing to propagate those existing rejection reasons into capability diagnostics.
