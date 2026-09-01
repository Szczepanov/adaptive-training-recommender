# Structured strength warm-ups

* **Status:** In progress
* **Date:** 2026-09-01
* **Blocked by:** Catalog-specific visual capture and full host-window verification
* **Unlocks:** Complete, executable warm-up prescriptions for every active catalog strength session
* **Decision boundary:** Catalog execution content changes; recommendation selection, fatigue cost,
  stimulus credit, and automatic warm-up-response coaching do not change

## Goal

Every active catalog strength workout must start with an explicit, executable warm-up that is
appropriate to the session, survives the catalog-to-session adapter, renders in the source-neutral
runner, and is logged as warm-up work rather than as training volume.

The first user-visible repair is `strength_full_body_maintenance_01` (`Primary Full-body Strength
Maintenance`), but the invariant applies to all active catalog strength workouts so the same omission
cannot recur in another recommendation.

## Current-state audit

The audit was run against `origin/main` at `245c12b7` on 2026-09-01.

* The catalog contains 46 active workouts. Thirty-three contain a `warmup` block.
* All nine active strength workouts lack a `warmup` block.
* Five strength workouts begin with `activation`; four begin directly with `main`. Activation is a
  performance/skill primer and is not a substitute for general preparation or lift-specific ramping.
* `Primary Full-body Strength Maintenance` currently resolves to `activation → main → accessory`.
  Its first executable work is four sets of hang power cleans.
* The reviewed source-neutral fixtures prove that the session schema and runner can already execute
  warm-up blocks: fixtures 01, 02, 03, and 08 contain `role: 'warmup'` blocks.
* `catalogSessionAdapter.ts` `mapBlockRole` preserves a catalog `warmup` role and
  `SessionRunner.tsx` renders every block in prescription order. The missing primary warm-up is
  therefore catalog content, not a hidden or filtered UI block.
* `RepetitionInputCard.tsx` always initializes `isWarmup` to `false`. If warm-up steps were added
  today, their performed sets would be recorded as working sets unless the athlete manually toggled
  every set. Those entries could then inflate tonnage and reach the estimated-1RM path.
* The catalog adapter carries dose, rest, RPE/RIR, notes, and technical stop conditions into
  `SessionStep`, but it has no structured catalog load field to carry a ramp-set load. The runner also
  does not render `SessionStep.load`. A load such as “empty bar”, “light rehearsal”, or “40% 1RM”
  would otherwise have to live in inert prose.
* Warm-up content is part of the immutable `WorkoutPrescription` and content-addressed
  `ExecutionPrescription`. A material edit must create a new catalog version and prescription hash;
  it must never mutate an existing snapshot.

The exact catalog gap is:

| Workout | Current blocks |
|---|---|
| `strength_full_body_maintenance_01` | activation, main, accessory |
| `strength_compact_power_01` | activation, main, accessory |
| `strength_reactive_power_01` | activation, main, accessory |
| `strength_bodyweight_full_body_01` | main, accessory |
| `strength_lower_body_01` | activation, main, accessory |
| `strength_upper_body_trunk_01` | main |
| `strength_cable_upper_01` | main |
| `travel_strength_maintenance_01` | main |
| `strength_race_week_primer_01` | activation, main |

This does **not** support the broader claim that structured sessions generally lack warm-ups.
Running, cycling quality, swimming, walking, cross-training, and field catalog sessions already use
structured warm-up blocks. Complete rest, breathwork, mobility/recovery, and an easy recovery spin
are not evidence that the strength invariant should be weakened; they are different session intents.

## Design decisions

### WU-D1 — enforce the invariant at the catalog boundary

Every active, non-manual workout with `modality: 'strength'` and training intent represented through
the catalog must contain a non-empty first block with `role: 'warmup'`.

Do not make `validateSessionDefinition` reject all warm-up-free authored definitions. The
source-neutral contract also represents rest, recovery, tests, rehabilitation, imported sessions,
and user-authored content, where a global mandatory-warm-up rule would be false. The manual builder
may offer a warning for a training-strength definition without a warm-up, but it must not silently
insert executable work.

### WU-D2 — distinguish preparation, ramping, and activation

A catalog strength warm-up may contain two layers:

1. short general or movement-pattern preparation using equipment already declared by the workout;
2. movement-specific rehearsal/ramp sets before the first loaded or high-coordination movement.

An existing `activation` block remains separate and follows the warm-up. Do not relabel med-ball
slams, power cleans, pogos, jumps, or race-week primers as the warm-up merely to satisfy validation.
Do not add a fatigue-producing PAPE protocol by default: current reviews report heterogeneous and
task-specific effects, so the product claim is readiness and movement rehearsal, not guaranteed
potentiation.

The evidence review must remain modest. General warm-ups often improve acute performance, but exact
resistance-training protocols are context-dependent and findings differ. Relevant starting sources
include the [general warm-up meta-analysis](https://pubmed.ncbi.nlm.nih.gov/19996770/), the
[specific squat/bench warm-up trial](https://pubmed.ncbi.nlm.nih.gov/32971729/), the
[resistance-training warm-up crossover trial with a null result](https://pubmed.ncbi.nlm.nih.gov/25153744/),
and the [upper-body warm-up systematic review](https://pubmed.ncbi.nlm.nih.gov/25694615/).
No catalog copy should claim that this change prevents injury.

### WU-D3 — warm-up time is part of the advertised session duration

Warm-up minutes are included inside each variant's `targetDurationMin`; they are not appended to the
current headline duration. Full, reduced, and return-to-training variants retain a short warm-up,
while reducing ramp volume and main/accessory work as needed to fit the variant.

The return-to-training variant must not preserve a high-impact or high-coordination warm-up step that
the same variant removes from the main prescription. Symptom and injury gates remain owned by the
existing engine. Warm-up content cannot bypass them.

### WU-D4 — planned warm-up role supplies the logging default

For repetition entries, a step inside a `warmup` block defaults `isWarmup` to `true`; every other
block defaults it to `false`. The athlete may correct the value while the execution remains in
progress because warm-up status is a performed historical fact, but the safe default follows the
immutable prescription.

Warm-up entries remain visible in the performed comparison and completion summary. Existing
`strengthExposure.ts`, overload-history, and one-rep-max filters continue excluding entries whose
`isWarmup` is true.

### WU-D5 — ramp loads are structured and visible

Add a bounded `WorkoutStepLoad` union to `workouts/models.ts` for catalog-authored strength steps,
covering only the load forms needed here: `bodyweight`, `unloaded`, `descriptive`,
`percent_one_rm`, and `percent_max`. Add `WorkoutStep.load?: WorkoutStepLoad` and explicitly map
each case to the existing `SessionLoad` union in `catalogSessionAdapter.ts`.

`SessionRunner.tsx` must render the resulting `SessionStep.load`. A relative percentage remains
visible when no athlete e1RM exists; no absolute kilograms are invented. If an e1RM is available,
the existing dated performance profile may supply a display/suggestion conversion, but that
conversion must not change the immutable percentage stored in the prescription.

Do not encode executable ramp loads only in `notes`, `cues`, titles, or parsed display strings.

### WU-D6 — version executable content and preserve history

Increment each edited `WorkoutDefinition.version`. A newly composed recommendation receives the
new `workoutVersion`, catalog source version, definition hash, and prescription hash.

Also increment `POLICY_VERSION` and move the outgoing value to
`HISTORICAL_POLICY_VERSIONS`: the exact prescription and `primarySession` binding are persisted
decision fields, and this change can alter both. Extend `check-policy-drift.mjs` so production
catalog workout files and the catalog-to-session adapter cannot change executable recommendation
content without an explicit policy-version decision.

Do not migrate or overwrite historical prescriptions. `sessionDefinitionResolver.ts`
`resolveSessionDefinition` reconstructs prescriptions carrying `displayMetadata` entirely from the
stored snapshot, so old completed and in-progress executions remain on the content they started
with. Add a regression test for that rollout guarantee.

## Work items

### WU0 `[x]` Register the evidence and the catalog invariant

**Files:** new `app/src/knowledge/strengthWarmupKnowledge.ts`,
`app/src/knowledge/sportsKnowledgeRegistry.ts`, `app/src/knowledge/knowledgeCoverage.ts`, relevant
knowledge-registry tests.

Add narrow claims for:

* active preparation can support acute performance/readiness;
* movement-specific rehearsal/ramping is a reasonable strength-session implementation pattern;
* exact dose and performance response are context-dependent;
* no injury-prevention claim is made by this catalog rule.

Record population, outcome, applicability, certainty, direction, and review date under ADR-0033.
The catalog invariant should reference the active claim IDs through an auditable catalog metadata or
validation mapping; do not put literature citations in free-text workout notes and call that lineage.

**Done when:** the canonical knowledge registry validates, the new claims are covered in
`knowledgeCoverage.ts`, and the approved wording is sufficient to author WU2 without inventing a
universal warm-up percentage ladder.

### WU1 `[x]` Carry structured warm-up loads through the execution boundary

**Depends on:** WU0 for allowed claim scope.

**Files:** `app/src/workouts/models.ts`, `app/src/workouts/validation.ts`,
`app/src/workouts/prescription.ts`, `app/src/sessions/catalogSessionAdapter.ts`,
`app/src/components/session/SessionRunner.tsx`, and their tests.

Implement WU-D5. Validate finite ranges/percentages and reject unsupported load shapes. Render each
load kind in the runner. Keep the adapter a field mapper; it must not infer load from a step name,
rep count, notes, or athlete history.

**Done when:** a catalog ramp step round-trips through `resolveWorkoutPrescription` →
`adaptCatalogPrescriptionToSessionDefinition` → `createExecutionPrescriptionFromCatalog`, changes
the prescription hash when its load changes, validates, and displays its load in the runner.

### WU2 `[x]` Repair `Primary Full-body Strength Maintenance`

**Depends on:** WU0 and WU1.

**Files:** `app/src/workouts/catalog/strength.ts`, `app/src/workouts/prescription.test.ts`,
`app/src/sessions/catalogSessionAdapter.test.ts`, runner tests, and visual-review fixtures.

Add a first `warmup` block before `Power activation`. It must contain a brief low-fatigue movement
preparation plus explicit rehearsal/ramp work for the first high-coordination/loaded movements,
using only equipment already declared by the workout. Keep the current power-clean activation as a
separate block.

Rebalance the three variants so their declared durations include the warm-up. The
return-to-training variant may omit clean-specific ramping when it omits the power clean, but it must
retain suitable preparation for the movements that remain. Increment the workout version.

**Done when:** starting today's `str_full_01` recommendation lands first on an unmistakably labelled
warm-up step; all planned warm-up repetitions default to `isWarmup: true`; the activation, main, and
accessory blocks follow in order; and full/reduced/return-to-training outputs fit their stated time
budgets.

### WU3 `[x]` Apply the invariant to the remaining strength catalog

**Depends on:** WU2 establishes the reviewed pattern and UI behavior.

**Files:** `app/src/workouts/catalog/strength.ts`,
`app/src/workouts/catalog/strength-lower.ts`, `app/src/workouts/catalog/support-strength.ts`,
`app/src/workouts/catalog/travel.ts`, and `app/src/workouts/catalog/taper-race.ts`.

Author session-specific warm-ups for the other eight active strength workouts:

* compact/power work: short general preparation followed by low-fatigue movement rehearsal;
* reactive/plyometric work: low-impact tissue and landing preparation before contacts;
* bodyweight/travel work: equipment-free pattern rehearsal, without inventing bands or machines;
* lower-body/Olympic work: general preparation plus lift-specific ramping;
* upper-body/cable work: shoulder/scapular preparation plus press/pull rehearsal using available
  equipment;
* race-week primer: the shortest effective preparation, with no extra fatigue-producing volume.

Apply WU-D3 to every variant and increment each edited workout version.

**Done when:** every active catalog strength workout satisfies the invariant and no warm-up adds
undeclared equipment, contradicts a return-to-training omission, or pushes a variant beyond its
advertised time.

### WU4 `[x]` Make warm-up logging safe by default

**Depends on:** WU2.

**Files:** `app/src/components/session/inputs/RepetitionInputCard.tsx`,
`app/src/components/session/SessionRunner.tsx`, `app/src/hooks/useSessionRunner.ts` only if the role
must be passed through the hook, plus `RepetitionInputCard` and runner tests.

Add an explicit prescribed default prop derived from `activeBlock.role === 'warmup'`. Reset the
control when the active step changes, preserve the value across consecutive sets of that step, and
retain in-progress correction behavior. Do not infer warm-up status later from step IDs or titles.

**Done when:** warm-up-block repetition entries persist `isWarmup: true` without an extra tap,
main/activation/accessory entries persist `false`, a user correction round-trips, and warm-up sets
remain excluded from overload/e1RM derivation.

### WU5 `[~]` Add enforcement, versioning, rollout, and visual coverage

**Depends on:** WU1–WU4.

**Files:** `app/src/workouts/validation.ts`, `app/scripts/validate-workouts.ts`,
`app/scripts/check-policy-drift.mjs`, `app/src/engine/policy.ts`, catalog/session/runner tests,
visual-review fixtures, `docs/workout-library.md`, and `docs/architecture/session-execution.md`.

Add a catalog validation error for an active strength workout whose first block is not a non-empty
warm-up. Add a catalog-wide test that enumerates the exact invariant instead of testing only the
primary workout. Bump policy/catalog versions as specified in WU-D6 and prove both replay paths:

* a new recommendation binds the new warm-up prescription;
* a stored old prescription with `displayMetadata` still restores its original block bytes after
  the live catalog version changes.

Capture desktop and 390 px mobile visual coverage showing the warm-up block, ramp-load copy,
warm-up logging default, transition into activation/main, and completion summary.

**Done when:** `npm run validate:workouts`, `npm run check`, `npm run build`,
`npm run simulate:scenarios`, `npm run simulate:diff`, and
`node scripts/check-policy-drift.mjs <base-sha>` pass; any simulation change is reviewed rather than
silently accepting a new baseline; and the living docs describe the shipped behavior.

**Implementation note (2026-09-01):** catalog validation, policy/catalog versioning, immutable
execution hashing, knowledge lineage, targeted adapter/runner tests, workout validation, and living
documentation are complete. `npm run simulate:scenarios` completed and the committed baseline was
left unchanged after review of broad pre-existing engine-level drift. The full visual refresh was
started but did not finish within the local command window; capture of the new catalog-specific
warm-up state remains the only open verification item.

## Tests to add

| Surface | Required assertion |
|---|---|
| Catalog invariant | Every active strength workout begins with a non-empty `warmup` block |
| Catalog equipment | Every warm-up exercise is compatible with the workout's declared equipment |
| Variant semantics | Full, reduced, and return-to-training retain an appropriate warm-up inside the target duration |
| Primary prescription | `str_full_01` resolves warm-up before activation/main/accessory |
| Adapter | Warm-up role, dose, rest, and structured load survive catalog adaptation |
| Hashing | Changing a ramp dose/load changes the definition and execution-prescription hashes |
| Runner default | Repetition entries in warm-up blocks default true; all other blocks default false |
| Correction | In-progress warm-up status can be corrected; terminal entries cannot be rewritten |
| Derived strength data | Warm-up entries do not affect tonnage, overload summaries, or e1RM derivation |
| Replay | Historical prescriptions restore from stored metadata after a catalog version bump |
| Visual | Primary warm-up is usable at desktop and 390 px mobile widths |

## Acceptance criteria

- [x] Starting `Primary Full-body Strength Maintenance` opens on warm-up work rather than hang power-clean working sets.
- [x] All nine active catalog strength workouts have explicit, session-specific warm-up blocks.
- [x] Activation remains distinct from warm-up.
- [x] Ramp loads are structured and visible; no executable load is recovered from prose.
- [x] Planned warm-up repetitions default to `isWarmup: true`.
- [x] Warm-up work remains excluded from working-set tonnage and e1RM estimation by existing downstream filters.
- [x] Catalog and policy versions identify the new executable content.
- [x] Catalog validation prevents regression.
- [~] The full check/build and visual refresh need a host window longer than the available command limit; targeted validation and tests pass, and simulations were reviewed without changing the baseline.

## Risks and rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Warm-up silently lengthens sessions | WU-D3 plus per-variant duration tests | Revert the new catalog versions and policy version; old snapshots remain valid |
| Warm-up sets inflate training load/e1RM | Role-derived default plus existing downstream exclusion tests | Disable new catalog recommendations while leaving stored executions readable |
| Generic warm-up conflicts with injury state | Existing hard gates remain authoritative; return variants remove incompatible steps | Revert the affected workout version; do not add a second injury evaluator in the runner |
| Exact ramp percentages overstate evidence | Register bounded claims, use relative/descriptive loads, and avoid universal percentage ladders | Replace the affected new version with a reviewed revision; never rewrite a stored prescription |
| Extra equipment makes a workout unreachable | Catalog equipment compatibility test | Replace the warm-up exercise with an already-compatible alternative |
| Mid-session deployment changes an active workout | Content-addressed snapshot restoration test | No data rollback is needed; active sessions continue on their stored hash |

## Out of scope

* Automatic selection changes based on how warm-up sets feel. Existing authored choices may prompt
  the athlete, but no new sensorless coaching inference is added.
* New fatigue, stimulus, weekly-credit, or injury-policy calculations from warm-up data.
* A global requirement that every manual/imported/recovery/test session contain a warm-up.
* Personalized warm-up generation from diagnoses, pain narratives, or inferred mobility deficits.
* Cool-down standardization; it should be audited separately and should not delay this repair.
* Rewriting historical catalog prescriptions or completed executions.

## Documentation to update when implemented

* `docs/workout-library.md`: strength warm-up invariant, structured ramp loads, duration semantics,
  and versioning.
* `docs/architecture/session-execution.md`: prescribed warm-up logging default and historical
  snapshot behavior.
* ADR-0004 and ADR-0023 remain the governing accepted decisions; amend them only if implementation
  changes their decisions rather than merely filling the catalog/content gap.

## Task board

| Item | Status | Depends on | Result |
|---|---|---|---|
| WU0 Evidence and invariant | `[x]` | — | Complete |
| WU1 Structured load path | `[x]` | WU0 | Complete |
| WU2 Primary full-body repair | `[x]` | WU0, WU1 | Complete |
| WU3 Remaining strength catalog | `[x]` | WU2 | Complete |
| WU4 Safe logging default | `[x]` | WU2 | Complete |
| WU5 Enforcement and rollout | `[~]` | WU1–WU4 | Partial — visual coverage capture outstanding |
