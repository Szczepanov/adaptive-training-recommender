# Workout Library Expansion — Implementation Plan

* **Status:** Implemented (2026-08-07)
* **Relocated** from `docs/workout-library-expansion-plan.md` to establish the
  `docs/plans/` convention. Content unchanged.

> **Reader warning — this document is a historical record, not a work list.**
> It was written *before* the work it describes was carried out, so its findings and
> "fix this" instructions describe a state that no longer exists. At least one of them
> (§1.3's resolver `status` finding) was re-reported as live during the 2026-08-08 review
> because this file was read as current. **Verify any finding here against the code before
> acting on it.**
>
> Its line references (`rules.ts:200`, `rules.ts:387`, `rules.ts:461`, `planner.ts:190`,
> `optimizer.ts:107-120`) are also stale — see F9 in
> [the 2026-08-08 review](../analysis/2026-08-08-architecture-review.md). The prose is
> still accurate and §1.2 remains the fullest written description of the two selection
> paths; treat the specifics as historical.

Date: 2026-08-07
Scope: `app/src/workouts/`, `app/src/engine/templates.ts`, `app/src/engine/microcycle.ts`

---

## Implementation outcome

Implemented on 2026-08-07. The library now contains 52 exercises, 36 workout definitions,
22 engine templates, and the same 17 event-plan coverage keys.

- All templates resolve through an active, non-manual catalogue workout or a retained
  compatibility fallback. Resolver candidates now use explicit
  `engineTemplatePriority` ordering rather than catalogue import order.
- `Power Maintenance` is available on both recommendation paths. `Field Maintenance`
  remains intent-optimizer-only: the readiness-only path cannot enforce its required
  two-day lower-body spacing rule, so it is intentionally excluded under Risk R2.
- The variable-intensity and 30/15 sessions share `end_hard_02`; the established 6×3
  session has priority 1 and the new alternatives have priorities 2 and 3. They are
  available in event-plan coverage without silently changing the default prescription.
- Phase 4 added `cable_machine` to the fine-grained workout equipment vocabulary,
  alongside its cable exercises and catalogue session.

`cd app && npm run check` passed after implementation (126 tests and catalogue validation).

---

## 1. Context

### 1.1 Baseline before implementation

| Layer | Count | Location |
|---|---|---|
| Exercises | 43 | `app/src/workouts/exercises.ts` |
| Workout definitions | 30 | `app/src/workouts/catalog/*.ts` (13 modules) |
| Engine session templates | 20 | `app/src/engine/templates.ts` |
| Event-plan coverage keys | 17 | `app/src/workouts/event-plan.ts` |

### 1.2 The two selection paths (critical to understand before changing anything)

A template can reach the user through **two independent code paths**, and they have
different filtering rules. Any change here must be evaluated against both.

**Path A — readiness rules (`evaluateTraining`, `rules.ts:200`)**

```text
readiness → mode (train | modify | recover) → category allowlist → pickTemplate
```

On a `train` day the candidate pool is a hardcoded **category allowlist**
(`rules.ts:387`):

```ts
t.category === 'Hard Endurance' || t.category === 'Moderate Endurance'
  || t.category === 'Full-body Strength' || t.category === 'Upper-body Strength'
  || t.category === 'Lower-body Strength'
```

`modify` mode filters by `systemicCost <= MODIFY_MAX_SYSTEMIC_COST` (any non-Rest
category). `recover` mode is restricted to `Rest` / `Mobility/Recovery`.

**Path B — intent optimizer (`evaluateTrainingWithIntent`, `rules.ts:461`; `generateWeekAheadPlan`, `planner.ts:190`)**

```text
ENRICHED_TEMPLATES → eligibility → systemicCost ceiling → rankCandidatesByUtility → top pick
```

There is **no category allowlist** on this path — only modality restriction, systemic
cost ceiling, mode gate, duration, equipment, and injury filters
(`optimizer.ts:107-120`).

> **Consequence:** a new template in a category outside the Path A allowlist is
> selectable on Path B but invisible on Path A. This is the single most important
> constraint shaping the phasing below.

### 1.3 The resolution contract

`prescription.ts` resolves an engine template to a catalogue workout in two steps:

1. **Preferred** — find a non-`manualOnly` workout whose `engineTemplateIds` contains
   the template id (`prescription.ts:310`). Only 8 of 20 templates currently have one.
2. **Fallback** — `FALLBACK_TEMPLATE_TO_WORKOUT` (`prescription.ts:19-37`), a 17-entry
   hand-written table.

`prescription.test.ts:29` asserts **every** template in `TEMPLATES` resolves non-null.
This is a real guardrail: adding a template without a mapping fails CI. It does *not*
check that the mapping is semantically correct.

> **~~Incidental finding (P1)~~ — RESOLVED during this plan's own implementation.**
> Verified against the code 2026-08-08: `workoutForTemplate`
> ([`prescription.ts:303`](../../app/src/workouts/prescription.ts)) filters on
> `workout.status === 'active' && !workout.manualOnly && workout.engineTemplateIds?.includes(templateId)`,
> and the legacy fallback at line 307 also requires `status === 'active'`. The resolver
> matches what `docs/workout-library.md` describes; there is no gap.
>
> The original text (a `draft`/`deprecated` workout could be prescribed, "fix in Phase 1")
> described the state *before* this plan was implemented and is struck through rather than
> deleted so the history stays readable. **It is not outstanding work.** It was
> re-reported as a live finding during the 2026-08-08 review cycle purely because this
> document was read as current — see the reader warning at the top.

---

## 2. Analysis — what is actually broken

Severity key: **P0** = user receives a session that isn't the one the engine chose.
**P1** = declared capability is unreachable. **P2** = content gap, nothing broken.

### 2.1 P0 — Six fallback entries resolve to the wrong session

`FALLBACK_TEMPLATE_TO_WORKOUT` routes these to a workout that does not deliver the
template's stimulus:

| Template | Title | Resolves to | Problem |
|---|---|---|---|
| `str_lower_01` | Lower Body Strength & Power | `strength_full_body_maintenance_01` | Full-body session incl. bench/pull-up. No lower-body-only workout exists in the catalogue at all. |
| `str_upper_02` | Cable Upper Body Circuit | `strength_upper_body_trunk_01` | Requires `cable_machine`; target workout has no cable exercise. No cable exercise exists. |
| `str_upper_01` | Upper Body Push/Pull | `strength_upper_body_trunk_01` | Acceptable, but the same target serves three distinct templates. |
| `mob_02` | Yoga & Breathwork Flow | `recovery_mobility_tissue_01` | Generic mobility. No breathwork/downregulation exercise exists. |
| `end_easy_02` | Light Base Run | `running_walk_run_01` | Walk-run is not a continuous base run. |
| `end_hard_01`, `end_hard_03`, `end_mod_01` | — | `running_walk_run_01` | **Already superseded** by `engineTemplateIds` in `quality-support.ts`. The fallback entries are now dead but misleading. |

`str_lower_01` is the worst case: it is in the Path A `train` allowlist, so it is
routinely selectable, and every selection silently delivers a full-body session.

### 2.2 P1 — Two declared engine categories have zero templates

`SessionTemplate['category']` (`engine/models.ts:220`) declares 11 categories.
`templates.ts` defines templates for 9. Missing:

- **`'Power Maintenance'`** — the catalogue has `strength_compact_power_01`
  (`category: 'power_maintenance'`), and the event plan lists it under
  `compact_strength`. No engine template can select it.
- **`'Field Maintenance'`** — the catalogue has `field_controlled_maintenance_01`,
  listed in the event plan under `field_maintenance`. No engine template can select it.

Both workouts are therefore reachable only through the event-plan path, never through
daily recommendation.

### 2.3 P1 — `ENRICHED_TEMPLATES` default profiles are wrong for the missing categories

`templates.ts:481-513` assigns stimulus/cost profiles by category with an `else` branch
for anything unmatched:

```ts
stimulus = { aerobicCapacity: 0.2, thresholdDevelopment: 0.3, surgeRepeatability: 0.4,
             maxStrength: 0.8, hypertrophy: 0.7, mobilityRecovery: 0.2 };
cost     = { systemic: 0.8, cardiovascular: 0.4, lowerBody: 0.8, upperBody: 0.8,
             impactTissue: 0.5, neuromuscular: 0.8 };
```

A `Field Maintenance` template falling into that branch would be scored with
`upperBody: 0.8` and `impactTissue: 0.5` — both materially wrong (field work is
lower-body and high-impact). Any new template in a new category **must** carry an
explicit `stimulusProfile` and `costProfile`, or the `else` branch must be extended.

### 2.4 P1 — Field sessions earn no microcycle credit

`planner.ts:141` builds the credit string as `` `${modality} ${category}` ``.
`microcycle.ts:80-88` matches objectives by keyword. A field session produces
`"Field Field Maintenance"`, which matches **none** of the four objective keyword sets
(`threshold|hard|tempo`, `surge|vo2|football|hiit`, `easy|endurance|zone 2|running|cycling`,
`strength|weight|lifting`). Note `'football'` is already a `surge_repeatability` keyword —
`'field'` is not.

### 2.5 P2 — Missing exercise families

No exercise in `exercises.ts` covers:

- **Plyometrics / reactive strength** — no pogo hop, countermovement jump, drop jump,
  or bound. `medicine_ball_slam` is the only explosive item and it is upper-body.
- **Eccentric hamstring** — `romanian_deadlift` is the sole posterior-chain exercise.
  No Nordic curl or equivalent.
- **Loaded calf/Achilles** — `seated_soleus_iso` is isometric only; no heavy or
  eccentric heel raise.
- **Hip extension** — no hip thrust or glute bridge.
- **Cable** — no cable exercise despite `cable_machine` in `EquipmentKey`.
- **Breathwork / downregulation** — `mobility_flow` is the only mobility exercise.
- Also absent: overhead press, loaded carry, deadlift, frontal-plane strength beyond
  `copenhagen_plank`.

The eccentric and calf gaps are notable because `worsening_achilles_pain`,
`acute_hamstring_pain`, and `painful_braking` appear throughout `eligibility` and
`contraindicationTags` — the system **gates on** those symptoms but offers no exercise
that builds the relevant tissue capacity.

### 2.6 Explicitly NOT problems

- **Two `Equipment` unions.** `workouts/models.ts:50` (`Equipment`) and
  `engine/models.ts:553` (`EquipmentKey`) are deliberately separate vocabularies —
  the engine gates on coarse user-owned equipment, the catalogue on fine-grained
  per-exercise needs. Do not merge them.
- **Intensity distribution model.** See §3.4.
- **Catalogue workouts with no engine template** (race day, taper, openers, event-specific
  endurance, over-unders, gap-closing). These are event-plan-driven by design.

---

## 3. Evidence base — why these additions and not others

### 3.1 Strength training for endurance: settled; interference is overstated

A [2026 umbrella review of concurrent-training meta-analyses](https://link.springer.com/article/10.1007/s40279-026-02401-y)
(17 meta-analyses, 144 studies, 1492 participants) reports aerobic-capacity gains
comparable between concurrent and endurance-only training. A
[2025 systematic review with meta-analysis in cyclists](https://link.springer.com/article/10.1007/s00421-025-05883-2)
confirms heavy strength training benefits physiological determinants of cycling
performance, with interference limited in trained athletes.

**Implication:** the existing primary strength session is well-founded and needs no
redesign. The gap is *category coverage*, not dose.

### 3.2 Reactive strength is a distinct, missing category

The [2025 umbrella review on strength training in endurance athletes](https://pubmed.ncbi.nlm.nih.gov/40153564/)
categorises strength work as maximal (>80% 1RM), explosive (<80% 1RM), and **reactive
(plyometric)**. Meta-analytic estimates put plyometric jump training at roughly **+2%
running economy** and **+3% VO₂max**
([Scientific Reports 2025](https://www.nature.com/articles/s41598-025-10652-4);
[jump-training meta-analysis](https://www.researchgate.net/publication/375775137_Effects_of_plyometric_jump_training_on_running_economy_in_endurance_runners_a_systematic_review_and_meta-analysis)).

**Implication:** add reactive-strength exercises. This is also the lowest-cost way to
maintain tendon stiffness for the field/football side of the macrocycle, and it is the
natural content for the missing `Power Maintenance` category.

### 3.3 Interval format: longer and variable-intensity work maximises time at VO₂max

A [2026 meta-analysis on time spent at or near VO₂max](https://link.springer.com/article/10.1186/s13102-026-01766-x)
finds that **longer and variable-intensity work intervals** maximise tVO₂max. A
[2025 network meta-analysis](https://link.springer.com/article/10.1186/s13102-025-01191-6)
identifies ~140 s work / 165 s recovery running HIIT and ≤30 s sprints with <97 s
recovery as effective protocols.

Current library: 4×8 threshold, 3×12 over-under, 6×3 VO₂ (bike), 4×4 VO₂ (run),
10×20 s surges. Missing: a **variable-intensity / decreasing-intensity** interval, and a
true **short-interval (30/15-style)** session.

**Implication:** two new quality sessions, both mapping to existing `end_hard_*`
templates as alternative candidates rather than new templates.

### 3.4 Intensity distribution: do not restructure periodization

The [2025 Frontiers review on training-intensity-distribution theory](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2025.1657892/full)
and a [systematic review with meta-analysis](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11329428/)
converge on: polarized is marginally superior at elite level; at recreational level
distribution models differ little and individual response dominates.

**Decision: no change to `periodization.ts` or `microcycle.ts` objective weights.** The
evidence does not support the engineering cost.

---

## 4. Design decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Fix routing before adding content | A correct catalogue behind a broken router still delivers the wrong session. §2.1 is the only P0. |
| D2 | New plyometric exercises get `modality: 'strength'`, not `'field'` | `validation.ts:22-30` restricts a `strength` workout to `strength` exercises. Using `'field'` would force widening the compatibility matrix, weakening a useful invariant. |
| D3 | Every new engine template carries explicit `stimulusProfile` + `costProfile` | Avoids the wrong `else`-branch defaults (§2.3). Also extend the `else` branches defensively. |
| D4 | New quality sessions attach to existing templates via `engineTemplateIds`, not new templates | A template is an engine-level *choice*; a workout is an execution. Two VO₂ formats are two executions of one choice. Avoids inflating the Path A candidate pool. |
| D5 | Add `Power Maintenance` to the Path A `train` allowlist; keep `Field Maintenance` optimizer-only | The readiness path cannot enforce field session spacing; see Risk R2. |
| D6 | Add `plyo_box`, then add `cable_machine` with Phase 4 cable content | The equipment vocabulary grows only when backed by catalogue content. |
| D7 | No new `WorkoutCategory` values | `full_body_strength`, `power_maintenance`, `field_maintenance` already cover the new content. Adding catalogue categories would ripple into `event-plan.ts` validation. |
| D8 | Event-plan coverage gains no new required keys | `validateEventPlanCoverage` fails on missing required keys; adding required coverage is a breaking change to the September plan. New workouts join existing keys as additional options. |

---

## 5. Implementation phases

Each phase is independently shippable and leaves `npm run check` green.

---

### Phase 1 — Fix template→workout routing (P0)

**Goal:** every engine template resolves to a workout that delivers its stated stimulus.

**1.1 Add a lower-body strength workout**

New file `app/src/workouts/catalog/strength-lower.ts`, exporting
`LOWER_BODY_STRENGTH_WORKOUTS` with one definition:

```text
id:       'strength_lower_body_01'
category: 'full_body_strength'          // no lower-only WorkoutCategory; D7
modality: 'strength'
objectives: ['strength_maintenance', 'power_maintenance', 'tissue_capacity']
engineTemplateIds: ['str_lower_01']
equipment: ['barbell', 'rack', 'dumbbells', 'bench', 'bodyweight']
```

Blocks: activation (`hang_power_clean`), main (`front_squat`,
`rear_foot_elevated_split_squat`, `romanian_deadlift`), accessory
(`seated_soleus_iso`, `tibialis_raise`, `copenhagen_plank`). All exercises already
exist — no `exercises.ts` change needed in this phase.

Must satisfy `validation.ts`:
- three variants `full` / `reduced` / `return_to_training`, durations non-increasing
  in that order (`validation.ts:240-241`);
- `duration.minimumMin <= defaultMin <= maximumMin`, minimum > 0 (`:208-209`);
- `full.targetDurationMin === duration.defaultMin` to avoid the warning at `:237`;
- `loadMultiplier` in `(0, 1.2]` (`:274`);
- every exercise's `equipment` covered by the workout's `equipment` (`:257`);
- `regressions: ['strength_compact_power_01']`, `progressions: []` — must exist and not
  create a cycle (`:352`, `validateProgressionGraph`);
- `garmin: { exportable: false }` (strength modality, `:363`);
- non-empty `sourceNotes` (warning at `:213`);
- computed step duration within 15 min of `targetDurationMin` per variant (`:344-348`).

Register in `catalog.ts` (import + spread).

**1.2 Prune and correct the fallback table** (`prescription.ts:19-37`)

- Remove `end_mod_01`, `end_mod_02`, `end_hard_01`, `end_hard_02`, `end_hard_03` —
  all now superseded by `engineTemplateIds` in `quality-support.ts`. Verify by
  temporarily removing and confirming `prescription.test.ts:29` still passes.
- Remove `str_lower_01` — superseded by 1.1.
- Leave `end_easy_02`/`end_easy_03` → `running_walk_run_01` (accepted, documented).
- Leave `str_upper_02` → `strength_upper_body_trunk_01` until Phase 4.

**1.3 Add a resolution-fidelity test**

`prescription.test.ts` currently proves resolution is non-null. Add a test asserting
resolved **modality and category agreement** for every template — e.g. a
`Lower-body Strength` template must not resolve to a workout whose blocks contain
`bench_press` or `pull_up`. This is the regression guard that would have caught §2.1.

**1.4 Enforce `status === 'active'` in the resolver**

`prescription.ts:310` — add the missing status predicate so the code matches the
documented contract (see incidental finding in §1.3):

```ts
WORKOUTS.find((workout) =>
  workout.status === 'active' && !workout.manualOnly
  && workout.engineTemplateIds?.includes(templateId))
```

Add a test that a workout with `status: 'deprecated'` and a matching `engineTemplateIds`
is not resolved. Zero behaviour change today (all 30 workouts are `active`); it prevents
a deprecation from silently continuing to ship.

**Verification:** `cd app && npm run check`

---

### Phase 2 — Make the two orphaned categories reachable (P1)

**Goal:** `Power Maintenance` and `Field Maintenance` become selectable on both paths.

**2.1 Two new engine templates** (`templates.ts`)

```ts
{
  id: 'str_power_01', category: 'Power Maintenance', modality: 'Strength',
  durationMin: 25, durationMax: 45,
  title: 'Compact Power Maintenance',
  requiredEquipment: ['free_weights'], environment: 'either',
  safetyTags: ['avoid_heavy_lower_body'],
  systemicCost: 0.35, objectiveTransferable: false,
  stimulusProfile: { aerobicCapacity: 0, thresholdDevelopment: 0,
                     surgeRepeatability: 0.6, maxStrength: 0.5,
                     hypertrophy: 0.2, mobilityRecovery: 0.1 },
  costProfile:     { systemic: 0.35, cardiovascular: 0.2, lowerBody: 0.4,
                     upperBody: 0.5, impactTissue: 0.3, neuromuscular: 0.7 },
}
{
  id: 'field_maint_01', category: 'Field Maintenance', modality: 'Field',
  durationMin: 25, durationMax: 50,
  title: 'Controlled Field & Football Maintenance',
  requiredEquipment: [], environment: 'outdoor',
  safetyTags: ['avoid_high_impact', 'avoid_heavy_lower_body'],
  systemicCost: 0.6, objectiveTransferable: false,
  stimulusProfile: { aerobicCapacity: 0.4, thresholdDevelopment: 0.2,
                     surgeRepeatability: 0.7, maxStrength: 0.1,
                     hypertrophy: 0, mobilityRecovery: 0 },
  costProfile:     { systemic: 0.6, cardiovascular: 0.5, lowerBody: 0.7,
                     upperBody: 0.05, impactTissue: 0.8, neuromuscular: 0.8 },
}
```

Explicit profiles per D3. Note `field_maint_01` carries `impactTissue: 0.8` — the
`else`-branch default would have given `0.5` with `upperBody: 0.8`.

**2.2 Extend the `ENRICHED_TEMPLATES` fallback branches** (`templates.ts:481-513`)

Add explicit `Power Maintenance` and `Field Maintenance` branches so a future template
that omits profiles still gets sane values.

**2.3 Wire `engineTemplateIds` in the catalogue**

- `strength_compact_power_01` → `engineTemplateIds: ['str_power_01']`
  (`catalog/strength.ts:42`)
- `field_controlled_maintenance_01` → `engineTemplateIds: ['field_maint_01']`
  (`catalog/field.ts:6`)

No fallback-table entries needed — `engineTemplateIds` takes precedence.

**2.4 Add the safe category to the Path A `train` allowlist** (`rules.ts:387`)

`Power Maintenance` is allowed. `Field Maintenance` remains Path B-only because the
readiness path cannot enforce `minimumDaysAfterHardLowerBody`; this is the selected
Risk R2 mitigation.

See Risk R2 for the guard this needs.

**2.5 Credit field sessions in the microcycle** (`microcycle.ts:82`)

Add `'field'` to the `surge_repeatability` keyword set alongside `'football'`, so
`"Field Field Maintenance"` resolves an objective. Verify against
`microcycleHistory` seeding — the same matcher runs on Garmin-derived history, so
confirm no real activity type string is accidentally captured.

**Verification:** `npm run check`, plus a new `prescription.test.ts` assertion that every
value of the `SessionTemplate['category']` union has at least one template. That test
is the guard which makes §2.2 unrepeatable.

---

### Phase 3 — Reactive strength and eccentric tissue work (P2, highest evidence value)

**3.1 New `Equipment` member** — add `'plyo_box'` to `workouts/models.ts:50`.

**3.2 New exercises** (`exercises.ts`) — all `modality: 'strength'` per D2:

| id | name | impact | eccentric | coordination | equipment |
|---|---|---|---|---|---|
| `pogo_hop` | Pogo Hop | high | moderate | moderate | `bodyweight` |
| `countermovement_jump` | Countermovement Jump | high | moderate | moderate | `bodyweight` |
| `drop_jump_low` | Low Drop Jump | high | high | high | `plyo_box` |
| `nordic_hamstring_curl` | Nordic Hamstring Curl | none | high | moderate | `bodyweight` |
| `eccentric_heel_raise` | Eccentric Heel Raise | low | high | low | `bodyweight` |
| `hip_thrust` | Hip Thrust | none | moderate | low | `barbell`, `bench` |

`contraindicationTags` must reuse existing vocabulary — `worsening_achilles_pain`,
`acute_hamstring_pain`, `knee_swelling`, `painful_deep_knee_flexion` — since
`eligibility.forbiddenPainFlags` is matched against these strings.

**3.3 New workout** — `strength_reactive_power_01` in `catalog/strength.ts`,
`category: 'power_maintenance'`, `engineTemplateIds: ['str_power_01']`.
Low volume (contacts ≤ 60), full recovery, `minimumDaysAfterHardLowerBody: 1`,
`forbiddenPainFlags` covering Achilles/hamstring/knee.

Add as a second option on the existing `compact_strength` event-plan coverage key
(D8 — no new required key).

**3.4 Extend existing sessions with tissue work**

Add `nordic_hamstring_curl` and `eccentric_heel_raise` as optional accessory steps
(`optional: true`) to `strength_full_body_maintenance_01` and the Phase 1
`strength_lower_body_01`. Guard the duration warning at `validation.ts:344` — optional
steps still count toward computed duration, so re-check each variant's
`targetDurationMin`.

**Verification:** `npm run validate:workouts` will flag equipment coverage and duration
drift. Expect to adjust `targetDurationMin` upward.

---

### Phase 4 — Interval format and mobility gaps (P2)

**4.1 Variable-intensity VO₂ session** — `cycling_vo2_variable_01`, attached to
`end_hard_02` via `engineTemplateIds` with `engineTemplatePriority: 2`.

**Resolved architecture decision:** `WorkoutDefinition.engineTemplatePriority` is the
explicit deterministic tiebreaker for multiple workouts implementing one template.
`cycling_vo2_6x3_01` retains the default priority (1), while the variable and short
formats use priorities 2 and 3. This preserves the established default prescription
while making alternative executions available through event-plan coverage.

**4.2 Short-interval session** — 30/15-style, ~30 s work with short recovery.

**4.3 Breathwork exercise + `mob_02` fidelity** — add `breathwork_downregulation`
(`modality: 'mobility'`) and either a new `recovery_breathwork_01` workout with
`engineTemplateIds: ['mob_02']`, or extend `recovery_mobility_tissue_01`.

**4.4 Cable content** — add `'cable_machine'` to the workouts `Equipment` union, two
cable exercises, and a `strength_cable_upper_01` workout with
`engineTemplateIds: ['str_upper_02']`. Then drop the `str_upper_02` fallback entry.

---

## 6. Test plan

| Level | What | Where |
|---|---|---|
| Static | Type check across both `Equipment` unions and the category union | `npm run typecheck` |
| Library | Referential, duration, equipment, variant, parameter-binding validation | `npm run validate:workouts` |
| Unit | Every template resolves non-null (existing) | `prescription.test.ts:29` |
| Unit | **New** — resolved workout's modality/category agrees with the template's | `prescription.test.ts` |
| Unit | **New** — every `SessionTemplate['category']` value has ≥1 template | `prescription.test.ts` |
| Unit | **New** — a `Field` session credits a microcycle objective | `microcycle` tests |
| Integration | Path A `train` mode can select Power Maintenance; Field remains optimizer-only for spacing safety | `rules.test.ts` |
| Integration | Path B optimizer ranks the new templates non-zero | `architecture.test.ts` |
| Regression | Event-plan coverage still validates | `validate-workouts.ts` |

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Phase 1's new lower-body workout shifts computed durations and trips the ±15 min warning | Warnings don't fail the build; tune `targetDurationMin` per variant during implementation. |
| R2 | **Adding `Field Maintenance` to the Path A `train` allowlist makes an outdoor, high-impact, coordination-heavy session selectable on any green day.** `field_controlled_maintenance_01` has `minimumDaysAfterHardLowerBody: 2` at the *catalogue* level, but Path A selects the **template**, and template selection does not consult catalogue eligibility. | Ship 2.4 behind the existing `safetyTags: ['avoid_high_impact', 'avoid_heavy_lower_body']` and verify `eligibility.ts` honours them. If spacing cannot be enforced at template level, **omit `Field Maintenance` from the Path A allowlist** and leave it Path B-only, where `costProfile.impactTissue: 0.8` gives the fatigue optimizer real spacing pressure. Decide with a test, not by inspection. |
| R3 | Two workouts per template makes resolution order-dependent | Resolved with `engineTemplatePriority`; catalogue import order does not affect routing. |
| R4 | Plyometric content conflicts with the September taper | `event-plan.ts` phase restrictions already exclude `field_maintenance` from taper/race. Add the reactive workout to `compact_strength` (build/travel only), never to taper keys. |
| R5 | `microcycle.ts` keyword change over-matches Garmin activity strings | Audit real `TrainingRecord.type` values before adding `'field'`. |

## 8. Non-goals

- No change to intensity-distribution / periodization weighting (§3.4).
- No merging of the two `Equipment` unions (§2.6).
- No Garmin workout publishing, custom workout storage, or workout-library UI — these
  remain out of scope per `docs/workout-library.md` §Current scope.

## 9. Sequencing

```text
Phase 1 (P0, routing)  ──▶  Phase 2 (P1, reachability)  ──▶  Phase 3 (evidence)  ──▶  Phase 4 (formats)
   independent               depends on Phase 1 tests        independent            independent
```

Phases 3 and 4 can run in parallel once Phase 2 lands. Phase 1 alone is worth shipping
on its own — it is the only phase that fixes incorrect user-facing output.

## 10. Documentation follow-up

- Update `docs/workout-library.md` §Source of the catalogue and §File layout.
- Consider a dedicated ADR for D4 (workout-per-template vs parameter-variant) if §4.1 resolves.
  (Originally written as "ADR-0010"; that number now belongs to decision provenance.
  0010–0015 are reserved — see the ADR index in [`docs/README.md`](../README.md) — so take
  the next number after the documented reservations.)
  toward a resolver change — that is an architectural decision, not a content one.
