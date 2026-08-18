# Authored composite session import and execution analysis (2026-08-18)

**Question asked.** How should the product change so workouts like the supplied Olympic
power, strength, tendon, trunk, recovery-bike and field sessions can be imported or built
manually, then followed and recorded during the workout?

**Verdict.** This is not an exercise-form problem and it is not solved by adding more
free-text fields to the current external-plan schema. The app needs one source-neutral,
revisioned **session definition** that sits between authoring and execution. Catalog
workouts, imported plans and manually built sessions should all normalize to that contract.
The engine should adjudicate a placed definition as it does today; only the adjudicated
variant becomes an executable snapshot; the runner should record performed work against
stable step identities.

The current system has three individually useful but disconnected representations:

* `ExternalPrescriptionStep` can display imported prose-like steps, but loses most of the
  supplied workout semantics and is not persisted with `DailyRecommendation`;
* `WorkoutPrescription` is structured enough to seed a catalog strength session, but is a
  curated-catalog output rather than a user-authored storage contract;
* `StrengthSession` is a durable raw log, but `LoggedSet` can record only repetitions and
  kilograms, not time, distance, per-side work, circuits, alternatives or the planned step
  it fulfilled.

An imported session therefore cannot seed the existing runner at all, and a manually
started session can record only a lossy subset. The first useful release is not an in-app
LLM parser. It is the normalized contract, full-content review, manual builder, persisted
execution snapshot, and a mixed-dose runner. Assisted prose parsing can safely follow once
there is a deterministic draft and confirmation boundary.

---

## 1. Scope and evidence

The examples reviewed include:

* full-body strength/power maintenance with tempo, rest ranges and a hard volume ceiling;
* upper-body absorption work with alternating sets, a superset, optional exercises and a
  separate recovery ride;
* return-to-training sessions with a morning tissue gate and yellow variants;
* lower/Olympic work with ramp sets, load relationships, technical stop rules, exercise
  choices and symptom-based omissions;
* field work with distance doses, progressive intensities, full recovery and planned cuts;
* recovery protocols, success criteria, fueling notes and prohibited additions.

The repository evidence was:

* `engine/models.ts` external-plan, recommendation and strength-session contracts;
* `engine/validation.ts` `validateExternalStep` and the external-plan validation boundary;
* `externalSessionProfiles.ts`, `externalSession.ts` and the current adjudication path;
* `workouts/models.ts`, `workouts/exercises.ts`, `strengthSessionEntry.ts` and
  `strengthExposure.ts`;
* `recommendationService.ts`, `useStrengthSessionRunner.ts`, `ExternalPlanImport`,
  `ExternalPlanWeek` and `Home`;
* the current architecture reference, ADR-0019 and ADR-0021;
* direct browser inspection of `ExternalPlanImport` using a representative four-exercise
  strength session in the visual-review harness. The temporary harness change was reverted.

This is a dated design analysis, not approval to change recommendation policy. In
particular, ADR-0021 D-STRCOST still applies: richer performed strength data must not start
affecting fatigue or stimulus merely because it becomes available.

---

## 2. What the examples actually require

The samples use a small, recurring grammar. Preserving that grammar is more useful than
preserving the original paragraphs verbatim.

| Concept | Examples | Product implication |
|---|---|---|
| Session intent | “activated rather than trained down”, preserve field readiness | Session summary and success criteria, visible but not treated as calibrated engine input |
| Global limits | total RPE, hardest-set cap, no grinding/failure/additional sets | Structured session targets and prohibitions |
| Blocks | warm-up, Olympic power, lower strength, tissue, core, cooldown | Stable block identity and progress |
| Execution grouping | two rounds, alternating sets, superset, sequential work | `sequential`, `circuit`, `alternating` and `superset` group modes |
| Mixed dose | reps, seconds, metres, minutes, per-side work | A dose union; not a mandatory reps-and-kilograms row |
| Dose ranges | 5–6 reps, 15–20 seconds, 45–60 seconds rest | Bounds, not a string that the runner must parse |
| Load semantics | kilograms, bodyweight, band, %1RM, % technical max, relative to today's clean | A load-target union, including a reference to another step |
| Effort and quality | RPE range/cap, RIR, “every rep crisp”, bar-speed stop | Effort target plus an independent quality/termination target |
| Tempo | `3-1-X-1`, `ISO`, continuous | Structured tempo when known, display text as fallback |
| Laterality | per side, alternating stopping leg | Bilateral/per-side/alternating semantics and optional side-specific performed values |
| Choice | back squat vs box squat vs goblet squat | A choice group with conditions and a selected variant |
| Conditional action | reduce load, reduce sets, omit RDL, pulls only, end block | Bounded actions, never arbitrary executable prose |
| Optionality | optional pull-ups, optional push jerks, optional recovery spin | Optional step or separate companion session depending on timing/recording |
| Negative constraint | no Nordics, no extra lower work, no Zone 2 conversion | Explicit “do not add” guidance; not a hidden absent exercise |
| Outcome | next-day soreness target, finish better than started | Completion reflection and later outcome prompt, separate from set logging |

Three distinct kinds of condition appear and should not be conflated:

1. **Engine-observable.** Time, equipment, environment, standing injury constraints and
   canonical daily tissue responses. These may select or rule out a variant, with the
   existing safety precedence.
2. **Athlete-observable during execution.** A warm-up feels heavy, a catch crashes, bar
   speed drops, a joint sensation rises. The runner can prompt the athlete and apply a
   bounded action, but the app cannot infer the observation without a sensor.
3. **Narrative context.** “Tomorrow is protected cycling quality” or “no 6v6 this week.”
   This explains the authored choice but is not an executable expression.

The import review must identify which category each rule entered. Treating all three as
notes loses useful behavior; treating all three as code creates a second, unaudited rules
engine.

---

## 3. Current-state fit and blocking gaps

### G1 — an imported prescription is display-only and not durable with the recommendation

`Recommendation.externalPrescription` exists in memory for the current imported decision.
`recommendationService.ts` `saveRecommendationInternal` persists
`Recommendation.prescription`, but not `externalPrescription`; `DailyRecommendation` has no
external definition or source reference. `useStrengthSessionRunner` later reads only
`DailyRecommendation.prescription` and passes it to
`strengthSessionEntry.ts` `extractPlannedStrengthExercises`.

Consequently an imported Strength recommendation cannot seed the runner, even when its
steps were structured enough to display on `Home`. Reload and historical execution have no
durable prescription to retrieve. This is the primary architectural blocker.

### G2 — external plan v1 is too lossy for these sessions

`ExternalPrescriptionStep` supports a name, one exact duration, exact sets/repeats, exact
recovery fields and free-text target/notes. It has no stable exercise identity, blocks,
rep or rest ranges, laterality, load semantics, tempo, circuits, alternatives, conditions,
cues, stop actions or companion sessions. `validateExternalStep` correctly rejects unknown
fields, so a generated workout cannot add these semantics even voluntarily.

Encoding `RPE 5–6; tempo 3-1-X-1; per side; reduce if heavy` into `target` would make the
screen look detailed while leaving every downstream consumer blind. The runner would have
to parse display text, which should remain forbidden.

### G3 — the confirmation screen does not confirm the workout

In the browser review, a representative session containing cleans, squats, RDLs and soleus
isometrics validated successfully. The preview showed only:

```text
2026-08-17  Full-body strength/power maintenance
strength · moderate · 45–55 min · key
```

None of the steps, sets, rest, targets or reduced form was visible before **Import this
plan**. There is no unresolved-exercise state because exercise resolution does not happen.
This preview is adequate for calendar placement, not for safely accepting an executable
workout.

### G4 — the performed log assumes bilateral repetitions with optional kilograms

`LoggedSet` requires `reps` and stores `weightKg`. It cannot faithfully record:

* a 30-second soleus isometric or Copenhagen plank;
* a 20-metre sled drag or 15-metre acceleration;
* a per-side split squat, dead bug or planned cut;
* a band/bodyweight/descriptive load without pretending blank kilograms carries the full
  meaning;
* a circuit round or completion-only recovery protocol;
* which planned step, alternative or variant the work fulfilled.

Free-text exercises prevent rejection, which is the correct safety valve, but they do not
solve traceability or dose shape.

### G5 — strength safety and cost inference are session-coarse

`externalSessionProfiles.ts` `inferredSafetyTags` gives every moderate-or-harder imported
strength session all three of `avoid_heavy_lower_body`, `avoid_overhead_pressing` and
`avoid_heavy_spinal_loading`. This fails safely, but it can exclude an upper-body-only
absorption day as though it contained heavy squats and overhead work. Cost and stimulus
are similarly derived from modality × intensity × duration, not actual exercises.

The supplied sessions make that coarseness visible: “upper body, minimal leg fatigue” and
“meaningful lower/Olympic day” cannot share the same structural profile merely because
both say `strength` and `moderate`.

### G6 — manual authoring is logging-first, not planning-first

The current manual path starts a `StrengthSession`, then adds catalog or free-text
exercises while training. There is no pre-workout builder for blocks, targets or variants,
and no distinction among:

* save a reusable workout without scheduling it;
* schedule it on a date for adjudication;
* replace today's generated recommendation;
* start unplanned work and record history only.

Those actions have different engine authority and must not be one ambiguous “Add workout”
button.

### G7 — mixed and later sessions have no identity boundary

An easy bike embedded as the first ten minutes of a gym warm-up belongs to the main
session. An “optional recovery spin later” does not: it may happen hours later and Garmin
may record it as its own cycling activity. Combining both into one strength log creates
ambiguous duration, adherence and Garmin reconciliation.

### G8 — the exercise registry only partially covers the samples

The catalog already knows many relevant movements, including hang power cleans, RDLs,
bench press, pull-ups, Copenhagen planks, soleus isometrics, tibialis raises, Nordics,
dead bugs and several field drills. Common sample movements are absent, including back and
box squats, chest-supported rows, muscle cleans, clean pulls, push jerks, overhead presses,
face pulls, band/scapular preparation, Spanish-squat isometrics, FFE split squats, sled
drags, lateral shuffles and several recovery movements.

A comprehensive static catalog is not realistic. The product needs aliases and
user-confirmed custom exercises, while keeping unknown metadata out of safety and cost
claims.

---

## 4. Target architecture

### 4.1 One normalized session definition; three authoring sources

Introduce a strict, source-neutral versioned contract—called `SessionDefinition` below.
It is neither a performed log nor a curated `WorkoutDefinition` and should not be inserted
into the static workout catalog.

```text
catalog WorkoutPrescription ─┐
manual builder ───────────────┼─> SessionDefinition draft
external plan v2 / parser ────┘          │
                                         ▼
                              resolve + athlete review
                                         │
                                         ▼
                         immutable revision + content hash
                                         │
                         placed SessionOccurrence
                                         │
                                         ▼
              existing safety / feasibility / readiness adjudication
                                         │
                                         ▼
                     adjudicated ExecutionPrescription snapshot
                                         │
                                         ▼
                         SessionExecution / performed log
                                         │
                                         ▼
                       completion reconciliation and history
```

The source identity should remain explicit:

```ts
type SessionDefinitionSource =
  | { kind: 'catalog'; workoutId: string; catalogVersion: string }
  | { kind: 'external_plan'; planId: string; revision: number; sessionId: string; contentHash: string }
  | { kind: 'manual'; definitionId: string; revision: number; contentHash: string };
```

ADR-0019 D-SHIM says its synthetic `ext:` template compromise should be revisited when a
second non-catalog consumer appears. Manual definitions and the execution runner are that
second consumer. A successor ADR should replace the shim at this boundary with an honest
union/source reference. The decision is not “external sessions bypass the engine”; it is
“several sources can supply the already-selected session that the same engine
adjudicates.”

### 4.2 Separate definition, occurrence, execution and exposure

These four records have different lifecycles:

| Record | Owns | Mutability |
|---|---|---|
| `SessionDefinition` | authored blocks, steps, variants and rules | immutable revisions |
| `SessionOccurrence` | scheduled Warsaw-local date, placement state, source revision | mutable placement overlay; source hash fixed |
| `ExecutionPrescription` | exact adjudicated variant and step targets shown at start | immutable snapshot after start |
| `SessionExecution` | athlete's performed sets/segments, observations and outcome | append/correct with an audit-safe write model; terminal state explicit |

This preserves ADR-0019 D-IMMUT and ADR-0021's raw-log ownership. A later edit creates a
new definition revision; it cannot rewrite yesterday's execution.

### 4.3 Proposed definition vocabulary

The exact TypeScript names need an ADR/schema design pass, but the semantic boundary should
look like this:

```ts
interface SessionDefinitionV2 {
  schema: 'adaptive-training-recommender/session-definition@2';
  id: string;
  revision: number;
  title: string;
  summary?: string;
  modalities: SessionModality[];
  dominantModality: SessionModality;
  duration: Range<number>;                 // minutes
  sessionTargets?: SessionTarget[];        // global RPE, no grinding, success criteria
  prohibitedAdditions?: string[];          // display guidance, never negative catalog inference
  blocks: SessionBlock[];
  variants?: SessionVariant[];
  companionSessions?: CompanionSessionRef[];
}

interface SessionBlock {
  id: string;
  title: string;
  role: 'warmup' | 'activation' | 'main' | 'accessory' | 'cooldown' | 'recovery';
  executionMode: 'sequential' | 'circuit' | 'alternating' | 'superset';
  rounds?: Range<number>;
  steps: SessionStep[];
}

interface ExerciseStep {
  kind: 'exercise';
  id: string;
  exerciseRef: ExerciseReference;
  dose: RepetitionDose | DurationDose | DistanceDose | CompletionDose;
  laterality?: 'bilateral' | 'per_side' | 'alternating';
  load?: AbsoluteLoad | PercentOneRm | PercentTechnicalMax | RelativeStepLoad |
         BodyweightLoad | BandLoad | DescriptiveLoad;
  effort?: RpeTarget | RirTarget;
  quality?: TechnicalQualityTarget | VelocityLossTarget;
  rest?: Range<number>;                    // seconds
  tempo?: StructuredTempo | { display: string };
  cues?: string[];
  optional?: boolean;
  loggingMode?: 'set_by_set' | 'round_checkoff' | 'completion_only';
}
```

`Range<T>` should allow exact values by using equal bounds. Display text remains available
for unfamiliar concepts, but no consumer should parse it back into behavior.

### 4.4 Choices and conditions must use bounded actions

A condition is data, not JavaScript and not a miniature natural-language engine. Its
actions should be limited to:

* `select_alternative`;
* `reduce_load_percent`;
* `reduce_sets` or `reduce_reps`;
* `omit_step`;
* `end_block`;
* `end_session`.

Its signal should be either a canonical app value or an explicit athlete observation.
Examples:

```text
Canonical tissue response: knee discomfort > 2/10
  → select goblet-squat-to-box alternative

Athlete observation: clean catch crashes
  → reduce load and require confirmation before next set

Athlete observation: bar speed drops
  → end Olympic block
```

No imported condition may loosen a standing injury constraint or readiness ceiling. If an
author says “proceed normally when knee is 10/10,” the app still applies every higher
authority. Unknown conditions become visible notes that require resolution during import;
they do not execute silently.

### 4.5 Exercise resolution and custom exercises

Every imported exercise should pass through a resolution state:

* **matched** to a catalog `exerciseId`, possibly through a reviewed alias;
* **custom confirmed**, with user-owned metadata sufficient for display and input shape;
* **unresolved**, loggable by name but not allowed to assert safety, cost, muscle split or
  estimated-1RM semantics.

A minimal custom-exercise record needs display name, modality, dose types, load modes,
equipment and laterality. Mechanical pattern, primary regions and safety tags should be
optional but clearly labelled as user-confirmed. Unknown should fail closed for engine
eligibility while remaining loggable; blocking all logging would recreate the free-text
problem in a different place.

---

## 5. UX redesign

### 5.1 Entry points should describe intent

From Today and the plan/calendar, offer **Add a workout** with three authoring choices:

1. **Paste workout text** — assisted conversion to a draft, when the parser service exists;
2. **Build manually** — deterministic form using the same definition contract;
3. **Import structured JSON** — advanced/replayable path and multi-week plan support.

After authoring, require one explicit destination:

* **Save only** — reusable definition, no engine effect;
* **Schedule** — create an occurrence on a chosen Warsaw-local date and adjudicate it;
* **Replace today's recommendation** — explicit athlete-authored selection, audited;
* **Start unplanned** — record performed work without pretending it was recommended.

“Add after today's session” should be a separate additional-session action with a stacking
warning/critique. It must not hide inside Replace or Start.

### 5.2 Manual builder

The default builder should be block-first and mobile-friendly:

* session title, purpose, duration and overall effort;
* add/reorder blocks from Warm-up, Main, Accessory, Cooldown or Recovery;
* add an exercise through search, recent exercises or custom creation;
* choose dose shape first, then show only relevant fields;
* optional advanced row for tempo, rest, cues, quality rule and alternative;
* duplicate exercise/block and save as a reusable template;
* preview the exact runner experience before saving.

It should not expose the entire schema at once. A bench-press row needs sets, reps, load
target, effort and rest. A plank needs sets, time and side. A recovery bike needs time,
power/HR/cadence targets and no weight field.

### 5.3 Paste/import review

The existing `ExternalPlanImport` calendar summary should become the first level of a
two-level review. Expanding a session must show:

* session intent and global caps;
* blocks in execution order;
* each exercise's resolved identity and mapping confidence;
* structured dose, load, effort, rest, tempo and laterality;
* alternatives and the exact signal/action pair for each condition;
* optional and companion sessions;
* fields that were retained only as narrative;
* warnings for stale readiness context, private health narrative or unsupported semantics.

Import should be disabled until all blocking mappings and conditions are resolved. A
side-by-side “source text → structured interpretation” view is worth the space for the
first confirmation because silently changing `per side`, `optional`, or `no additional
sets` changes the workout materially.

### 5.4 Assisted prose parsing

ADR-0019 D-NOPARSE remains sound. Free-text parsing needs a server-side model call and is
non-deterministic, so it must be an authoring convenience before the persistence boundary:

```text
paste prose → model structured output → deterministic validation → resolution warnings
            → athlete edits/confirms → persist exact normalized bytes + hash
```

The model must never write a plan or recommendation directly. Persist parser version,
source type and optional original text separately from the executable definition. Replay
uses the confirmed normalized artifact, never a new parse.

The supplied daily plans include transient HRV, RHR, pain and soreness statements. The
parser should flag these as stale daily context and omit them from the reusable definition
unless the athlete explicitly keeps a privacy-safe narrative note. Canonical morning gates
should be rebuilt from the app's current check-in/readiness state, not imported as frozen
health facts.

### 5.5 In-session runner

The runner should become a general session runner with a strength-optimized input mode,
not a separate bespoke screen for every modality. The mobile hierarchy should be:

1. sticky session/block progress and elapsed time;
2. current exercise with the planned dose, cues and active stop rule;
3. one-hand performed input specialized to reps, time, distance or check-off;
4. previous performed set and planned next set;
5. rest timer using the authored range;
6. large **Complete set/segment** action;
7. secondary edit/undo/substitute/omit actions;
8. upcoming work collapsed below.

When a condition is reached, show an actionable card—for example **Catch crashing? Reduce
10%**—and record the athlete's confirmation plus the resulting variant/action. Never ask
the athlete to reinterpret the original paragraph mid-set.

Session completion should summarize planned versus performed work, substitutions,
omissions, session RPE and notes. Success criteria such as “finish activated” belong in a
quick completion reflection; next-day soreness belongs in the next check-in, linked to the
occurrence rather than guessed at finish.

The five P1 findings in the companion Strength UI/UX review—resume visibility, safe
terminal actions, correction, responsive layout and prescription context—are prerequisites
for this richer runner. Adding more fields to the current interaction would amplify those
problems.

---

## 6. Performed-data contract

Do not force every completed step into `LoggedSet`. Preserve the simple reps/kilograms path
while widening the performed dose and source linkage:

```ts
type PerformedDose =
  | { kind: 'repetitions'; reps: number }
  | { kind: 'duration'; seconds: number }
  | { kind: 'distance'; metres: number }
  | { kind: 'completion'; completed: boolean };

type PerformedLoad =
  | { kind: 'kilograms'; kg: number }
  | { kind: 'bodyweight' }
  | { kind: 'band'; label?: string }
  | { kind: 'descriptive'; value: string };

interface PerformedSetOrSegment {
  id: string;
  plannedStepId?: string;
  selectedAlternativeId?: string;
  setIndex?: number;
  side?: 'left' | 'right' | 'bilateral' | 'alternating';
  dose: PerformedDose;
  load?: PerformedLoad;
  gauge?: IntensityGauge;
  isWarmup: boolean;
  completedAt: string;
  notes?: string;
}
```

Use a schema-version-2 reader/migration boundary; do not rewrite existing v1 strength
documents in place. Old `LoggedSet` rows map naturally to a repetitions dose and kilograms
load. Corrections need stable performed-row IDs rather than using `setIndex` as identity.

`SessionExecution` should carry `sourceOccurrenceId`, `sourceDefinitionHash` and the exact
`ExecutionPrescription` snapshot. `sourceRecommendationDate` alone is insufficient once a
day can contain a generated recommendation, a manually scheduled workout and an optional
companion ride.

### Mixed-session reconciliation

An embedded bike warm-up is a segment of the strength occurrence and should not become a
second completed exposure merely because Garmin also records part of it. A later optional
recovery spin is a separate companion occurrence, with its own start/completion and Garmin
match. Field work is likewise distance/segment based but can use the same execution model.

The occurrence key must prevent a manual log and a Garmin activity representing the same
physical work from being counted twice. Planned values never become completed load merely
because they existed; completed exposure is derived from performed or reconciled evidence.

---

## 7. Engine authority and policy boundaries

The source-neutral definition does not change the authority order in the current
architecture:

```text
clinical and structured injury constraints
  → feasibility (time, equipment, environment, guardrails)
  → readiness ceiling
  → authored variant / bounded scaling
  → athlete executes or declines
```

The author owns purpose, exercise selection, useful variants and which work is optional.
The engine owns whether the session is permissible now and may only tighten the dose. The
runner owns observations and records what actually happened.

Specific changes required:

* derive required equipment and safety tags from resolved required steps;
* do not let an optional step block the whole session;
* gate only the selected alternative, while proving every offered alternative before it is
  shown as executable;
* prefer authored structural variants—such as “2 × 3 squat and omit RDL”—over multiplying
  the whole session duration;
* keep unknown exercises conservative: they can be displayed/logged, but cannot claim a
  precise cost, stimulus or safety clearance;
* keep cost/stimulus derivation behind a default-off selector until real-history evidence,
  policy-version change, replay and simulation gates approve it.

The current `ExternalSessionScaling.reducedSummary` can explain a reduced form but cannot
execute it. A structured variant is necessary if the product is going to tell the athlete
exactly what to do. Free-text fallback remains advisory under ADR-0019 D-CANDIDATE.

---

## 8. Recommended delivery sequence

### P0 — agree the contract and authority boundary

1. Write a successor ADR covering the source-neutral definition, replacement of the
   synthetic-template shim, definition/occurrence/execution separation and manual-session
   authority.
2. Define session-definition v2 and performed-execution v2 validators plus immutable
   hashing/revision rules.
3. Decide the user-scoped Firestore paths and security rules before emitting athlete data.

Exit criterion: the four supplied session families can be represented without parsing any
behavior back from strings.

### P1 — make authored strength sessions executable

1. Fix the current runner's P1 interaction defects from the companion review.
2. Persist a source reference and exact adjudicated execution snapshot with the daily
   decision/occurrence.
3. Add planned-step identity and reps/time/distance/completion performed doses.
4. Build a manual one-off session builder and schedule/start intent choices.
5. Add exercise aliases, custom-exercise resolution and the missing common strength
   movements.

Exit criterion: the Monday full-body and lower/Olympic examples can be built manually,
scheduled, adjudicated, resumed, executed, corrected and completed without free-text dose
loss.

### P2 — external v2 import with full review

1. Extend JSON import to the same normalized blocks, steps, variants and conditions.
2. Add full-content preview, source-to-interpretation review and mapping resolution.
3. Persist immutable v2 revisions and hashes; retain v1 read compatibility.
4. Add companion-session handling and mixed-session reconciliation.

Exit criterion: importing one of the supplied examples produces the same execution screen
as manually building it, and no unresolved behavior is hidden behind a successful import.

### P3 — assisted prose import

1. Add a server-side structured-output parser into the draft boundary.
2. Measure mapping corrections, unsupported-rule rate and time-to-confirm.
3. Keep JSON and manual authoring as fallbacks; never make the parser the only entry path.

Exit criterion: the athlete can paste the supplied prose, resolve a small explicit warning
set, and obtain a deterministic artifact that reopens identically without re-parsing.

### P4 — evidence-backed engine enrichment

After enough performed history exists, compare exercise-derived safety/cost/stimulus
profiles against the current coarse fallback. Only an approved measured candidate should
change recommendation behavior, with `POLICY_VERSION`, replay and simulation evidence.

---

## 9. Acceptance scenarios

The implementation is not complete until these end-to-end scenarios pass:

1. **Tempo strength maintenance.** Import/build cleans, squats, RDL, bench, row, pull-ups,
   isometrics and dead bugs with rest/tempo/RPE ranges; execute and edit a mistaken set.
2. **Warm-up-heavy downgrade.** During squat warm-up, choose “feels heavy”; the runner
   changes squat to 2 × 3, omits RDL, shows the decision and records the variant.
3. **Olympic stop rule.** Log a crashing catch; reduce the next load. Log a bar-speed drop;
   end only the Olympic block and preserve later safe work.
4. **Symptom-based exercise choice.** Resolve back squat, box squat or goblet-to-box from
   the canonical knee state, never bypassing a stricter injury constraint.
5. **Per-side and timed work.** Record Copenhagen planks, soleus isometrics and dead bugs
   without fake reps or kilograms, including left/right completion.
6. **Field session.** Record accelerations, decelerations, lateral shuffles, planned cuts
   and ball work with distance/time doses and controlled intensity.
7. **Optional later spin.** Complete the strength workout, then start or skip the distinct
   recovery-spin companion. A matched Garmin ride is counted once.
8. **Upper-body safety.** An upper-only strength day is not blocked by inferred heavy
   lower-body work; an unknown custom exercise does not silently gain safety clearance.
9. **Reload/replay.** Kill and reopen mid-session; planned targets, selected alternatives,
   performed rows and pending/synced state return. Historical execution resolves the exact
   source hash without re-parsing prose.
10. **Import review integrity.** Change `per side` to bilateral, required to optional, or
    `end block` to `reduce load`; the preview makes each material change visible before
    confirmation.

---

## 10. Final recommendation

Build the deterministic middle before adding an AI front door. The highest-value slice is:

```text
manual builder + external JSON v2
  → normalized immutable session definition
  → explicit schedule/replace/start intent
  → existing adjudication
  → persisted execution snapshot
  → mixed-dose runner and raw performed log
```

This makes the supplied sessions genuinely usable, preserves replay and user isolation,
and gives later prose parsing a safe place to land. Expanding the current free-text import
or the current reps/kilograms logger independently would create more content without
creating a trustworthy workout workflow.
